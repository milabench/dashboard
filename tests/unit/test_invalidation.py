"""Tests for database/invalidation.py's rule application and recompute."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from dashboard.server.database.invalidation import (
    recompute_invalidations,
    validate_rule,
)
from dashboard.server.database.models import Base, Exec, InvalidationRule, Pack


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        yield sess


def _make_exec(sess, name, created_time):
    e = Exec(name=name, created_time=created_time)
    sess.add(e)
    sess.flush()
    return e


def _make_pack(sess, exec_id, name, created_time):
    p = Pack(exec_id=exec_id, name=name, tag=f"{name}.0", created_time=created_time)
    sess.add(p)
    sess.flush()
    return p


class TestValidateRule:
    def test_requires_exec_id_or_bench_name(self):
        assert validate_rule(None, None) is not None

    def test_exec_id_alone_is_valid(self):
        assert validate_rule(1, None) is None

    def test_bench_name_alone_is_valid(self):
        assert validate_rule(None, "bf16") is None


class TestRecomputeInvalidations:
    def test_bench_name_rule_invalidates_matching_packs_only(self, session):
        old = datetime(2026, 1, 1)
        new = datetime(2026, 6, 1)
        e1 = _make_exec(session, "run1", old)
        p_old_match = _make_pack(session, e1._id, "bf16", old)
        p_old_other = _make_pack(session, e1._id, "fp16", old)
        p_new_match = _make_pack(session, e1._id, "bf16", new)
        session.commit()

        session.add(InvalidationRule(
            bench_name="bf16",
            before=datetime(2026, 3, 1),
            reason="simulated bug",
            active=True,
        ))
        session.commit()

        counts = recompute_invalidations(session)
        assert counts["packs_invalidated"] == 1
        assert counts["execs_invalidated"] == 0

        session.refresh(p_old_match)
        session.refresh(p_old_other)
        session.refresh(p_new_match)
        assert p_old_match.invalidated is True
        assert p_old_other.invalidated is False
        assert p_new_match.invalidated is False

    def test_exec_id_rule_invalidates_whole_run(self, session):
        e1 = _make_exec(session, "bad_run", datetime(2026, 1, 1))
        e2 = _make_exec(session, "good_run", datetime(2026, 1, 1))
        session.commit()

        session.add(InvalidationRule(exec_id=e1._id, reason="bad system config", active=True))
        session.commit()

        counts = recompute_invalidations(session)
        assert counts["execs_invalidated"] == 1

        session.refresh(e1)
        session.refresh(e2)
        assert e1.invalidated is True
        assert e2.invalidated is False

    def test_exec_id_and_bench_name_scopes_to_one_pack_in_one_run(self, session):
        e1 = _make_exec(session, "run1", datetime(2026, 1, 1))
        e2 = _make_exec(session, "run2", datetime(2026, 1, 1))
        p1 = _make_pack(session, e1._id, "bf16", datetime(2026, 1, 1))
        p2 = _make_pack(session, e2._id, "bf16", datetime(2026, 1, 1))
        session.commit()

        session.add(InvalidationRule(exec_id=e1._id, bench_name="bf16", reason="x", active=True))
        session.commit()

        recompute_invalidations(session)
        session.refresh(p1)
        session.refresh(p2)
        assert p1.invalidated is True
        assert p2.invalidated is False

    def test_inactive_rule_is_not_applied(self, session):
        e1 = _make_exec(session, "run1", datetime(2026, 1, 1))
        session.commit()

        session.add(InvalidationRule(exec_id=e1._id, reason="x", active=False))
        session.commit()

        counts = recompute_invalidations(session)
        assert counts["rules_applied"] == 0
        session.refresh(e1)
        assert e1.invalidated is False

    def test_recompute_clears_stale_flags_from_deleted_rules(self, session):
        e1 = _make_exec(session, "run1", datetime(2026, 1, 1))
        session.commit()

        rule = InvalidationRule(exec_id=e1._id, reason="x", active=True)
        session.add(rule)
        session.commit()
        recompute_invalidations(session)
        session.refresh(e1)
        assert e1.invalidated is True

        # "delete" == deactivate, then recompute again
        rule.active = False
        session.commit()
        recompute_invalidations(session)
        session.refresh(e1)
        assert e1.invalidated is False

    def test_after_and_before_together_bound_a_regression_window(self, session):
        # A bug introduced on 2026-03-01 and fixed on 2026-06-01 — only packs
        # created strictly inside that window are bad.
        e1 = _make_exec(session, "run1", datetime(2026, 1, 1))
        before_bug = _make_pack(session, e1._id, "bf16", datetime(2026, 1, 1))
        during_bug = _make_pack(session, e1._id, "bf16", datetime(2026, 4, 1))
        after_fix = _make_pack(session, e1._id, "bf16", datetime(2026, 7, 1))
        session.commit()

        session.add(InvalidationRule(
            bench_name="bf16",
            after=datetime(2026, 3, 1),
            before=datetime(2026, 6, 1),
            reason="regression window",
            active=True,
        ))
        session.commit()

        counts = recompute_invalidations(session)
        assert counts["packs_invalidated"] == 1

        session.refresh(before_bug)
        session.refresh(during_bug)
        session.refresh(after_fix)
        assert before_bug.invalidated is False
        assert during_bug.invalidated is True
        assert after_fix.invalidated is False
