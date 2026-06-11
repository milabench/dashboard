"""GPU summary: materialized view + real-time fallback.

Provides two endpoints:
  GET  /api/gpu/summary          - fast read from materialized view (falls back to live query)
  POST /api/gpu/summary/refresh  - force-refresh the materialized view (dev only)
"""

import sqlalchemy
from flask import jsonify
from sqlalchemy import select, func, cast, text, TEXT, Float

from milabench.metrics.sqlalchemy import Exec, Pack
from .materialized_views import GPU_SUMMARY_VIEW as VIEW_NAME, _view_exists
from dashboard.cli.database.views import create_views, refresh_views


def _rows_to_json(rows):
    return [
        {
            "gpu": row["gpu"],
            "cpu_arch": row["cpu_arch"],
            "exec_id": row["exec_id"],
            "latest_date": row["latest_date"].isoformat() if row["latest_date"] else None,
            "run_name": row["run_name"],
            "pytorch": row["pytorch"],
            "arch": row["arch"],
            "accel_version": row["accel_version"],
            "milabench_tag": row["milabench_tag"],
            "milabench_commit": row["milabench_commit"],
            "contributor": row["contributor"],
            "gpu_count": row["gpu_count"],
            "gpu_memory": row["gpu_memory"],
            "total": row["total"],
            "passed": float(row["passed"]),
            "pass_rate": round(float(row["passed"]) / row["total"], 4) if row["total"] else 0,
        }
        for row in rows
    ]


def _live_query(sqlexec):
    """Compute the GPU summary in real time (no materialized view)."""
    gpu_col = cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT).label("gpu")
    cpu_arch_col = func.coalesce(cast(Exec.meta["os"]["machine"], TEXT), "unknown").label("cpu_arch")
    gpu_count_col = select(func.count()).select_from(
        func.json_object_keys(Exec.meta["accelerators"]["gpus"])
    ).correlate(Exec).scalar_subquery().label("gpu_count")
    gpu_memory_col = cast(cast(Exec.meta["accelerators"]["gpus"]["0"]["memory"]["total"], TEXT), Float).label("gpu_memory")

    exec_base = (
        select(
            Exec._id,
            Exec.name,
            Exec.created_time,
            Exec.meta,
            gpu_col,
            cpu_arch_col,
            gpu_count_col,
            gpu_memory_col,
        )
        .where(cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT).isnot(None))
        .where(cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT) != 'null')
    ).subquery("exec_base")

    latest_per_gpu = (
        select(
            exec_base.c.gpu,
            exec_base.c.cpu_arch,
            exec_base.c.gpu_count,
            exec_base.c.gpu_memory,
            func.max(exec_base.c._id).label("exec_id"),
            func.max(exec_base.c.created_time).label("latest_date"),
            exec_base.c.name.label("run_name"),
        )
        .group_by(
            exec_base.c.gpu, exec_base.c.cpu_arch,
            exec_base.c.gpu_count, exec_base.c.gpu_memory,
            exec_base.c.name,
        )
        .order_by(func.max(exec_base.c.created_time).desc())
    ).subquery()

    ranked = (
        select(
            latest_per_gpu.c.gpu,
            latest_per_gpu.c.cpu_arch,
            latest_per_gpu.c.gpu_count,
            latest_per_gpu.c.gpu_memory,
            latest_per_gpu.c.exec_id,
            latest_per_gpu.c.latest_date,
            latest_per_gpu.c.run_name,
            func.row_number().over(
                partition_by=[
                    latest_per_gpu.c.gpu,
                    latest_per_gpu.c.cpu_arch,
                    latest_per_gpu.c.gpu_count,
                    latest_per_gpu.c.gpu_memory,
                ],
                order_by=latest_per_gpu.c.latest_date.desc()
            ).label("rn")
        )
    ).subquery()

    most_recent = (
        select(
            ranked.c.gpu,
            ranked.c.cpu_arch,
            ranked.c.gpu_count,
            ranked.c.gpu_memory,
            ranked.c.exec_id,
            ranked.c.latest_date,
            ranked.c.run_name,
        ).where(ranked.c.rn == 1)
    ).subquery()

    bench_status = (
        select(
            Pack.exec_id,
            Pack.name.label("bench"),
            func.avg(
                sqlalchemy.case(
                    (Pack.status.in_(["done", "early_stop"]), 1.0),
                    else_=0.0,
                )
            ).label("pass_rate"),
        )
        .where(Pack.exec_id.in_(select(most_recent.c.exec_id)))
        .group_by(Pack.exec_id, Pack.name)
    ).subquery()

    pytorch_col = cast(Exec.meta["pytorch"]["torch"], TEXT).label("pytorch")
    arch_col = cast(Exec.meta["accelerators"]["arch"], TEXT).label("arch")
    cuda_ver = cast(Exec.meta["pytorch"]["build_settings"]["CUDA_VERSION"], TEXT)
    hip_ver = cast(Exec.meta["pytorch"]["build_settings"]["HIP_VERSION"], TEXT)
    accel_col = func.coalesce(cuda_ver, hip_ver).label("accel_version")
    mb_tag_col = cast(Exec.meta["milabench"]["tag"], TEXT).label("mb_tag")
    mb_commit_col = cast(Exec.meta["milabench"]["commit"], TEXT).label("mb_commit")
    contributor_col = cast(Exec.meta["contributor"], TEXT).label("contributor")

    results_query = (
        select(
            most_recent.c.gpu,
            most_recent.c.cpu_arch,
            most_recent.c.gpu_count,
            most_recent.c.gpu_memory,
            most_recent.c.exec_id,
            most_recent.c.latest_date,
            most_recent.c.run_name,
            pytorch_col,
            arch_col,
            accel_col,
            mb_tag_col,
            mb_commit_col,
            contributor_col,
            func.count(bench_status.c.bench).label("total"),
            func.coalesce(func.round(cast(func.sum(bench_status.c.pass_rate), sqlalchemy.Numeric), 2), 0).label("passed"),
        )
        .join(Exec, Exec._id == most_recent.c.exec_id)
        .outerjoin(bench_status, bench_status.c.exec_id == most_recent.c.exec_id)
        .group_by(
            most_recent.c.gpu,
            most_recent.c.cpu_arch,
            most_recent.c.gpu_count,
            most_recent.c.gpu_memory,
            most_recent.c.exec_id,
            most_recent.c.latest_date,
            most_recent.c.run_name,
            pytorch_col,
            arch_col,
            accel_col,
            mb_tag_col,
            mb_commit_col,
            contributor_col,
        )
        .order_by(most_recent.c.gpu, most_recent.c.cpu_arch)
    )

    with sqlexec() as sess:
        rows = sess.execute(results_query).mappings().all()
        return rows


def gpu_summary_routes(app, sqlexec, scheduler, dev_only):
    """Register GPU summary endpoints on the Flask app."""

    _has_view = False

    def _ensure_view():
        nonlocal _has_view
        try:
            with sqlexec() as sess:
                if _view_exists(sess, VIEW_NAME):
                    _has_view = True
                    print("[gpu_summary] Materialized view found")
                    return
                create_views(sess, [VIEW_NAME])
                _has_view = True
        except Exception as err:
            print(f"[gpu_summary] Could not ensure materialized view: {err}")

    def _refresh():
        try:
            with sqlexec() as sess:
                refresh_views(sess, [VIEW_NAME])
        except Exception as err:
            print(f"[gpu_summary] Refresh failed: {err}")

    _ensure_view()
    if _has_view:
        scheduler.add_job(_refresh, 'interval', minutes=10, id='refresh_gpu_summary')

    @app.route('/api/gpu/summary')
    def api_gpu_summary():
        """Read GPU summary - from materialized view if available, otherwise live."""
        if _has_view:
            with sqlexec() as sess:
                rows = sess.execute(text(f"SELECT * FROM {VIEW_NAME}")).mappings().all()
        else:
            rows = _live_query(sqlexec)

        return jsonify(_rows_to_json(rows))

    @app.route('/api/gpu/summary/live')
    def api_gpu_summary_live():
        """Always compute the GPU summary in real time."""
        rows = _live_query(sqlexec)
        return jsonify(_rows_to_json(rows))

    @app.route('/api/gpu/summary/refresh', methods=['POST'])
    @dev_only
    def api_gpu_summary_refresh():
        """Force-refresh the materialized view."""
        if not _has_view:
            return jsonify({"status": "ERR", "message": "Materialized view not available"}), 503
        _refresh()
        return jsonify({"status": "ok"})
