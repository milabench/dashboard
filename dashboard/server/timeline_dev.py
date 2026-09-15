"""Dev-only endpoints for browsing benchmate timeline databases.

Reuses benchmate.timeline (ResultStore / TimelineProcessor) directly so the
numbers shown here are computed by the exact same code path as the CLI
(`python -m benchmate.timeline --db ...`) and the benchmarks themselves.
"""
import json
import traceback
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from flask import request, Response, stream_with_context

from .timeline_gpu import gpu_power_report


def _parse_created_at(raw: str) -> datetime:
    # str(datetime) omits the fractional part entirely when microsecond==0.
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")


def _sse(event, data):
    """Format a Server-Sent Event (matches dashboard/server/push.py's
    convention, so both streaming endpoints in this app speak the same
    wire format and the frontend can share one parser).
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def timeline_processor(app, bp, cache):
    from benchmate.timeline import (
        ResultStore,
        TimelineProcessor,
        TimelineConfig,
        JobAdapter,
        convert,
        vllm_style_report,
        bucket_aggregate_report,
        apply_ramp_trim,
        compute_launch_trim_window,
        select_buckets_in_window,
    )

    # A SQLAlchemy engine is meant to be shared/reused across requests and
    # threads, not recreated per request — /check and /runs (used before a
    # run is even picked) can still land concurrently with an in-flight
    # /stream, and building a brand new ResultStore (and re-running its
    # schema migration) for each one raced against SQLite's single-writer
    # lock and intermittently failed with "database is locked".
    @lru_cache(maxsize=8)
    def _get_store(path_str):
        return ResultStore(path_str)

    def resolve_db_path():
        # ?db_path=... is the primary source now (the frontend keeps it in
        # the URL); the cookie is only a fallback for any stale client.
        raw = request.args.get("db_path") or request.cookies.get("timelineDbPath")
        return raw.strip() if raw else None

    def open_store():
        raw = resolve_db_path()
        if not raw:
            return None, ({"error": "No database path set. Set one via the Timeline view."}, 400)
        path = Path(raw).expanduser()
        if not path.exists():
            return None, ({"error": f"File not found: {path}"}, 404)
        return _get_store(str(path)), None

    def bucket_params():
        return {
            "num_buckets": request.args.get("num_buckets", 30, type=int),
            "input_weight": request.args.get("input_weight", 1.0, type=float),
            "output_weight": request.args.get("output_weight", 5.0, type=float),
        }

    def trim_window(outputs, params, concurrency, trim_enabled, trim_mode):
        """Compute the full (untrimmed) bucket set once — needed to locate
        the trim window (the concurrency strategy reads active_jobs off it)
        and to show the whole run's shape for context — then derive the
        trim window (via whichever strategy is selected), and return
        (full_buckets, trim_info, report_outputs).

        Once a window is known, the `num_buckets` official buckets are laid
        out FRESH, directly inside that window (its own placement and
        width), rather than discarding buckets from the fixed whole-run
        grid after the fact: that way all N are genuinely clean
        steady-state samples — "N buckets = N samples for milabench" — and
        the window is exactly their combined span by construction, with no
        separate bucket-alignment step needed. TimelineProcessor also
        returns "fake" buckets outside the window (tagged in_window=False)
        purely so the chart keeps showing ramp-up/down context; those never
        feed report_outputs or the aggregate report.
        """
        config = TimelineConfig(
            num_buckets=params["num_buckets"],
            input_token_weight=params["input_weight"],
            output_token_weight=params["output_weight"],
        )
        full_buckets = TimelineProcessor(config)(outputs, number=params["num_buckets"], persist=False)

        window = None
        if trim_enabled:
            if trim_mode == "launch":
                window = compute_launch_trim_window(outputs, concurrency)
            else:
                ramp = apply_ramp_trim(full_buckets, concurrency)
                window = ramp["window"]
                if window is None and full_buckets and not ramp["buckets"]:
                    # apply_ramp_trim's "every bucket satisfies the
                    # threshold" case — the whole run would be trimmed
                    # away. window=None here means something different
                    # from "no threshold configured" (which also leaves
                    # window=None); represent it as an explicitly empty
                    # window instead of silently falling back to no trim.
                    window = (0.0, 0.0)

        # Purely informational: how much of the coarse whole-run grid the
        # window cuts away, for the "dropped N bucket(s)" status text.
        selection = select_buckets_in_window(full_buckets, window)

        if window is not None:
            display_buckets = TimelineProcessor(config)(
                outputs, number=params["num_buckets"], persist=False, window=window,
            )
            official_buckets = [b for b in display_buckets if b["in_window"]]
        else:
            display_buckets = full_buckets
            official_buckets = full_buckets

        trim = {
            "buckets": official_buckets,
            "display_buckets": display_buckets,
            "window": window,
            "trimmed_start": selection["trimmed_start"],
            "trimmed_end": selection["trimmed_end"],
        }

        report_outputs = outputs
        if window is not None:
            window_start, window_end = window
            min_start = min(o["start_time"] for o in outputs)
            report_outputs = [
                o for o in outputs
                if window_start <= (o["start_time"] - min_start) < window_end
            ]

        return full_buckets, trim, report_outputs

    @bp.route("/api/timeline/check", methods=["GET"])
    def timeline_check():
        raw = resolve_db_path()
        if not raw:
            return {"ok": False, "error": "No database path set."}, 400
        path = Path(raw).expanduser()
        if not path.exists():
            return {"ok": False, "error": f"File not found: {path}"}, 404
        return {"ok": True, "path": str(path)}

    @bp.route("/api/timeline/runs", methods=["GET"])
    def timeline_list_runs():
        store, err = open_store()
        if err:
            return err
        return store.list_runs()

    @bp.route("/api/timeline/runs/<int:run_id>/stream", methods=["GET"])
    def timeline_stream(run_id):
        """One request that does all of a page load's work and streams each
        stage as it completes, instead of four independent endpoints
        (requests/buckets/report/gantt) each re-loading the run from the db
        and — for buckets/report — separately recomputing the exact same
        trim window. That duplication was also a real correctness hazard:
        it's how buckets and report ended up disagreeing earlier. Now
        there's exactly one DB load and one trim_window() call per page
        load, reused for every stage below — one source of truth, no
        wasted work, and cancelling the request (e.g. the frontend
        superseding it with a new one) stops whatever stage hasn't started
        yet, since a closed connection breaks the next yield.
        """
        store, err = open_store()
        if err:
            return err

        params = bucket_params()
        trim_enabled = request.args.get("trim", "false").lower() in ("1", "true", "yes")
        trim_mode = request.args.get("trim_mode", "concurrency")
        concurrency = request.args.get("concurrency", type=float)

        def generate():
            try:
                outputs = store.load(run_id=run_id)
                if not outputs:
                    yield _sse("error", {"error": f"Run {run_id} has no requests (or does not exist)."})
                    return
                yield _sse("requests", outputs)

                # persist=False: this is a read-only view, never re-writes the db.
                full_buckets, trim, report_outputs = trim_window(
                    outputs, params, concurrency, trim_enabled, trim_mode,
                )
                trim_meta = {
                    "enabled": trim_enabled,
                    "mode": trim_mode,
                    "concurrency": concurrency,
                    "trimmed_start": trim["trimmed_start"],
                    "trimmed_end": trim["trimmed_end"],
                    "kept_buckets": len(trim["buckets"]),
                    "total_buckets": len(full_buckets),
                    "window": trim["window"],
                }
                yield _sse("buckets", {
                    # display_buckets includes the "fake" context buckets
                    # outside the trim window (in_window=False) so the chart
                    # still shows ramp-up/down shape; `buckets` (official,
                    # in-window only) is what the aggregate report actually
                    # samples from.
                    "buckets": trim["display_buckets"],
                    "official_buckets": trim["buckets"],
                    "full_buckets": full_buckets,
                    "trim": trim_meta,
                })

                jobs = [JobAdapter(convert(o)) for o in outputs]
                jobs.sort(key=lambda item: item.end)
                jobs.sort(key=lambda item: item.start)
                proc = TimelineProcessor(TimelineConfig())
                proc.method_1(jobs)
                yield _sse("gantt", [job.__json__() for job in jobs])

                yield _sse("report", {
                    # vLLM's own script has no concept of ramp trimming — it
                    # always reduces the whole run to one number — so this
                    # side always uses every request, trim or not. That's
                    # the point of the comparison: what vLLM's naive
                    # whole-run method reports versus what the bucket
                    # method reports once ramp-up/down is excluded.
                    "vllm": vllm_style_report(outputs),
                    # trim["buckets"] is the official, in-window-only bucket
                    # set — exactly num_buckets samples laid out fresh
                    # inside the trim window itself, not a subset of (or a
                    # grid re-derived from) a fixed whole-run grid. That
                    # keeps this report from being vulnerable to a single
                    # long-tail straggler (one that started inside the
                    # window but finishes well after everyone else)
                    # stretching an independently-rebuilt grid into a fake
                    # near-empty tail — the failure mode a from-scratch
                    # rebuild sized to report_outputs' own start/end span
                    # would have.
                    "bucket_aggregate": bucket_aggregate_report(
                        report_outputs, params["num_buckets"], params["input_weight"], params["output_weight"],
                        buckets=trim["buckets"],
                    ),
                    "trim": {
                        **trim_meta,
                        "requests_used": len(report_outputs),
                        "requests_total": len(outputs),
                    },
                })

                # Best-effort: a matching .data log with GPU power samples
                # may not exist (path not reachable, run not saved with its
                # logs, etc.) — that's a normal, expected outcome, not an
                # error worth failing the whole stream over.
                try:
                    run_row = next((r for r in store.list_runs() if r["run_id"] == run_id), None)
                    if run_row is None:
                        gpu = {"available": False}
                    else:
                        gpu = gpu_power_report(
                            Path(resolve_db_path()).expanduser(),
                            _parse_created_at(run_row["created_at"]),
                            full_buckets[-1]["time"] if full_buckets else 0.0,
                            trim["buckets"],
                        )
                except Exception as gpu_err:
                    gpu = {"available": False, "error": str(gpu_err)}
                yield _sse("gpu", gpu)

                yield _sse("done", None)
            except Exception as err:
                yield _sse("error", {"error": str(err), "traceback": traceback.format_exc()})

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
