"""Admin: mark runs or a named benchmark as invalidated (known-bad data —
e.g. a milabench bug that produced wrong results until it was fixed).

Same dev/prod-target-aware, injectable-session_factory pattern as
runs_admin.py — typically used against prod once a bug is confirmed and
its fix date known, but works the same against dev for testing.

Rules are recorded (for audit / undo) and then materialized onto
Exec.invalidated / Pack.invalidated (see database/invalidation.py) so every
read path elsewhere in the dashboard can filter on a plain boolean instead
of re-evaluating rules per query.
"""

from datetime import datetime

from flask import jsonify, request
from sqlalchemy import distinct, select

from .database.invalidation import recompute_invalidations, validate_rule
from .database.models import InvalidationRule, Pack
from .visibility import parse_release_at


def _target(source) -> str:
    from .admin_db import TARGETS
    target = source.get("target", "dev")
    if target not in TARGETS:
        raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
    return target


def invalidation_admin_routes(bp, session_factory=None):
    if session_factory is None:
        from .admin_db import admin_session as session_factory

    @bp.route("/api/admin/invalidation-rules", methods=["GET"])
    def api_list_invalidation_rules():
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            rows = sess.execute(
                select(InvalidationRule).order_by(InvalidationRule._id.desc())
            ).scalars().all()
            return jsonify([r.as_dict() for r in rows])

    @bp.route("/api/admin/invalidation-rules", methods=["POST"])
    def api_create_invalidation_rule():
        body = request.get_json(force=True) or {}
        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        exec_id = body.get("exec_id")
        bench_name = (body.get("bench_name") or "").strip() or None
        reason = (body.get("reason") or "").strip()

        error = validate_rule(exec_id, bench_name)
        if error:
            return jsonify({"error": error}), 400
        if not reason:
            return jsonify({"error": "reason is required"}), 400

        try:
            before = parse_release_at(body.get("before")) if body.get("before") else None
            after = parse_release_at(body.get("after")) if body.get("after") else None
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            rule = InvalidationRule(
                exec_id=exec_id,
                bench_name=bench_name,
                before=before,
                after=after,
                reason=reason,
                active=True,
                created_at=datetime.utcnow(),
            )
            sess.add(rule)
            sess.commit()
            sess.refresh(rule)

            counts = recompute_invalidations(sess)

            return jsonify({"rule": rule.as_dict(), **counts})

    @bp.route("/api/admin/invalidation-rules/<int:rule_id>", methods=["DELETE"])
    def api_delete_invalidation_rule(rule_id):
        body = request.get_json(silent=True) or {}
        try:
            target = _target({**request.args, **body})
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            rule = sess.get(InvalidationRule, rule_id)
            if rule is None:
                return jsonify({"error": "not found"}), 404
            rule.active = False
            sess.commit()

            counts = recompute_invalidations(sess)
            return jsonify({"status": "OK", **counts})

    @bp.route("/api/admin/invalidation-rules/recompute", methods=["POST"])
    def api_recompute_invalidation_rules():
        """Re-run all active rules — picks up newly pushed data (created_time
        within a rule's date range) that arrived after the rule was made."""
        body = request.get_json(silent=True) or {}
        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            counts = recompute_invalidations(sess)
            return jsonify({"status": "OK", **counts})

    @bp.route("/api/admin/invalidation-rules/bench-names", methods=["GET"])
    def api_invalidation_bench_names():
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            rows = sess.execute(
                select(distinct(Pack.name)).order_by(Pack.name)
            ).scalars().all()
            return jsonify([r for r in rows if r])
