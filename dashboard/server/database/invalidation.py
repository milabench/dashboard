"""Materializes InvalidationRule rows onto Exec.invalidated / Pack.invalidated.

Rules are re-applied in full (reset-then-reapply) whenever they change,
rather than incrementally tracked, since the dataset is small enough that
a full recompute is cheap and this avoids subtle bugs from overlapping or
retracted rules interacting with each other.
"""

from __future__ import annotations

from sqlalchemy import select, update

from .models import Exec, InvalidationRule, Pack


def _date_range_conditions(rule: InvalidationRule, date_column):
    conditions = []
    if rule.before is not None:
        conditions.append(date_column < rule.before)
    if rule.after is not None:
        conditions.append(date_column >= rule.after)
    return conditions


def apply_rule(sess, rule: InvalidationRule) -> dict:
    """Set invalidated=True on whatever this single rule matches."""
    if rule.bench_name:
        conditions = [Pack.name == rule.bench_name]
        conditions += _date_range_conditions(rule, Pack.created_time)
        if rule.exec_id is not None:
            conditions.append(Pack.exec_id == rule.exec_id)
        result = sess.execute(update(Pack).where(*conditions).values(invalidated=True))
        return {"execs": 0, "packs": result.rowcount or 0}

    conditions = [Exec._id == rule.exec_id]
    conditions += _date_range_conditions(rule, Exec.created_time)
    result = sess.execute(update(Exec).where(*conditions).values(invalidated=True))
    return {"execs": result.rowcount or 0, "packs": 0}


def recompute_invalidations(sess) -> dict:
    """Reset every invalidated flag, then reapply all active rules in order."""
    sess.execute(update(Exec).values(invalidated=False))
    sess.execute(update(Pack).values(invalidated=False))

    rules = sess.execute(
        select(InvalidationRule).where(InvalidationRule.active.is_(True)).order_by(InvalidationRule._id)
    ).scalars().all()

    total_execs = total_packs = 0
    for rule in rules:
        counts = apply_rule(sess, rule)
        total_execs += counts["execs"]
        total_packs += counts["packs"]

    sess.commit()
    return {
        "rules_applied": len(rules),
        "execs_invalidated": total_execs,
        "packs_invalidated": total_packs,
    }


def validate_rule(exec_id, bench_name) -> str | None:
    """Return an error message if the rule is too broad/ambiguous, else None."""
    if exec_id is None and not bench_name:
        return "Provide at least an exec_id or a bench_name to scope the invalidation."
    return None
