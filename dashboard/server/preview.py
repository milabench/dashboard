"""Hidden production access to experimental dashboard routes.

Set ``PREVIEW_SECRET`` to override the default token (``experimental``).
Set ``PREVIEW_SECRET=`` (empty) to disable preview on production. The
token is never returned by the API — clients must already know it.
"""

from __future__ import annotations

import os
import secrets

from flask import Blueprint, jsonify, request

DEFAULT_PREVIEW_SECRET = "experimental"


def preview_secret() -> str:
    raw = os.environ.get("PREVIEW_SECRET")
    if raw is None:
        return DEFAULT_PREVIEW_SECRET
    return raw.strip()


def preview_enabled() -> bool:
    return bool(preview_secret())


def token_valid(token: str | None) -> bool:
    secret = preview_secret()
    if not secret or not token:
        return False
    return secrets.compare_digest(token, secret)


def register_preview_routes(app, cache, sqlexec, register_experimental):
    """Attach authenticated preview routes when ``PREVIEW_SECRET`` is set."""
    if not preview_enabled():
        return

    preview_bp = Blueprint("preview", __name__)

    @preview_bp.before_request
    def _require_preview_token():
        if request.endpoint == "preview.verify_preview":
            return None
        if token_valid(
            request.headers.get("X-Preview-Token")
            or request.args.get("preview_token")
        ):
            return None
        return jsonify({"error": "Preview token required"}), 401

    @preview_bp.route("/api/preview/verify", methods=["POST"])
    def verify_preview():
        body = request.get_json(silent=True) or {}
        if token_valid(body.get("token")):
            return jsonify({"ok": True})
        return jsonify({"error": "Invalid preview token"}), 401

    register_experimental(preview_bp, app, cache, sqlexec)
    app.register_blueprint(preview_bp)
