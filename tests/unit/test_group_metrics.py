"""Tests for benchmark-group metric queries (multi-rank / multi-benchmark isolation)."""

from datetime import datetime

import pytest
import sqlalchemy
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from dashboard.server.database.models import Base, Exec, Metric, Pack


def _pack(exec_id, name, tag):
    return Pack(
        exec_id=exec_id,
        created_time=datetime.utcnow(),
        name=name,
        tag=tag,
        config={"name": name, "tag": tag.split(".")},
    )


def _metric(exec_id, pack_id, name, value, gpu_id="0", order=1):
    return Metric(
        exec_id=exec_id,
        pack_id=pack_id,
        name=name,
        value=value,
        gpu_id=gpu_id,
        order=order,
    )


@pytest.fixture
def metrics_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        run = Exec(name="run1", created_time=datetime.utcnow(), meta={}, status="done")
        sess.add(run)
        sess.commit()
        sess.refresh(run)

        lightning = _pack(run._id, "lightning", "lightning.D0")
        lightning_gpus = _pack(run._id, "lightning-gpus", "lightning-gpus.0")
        fp16 = _pack(run._id, "fp16", "fp16.D0")
        sess.add_all([lightning, lightning_gpus, fp16])
        sess.commit()
        for pack in (lightning, lightning_gpus, fp16):
            sess.refresh(pack)

        sess.add_all(
            [
                _metric(run._id, lightning._id, "gpu.load", 0.9, gpu_id="0", order=10),
                _metric(run._id, lightning_gpus._id, "gpu.load", 0.1, gpu_id="0", order=20),
                _metric(run._id, fp16._id, "gpu.load", 0.5, gpu_id="0", order=30),
            ]
        )
        sess.commit()
        yield engine, run._id, {
            "lightning": lightning._id,
            "lightning-gpus": lightning_gpus._id,
            "fp16": fp16._id,
        }


def _group_metrics(session, exec_id, pack_name):
    stmt = (
        sqlalchemy.select(Metric)
        .where(Metric.exec_id == exec_id, Pack.name == pack_name)
        .join(Pack, Metric.pack_id == Pack._id)
    )
    return session.execute(stmt).scalars().all()


def test_group_metrics_exact_name_does_not_mix_related_benchmarks(metrics_db):
    engine, exec_id, pack_ids = metrics_db
    with Session(engine) as sess:
        rows = _group_metrics(sess, exec_id, "lightning")

    assert len(rows) == 1
    assert rows[0].pack_id == pack_ids["lightning"]
    assert rows[0].value == 0.9


def test_group_metrics_exact_name_would_have_mixed_with_startswith(metrics_db):
    engine, exec_id, pack_ids = metrics_db
    with Session(engine) as sess:
        stmt = (
            sqlalchemy.select(Metric)
            .where(Metric.exec_id == exec_id, Pack.name.startswith("lightning"))
            .join(Pack, Metric.pack_id == Pack._id)
        )
        rows = sess.execute(stmt).scalars().all()

    assert len(rows) == 2
    assert {row.pack_id for row in rows} == {pack_ids["lightning"], pack_ids["lightning-gpus"]}
