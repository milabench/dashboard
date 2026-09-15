"""Best-effort correlation between a benchmark_results.db run and the raw
milabench .data log that produced it, so GPU power data can be pulled in and
plotted alongside the request timeline (tokens/joule "performance per watt").

The two live on different clocks. `_Run.created_at` and `_Request.start_time`
are written by benchmate.timeline itself: created_at is a wall-clock
datetime.utcnow(), but start_time/latency sit on whatever monotonic-ish clock
the benchmark process used internally (its zero point is arbitrary, NOT unix
epoch). The .data log's "start"/"end" phase-boundary events and its gpudata
samples, on the other hand, ARE stamped with wall-clock unix-epoch time
(voir's own event clock) — which IS directly comparable to created_at.

That gives a way to place a .data file in time (compare its "end" event to
created_at) and a way to convert its gpudata timestamps into the SAME
request-relative coordinate our buckets use: assume the "end" phase event
fires at approximately the same moment TimelineProcessor's own `run_end`
(max request end, relative) does, giving a single additive offset between
the two clocks (they tick at the same rate — only the zero point differs, so
this is an offset, not a rescale).
"""
import json
from datetime import datetime, timezone
from pathlib import Path

# How close a .data file's "end" event must land to a run's created_at to be
# considered a match. Generous: the actual gap observed in practice is the
# few seconds calculate_metrics() spends on report generation after
# TimelineProcessor runs, but this stays forgiving for slower machines.
MATCH_TOLERANCE_S = 180.0


def _scan_data_file(path: Path):
    """One pass over a .data file's JSON lines, pulling out just what's
    needed to correlate it and extract its GPU power series.
    """
    end_wall = None
    gpu_samples = []  # [(wall_clock_time, {device_id: watts})]

    with open(path, "r", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            event = entry.get("event")
            data = entry.get("data") or {}

            if event == "end" and isinstance(data.get("time"), (int, float)):
                end_wall = data["time"]
            elif event == "data":
                gpudata = data.get("gpudata")
                t = data.get("time")
                if isinstance(gpudata, dict) and isinstance(t, (int, float)):
                    watts = {
                        dev: v.get("power")
                        for dev, v in gpudata.items()
                        if isinstance(v, dict) and isinstance(v.get("power"), (int, float))
                    }
                    if watts:
                        gpu_samples.append((t, watts))

    return {"end_wall": end_wall, "gpu_samples": gpu_samples}


def _to_utc_epoch(created_at: datetime) -> float:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.timestamp()


def find_matching_gpu_data(db_path: Path, run_created_at: datetime):
    """Scan .data files under db_path's directory for the one whose "end"
    phase event lands closest to this run's created_at. Returns
    (path, end_wall, gpu_samples) for the best match within tolerance, or
    None if nothing matched closely enough (or no .data file had any
    gpudata samples at all).
    """
    target = _to_utc_epoch(run_created_at)
    best = None
    best_delta = MATCH_TOLERANCE_S

    for candidate in Path(db_path).parent.rglob("*.data"):
        try:
            scanned = _scan_data_file(candidate)
        except (OSError, UnicodeDecodeError):
            continue
        end_wall = scanned["end_wall"]
        if end_wall is None or not scanned["gpu_samples"]:
            continue
        delta = abs(end_wall - target)
        if delta < best_delta:
            best_delta = delta
            best = (candidate, end_wall, scanned["gpu_samples"])

    return best


def gpu_power_report(db_path: Path, run_created_at: datetime, run_duration: float, buckets: list[dict]):
    """Best-effort GPU power series + per-bucket tokens/joule efficiency for
    a run, or {"available": False} if no matching .data file was found.

    `run_duration` and `buckets` come from the SAME request-relative clock
    used everywhere else in this run's report (buckets already carry
    `start`/`time`/`rate` in that coordinate system) — the gpudata series is
    converted into that same coordinate system so it can be plotted and
    correlated against them directly.
    """
    match = find_matching_gpu_data(db_path, run_created_at)
    if match is None:
        return {"available": False}

    path, end_wall, gpu_samples = match
    # Both clocks tick at the same rate; only the zero point differs. The
    # "end" event fires at approximately the same moment run_duration
    # (this run's own max relative request-end) does, so that pair anchors
    # the additive offset between them.
    offset = end_wall - run_duration

    series = sorted(
        (
            {"time": t - offset, "power_w": sum(watts.values())}
            for t, watts in gpu_samples
        ),
        key=lambda s: s["time"],
    )

    def power_at(rel_time_lo, rel_time_hi):
        pts = [s["power_w"] for s in series if rel_time_lo <= s["time"] < rel_time_hi]
        return sum(pts) / len(pts) if pts else None

    bucket_power = []
    for b in buckets:
        avg_power = power_at(b["start"], b["time"])
        bucket_power.append({
            "time": b["time"],
            "start": b["start"],
            "power_w": avg_power,
            # tok/s divided by W == tok/(s*W) == tok/J: the standard
            # performance-per-watt efficiency figure.
            "tokens_per_joule": (b["rate"] / avg_power) if avg_power else None,
        })

    return {
        "available": True,
        "data_file": str(path),
        "series": series,
        "buckets": bucket_power,
    }
