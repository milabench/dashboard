"""Manage the GPU specifications database.

Examples::

    # seed from built-in IGUANE data
    dashboard db gpus seed

    # list all GPUs
    dashboard db gpus list

    # list GPUs filtered by vendor
    dashboard db gpus list --vendor nvidia

    # show details for a specific GPU
    dashboard db gpus show H100-SXM5-80GB

    # add or update a GPU from JSON
    dashboard db gpus upsert "B200-NVL" '{"fp16": 2250, "fp32": 140, "fp64": 70, "tf32": 1125, "memgb": 186, "membw": 8000, "tdp": 1200, "reldate": "2025-03-18"}'

    # import GPUs from a TOML file (IGUANE rawdata.toml format)
    dashboard db gpus import /path/to/rawdata.toml

    # update a single spec key for an existing GPU
    dashboard db gpus set-spec H100-SXM5-80GB nvlink_bw 900
"""

import json

from argklass.command import Command, newparser


class GPUs(Command):
    """Manage GPU specifications: seed, list, add, import."""

    name: str = "gpus"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, GPUs)
        parser.add_argument(
            "action",
            choices=["seed", "list", "show", "upsert", "import", "set-spec"],
            help="Action to perform on the GPU database",
        )
        parser.add_argument(
            "positional",
            nargs="*",
            default=[],
            help="Positional arguments (varies by action)",
        )
        parser.add_argument(
            "--vendor",
            type=str,
            default=None,
            help="Filter by vendor (for list)",
        )
        parser.add_argument(
            "--arch",
            type=str,
            default=None,
            help="GPU architecture (for upsert)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri

        engine = create_engine(database_uri())

        with Session(engine) as sess:
            match args.action:
                case "seed":
                    _cmd_seed(sess)
                case "list":
                    _cmd_list(sess, vendor=args.vendor)
                case "show":
                    if not args.positional:
                        print("[gpus] show requires a GPU name")
                        return
                    _cmd_show(sess, args.positional[0])
                case "upsert":
                    if len(args.positional) < 2:
                        print("[gpus] upsert requires: <name> <json-specs>")
                        return
                    _cmd_upsert(sess, args.positional[0], args.positional[1], arch=args.arch)
                case "import":
                    if not args.positional:
                        print("[gpus] import requires a TOML file path")
                        return
                    _cmd_import(sess, args.positional[0])
                case "set-spec":
                    if len(args.positional) < 3:
                        print("[gpus] set-spec requires: <gpu-name> <key> <value>")
                        return
                    _cmd_set_spec(sess, args.positional[0], args.positional[1], args.positional[2])


def _cmd_seed(sess):
    from dashboard.server.database.gpu import seed_gpus

    count = seed_gpus(sess)
    print(f"[gpus] Seeded {count} GPUs")


def _cmd_list(sess, vendor=None):
    from sqlalchemy import select
    from dashboard.server.database.gpu import GPU

    stmt = select(GPU).order_by(GPU.release_date, GPU.name)
    if vendor:
        stmt = stmt.where(GPU.vendor == vendor)

    rows = sess.execute(stmt).scalars().all()

    if not rows:
        print("[gpus] No GPUs found")
        return

    header = f"{'Name':<50} {'Vendor':<8} {'Arch':<16} {'FP16':>10} {'FP32':>10} {'MemGB':>6} {'MemBW':>7} {'TDP':>5}"
    print(header)
    print("-" * len(header))

    for gpu in rows:
        fp16 = f"{gpu.fp16:.1f}" if gpu.fp16 is not None else "-"
        fp32 = f"{gpu.fp32:.1f}" if gpu.fp32 is not None else "-"
        memgb = f"{gpu.memgb:.0f}" if gpu.memgb is not None else "-"
        membw = f"{gpu.membw:.0f}" if gpu.membw is not None else "-"
        tdp = f"{gpu.tdp:.0f}" if gpu.tdp is not None else "-"
        arch = gpu.architecture or "-"

        print(f"{gpu.name:<50} {gpu.vendor:<8} {arch:<16} {fp16:>10} {fp32:>10} {memgb:>6} {membw:>7} {tdp:>5}")

    print(f"\n{len(rows)} GPU(s)")


def _cmd_show(sess, name):
    from sqlalchemy import select
    from dashboard.server.database.gpu import GPU

    gpu = sess.execute(select(GPU).where(GPU.name == name)).scalar_one_or_none()
    if gpu is None:
        print(f"[gpus] GPU '{name}' not found")
        return

    print(f"Name:         {gpu.name}")
    print(f"Vendor:       {gpu.vendor}")
    print(f"Architecture: {gpu.architecture or '-'}")
    print(f"Release Date: {gpu.release_date or '-'}")
    print()
    print("Performance Specs:")
    if gpu.specs:
        for k, v in sorted(gpu.specs.items()):
            print(f"  {k:<16} {v}")
    else:
        print("  (empty)")


def _cmd_upsert(sess, name, specs_json, arch=None):
    from dashboard.server.database.gpu import GPU, _guess_vendor, _guess_architecture, _gpu_to_row, _ROW_FIELDS

    try:
        raw = json.loads(specs_json)
    except json.JSONDecodeError as e:
        print(f"[gpus] Invalid JSON: {e}")
        return

    vendor = _guess_vendor(name)
    architecture = arch or _guess_architecture(name)
    gpu = GPU.from_spec(name, raw, vendor=vendor, architecture=architecture)

    from sqlalchemy.dialects.postgresql import insert as pg_insert

    stmt = pg_insert(GPU).values(**_gpu_to_row(gpu))
    stmt = stmt.on_conflict_do_update(
        index_elements=["name"],
        set_={k: getattr(stmt.excluded, k) for k in _ROW_FIELDS},
    )
    sess.execute(stmt)
    sess.commit()
    print(f"[gpus] Upserted '{name}'")


def _cmd_import(sess, toml_path):
    import tomllib
    from dashboard.server.database.gpu import GPU, _guess_vendor, _guess_architecture, _gpu_to_row, _ROW_FIELDS

    with open(toml_path, "rb") as f:
        data = tomllib.load(f)

    from sqlalchemy.dialects.postgresql import insert as pg_insert

    count = 0
    for name, raw in data.items():
        if not isinstance(raw, dict):
            continue

        vendor = _guess_vendor(name)
        gpu = GPU.from_spec(name, raw, vendor=vendor, architecture=_guess_architecture(name))

        stmt = pg_insert(GPU).values(**_gpu_to_row(gpu))
        stmt = stmt.on_conflict_do_update(
            index_elements=["name"],
            set_={k: getattr(stmt.excluded, k) for k in _ROW_FIELDS},
        )
        sess.execute(stmt)
        count += 1

    sess.commit()
    print(f"[gpus] Imported {count} GPUs from {toml_path}")


def _cmd_set_spec(sess, gpu_name, key, value):
    from sqlalchemy import select
    from dashboard.server.database.gpu import GPU

    gpu = sess.execute(select(GPU).where(GPU.name == gpu_name)).scalar_one_or_none()
    if gpu is None:
        print(f"[gpus] GPU '{gpu_name}' not found")
        return

    try:
        typed_value = json.loads(value)
    except (json.JSONDecodeError, ValueError):
        typed_value = value

    specs = dict(gpu.specs) if gpu.specs else {}
    specs[key] = typed_value
    gpu.specs = specs

    scalar_cols = {"fp4", "fp8", "fp16", "fp32", "fp64", "tf32", "memgb", "membw", "tdp"}
    if key in scalar_cols and isinstance(typed_value, (int, float)):
        setattr(gpu, key, float(typed_value))

    sess.commit()
    print(f"[gpus] Set {gpu_name}.specs[{key}] = {typed_value}")


COMMANDS = GPUs
