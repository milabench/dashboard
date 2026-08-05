"""Tests for the dashboard SQLAlchemy ingest writer."""

from types import SimpleNamespace

from sqlalchemy import create_engine

from dashboard.server.database.models import Base
from dashboard.server.database.writer import DATA, SQLAlchemy


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


def _backend_ready_for_data(engine):
    """Create a writer with a pack already past meta/start (DATA step)."""
    backend = SQLAlchemy(engine=engine)
    pack_cfg = {
        "run_name": "r1",
        "name": "bench",
        "devices": [0],
        "job-number": 1,
    }
    pack = SimpleNamespace(config=pack_cfg)
    backend.on_new_run(SimpleNamespace(data={}, pack=pack))
    backend.on_new_pack(SimpleNamespace(tag="bench.0", pack=pack, data={}))
    state = backend.states["bench.0"]
    state.step = DATA
    state.start = 0
    return backend, pack


def test_torchmem_expanded_per_device():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend, pack = _backend_ready_for_data(engine)

    entry = SimpleNamespace(
        tag="bench.0",
        pack=pack,
        event="data",
        data={
            "time": 123.0,
            "torchmem": {
                "0": {
                    "allocated": 2068.9,
                    "reserved": 2588.0,
                    "max_allocated": 25844.3,
                    "max_reserved": 27544.0,
                }
            },
        },
    )
    backend.on_data(entry)

    by_name = {m.name: m for m in backend.pending_metrics}
    assert set(by_name) == {
        "torchmem.allocated",
        "torchmem.reserved",
        "torchmem.max_allocated",
        "torchmem.max_reserved",
    }
    assert by_name["torchmem.max_allocated"].value == 25844.3
    assert by_name["torchmem.max_allocated"].gpu_id == "0"
    assert by_name["torchmem.max_allocated"].unit == "MiB"
    assert by_name["torchmem.max_allocated"].order == 123.0


def test_jaxmem_expanded_per_device():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend, pack = _backend_ready_for_data(engine)

    entry = SimpleNamespace(
        tag="bench.0",
        pack=pack,
        event="data",
        data={
            "time": 1.0,
            "jaxmem": {"0": {"allocated": 10.0, "reserved": 20.0, "max_allocated": 30.0, "max_reserved": 40.0}},
        },
    )
    backend.on_data(entry)

    names = {m.name for m in backend.pending_metrics}
    assert names == {
        "jaxmem.allocated",
        "jaxmem.reserved",
        "jaxmem.max_allocated",
        "jaxmem.max_reserved",
    }


def test_empty_torchmem_is_noop(capsys):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend, pack = _backend_ready_for_data(engine)

    entry = SimpleNamespace(
        tag="bench.0",
        pack=pack,
        event="data",
        data={"time": 1.0, "torchmem": {}},
    )
    backend.on_data(entry)

    assert backend.pending_metrics == []
    assert "Unexpected value" not in capsys.readouterr().out


def test_empty_jaxmem_is_noop(capsys):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend, pack = _backend_ready_for_data(engine)

    entry = SimpleNamespace(
        tag="bench.0",
        pack=pack,
        event="data",
        data={"time": 1.0, "jaxmem": {}},
    )
    backend.on_data(entry)

    assert backend.pending_metrics == []
    assert "Unexpected value" not in capsys.readouterr().out
