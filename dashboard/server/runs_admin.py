"""Admin: browse runs and flip public/private visibility.

Typically used against prod (release a run to the public site once you're
happy with it) but works the same against dev for testing. Every route
accepts a ``target`` ('dev' or 'prod', default 'dev') and operates against
that database via an injectable ``session_factory`` — same pattern as
``run_groups.py``/``push.py``'s admin routes.
"""

import secrets

from flask import jsonify, request
from sqlalchemy import func, select

from .database.models import Exec
from .visibility import (
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
    parse_release_at,
    share_url_for,
)


def _exec_summary(run: Exec) -> dict:
    return {
        "_id": run._id,
        "name": run.name,
        "created_time": run.created_time.isoformat() if run.created_time else None,
        "status": run.status,
        "visibility": "private" if run.visibility == VISIBILITY_PRIVATE else "public",
        "share_token": run.share_token,
        "share_path": share_url_for(run.share_token) if run.share_token else None,
        "release_at": run.release_at.isoformat() if run.release_at else None,
    }


def runs_admin_routes(bp, session_factory=None):
    from .admin_db import TARGETS
    if session_factory is None:
        from .admin_db import admin_session as session_factory

    def _target(source) -> str:
        target = source.get("target", "dev")
        if target not in TARGETS:
            raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
        return target

    @bp.route("/api/admin/runs", methods=["GET"])
    def api_admin_list_runs():
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        q = request.args.get("q", "").strip()
        visibility = request.args.get("visibility")  # "public" | "private" | None
        limit = min(int(request.args.get("limit", 50)), 200)
        offset = max(int(request.args.get("offset", 0)), 0)

        conditions = []
        if q:
            conditions.append(Exec.name.ilike(f"%{q}%"))
        if visibility == "public":
            conditions.append(Exec.visibility == VISIBILITY_PUBLIC)
        elif visibility == "private":
            conditions.append(Exec.visibility == VISIBILITY_PRIVATE)

        with session_factory(target) as sess:
            total = sess.execute(
                select(func.count()).select_from(Exec).where(*conditions)
            ).scalar_one()
            rows = sess.execute(
                select(Exec)
                .where(*conditions)
                .order_by(Exec._id.desc())
                .limit(limit)
                .offset(offset)
            ).scalars().all()

            return jsonify({
                "total": total,
                "runs": [_exec_summary(r) for r in rows],
            })

    @bp.route("/api/admin/runs/<int:exec_id>/visibility", methods=["POST"])
    def api_admin_set_visibility(exec_id):
        body = request.get_json(force=True) or {}
        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        visibility = body.get("visibility")
        if visibility not in ("public", "private"):
            return jsonify({"error": "visibility must be 'public' or 'private'"}), 400

        with session_factory(target) as sess:
            run = sess.get(Exec, exec_id)
            if run is None:
                return jsonify({"error": "not found"}), 404

            if visibility == "public":
                run.visibility = VISIBILITY_PUBLIC
            else:
                run.visibility = VISIBILITY_PRIVATE
                if not run.share_token:
                    run.share_token = secrets.token_urlsafe(32)
                if "release_at" in body:
                    raw = body.get("release_at")
                    if raw:
                        try:
                            run.release_at = parse_release_at(raw)
                        except ValueError as err:
                            return jsonify({"error": str(err)}), 400
                    else:
                        run.release_at = None

            sess.commit()
            sess.refresh(run)
            return jsonify(_exec_summary(run))
