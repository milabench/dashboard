"""Experimental dashboard APIs (health, scaling-live, bench docs, timeline).

Registered on the dev blueprint locally (no auth) and on the preview
blueprint in production when ``PREVIEW_SECRET`` is set (token required).
"""


def ensure_scaling_live_table(sqlexec):
    try:
        from .database.scaling_live import LiveScalingObservation
        from dashboard.server.database.models import Base as MetricsBase

        with sqlexec() as sess:
            MetricsBase.metadata.create_all(
                sess.bind, tables=[LiveScalingObservation.__table__], checkfirst=True
            )
            sess.commit()
    except Exception as err:
        print(f"[scaling_live] Could not create scaling_observations_live table: {err}")


def register_experimental_routes(bp, app, cache, sqlexec):
    from .bench_doc import bench_doc_routes
    from .milabench_health import milabench_health_routes
    from .scaling_live import scaling_live_routes
    from .scaling_suggest import scaling_suggest_routes
    from .timeline_dev import timeline_processor

    ensure_scaling_live_table(sqlexec)
    milabench_health_routes(bp, sqlexec)
    scaling_live_routes(bp, sqlexec)
    scaling_suggest_routes(bp, sqlexec)
    bench_doc_routes(bp, sqlexec)

    try:
        timeline_processor(app, bp, cache)
    except Exception as exc:
        import traceback

        print(f"[timeline] timeline_processor FAILED: {exc}")
        traceback.print_exc()
