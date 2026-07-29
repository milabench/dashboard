"""Tests for the dashboard SQLAlchemy ingest writer."""

from types import SimpleNamespace

from sqlalchemy import create_engine

from dashboard.server.database.models import Base
from dashboard.server.database.writer import SQLAlchemy


def test_sqlalchemy_reuses_injected_engine():
    engine = create_engine("sqlite:///:memory:")
    pool = engine.pool

    with SQLAlchemy(engine=engine) as logger:
        assert logger.engine is engine

    # The caller owns an injected engine, so leaving the logger must not
    # dispose its pool.
    assert engine.pool is pool


def test_meta_forced_applied_last():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    backend = SQLAlchemy(
        engine=engine,
        meta_tags={"notes": "upload"},
        meta_forced={"source": "ci", "contributor": "bot"},
    )
    pack = SimpleNamespace(config={"run_name": "r1"})
    entry = SimpleNamespace(
        data={"notes": "from-run", "pytorch": {"torch": "2"}},
        pack=pack,
    )
    backend.on_new_run(entry)

    assert backend.run.meta["contributor"] == "bot"
    assert backend.run.meta["source"] == "ci"
    assert backend.run.meta["notes"] == "from-run"
    assert backend.run.meta["pytorch"] == {"torch": "2"}
