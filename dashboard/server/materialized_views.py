"""Materialized view definitions and management.

Provides a registry of all materialized views used by the dashboard,
plus helpers to create, refresh, and drop them — usable from both
the server startup path and a standalone CLI.
"""

import argparse
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from .utils import database_uri


VIEWS = {}


def register_view(name, sql, indexes=None):
    """Register a materialized view definition."""
    VIEWS[name] = {
        "sql": sql,
        "indexes": indexes or [],
    }


def _view_exists(sess, name):
    result = sess.execute(
        text("SELECT 1 FROM pg_matviews WHERE matviewname = :name"),
        {"name": name},
    )
    return result.scalar() is not None


def create_views(sess, names=None, force=False):
    """Create materialized views. If force=True, drop and recreate."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        defn = VIEWS.get(name)
        if defn is None:
            print(f"[matview] Unknown view: {name}")
            continue

        exists = _view_exists(sess, name)

        if exists and not force:
            print(f"[matview] {name} already exists (use --force to recreate)")
            continue

        if exists:
            sess.execute(text(f"DROP MATERIALIZED VIEW IF EXISTS {name}"))
            print(f"[matview] Dropped {name}")

        sess.execute(text(defn["sql"]))
        for idx_sql in defn["indexes"]:
            sess.execute(text(idx_sql))

        sess.commit()
        print(f"[matview] Created {name}")


def refresh_views(sess, names=None):
    """Refresh materialized views concurrently."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        if name not in VIEWS:
            print(f"[matview] Unknown view: {name}")
            continue

        if not _view_exists(sess, name):
            print(f"[matview] {name} does not exist, skipping refresh")
            continue

        sess.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name}"))
        sess.commit()
        print(f"[matview] Refreshed {name}")


def drop_views(sess, names=None):
    """Drop materialized views."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        sess.execute(text(f"DROP MATERIALIZED VIEW IF EXISTS {name}"))
        sess.commit()
        print(f"[matview] Dropped {name}")


def status_views(sess, names=None):
    """Print status of materialized views."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        exists = _view_exists(sess, name)
        if exists:
            row_count = sess.execute(
                text(f"SELECT count(*) FROM {name}")
            ).scalar()
            print(f"  {name}: {row_count} rows")
        else:
            print(f"  {name}: NOT CREATED")


# -- View definitions --------------------------------------------------------

GPU_SUMMARY_VIEW = "gpu_summary_mv"

register_view(
    GPU_SUMMARY_VIEW,
    f"""
    CREATE MATERIALIZED VIEW IF NOT EXISTS {GPU_SUMMARY_VIEW} AS
    WITH exec_base AS (
        SELECT
            _id,
            name,
            created_time,
            meta,
            meta -> 'accelerators' -> 'gpus' -> '0' ->> 'product' AS gpu,
            coalesce(meta -> 'os' ->> 'machine', 'unknown') AS cpu_arch,
            (SELECT count(*) FROM json_object_keys(meta -> 'accelerators' -> 'gpus')) AS gpu_count,
            (meta -> 'accelerators' -> 'gpus' -> '0' -> 'memory' ->> 'total')::float AS gpu_memory
        FROM execs
        WHERE (meta -> 'accelerators' -> 'gpus' -> '0' ->> 'product') IS NOT NULL
          AND (meta -> 'accelerators' -> 'gpus' -> '0' ->> 'product') != 'null'
    ),
    latest_per_gpu AS (
        SELECT
            gpu, cpu_arch, gpu_count, gpu_memory,
            max(_id) AS exec_id,
            max(created_time) AS latest_date,
            name AS run_name
        FROM exec_base
        GROUP BY gpu, cpu_arch, gpu_count, gpu_memory, name
    ),
    ranked AS (
        SELECT *,
            row_number() OVER (
                PARTITION BY gpu, cpu_arch, gpu_count, gpu_memory
                ORDER BY latest_date DESC
            ) AS rn
        FROM latest_per_gpu
    ),
    most_recent AS (
        SELECT gpu, cpu_arch, gpu_count, gpu_memory, exec_id, latest_date, run_name
        FROM ranked WHERE rn = 1
    ),
    bench_status AS (
        SELECT exec_id, name AS bench,
               avg(CASE WHEN status IN ('done', 'early_stop') THEN 1.0 ELSE 0.0 END) AS pass_rate
        FROM packs
        WHERE exec_id IN (SELECT exec_id FROM most_recent)
        GROUP BY exec_id, name
    )
    SELECT
        mr.gpu,
        mr.cpu_arch,
        mr.gpu_count,
        mr.gpu_memory,
        mr.exec_id,
        mr.latest_date,
        mr.run_name,
        e.meta -> 'pytorch' ->> 'torch' AS pytorch,
        e.meta -> 'accelerators' ->> 'arch' AS arch,
        coalesce(
            e.meta -> 'pytorch' -> 'build_settings' ->> 'CUDA_VERSION',
            e.meta -> 'pytorch' -> 'build_settings' ->> 'HIP_VERSION'
        ) AS accel_version,
        e.meta -> 'milabench' ->> 'tag' AS milabench_tag,
        e.meta -> 'milabench' ->> 'commit' AS milabench_commit,
        e.meta ->> 'contributor' AS contributor,
        count(bs.bench) AS total,
        coalesce(round(sum(bs.pass_rate)::numeric, 2), 0) AS passed
    FROM most_recent mr
    JOIN execs e ON e._id = mr.exec_id
    LEFT JOIN bench_status bs ON bs.exec_id = mr.exec_id
    GROUP BY mr.gpu, mr.cpu_arch, mr.gpu_count, mr.gpu_memory,
             mr.exec_id, mr.latest_date, mr.run_name,
             pytorch, arch, accel_version, milabench_tag, milabench_commit, contributor
    ORDER BY mr.gpu, mr.cpu_arch
    """,
    indexes=[
        f"CREATE UNIQUE INDEX IF NOT EXISTS {GPU_SUMMARY_VIEW}_exec_id ON {GPU_SUMMARY_VIEW} (exec_id)",
    ],
)


# -- CLI ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Manage dashboard materialized views",
    )
    parser.add_argument(
        "action",
        choices=["create", "refresh", "drop", "status", "recreate"],
        help="Action to perform",
    )
    parser.add_argument(
        "--views",
        nargs="*",
        default=None,
        help=f"Views to target (default: all). Available: {', '.join(VIEWS.keys())}",
    )

    args = parser.parse_args()

    uri = database_uri()
    engine = create_engine(uri)

    with Session(engine) as sess:
        match args.action:
            case "create":
                create_views(sess, args.views)
            case "refresh":
                refresh_views(sess, args.views)
            case "drop":
                drop_views(sess, args.views)
            case "recreate":
                create_views(sess, args.views, force=True)
            case "status":
                status_views(sess, args.views)


if __name__ == "__main__":
    main()
