"""Import milabench scaling YAML observations into Postgres.

Examples::

    # import from milabench config/scaling (skips default.yaml, inference.yaml;
    # runs milabench.sizer.deduplicate_observation before insert)
    dashboard db scaling import

    # import from an explicit directory
    dashboard db scaling import /path/to/scaling

    # list distinct GPUs currently in the table
    dashboard db scaling list
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from argklass.command import Command, newparser

SKIP_FILES = frozenset({"default.yaml", "inference.yaml"})


class Scaling(Command):
    """Import / list scaling observations."""

    name: str = "scaling"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Scaling)
        parser.add_argument(
            "action",
            choices=["import", "list"],
            help="Action to perform",
        )
        parser.add_argument(
            "path",
            nargs="?",
            default=None,
            help="Directory of *.yaml scaling files (for import)",
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to data directory containing .secrets (default: repo data/)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine, select, func
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri, load_db_secrets
        from dashboard.server.database.scaling import ScalingObservation

        load_db_secrets(root=args.secrets)
        try:
            uri = database_uri()
        except ValueError as err:
            print(f"[scaling] {err}")
            return 1

        if hasattr(uri, "host"):
            print(f"[scaling] Connecting to {uri.host} as {uri.username}")
        engine = create_engine(uri)

        with Session(engine) as sess:
            match args.action:
                case "import":
                    directory = _resolve_scaling_dir(args.path)
                    return _cmd_import(sess, directory)
                case "list":
                    rows = sess.execute(
                        select(
                            ScalingObservation.gpu,
                            func.count(ScalingObservation._id),
                        ).group_by(ScalingObservation.gpu)
                        .order_by(ScalingObservation.gpu)
                    ).all()
                    if not rows:
                        print("[scaling] No observations in database")
                        return 0
                    for gpu, count in rows:
                        print(f"  {gpu:<16} {count:>6} rows")
                    return 0


def _resolve_scaling_dir(path: str | None) -> Path:
    if path:
        return Path(path)

    # Prefer packaged dashboard copy (deploy), else milabench config/scaling.
    try:
        import importlib.resources as importlib_resources

        packaged = Path(importlib_resources.files("dashboard.data") / "scaling")
        if packaged.is_dir() and any(packaged.glob("*.yaml")):
            return packaged
    except Exception:
        pass

    # .../milabench_dev/dashboard/dashboard/cli/database/scaling.py
    # parents[4] == milabench_dev workspace root
    workspace = Path(__file__).resolve().parents[4]
    candidates = [
        workspace / "milabench" / "config" / "scaling",
        Path(os.environ["MILABENCH_SCALING_DIR"])
        if os.environ.get("MILABENCH_SCALING_DIR")
        else None,
    ]
    for cand in candidates:
        if cand is not None and cand.is_dir():
            return cand

    raise SystemExit(
        "[scaling] No scaling directory found. Pass an explicit path, "
        "or set MILABENCH_SCALING_DIR."
    )


def _mib(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    from milabench.sizer import to_octet

    return to_octet(str(value)) / (1024**2)


def _count_observations(data: dict) -> int:
    total = 0
    for bench, config in data.items():
        if bench == "version" or not isinstance(config, dict):
            continue
        total += len(config.get("observations") or [])
    return total


def _normalize_scaling(data: dict) -> dict:
    """Convert v1 ``model`` maps and ensure ``cpu`` is set for dedup keys."""
    normalized = {}
    for bench, config in data.items():
        if bench == "version":
            normalized[bench] = config
            continue
        if not isinstance(config, dict):
            continue

        observations = config.get("observations")
        if observations is None and "model" in config:
            observations = [
                {"batch_size": int(k), "memory": v, "cpu": 0, "perf": 1.0, "time": 0}
                for k, v in config["model"].items()
            ]
        else:
            observations = list(observations or [])

        for obs in observations:
            if "cpu" not in obs or obs["cpu"] is None:
                obs["cpu"] = 0
            if "perf" not in obs or obs["perf"] is None:
                obs["perf"] = 0
            if "time" not in obs or obs["time"] is None:
                obs["time"] = 0

        normalized[bench] = {"observations": observations}
    return normalized


def _parse_file(path: Path) -> tuple[list, int, int]:
    """Load YAML, deduplicate, return (rows, raw_count, deduped_count)."""
    import yaml
    from milabench.sizer import deduplicate_observation

    from dashboard.server.database.scaling import ScalingObservation

    with path.open("r") as fp:
        data = yaml.safe_load(fp) or {}

    normalized = _normalize_scaling(data)
    raw_count = _count_observations(normalized)
    deduped = deduplicate_observation(normalized)
    deduped_count = _count_observations(deduped)

    gpu = path.stem
    source_file = path.name
    rows = []

    for bench, config in deduped.items():
        if bench == "version" or not isinstance(config, dict):
            continue

        for obs in config.get("observations") or []:
            observed_at = None
            raw_time = obs.get("time")
            if raw_time is not None:
                try:
                    observed_at = datetime.fromtimestamp(
                        float(raw_time), tz=timezone.utc
                    )
                except (TypeError, ValueError, OSError):
                    observed_at = None

            rows.append(
                ScalingObservation(
                    gpu=gpu,
                    bench=bench,
                    batch_size=int(obs["batch_size"]),
                    cpu=int(obs["cpu"]) if obs.get("cpu") is not None else None,
                    memory_mib=_mib(obs.get("memory")),
                    torchmem_mib=_mib(obs.get("torchmem")),
                    jaxmem_mib=_mib(obs.get("jaxmem")),
                    perf=float(obs["perf"]) if obs.get("perf") is not None else None,
                    observed_at=observed_at,
                    torch=obs.get("torch"),
                    backend=obs.get("backend"),
                    backend_version=obs.get("backend_version"),
                    revision=obs.get("revision"),  # reserved; usually None
                    source_file=source_file,
                )
            )

    return rows, raw_count, deduped_count


def _cmd_import(sess, directory: Path) -> int:
    from sqlalchemy import delete

    from dashboard.server.database.scaling import ScalingObservation

    directory = Path(directory)
    if not directory.is_dir():
        print(f"[scaling] Not a directory: {directory}")
        return 1

    files = sorted(
        p for p in directory.glob("*.yaml") if p.name not in SKIP_FILES
    )
    if not files:
        print(f"[scaling] No YAML files to import in {directory} (skipped {sorted(SKIP_FILES)})")
        return 0

    print(f"[scaling] Importing from {directory} (deduplicating via milabench.sizer)")
    total = 0
    for path in files:
        rows, raw_count, deduped_count = _parse_file(path)
        gpu = path.stem
        sess.execute(
            delete(ScalingObservation).where(ScalingObservation.gpu == gpu)
        )
        sess.add_all(rows)
        sess.commit()
        dropped = raw_count - deduped_count
        print(
            f"  {path.name}: {deduped_count} observations"
            f" (from {raw_count}, dropped/merged {dropped})"
        )
        total += len(rows)

    print(f"[scaling] Done — {total} rows across {len(files)} GPU file(s)")
    return 0


COMMANDS = Scaling
