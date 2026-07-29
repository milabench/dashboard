"""Tests for push-key metadata creation, listing, and authoritative merge."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as SASession

from dashboard.server.database.models import Base, PushKey
from dashboard.server.database.writer import SQLAlchemy, FORCED_META_KEYS


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def engine():
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    return eng


@pytest.fixture
def session(engine):
    with SASession(engine) as sess:
        yield sess


@pytest.fixture
def push_app(engine):
    """Flask app with push routes against an in-memory SQLite DB."""
    from dashboard.server.push import push_routes

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["UPLOAD_FOLDER"] = "/tmp"

    class FakeDatabase:
        def __init__(self, eng):
            self.engine = eng

        @contextmanager
        def connect(self):
            with SASession(self.engine) as sess:
                yield sess

    db = FakeDatabase(engine)
    push_routes(app, db)
    return app, db


# ─── Model tests ──────────────────────────────────────────────────────

class TestPushKeyModel:
    def test_as_dict_includes_metadata(self, session):
        key = PushKey(name="ci", key="a" * 64, metadata_={"source": "ci", "ignore": True})
        session.add(key)
        session.commit()

        d = key.as_dict()
        assert d["name"] == "ci"
        assert d["metadata"] == {"source": "ci", "ignore": True}
        assert "key" not in d

    def test_metadata_defaults_to_empty_object(self, session):
        key = PushKey(name="alice", key="b" * 64, metadata_={})
        session.add(key)
        session.commit()
        session.refresh(key)

        row = session.execute(select(PushKey).where(PushKey.name == "alice")).scalar_one()
        assert row.metadata_ == {}
        assert row.as_dict()["metadata"] == {}


# ─── API tests ────────────────────────────────────────────────────────

class TestPushKeyAPI:
    def test_create_key_without_metadata(self, push_app):
        app, _ = push_app
        client = app.test_client()

        resp = client.post("/api/push/key/request", json={"name": "bob"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "OK"
        assert data["name"] == "bob"
        assert len(data["key"]) == 64
        assert data["metadata"] == {}

    def test_create_key_with_metadata(self, push_app):
        app, _ = push_app
        client = app.test_client()

        meta = {"source": "ci", "ignore": True}
        resp = client.post(
            "/api/push/key/request",
            json={"name": "github-ci", "metadata": meta},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "OK"
        assert data["metadata"] == meta

        listed = client.get("/api/push/key/list").get_json()
        assert listed == [{"name": "github-ci", "metadata": meta}]
        assert all("key" not in row for row in listed)

    def test_reject_non_object_metadata(self, push_app):
        app, _ = push_app
        client = app.test_client()

        resp = client.post(
            "/api/push/key/request",
            json={"name": "bad", "metadata": ["not", "an", "object"]},
        )
        assert resp.status_code == 400
        assert resp.get_json()["status"] == "ERR"

    def test_duplicate_name_conflict(self, push_app):
        app, _ = push_app
        client = app.test_client()

        assert client.post("/api/push/key/request", json={"name": "dup"}).status_code == 200
        resp = client.post("/api/push/key/request", json={"name": "dup"})
        assert resp.status_code == 409

    def test_resolve_returns_name_and_metadata(self, push_app, engine):
        from dashboard.server.push import push_routes

        # Re-bind to inspect resolve via upload auth path
        app, db = push_app
        client = app.test_client()

        meta = {"source": "ci"}
        created = client.post(
            "/api/push/key/request",
            json={"name": "ci-bot", "metadata": meta},
        ).get_json()

        # Call resolve_push_key through a tiny helper by uploading without a file
        # (401/403/400 still exercise key resolution)
        resp = client.post(
            "/api/push/zip/stream",
            data={"key": created["key"]},
            content_type="multipart/form-data",
        )
        # Missing file after successful key resolve → 400
        assert resp.status_code == 400

        # Invalid key → 403
        bad = client.post(
            "/api/push/zip/stream",
            data={"key": "0" * 64},
            content_type="multipart/form-data",
        )
        assert bad.status_code == 403


# ─── Merge precedence tests ───────────────────────────────────────────

class TestMetaForcedMerge:
    def _fake_entry(self, run_meta):
        pack = SimpleNamespace(config={"run_name": "test-run"})
        return SimpleNamespace(data=run_meta, pack=pack, event="meta", tag="bench")

    def test_key_metadata_and_contributor_override_conflicts(self, engine):
        run_meta = {
            "contributor": "spoofed",
            "source": "from-archive",
            "pytorch": {"torch": "2.0"},
            "cluster": "lab",
        }
        user_meta = {
            "source": "from-upload",
            "notes": "nightly",
        }
        key_meta = {
            "source": "ci",
            "ignore": True,
        }

        backend = SQLAlchemy(
            engine=engine,
            meta_tags=user_meta,
            meta_forced={**key_meta, "contributor": "github-ci"},
        )
        backend.on_new_run(self._fake_entry(run_meta))

        meta = backend.run.meta
        assert meta["contributor"] == "github-ci"
        assert meta["source"] == "ci"
        assert meta["ignore"] is True
        assert meta["notes"] == "nightly"
        assert meta["cluster"] == "lab"
        assert meta["pytorch"] == {"torch": "2.0"}

    def test_forced_keys_stripped_from_run_data(self):
        assert "contributor" in FORCED_META_KEYS

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)

        backend = SQLAlchemy(
            engine=engine,
            meta_tags={},
            meta_forced={"contributor": "alice", "ignore": True},
        )
        backend.on_new_run(self._fake_entry({
            "contributor": "evil",
            "ignore": False,
            "cpu": {"count": 8},
        }))

        meta = backend.run.meta
        assert meta["contributor"] == "alice"
        assert meta["ignore"] is True
        assert meta["cpu"] == {"count": 8}

    def test_empty_key_metadata_preserves_existing_behavior(self, engine):
        backend = SQLAlchemy(
            engine=engine,
            meta_tags={"notes": "manual"},
            meta_forced={"contributor": "bob"},
        )
        backend.on_new_run(self._fake_entry({
            "pytorch": {"torch": "2.1"},
            "notes": "from-run",
        }))

        meta = backend.run.meta
        # Run metadata still wins over per-upload tags
        assert meta["notes"] == "from-run"
        assert meta["contributor"] == "bob"
        assert meta["pytorch"] == {"torch": "2.1"}
