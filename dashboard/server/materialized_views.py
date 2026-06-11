"""Materialized view definitions and management.

Provides a registry of all materialized views used by the dashboard,
plus helpers to create, refresh, and drop them - usable from both
the server startup path and the CLI.
"""

from sqlalchemy import text


VIEWS = {}


def register_view(name, sql, indexes=None, expected_columns=None):
    """Register a materialized view definition."""
    VIEWS[name] = {
        "sql": sql,
        "indexes": indexes or [],
        "expected_columns": set(expected_columns) if expected_columns else None,
    }


def _view_exists(sess, name):
    result = sess.execute(
        text("SELECT 1 FROM pg_matviews WHERE matviewname = :name"),
        {"name": name},
    )
    return result.scalar() is not None


def _view_columns(sess, name):
    """Return the set of column names for a materialized view."""
    result = sess.execute(
        text(
            "SELECT attname FROM pg_attribute "
            "WHERE attrelid = :name::regclass AND attnum > 0 AND NOT attisdropped"
        ),
        {"name": name},
    )
    return {row[0] for row in result}


def _view_schema_ok(sess, name, defn):
    """Check if the existing view has the expected columns."""
    expected = defn.get("expected_columns")
    if expected is None:
        return True
    actual = _view_columns(sess, name)
    missing = expected - actual
    if missing:
        print(f"[matview] {name} is missing columns: {missing}")
        return False
    return True



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
    expected_columns=[
        "gpu", "cpu_arch", "gpu_count", "gpu_memory",
        "exec_id", "latest_date", "run_name",
        "pytorch", "arch", "accel_version",
        "milabench_tag", "milabench_commit", "contributor",
        "total", "passed",
    ],
)
