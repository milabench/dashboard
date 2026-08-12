"""Breakdown view: weighted scores per GPU for a selectable benchmark set."""

from __future__ import annotations

import math
from collections import defaultdict

from flask import jsonify, request
from sqlalchemy import select

from dashboard.server.database.models import Weight
from dashboard.server.plot import PERF_AGG_METHODS, sql_direct_report
from dashboard.server.utils import cursor_to_json

DEFAULT_PERF_AGG = "median"


def parse_perf_agg(raw: str | None) -> str:
    method = (raw or DEFAULT_PERF_AGG).strip().lower()
    if method not in PERF_AGG_METHODS:
        return DEFAULT_PERF_AGG
    return method


def _enabled_rows(report_rows: list[dict]) -> tuple[list[dict], float]:
    rows: list[dict] = []
    weight_total = 0.0
    for row in report_rows:
        enabled = float(row.get("enabled") or 0)
        weight = float(row.get("weight") or 0)
        if enabled <= 0 or weight <= 0:
            continue
        rows.append(row)
        if weight_total <= 0:
            weight_total = float(row.get("weight_total") or 0)
    if weight_total <= 0 and rows:
        weight_total = sum(float(row.get("weight") or 0) for row in rows)
    return rows, weight_total


def aggregate_score(report_rows: list[dict]) -> tuple[float, int]:
    """Weighted geometric mean over per-benchmark scores (execution report formula)."""
    rows, weight_total = _enabled_rows(report_rows)
    if not rows or weight_total <= 0:
        return 0.0, 0

    log_sum = sum(float(row.get("log_score") or 0) for row in rows)
    return math.exp(log_sum / weight_total), len(rows)


def _strip_json_text(value) -> str | None:
    """Postgres JSON ->> on a string value often includes JSON quotes."""
    if value is None:
        return None
    text = str(value).strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def workload_rows(sess, profile: str) -> list[dict]:
    stmt = select(Weight).where(Weight.profile == profile).order_by(Weight.priority)
    rows = []
    for row in sess.execute(stmt):
        w: Weight = row[0]
        rows.append(
            {
                "pack": w.pack,
                "group1": w.group1,
                "group2": w.group2,
                "group3": w.group3,
                "group4": w.group4,
                "weight": w.weight,
                "enabled": w.enabled,
                "priority": w.priority,
            }
        )
    return rows


def parse_benches_arg(raw: str | None) -> list[str] | None:
    if raw is None or not raw.strip():
        return None
    benches = [b.strip() for b in raw.split(",") if b.strip()]
    return benches or None


def gpu_scores(
    sqlexec,
    profile: str,
    benches: list[str],
    *,
    perf_agg: str = DEFAULT_PERF_AGG,
) -> list[dict]:
    """Score per GPU (latest public exec), filtered to ``benches``."""
    from dashboard.server.gpu_summary import _live_query

    gpu_rows = _live_query(sqlexec)
    if not gpu_rows:
        return []

    exec_ids = [str(r["exec_id"]) for r in gpu_rows]
    with sqlexec() as sess:
        stmt = sql_direct_report(
            exec_ids,
            profile=profile,
            benches=benches,
            perf_agg=perf_agg,
        )
        cursor = sess.execute(stmt)
        report_by_exec: dict[int, list[dict]] = defaultdict(list)
        for row in cursor_to_json(cursor):
            report_by_exec[int(row["exec_id"])].append(row)

    results = []
    for gpu_row in gpu_rows:
        exec_id = int(gpu_row["exec_id"])
        score, bench_count = aggregate_score(report_by_exec.get(exec_id, []))
        results.append(
            {
                "gpu": _strip_json_text(gpu_row["gpu"]),
                "exec_id": exec_id,
                "run_name": gpu_row["run_name"],
                "latest_date": gpu_row["latest_date"].isoformat()
                if gpu_row.get("latest_date")
                else None,
                "score": round(score, 2),
                "bench_count": bench_count,
                "pytorch": _strip_json_text(gpu_row.get("pytorch")),
                "accel_version": _strip_json_text(gpu_row.get("accel_version")),
            }
        )

    results.sort(key=lambda r: (-r["score"], r["gpu"] or ""))
    return results


def exec_scores(
    sqlexec,
    profile: str,
    exec_ids: list[str],
    benches: list[str],
    *,
    drop_min_max: bool = True,
    perf_agg: str | None = None,
) -> list[dict]:
    """Filtered weighted score for explicit exec ids (report-style, one row per exec)."""
    if not exec_ids:
        return []

    with sqlexec() as sess:
        stmt = sql_direct_report(
            exec_ids,
            profile=profile,
            drop_min_max=drop_min_max,
            benches=benches,
            perf_agg=perf_agg,
        )
        cursor = sess.execute(stmt)
        report_by_exec: dict[int, list[dict]] = defaultdict(list)
        for row in cursor_to_json(cursor):
            report_by_exec[int(row["exec_id"])].append(row)

    results = []
    for exec_id_s in exec_ids:
        exec_id = int(exec_id_s)
        score, bench_count = aggregate_score(report_by_exec.get(exec_id, []))
        results.append(
            {
                "exec_id": exec_id,
                "score": round(score, 2),
                "bench_count": bench_count,
            }
        )
    return results


def breakdown_routes(app, sqlexec):
    @app.route("/api/breakdown/workloads")
    def api_breakdown_workloads():
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        with sqlexec() as sess:
            return jsonify(workload_rows(sess, profile))

    @app.route("/api/gpu/scores")
    def api_gpu_scores():
        """Weighted score per GPU (latest exec), filtered by benchmark names."""
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        return jsonify(gpu_scores(sqlexec, profile, benches, perf_agg=perf_agg))

    @app.route("/api/report/score")
    def api_report_score():
        """Weighted score for exec(s), filtered by benchmark names (report formula, bench IN list)."""
        from dashboard.server.visibility import require_public_exec

        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        drop_min_max = request.args.get("drop_min_max", "true").lower() == "true"
        perf_agg = request.args.get("perf_agg")
        if perf_agg:
            perf_agg = parse_perf_agg(perf_agg)
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        exec_ids = [x for x in request.args.get("exec_ids", "").split(",") if x]
        if not exec_ids:
            return jsonify({"error": "exec_ids is required (comma-separated)"}), 400

        with sqlexec() as sess:
            for exec_id in exec_ids:
                if require_public_exec(sess, exec_id) is None:
                    return jsonify({"error": "Not found"}), 404

        rows = exec_scores(
            sqlexec,
            profile,
            exec_ids,
            benches,
            drop_min_max=drop_min_max,
            perf_agg=perf_agg,
        )
        if len(rows) == 1:
            return jsonify(rows[0])
        return jsonify(rows)

    # Back-compat alias
    @app.route("/api/breakdown/scores")
    def api_breakdown_scores():
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(
            request.args.get("benches") or request.args.get("packs")
        )
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        return jsonify(gpu_scores(sqlexec, profile, benches, perf_agg=perf_agg))
