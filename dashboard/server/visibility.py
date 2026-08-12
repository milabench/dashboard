"""Run visibility helpers (public vs private / share-token access)."""

from __future__ import annotations

from datetime import datetime

import sqlalchemy
from sqlalchemy import select

from dashboard.server.database.models import Exec

VISIBILITY_PUBLIC = 0
VISIBILITY_PRIVATE = 1


def public_exec_filter():
    """SQLAlchemy filter clause: public runs only."""
    return Exec.visibility == VISIBILITY_PUBLIC


def is_public(exec_row: Exec | None) -> bool:
    if exec_row is None:
        return False
    return (exec_row.visibility or VISIBILITY_PUBLIC) == VISIBILITY_PUBLIC


def can_access_by_id(exec_row: Exec | None) -> bool:
    """Numeric exec id access is allowed only for public runs."""
    return is_public(exec_row)


def lookup_by_share_token(sess, token: str | None) -> Exec | None:
    if not token:
        return None
    return sess.execute(
        select(Exec).where(Exec.share_token == token)
    ).scalar_one_or_none()


def require_public_exec(sess, exec_id) -> Exec | None:
    """Return exec if publicly accessible by id, else None."""
    exec_row = sess.get(Exec, int(exec_id))
    if not can_access_by_id(exec_row):
        return None
    return exec_row


def share_url_for(token: str, base_url: str | None = None) -> str:
    """Build an obfuscated share path (no exec id)."""
    path = f"/share/{token}"
    if base_url:
        return f"{base_url.rstrip('/')}{path}"
    return path


def parse_release_at(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"Invalid release_at datetime: {raw!r}")


def release_due_runs(sess) -> int:
    """Promote private runs whose release_at has passed. Returns rows updated."""
    now = datetime.utcnow()
    result = sess.execute(
        sqlalchemy.update(Exec)
        .where(Exec.visibility == VISIBILITY_PRIVATE)
        .where(Exec.release_at.isnot(None))
        .where(Exec.release_at <= now)
        .values(visibility=VISIBILITY_PUBLIC)
    )
    return int(result.rowcount or 0)
