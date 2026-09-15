"""Tests for the dashboard SQLAlchemy ingest writer."""

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from dashboard.server.database.models import Base, Exec, Pack
from dashboard.server.database.writer import DATA, SQLAlchemy, _is_prepare_run_name


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


def test_on_start_persists_command_to_db():
    # Pack.command is assigned on the Pack ORM object in on_start, but
    # on_new_pack's own `with self.session()` block has already closed by
    # then, detaching the object — a plain attribute assignment on a
    # detached instance is never flushed. on_start must persist it via an
    # explicit statement (like update_pack_status does for status), not
    # rely on the attribute mutation alone.
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend, pack = _backend_ready_for_data(engine)

    state = backend.states["bench.0"]
    state.step = 1  # START

    command = ["python", "main.py", "--batch-size", "42"]
    backend.on_start(SimpleNamespace(
        tag="bench.0",
        pack=pack,
        event="start",
        data={"command": command, "time": 123.0},
    ))

    with Session(engine) as sess:
        row = sess.execute(select(Pack).where(Pack._id == state.pack._id)).scalar_one()
        assert row.command == command


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


def test_torchmem_remaps_physical_gpu_for_per_gpu_pack():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend = SQLAlchemy(engine=engine)
    pack_cfg = {
        "run_name": "r1",
        "name": "resnet50",
        "devices": [3],
        "job-number": 1,
    }
    pack = SimpleNamespace(config=pack_cfg)
    backend.on_new_run(SimpleNamespace(data={}, pack=pack))
    backend.on_new_pack(SimpleNamespace(tag="resnet50.D3", pack=pack, data={}))
    state = backend.states["resnet50.D3"]
    state.step = DATA
    state.start = 0

    entry = SimpleNamespace(
        tag="resnet50.D3",
        pack=pack,
        event="data",
        data={
            "time": 456.0,
            "torchmem": {
                "0": {
                    "allocated": 100.0,
                    "reserved": 200.0,
                    "max_allocated": 300.0,
                    "max_reserved": 400.0,
                }
            },
        },
    )
    backend.on_data(entry)

    by_name = {m.name: m for m in backend.pending_metrics}
    assert by_name["torchmem.max_allocated"].gpu_id == "3"
    assert by_name["torchmem.max_allocated"].value == 300.0


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


class TestIsPrepareRunName:

    @pytest.mark.parametrize(
        "name",
        [
            "prepare.2026-08-02_19-03-10",
            "prepare_2026-08-02",
            "prepare-run",
            "prepare",
            "PREPARE.foo",
            "Prepare something",
        ],
    )
    def test_matches_prepare_names(self, name):
        assert _is_prepare_run_name(name)

    @pytest.mark.parametrize(
        "name",
        ["rufijini.2026-08-06_14-32-27", "preparation.run", "preparex", None, ""],
    )
    def test_does_not_match_other_names(self, name):
        assert not _is_prepare_run_name(name)


def test_on_new_run_refuses_prepare_run_name():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    backend = SQLAlchemy(engine=engine)
    pack = SimpleNamespace(config={"run_name": "prepare.2026-08-02_19-03-10"})
    entry = SimpleNamespace(data={}, pack=pack)

    with pytest.raises(ValueError, match="prepare"):
        backend.on_new_run(entry)

    with Session(engine) as sess:
        assert sess.execute(select(Exec)).first() is None


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
