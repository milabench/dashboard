"""Compute scaling_observations_live from real pushed run data.

Distinct from ``cli/database/scaling.py``, which imports the static
``milabench/config/scaling/*.yaml`` snapshots. This instead aggregates
Exec/Pack/Metric rows already in the database — more up to date, at the
cost of being best-effort on two fronts that the live sizer-extraction path
doesn't have to deal with:

* Batch size is never recorded as a Metric (see investigation notes) — it's
  parsed out of ``Pack.command`` (the rendered argv) by looking for a
  handful of known CLI flag spellings. Packs where none match are skipped.
* GPU memory: prefer the absolute-MiB torchmem/jaxmem allocator peak; only
  fall back to gpudata's percentage-of-capacity reading (multiplied back up
  using the exec's reported total GPU memory) when neither is available.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone

import sqlalchemy as sa

from .database.models import Exec, Metric, Pack
from .database.scaling_live import LiveScalingObservation
from .visibility import public_exec_filter

# Ordered by specificity — checked in order, first match wins.
_BATCH_SIZE_FLAGS = (
    "--per_device_train_batch_size",
    "--per_gpu_batch_size",
    "--buffer_batch_size",
    "--train_batch_size",
    "--mini-batch-size",
    "--batch-size",
    "--batch_size",
)

# torchtune's CLI takes bare `key=value` overrides (no leading dashes), e.g.
# `... bench/lora_finetune_single_device.py epochs=1 batch_size=8 ...` — seen
# on llm-lora-single/-ddp-gpus/-mp-gpus and llm-full-mp-gpus.
_BARE_KEY_VALUE_BATCH_SIZE_FLAGS = ("batch_size",)

_KNOWN_GPU_CODES = re.compile(
    r"\b(H100|H200|A100|A40|A30|A10|A6000|L40S?|B100|B200|GB10|GB200|"
    r"MI300X?|MI325X?|MI355X?|MI250X?|MI210|V100|T4|P100)\b",
    re.IGNORECASE,
)
_GPU_NOISE_WORDS = re.compile(
    r"\b(NVIDIA|AMD|Instinct|Corporation|GeForce|RTX|OAM|SXM\d*|PCIe|HBM\d*)\b",
    re.IGNORECASE,
)


def extract_batch_size(command) -> int | None:
    """Best-effort batch size from a Pack's rendered argv list."""
    if not command:
        return None
    for i, arg in enumerate(command):
        if not isinstance(arg, str):
            continue
        if "=" in arg:
            flag, _, value = arg.partition("=")
            if flag in _BATCH_SIZE_FLAGS or flag in _BARE_KEY_VALUE_BATCH_SIZE_FLAGS:
                try:
                    return int(value)
                except ValueError:
                    return None
        elif arg in _BATCH_SIZE_FLAGS and i + 1 < len(command):
            try:
                return int(command[i + 1])
            except (TypeError, ValueError):
                return None
    return None


def normalize_gpu_short(product: str | None) -> str | None:
    """Best-effort short GPU code, e.g. "NVIDIA H100 80GB HBM3" -> "H100"."""
    if not product:
        return None
    text = product.strip()
    m = _KNOWN_GPU_CODES.search(text)
    if m:
        return m.group(1).upper()
    cleaned = _GPU_NOISE_WORDS.sub("", text).strip()
    tokens = cleaned.split()
    return tokens[0] if tokens else text


def _gpu_total_mib(meta: dict) -> float | None:
    try:
        gpus = meta["accelerators"]["gpus"]
        first = next(iter(gpus.values()))
        total = first["memory"]["total"]
        return float(total)
    except (KeyError, TypeError, StopIteration, ValueError):
        return None


def compute_live_scaling(session, benches: list[str] | None = None) -> dict:
    """Recompute the whole scaling_observations_live cache.

    Returns a summary: {written, skipped_no_batch_size, skipped_no_gpu, packs_considered}.
    """
    exec_rows = session.execute(
        sa.select(Exec._id, Exec.meta).where(public_exec_filter(), Exec.status == "done")
    ).all()
    meta_by_exec = {e._id: (e.meta or {}) for e in exec_rows}
    if not meta_by_exec:
        return {"written": 0, "skipped_no_batch_size": 0, "skipped_no_gpu": 0, "packs_considered": 0}

    pack_rows = session.execute(
        sa.select(Pack._id, Pack.exec_id, Pack.name, Pack.command)
        .where(
            Pack.exec_id.in_(meta_by_exec.keys()),
            Pack.status == "done",
            Pack.invalidated.is_(False),
        )
    ).all()

    if benches:
        bench_set = set(benches)
        pack_rows = [p for p in pack_rows if p.name in bench_set]

    packs_considered = len(pack_rows)
    if not pack_rows:
        return {"written": 0, "skipped_no_batch_size": 0, "skipped_no_gpu": 0, "packs_considered": 0}

    pack_ids = [p._id for p in pack_rows]

    perf_by_pack: dict[int, float] = dict(
        session.execute(
            sa.select(Metric.pack_id, sa.func.avg(Metric.value))
            .where(Metric.pack_id.in_(pack_ids), Metric.name == "rate")
            .group_by(Metric.pack_id)
        ).all()
    )

    allocmem_by_pack: dict[int, float] = dict(
        session.execute(
            sa.select(Metric.pack_id, sa.func.max(Metric.value))
            .where(
                Metric.pack_id.in_(pack_ids),
                Metric.name.in_(["torchmem.max_allocated", "jaxmem.max_allocated"]),
            )
            .group_by(Metric.pack_id)
        ).all()
    )

    gpudata_pct_by_pack: dict[int, float] = dict(
        session.execute(
            sa.select(Metric.pack_id, sa.func.max(Metric.value))
            .where(Metric.pack_id.in_(pack_ids), Metric.name == "gpudata.memory")
            .group_by(Metric.pack_id)
        ).all()
    )

    # (gpu, bench, batch_size) -> accumulator
    points: dict[tuple, dict] = defaultdict(lambda: {
        "perf": [], "memory": [], "torch": None, "backend": None, "exec_id": None, "pack_id": None,
    })

    skipped_no_batch_size = 0
    skipped_no_gpu = 0

    for pack in pack_rows:
        meta = meta_by_exec.get(pack.exec_id, {})
        gpu = normalize_gpu_short(
            (meta.get("accelerators") or {}).get("gpus", {}).get("0", {}).get("product")
        )
        if not gpu:
            skipped_no_gpu += 1
            continue

        batch_size = extract_batch_size(pack.command)
        if batch_size is None:
            # Some benchmarks (e.g. torchtitan/openinstruct) don't take a
            # plain --batch-size-style flag at all — fall back to the
            # sizer's own recorded override, when this run explicitly set
            # one (see grouping.py's "resized (batch_size=X)" — same field).
            override = (meta.get("overrides") or {}).get("sizer.batch_size")
            try:
                batch_size = int(override) if override is not None else None
            except (TypeError, ValueError):
                batch_size = None
        if batch_size is None:
            skipped_no_batch_size += 1
            continue

        memory = allocmem_by_pack.get(pack._id)
        if memory is None:
            pct = gpudata_pct_by_pack.get(pack._id)
            total_mib = _gpu_total_mib(meta)
            if pct is not None and total_mib is not None:
                memory = pct * total_mib

        pytorch = meta.get("pytorch") or {}
        torch_ver = pytorch.get("torch") or pytorch.get("version")
        backend = "rocm" if pytorch.get("hip") else ("cuda" if pytorch.get("cuda") else None)

        acc = points[(gpu, pack.name, batch_size)]
        if pack._id in perf_by_pack:
            acc["perf"].append(perf_by_pack[pack._id])
        if memory is not None:
            acc["memory"].append(memory)
        acc["torch"] = acc["torch"] or torch_ver
        acc["backend"] = acc["backend"] or backend
        acc["exec_id"] = pack.exec_id
        acc["pack_id"] = pack._id

    now = datetime.now(timezone.utc)
    # Scope the wipe to what this recompute actually covers — a benches-
    # filtered call must not delete cached points for benches it didn't
    # touch.
    delete_stmt = sa.delete(LiveScalingObservation)
    if benches:
        delete_stmt = delete_stmt.where(LiveScalingObservation.bench.in_(benches))
    session.execute(delete_stmt)
    written = 0
    for (gpu, bench, batch_size), acc in points.items():
        if not acc["perf"] and not acc["memory"]:
            continue
        session.add(LiveScalingObservation(
            gpu=gpu,
            bench=bench,
            batch_size=batch_size,
            memory_mib=(sum(acc["memory"]) / len(acc["memory"])) if acc["memory"] else None,
            perf=(sum(acc["perf"]) / len(acc["perf"])) if acc["perf"] else None,
            n_samples=max(len(acc["perf"]), len(acc["memory"]), 1),
            torch=acc["torch"],
            backend=acc["backend"],
            exec_id=acc["exec_id"],
            pack_id=acc["pack_id"],
            computed_at=now,
        ))
        written += 1
    session.commit()

    return {
        "written": written,
        "skipped_no_batch_size": skipped_no_batch_size,
        "skipped_no_gpu": skipped_no_gpu,
        "packs_considered": packs_considered,
    }
