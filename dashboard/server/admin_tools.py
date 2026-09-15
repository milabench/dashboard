"""Admin: DB migrations and materialized-view maintenance.

Mirrors the ``dashboard db migrate`` / ``dashboard db views`` CLI commands
(reuses their underlying functions directly) but lets an admin pick the
target ('dev' or 'prod', default 'dev') per request instead of per
process — same pattern as the other admin routes.
"""

import io
from contextlib import redirect_stdout

from flask import jsonify, request

from .admin_db import TARGETS, admin_session, resolve_target_admin_uri


def _target_from(source) -> str:
    target = source.get("target", "dev")
    if target not in TARGETS:
        raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
    return target


def _run_captured(fn, *args, **kwargs):
    log = io.StringIO()
    with redirect_stdout(log):
        rc = fn(*args, **kwargs)
    return rc, log.getvalue()


def admin_tools_routes(bp):
    @bp.route("/api/admin/migrate/status", methods=["GET"])
    def api_admin_migrate_status():
        from dashboard.cli.database.migrate import _check

        try:
            target = _target_from(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        try:
            db_url = resolve_target_admin_uri(target)
            rc, log = _run_captured(_check, db_url)
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify({"status": "OK" if rc == 0 else "ERR", "log": log})

    @bp.route("/api/admin/migrate/upgrade", methods=["POST"])
    def api_admin_migrate_upgrade():
        from dashboard.cli.database.migrate import _upgrade

        body = request.get_json(silent=True) or {}
        try:
            target = _target_from(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        try:
            db_url = resolve_target_admin_uri(target)
            rc, log = _run_captured(_upgrade, db_url)
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify({"status": "OK" if rc == 0 else "ERR", "log": log})

    @bp.route("/api/admin/views/status", methods=["GET"])
    def api_admin_views_status():
        from dashboard.cli.database.views import status_views

        try:
            target = _target_from(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        try:
            with admin_session(target) as sess:
                rc, log = _run_captured(status_views, sess)
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify({"status": "OK", "log": log})

    @bp.route("/api/admin/views/refresh", methods=["POST"])
    def api_admin_views_refresh():
        from dashboard.cli.database.views import refresh_views

        body = request.get_json(silent=True) or {}
        try:
            target = _target_from(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        try:
            with admin_session(target) as sess:
                _, log = _run_captured(refresh_views, sess, None)
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify({"status": "OK", "log": log})
