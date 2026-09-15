"""Experimental (DEV only): suggest milabench commands to fill gaps in the
scaling_observations_live cache.

"Expected" coverage comes from milabench's own ``config/sizing.yaml`` — the
multirun definition used to build a benchmark's batch-size-vs-memory/perf
scaling profile in the first place. Of its four sweeps (mult, add, fixed_bs,
auto), only ``fixed_bs`` names literal, GPU/benchmark-independent batch
sizes; the other three are relative to a runtime-measured baseline batch
size that isn't recoverable from cached data alone, so this only checks
coverage of the fixed_bs set. That's a known, deliberate scope limit for
this first version, not an oversight.
"""

from __future__ import annotations

from pathlib import Path

from flask import jsonify, request
from sqlalchemy import select

from .database.scaling_live import LiveScalingObservation

# Mirrors config/sizing.yaml's "fixed_bs{sizer.batch_size}" run — kept as a
# fallback so this still works if the milabench source tree isn't checked
# out alongside the dashboard (e.g. a packaged deploy).
_FALLBACK_TARGET_BATCH_SIZES = [1, 2, 4, 8, 16, 32, 64, 128]


def _sizing_yaml_path() -> Path | None:
    # .../dashboard/dashboard/server/scaling_suggest.py
    # parents[3] == the milabench_dev workspace root, sibling to milabench/
    workspace = Path(__file__).resolve().parents[3]
    candidate = workspace / "milabench" / "config" / "sizing.yaml"
    return candidate if candidate.is_file() else None


def target_batch_sizes() -> list[int]:
    """Best-effort literal batch-size targets from sizing.yaml's fixed_bs run."""
    path = _sizing_yaml_path()
    if path is None:
        return list(_FALLBACK_TARGET_BATCH_SIZES)

    try:
        import yaml

        with path.open() as fh:
            data = yaml.safe_load(fh) or {}
        for run in (data.get("multirun") or {}).get("runs", []):
            matrix = run.get("matrix") or {}
            if "sizer.batch_size" in matrix:
                return sorted({int(v) for v in matrix["sizer.batch_size"]})
    except Exception:
        pass

    return list(_FALLBACK_TARGET_BATCH_SIZES)


def suggest_command(bench: str, batch_size: int) -> str:
    """A directly-runnable milabench command to fill one missing data point."""
    return (
        f"milabench run --select {bench} "
        f"--override sizer.auto=1 --override sizer.batch_size={batch_size}"
    )


def scaling_suggest_routes(bp, sqlexec):
    @bp.route("/api/scaling-live/suggest", methods=["GET"])
    def api_scaling_live_suggest():
        gpu_filter = request.args.get("gpu")
        bench_filter = request.args.get("bench")
        targets = target_batch_sizes()

        stmt = select(LiveScalingObservation.gpu, LiveScalingObservation.bench, LiveScalingObservation.batch_size)
        if gpu_filter:
            stmt = stmt.where(LiveScalingObservation.gpu == gpu_filter)
        if bench_filter:
            stmt = stmt.where(LiveScalingObservation.bench == bench_filter)

        observed: dict[tuple[str, str], set[int]] = {}
        with sqlexec() as sess:
            for gpu, bench, batch_size in sess.execute(stmt).all():
                observed.setdefault((gpu, bench), set()).add(batch_size)

        suggestions = []
        for (gpu, bench), observed_sizes in sorted(observed.items()):
            missing = sorted(set(targets) - observed_sizes)
            if not missing:
                continue
            suggestions.append({
                "gpu": gpu,
                "bench": bench,
                "observed_batch_sizes": sorted(observed_sizes),
                "missing_batch_sizes": missing,
                "commands": [
                    {"batch_size": bs, "command": suggest_command(bench, bs)}
                    for bs in missing
                ],
            })

        return jsonify({
            "target_batch_sizes": targets,
            "suggestions": suggestions,
        })
