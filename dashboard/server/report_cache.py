"""Report cache: lazy-populated table that caches sql_direct_report results.

The cache is keyed by (exec_id, profile). On first request for an exec_id,
the expensive sql_direct_report query runs once and the results are stored
in the ``report_cache`` table. Subsequent requests for the same exec_id
read directly from the table.

Invalidation happens:
  - On push: rows for the affected exec_id are deleted.
  - Periodically: a background job evicts rows for all but the N most
    recent exec_ids.
"""

import os
from datetime import datetime

from sqlalchemy import delete, select, func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from milabench.metrics.sqlalchemy import ReportCache

REPORT_CACHE_MAX_EXECS = int(os.getenv("REPORT_CACHE_MAX_EXECS", 50))


def _table_exists(sess):
    """Check if the report_cache table exists."""
    result = sess.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'report_cache'"
        )
    )
    return result.scalar() is not None


def get_cached_report(sess, exec_id, profile):
    """Return cached report rows for (exec_id, profile), or None if not cached."""
    stmt = (
        select(ReportCache)
        .where(ReportCache.exec_id == int(exec_id), ReportCache.profile == profile)
    )
    rows = sess.execute(stmt).scalars().all()
    return [r.as_dict() for r in rows] if rows else None


def store_report(sess, exec_id, profile, rows):
    """Insert report rows into the cache, skipping conflicts."""
    now = datetime.utcnow()
    for row in rows:
        stmt = pg_insert(ReportCache.__table__).values(
            exec_id=int(exec_id),
            profile=profile,
            bench=row["bench"],
            fail=row.get("fail"),
            n=row.get("n"),
            ngpu=row.get("ngpu"),
            perf=row.get("perf"),
            sem=row.get("sem"),
            std=row.get("std"),
            score=row.get("score"),
            log_score=row.get("log_score"),
            weight=row.get("weight"),
            enabled=row.get("enabled"),
            order=row.get("order"),
            weight_total=row.get("weight_total"),
            created_at=now,
        ).on_conflict_do_nothing(constraint="uq_report_cache_row")
        sess.execute(stmt)
    sess.commit()


def invalidate_exec(sess, exec_id):
    """Delete all cached report rows for a given exec_id."""
    sess.execute(
        delete(ReportCache).where(ReportCache.exec_id == int(exec_id))
    )
    sess.commit()


def evict_old_entries(sess, keep=None):
    """Keep only the ``keep`` most-recent exec_ids in the cache."""
    keep = keep or REPORT_CACHE_MAX_EXECS

    recent_ids = (
        select(ReportCache.exec_id)
        .group_by(ReportCache.exec_id)
        .order_by(func.max(ReportCache.created_at).desc())
        .limit(keep)
    ).subquery()

    sess.execute(
        delete(ReportCache).where(ReportCache.exec_id.notin_(select(recent_ids.c.exec_id)))
    )
    sess.commit()


def cache_status(sess):
    """Return a dict summarising the cache state."""
    if not _table_exists(sess):
        return {"exists": False}

    total_rows = sess.execute(select(func.count()).select_from(ReportCache)).scalar()
    distinct_execs = sess.execute(
        select(func.count(func.distinct(ReportCache.exec_id)))
    ).scalar()
    distinct_profiles = sess.execute(
        select(func.count(func.distinct(ReportCache.profile)))
    ).scalar()

    return {
        "exists": True,
        "total_rows": total_rows,
        "distinct_execs": distinct_execs,
        "distinct_profiles": distinct_profiles,
    }
