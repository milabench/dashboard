"""Tests for hidden production preview access."""

import pytest
from flask import Flask

from dashboard.server.preview import preview_enabled, register_preview_routes, token_valid


@pytest.fixture(autouse=True)
def _clear_preview_secret(monkeypatch):
    monkeypatch.setenv("PREVIEW_SECRET", "")


def test_preview_disabled_when_secret_empty():
    assert preview_enabled() is False
    assert token_valid("anything") is False


def test_preview_default_token(monkeypatch):
    monkeypatch.delenv("PREVIEW_SECRET", raising=False)
    assert preview_enabled() is True
    assert token_valid("experimental") is True
    assert token_valid("wrong") is False


def test_preview_token_validation(monkeypatch):
    monkeypatch.setenv("PREVIEW_SECRET", "test-secret")
    assert preview_enabled() is True
    assert token_valid("test-secret") is True
    assert token_valid("wrong") is False
    assert token_valid(None) is False


def test_preview_routes_require_token(monkeypatch):
    monkeypatch.setenv("PREVIEW_SECRET", "test-secret")
    monkeypatch.setenv("DEV_MODE", "false")

    app = Flask(__name__)
    cache = None

    def sqlexec():
        raise RuntimeError("not used in this test")

    def register_experimental(bp, _app, _cache, _sqlexec):
        @bp.route("/api/scaling-live", methods=["GET"])
        def scaling_live():
            return {"ok": True}

    register_preview_routes(app, cache, sqlexec, register_experimental)

    client = app.test_client()
    assert client.get("/api/scaling-live").status_code == 401
    assert client.get("/api/scaling-live", headers={"X-Preview-Token": "wrong"}).status_code == 401
    assert client.get("/api/scaling-live", headers={"X-Preview-Token": "test-secret"}).status_code == 200

    verify = client.post("/api/preview/verify", json={"token": "test-secret"})
    assert verify.status_code == 200
    assert verify.get_json() == {"ok": True}
