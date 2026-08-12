"""Tests for run visibility and embargo helpers."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from dashboard.server.database.models import Base, Exec
from dashboard.server.visibility import (
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
    can_access_by_id,
    is_public,
    lookup_by_share_token,
    parse_release_at,
    release_due_runs,
)


@pytest.fixture()
def sess():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[Exec.__table__])
    with Session(engine) as session:
        yield session


def test_public_run_accessible_by_id(sess):
    run = Exec(name="public-run", visibility=VISIBILITY_PUBLIC)
    sess.add(run)
    sess.commit()

    assert is_public(run)
    assert can_access_by_id(run)


def test_private_run_not_accessible_by_id(sess):
    run = Exec(name="private-run", visibility=VISIBILITY_PRIVATE, share_token="secret-token")
    sess.add(run)
    sess.commit()

    assert not is_public(run)
    assert not can_access_by_id(run)


def test_lookup_by_share_token(sess):
    run = Exec(name="private-run", visibility=VISIBILITY_PRIVATE, share_token="abc123")
    sess.add(run)
    sess.commit()

    found = lookup_by_share_token(sess, "abc123")
    assert found is not None
    assert found.name == "private-run"
    assert lookup_by_share_token(sess, "missing") is None


def test_release_due_runs(sess):
    past = datetime.utcnow() - timedelta(hours=1)
    future = datetime.utcnow() + timedelta(days=1)

    due = Exec(
        name="due",
        visibility=VISIBILITY_PRIVATE,
        share_token="due-token",
        release_at=past,
    )
    pending = Exec(
        name="pending",
        visibility=VISIBILITY_PRIVATE,
        share_token="pending-token",
        release_at=future,
    )
    sess.add_all([due, pending])
    sess.commit()

    count = release_due_runs(sess)
    assert count == 1
    sess.refresh(due)
    sess.refresh(pending)
    assert due.visibility == VISIBILITY_PUBLIC
    assert pending.visibility == VISIBILITY_PRIVATE


def test_parse_release_at_formats():
    assert parse_release_at("2026-09-01 12:00").year == 2026
    assert parse_release_at("2026-09-01T12:00:00").month == 9

    with pytest.raises(ValueError):
        parse_release_at("not-a-date")
