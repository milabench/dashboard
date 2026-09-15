"""Breakdown view: weighted scores per GPU for a selectable benchmark set."""

from __future__ import annotations

import math
from collections import defaultdict

from flask import jsonify, request
from sqlalchemy import select

from dashboard.server.database.models import Exec, RunGroup, RunGroupMember, Weight
from dashboard.server.database.grouping import (
    assign_benches_to_execs,
    pack_status_by_exec,
    rank_execs_by_success,
)
from dashboard.server.plot import PERF_AGG_METHODS, sql_direct_report
from dashboard.server.utils import cursor_to_json
from dashboard.server.visibility import public_exec_filter

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


def breakdown_matrix(
    sqlexec,
    profile: str,
    benches: list[str],
    *,
    perf_agg: str = DEFAULT_PERF_AGG,
) -> dict:
    """Benchmark rows × GPU columns matrix of per-bench scores."""
    from dashboard.server.gpu_summary import _live_query

    gpu_rows = _live_query(sqlexec)
    if not gpu_rows:
        return {"gpus": [], "benches": []}

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

    gpu_columns = []
    for gpu_row in gpu_rows:
        exec_id = int(gpu_row["exec_id"])
        total_score, _ = aggregate_score(report_by_exec.get(exec_id, []))
        gpu_columns.append(
            {
                "key": str(exec_id),
                "gpu": _strip_json_text(gpu_row["gpu"]),
                "exec_id": exec_id,
                "total_score": round(total_score, 2),
            }
        )
    gpu_columns.sort(key=lambda col: (-col["total_score"], col["gpu"] or ""))

    bench_map: dict[str, dict] = {}
    for exec_id, rows in report_by_exec.items():
        col_key = str(exec_id)
        for row in rows:
            bench = row["bench"]
            enabled = float(row.get("enabled") or 0)
            weight = float(row.get("weight") or 0)
            if enabled <= 0 or weight <= 0:
                continue
            entry = bench_map.get(bench)
            if entry is None:
                entry = {
                    "bench": bench,
                    "weight": weight,
                    "order": float(row.get("order") or 999),
                    "scores": {},
                }
                bench_map[bench] = entry
            entry["scores"][col_key] = round(float(row.get("score") or 0), 2)

    bench_rows = sorted(bench_map.values(), key=lambda r: (r["order"], r["bench"]))
    return {"gpus": gpu_columns, "benches": bench_rows}


def _hardware_groups_for_config(sess, config_group_id: int) -> list[tuple[int, str]]:
    """Hardware RunGroups sharing at least one member exec with config_group_id."""
    member_execs = select(RunGroupMember.exec_id).where(RunGroupMember.group_id == config_group_id)
    rows = sess.execute(
        select(RunGroup._id, RunGroup.label)
        .join(RunGroupMember, RunGroupMember.group_id == RunGroup._id)
        .where(RunGroupMember.exec_id.in_(member_execs), RunGroup.strategy == "hardware")
        .distinct()
    ).all()
    return [(r._id, r.label) for r in rows]


def _intersected_execs(sess, group_a_id: int, group_b_id: int):
    """Public execs that are members of both groups, newest first."""
    q = (
        select(Exec._id, Exec.created_time)
        .join(RunGroupMember, RunGroupMember.exec_id == Exec._id)
        .where(RunGroupMember.group_id == group_a_id)
        .where(
            Exec._id.in_(
                select(RunGroupMember.exec_id).where(RunGroupMember.group_id == group_b_id)
            )
        )
        .where(public_exec_filter())
        .order_by(Exec.created_time.desc())
    )
    return sess.execute(q).all()


def _composite_rows_for_group_pair(
    sess,
    hardware_group_id: int,
    config_group_id: int,
    profile: str,
    benches: list[str],
    perf_agg: str,
):
    """Composite report rows for (hardware ∩ config), restricted to ``benches``.

    Reuses assign_benches_to_execs's bench→exec merge (see
    database/grouping.py) so a slice spanning several separate pushes is
    treated as one comparable run, then unifies weight_total across the
    per-exec sub-reports (each only covers its own bench subset). Execs are
    ranked by successful-bench count first (rank_execs_by_success) so the
    composite draws from as few runs as possible — the single most-complete
    run first, other runs only filling in what it's missing — rather than
    picking whichever run is newest-and-successful bench-by-bench, which can
    silently stitch together many different runs and make otherwise-identical
    hardware/config slices report noticeably different numbers.

    Returns (rows, exec_count, latest_created_time).
    """
    execs = _intersected_execs(sess, hardware_group_id, config_group_id)
    if not execs:
        return [], 0, None

    exec_ids = [e._id for e in execs]
    packs_by_exec, status_by_exec = pack_status_by_exec(sess, exec_ids)
    ranked_exec_ids = rank_execs_by_success(exec_ids, packs_by_exec, status_by_exec)
    # drop_unresolved=True: a bench that never succeeded on any candidate
    # exec is left out of the score entirely rather than counted as a 0 —
    # a fabricated zero skews the weighted geomean far more than simply
    # scoring on fewer benches would.
    exec_to_benches = assign_benches_to_execs(
        ranked_exec_ids, packs_by_exec, status_by_exec, drop_unresolved=True
    )

    benches_set = set(benches)
    exec_to_benches = {
        exec_id: [b for b in bs if b in benches_set]
        for exec_id, bs in exec_to_benches.items()
    }
    exec_to_benches = {exec_id: bs for exec_id, bs in exec_to_benches.items() if bs}

    all_rows: list[dict] = []
    for exec_id, bs in exec_to_benches.items():
        stmt = sql_direct_report([exec_id], profile=profile, benches=bs, perf_agg=perf_agg)
        all_rows.extend(cursor_to_json(sess.execute(stmt)))

    total_weight = sum(
        r["weight"]
        for r in all_rows
        if (r.get("enabled") or 0) > 0 and (r.get("weight") or 0) > 0
    )
    for row in all_rows:
        row["weight_total"] = total_weight

    return all_rows, len(exec_ids), execs[0].created_time


def run_group_scores(
    sqlexec,
    config_group_id: int,
    profile: str,
    benches: list[str],
    *,
    perf_agg: str = DEFAULT_PERF_AGG,
) -> list[dict]:
    """Score per hardware run-group, composite over (hardware ∩ config_group_id)."""
    with sqlexec() as sess:
        hw_groups = _hardware_groups_for_config(sess, config_group_id)
        results = []
        for hw_id, hw_label in hw_groups:
            rows, exec_count, latest = _composite_rows_for_group_pair(
                sess, hw_id, config_group_id, profile, benches, perf_agg
            )
            if not rows:
                continue
            score, bench_count = aggregate_score(rows)
            results.append(
                {
                    "hardware_group_id": hw_id,
                    "gpu": hw_label,
                    "score": round(score, 2),
                    "bench_count": bench_count,
                    "exec_count": exec_count,
                    "latest_date": latest.isoformat() if latest else None,
                }
            )

    results.sort(key=lambda r: (-r["score"], r["gpu"] or ""))
    return results


def run_group_matrix(
    sqlexec,
    config_group_id: int,
    profile: str,
    benches: list[str],
    *,
    perf_agg: str = DEFAULT_PERF_AGG,
) -> dict:
    """Benchmark rows × hardware-group columns matrix, composite over (hardware ∩ config_group_id)."""
    with sqlexec() as sess:
        hw_groups = _hardware_groups_for_config(sess, config_group_id)
        if not hw_groups:
            return {"gpus": [], "benches": []}

        gpu_columns = []
        bench_map: dict[str, dict] = {}
        for hw_id, hw_label in hw_groups:
            rows, _exec_count, _latest = _composite_rows_for_group_pair(
                sess, hw_id, config_group_id, profile, benches, perf_agg
            )
            if not rows:
                continue
            total_score, _ = aggregate_score(rows)
            col_key = str(hw_id)
            gpu_columns.append(
                {
                    "key": col_key,
                    "gpu": hw_label,
                    "hardware_group_id": hw_id,
                    "total_score": round(total_score, 2),
                }
            )
            for row in rows:
                bench = row["bench"]
                enabled = float(row.get("enabled") or 0)
                weight = float(row.get("weight") or 0)
                if enabled <= 0 or weight <= 0:
                    continue
                entry = bench_map.get(bench)
                if entry is None:
                    entry = {
                        "bench": bench,
                        "weight": weight,
                        "order": float(row.get("order") or 999),
                        "scores": {},
                    }
                    bench_map[bench] = entry
                entry["scores"][col_key] = round(float(row.get("score") or 0), 2)

    gpu_columns.sort(key=lambda col: (-col["total_score"], col["gpu"] or ""))
    bench_rows = sorted(bench_map.values(), key=lambda r: (r["order"], r["bench"]))
    return {"gpus": gpu_columns, "benches": bench_rows}


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


def breakdown_routes(bp, sqlexec):
    @bp.route("/api/breakdown/workloads")
    def api_breakdown_workloads():
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        with sqlexec() as sess:
            return jsonify(workload_rows(sess, profile))

    @bp.route("/api/gpu/scores")
    def api_gpu_scores():
        """Weighted score per GPU (latest exec), filtered by benchmark names."""
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        return jsonify(gpu_scores(sqlexec, profile, benches, perf_agg=perf_agg))

    @bp.route("/api/breakdown/matrix")
    def api_breakdown_matrix():
        """Per-benchmark scores across GPUs (bench rows, GPU columns)."""
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        return jsonify(
            breakdown_matrix(sqlexec, profile, benches, perf_agg=perf_agg)
        )

    @bp.route("/api/breakdown/run-group-scores")
    def api_run_group_scores():
        """Weighted score per hardware run-group, composite over (hardware ∩ config)."""
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400
        config_group_id = request.args.get("config_group_id", type=int)
        if config_group_id is None:
            return jsonify({"error": "config_group_id is required"}), 400

        with sqlexec() as sess:
            group = sess.get(RunGroup, config_group_id)
            if group is None or group.strategy != "config":
                return jsonify({"error": "config_group_id must reference a config run-group"}), 404

        return jsonify(
            run_group_scores(sqlexec, config_group_id, profile, benches, perf_agg=perf_agg)
        )

    @bp.route("/api/breakdown/run-group-matrix")
    def api_run_group_matrix():
        """Per-benchmark scores across hardware run-groups (bench rows, hardware-group columns)."""
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(request.args.get("benches"))
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400
        config_group_id = request.args.get("config_group_id", type=int)
        if config_group_id is None:
            return jsonify({"error": "config_group_id is required"}), 400

        with sqlexec() as sess:
            group = sess.get(RunGroup, config_group_id)
            if group is None or group.strategy != "config":
                return jsonify({"error": "config_group_id must reference a config run-group"}), 404

        return jsonify(
            run_group_matrix(sqlexec, config_group_id, profile, benches, perf_agg=perf_agg)
        )

    @bp.route("/api/report/score")
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
    @bp.route("/api/breakdown/scores")
    def api_breakdown_scores():
        profile = request.cookies.get("scoreProfile") or request.args.get("profile") or "default"
        perf_agg = parse_perf_agg(request.args.get("perf_agg"))
        benches = parse_benches_arg(
            request.args.get("benches") or request.args.get("packs")
        )
        if not benches:
            return jsonify({"error": "benches is required (comma-separated pack names)"}), 400

        return jsonify(gpu_scores(sqlexec, profile, benches, perf_agg=perf_agg))
