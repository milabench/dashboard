"""Feature flags: named on/off switches toggleable from the admin UI
without a deploy — a kill switch for a risky code path in prod, or a
gradual rollout gate.

Same dev/prod-target-aware, injectable-session_factory pattern as
invalidation_admin.py / runs_admin.py for the admin CRUD routes. The
public route (``public_feature_flag_routes``) reads from whichever DB the
running server itself is connected to — a deployed instance always talks
to one database, so there's no target to choose there.
"""

from datetime import datetime

from flask import jsonify, request
from sqlalchemy import select

from .database.models import FeatureFlag


def is_enabled(session, name: str, default: bool = False) -> bool:
    """Look up a flag by name; a name with no row yet falls back to
    ``default`` so a call site can gate itself safely before the flag is
    ever created (e.g. off by default until someone flips it on)."""
    flag = session.execute(
        select(FeatureFlag).where(FeatureFlag.name == name)
    ).scalar_one_or_none()
    if flag is None:
        return default
    return bool(flag.enabled)


def _target(source) -> str:
    from .admin_db import TARGETS

    target = source.get("target", "dev")
    if target not in TARGETS:
        raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
    return target


def public_feature_flag_routes(bp, sqlexec):
    @bp.route("/api/feature-flags")
    def api_feature_flags():
        """{name: enabled} for every flag, from the server's own DB."""
        with sqlexec() as sess:
            rows = sess.execute(select(FeatureFlag.name, FeatureFlag.enabled)).all()
            return jsonify({name: bool(enabled) for name, enabled in rows})


def feature_flag_admin_routes(bp, session_factory=None):
    if session_factory is None:
        from .admin_db import admin_session as session_factory

    @bp.route("/api/admin/feature-flags", methods=["GET"])
    def api_list_feature_flags():
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            rows = sess.execute(
                select(FeatureFlag).order_by(FeatureFlag.name)
            ).scalars().all()
            return jsonify([r.as_dict() for r in rows])

    @bp.route("/api/admin/feature-flags", methods=["POST"])
    def api_create_feature_flag():
        body = request.get_json(force=True) or {}
        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400

        with session_factory(target) as sess:
            existing = sess.execute(
                select(FeatureFlag).where(FeatureFlag.name == name)
            ).scalar_one_or_none()
            if existing is not None:
                return jsonify({"error": f"Flag {name!r} already exists"}), 400

            flag = FeatureFlag(
                name=name,
                enabled=bool(body.get("enabled", False)),
                description=(body.get("description") or "").strip() or None,
            )
            sess.add(flag)
            sess.commit()
            sess.refresh(flag)
            return jsonify(flag.as_dict()), 201

    @bp.route("/api/admin/feature-flags/<string:name>", methods=["PATCH"])
    def api_update_feature_flag(name):
        body = request.get_json(force=True) or {}
        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            flag = sess.execute(
                select(FeatureFlag).where(FeatureFlag.name == name)
            ).scalar_one_or_none()
            if flag is None:
                return jsonify({"error": "not found"}), 404

            if "enabled" in body:
                flag.enabled = bool(body["enabled"])
            if "description" in body:
                flag.description = (body.get("description") or "").strip() or None
            flag.updated_at = datetime.utcnow()
            sess.commit()
            sess.refresh(flag)
            return jsonify(flag.as_dict())

    @bp.route("/api/admin/feature-flags/<string:name>", methods=["DELETE"])
    def api_delete_feature_flag(name):
        body = request.get_json(silent=True) or {}
        try:
            target = _target({**request.args, **body})
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            flag = sess.execute(
                select(FeatureFlag).where(FeatureFlag.name == name)
            ).scalar_one_or_none()
            if flag is None:
                return jsonify({"error": "not found"}), 404
            sess.delete(flag)
            sess.commit()
            return jsonify({"status": "OK"})
