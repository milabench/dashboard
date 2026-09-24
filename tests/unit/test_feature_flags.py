"""Tests for feature_flags.is_enabled and the admin CRUD routes."""

from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from dashboard.server.database.models import Base, FeatureFlag
from dashboard.server.feature_flags import feature_flag_admin_routes, is_enabled


def _sqlite_engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine


class TestIsEnabled:
    def test_unknown_flag_falls_back_to_default(self):
        engine = _sqlite_engine()
        with Session(engine) as sess:
            assert is_enabled(sess, "does-not-exist") is False
            assert is_enabled(sess, "does-not-exist", default=True) is True

    def test_enabled_flag(self):
        engine = _sqlite_engine()
        with Session(engine) as sess:
            sess.add(FeatureFlag(name="new-thing", enabled=True))
            sess.commit()
            assert is_enabled(sess, "new-thing") is True
            assert is_enabled(sess, "new-thing", default=False) is True

    def test_disabled_flag_overrides_default_true(self):
        engine = _sqlite_engine()
        with Session(engine) as sess:
            sess.add(FeatureFlag(name="risky-thing", enabled=False))
            sess.commit()
            assert is_enabled(sess, "risky-thing", default=True) is False


def _app_with_routes(engine):
    app = Flask(__name__)

    def session_factory(target):
        assert target in ("dev", "prod")
        return Session(engine)

    feature_flag_admin_routes(app, session_factory=session_factory)
    return app


class TestFeatureFlagAdminRoutes:
    def test_create_list_update_delete(self):
        engine = _sqlite_engine()
        client = _app_with_routes(engine).test_client()

        create = client.post("/api/admin/feature-flags", json={"name": "foo", "enabled": True})
        assert create.status_code == 201
        assert create.get_json()["enabled"] is True

        listed = client.get("/api/admin/feature-flags")
        assert [f["name"] for f in listed.get_json()] == ["foo"]

        updated = client.patch("/api/admin/feature-flags/foo", json={"enabled": False})
        assert updated.status_code == 200
        assert updated.get_json()["enabled"] is False

        deleted = client.delete("/api/admin/feature-flags/foo", json={})
        assert deleted.status_code == 200

        listed_after = client.get("/api/admin/feature-flags")
        assert listed_after.get_json() == []

    def test_duplicate_name_rejected(self):
        engine = _sqlite_engine()
        client = _app_with_routes(engine).test_client()

        client.post("/api/admin/feature-flags", json={"name": "foo"})
        dup = client.post("/api/admin/feature-flags", json={"name": "foo"})
        assert dup.status_code == 400

    def test_update_missing_flag_404(self):
        engine = _sqlite_engine()
        client = _app_with_routes(engine).test_client()

        resp = client.patch("/api/admin/feature-flags/nope", json={"enabled": True})
        assert resp.status_code == 404

    def test_invalid_target_rejected(self):
        engine = _sqlite_engine()
        client = _app_with_routes(engine).test_client()

        resp = client.get("/api/admin/feature-flags", query_string={"target": "staging"})
        assert resp.status_code == 400
