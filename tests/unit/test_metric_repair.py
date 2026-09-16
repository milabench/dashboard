"""Tests for mixed-metric audit and repair."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from dashboard.server.database.metric_repair import (
    audit_exec,
    delete_pack_metrics,
    find_prefix_collision_pairs,
    fix_local_gpu_ids,
)
from dashboard.server.database.models import Base, Exec, Metric, Pack


def _pack(exec_id, name, tag, devices):
    return Pack(
        exec_id=exec_id,
        created_time=datetime.utcnow(),
        name=name,
        tag=tag,
        config={"name": name, "tag": tag.split("."), "devices": devices},
    )


def _gpu_metric(exec_id, pack_id, gpu_id, order, value=0.9):
    return Metric(
        exec_id=exec_id,
        pack_id=pack_id,
        name="gpu.load",
        value=value,
        gpu_id=str(gpu_id),
        order=order,
    )


@pytest.fixture
def repair_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        run = Exec(name="run1", created_time=datetime.utcnow(), meta={}, status="done")
        sess.add(run)
        sess.commit()
        sess.refresh(run)

        d0 = _pack(run._id, "lightning", "lightning.D0", [0])
        d3 = _pack(run._id, "lightning", "lightning.D3", [3])
        gpus = _pack(run._id, "lightning-gpus", "lightning-gpus.0", list(range(8)))
        sess.add_all([d0, d3, gpus])
        sess.commit()
        for pack in (d0, d3, gpus):
            sess.refresh(pack)

        sess.add_all(
            [
                _gpu_metric(run._id, d0._id, "0", 10),
                _gpu_metric(run._id, d3._id, "0", 20),
                _gpu_metric(run._id, gpus._id, "0", 30, value=0.1),
                _gpu_metric(run._id, gpus._id, "3", 31, value=0.2),
            ]
        )
        sess.commit()
        yield engine, run._id, {"d0": d0._id, "d3": d3._id, "gpus": gpus._id}


def test_find_prefix_collision_pairs():
    pairs = find_prefix_collision_pairs(["lightning", "lightning-gpus", "fp16"])
    assert ("lightning", "lightning-gpus") in pairs
    assert all(left != right for left, right in pairs)


def test_audit_detects_group_series_collision(repair_db):
    engine, exec_id, _ = repair_db
    with Session(engine) as sess:
        issues = audit_exec(sess, exec_id)

    kinds = {i.kind for i in issues}
    assert "GROUP_SERIES_COLLISION" in kinds
    assert "PREFIX_COLLISION" in kinds
    assert "LOCAL_GPU_ID" in kinds


def test_audit_detects_local_gpu_id(repair_db):
    engine, exec_id, pack_ids = repair_db
    with Session(engine) as sess:
        pack = sess.get(Pack, pack_ids["d3"])
        pack.config = {"name": "lightning", "tag": ["lightning", "D3"], "devices": [3]}
        sess.commit()

        issues = audit_exec(sess, exec_id)

    local = [i for i in issues if i.kind == "LOCAL_GPU_ID" and i.pack_id == pack_ids["d3"]]
    assert len(local) == 1
    assert local[0].metric_count == 1


def test_fix_local_gpu_ids_updates_only_rank_packs(repair_db):
    engine, exec_id, pack_ids = repair_db
    with Session(engine) as sess:
        for pack_id in (pack_ids["d0"], pack_ids["d3"]):
            pack = sess.get(Pack, pack_id)
            devices = [0 if pack_id == pack_ids["d0"] else 3]
            pack.config = {"name": "lightning", "devices": devices}
        sess.commit()

        result = fix_local_gpu_ids(sess, exec_id, dry_run=False)
        sess.commit()

        d3_gpu = sess.execute(
            select(Metric.gpu_id).where(Metric.pack_id == pack_ids["d3"])
        ).scalar_one()
        gpus_gpu = sess.execute(
            select(Metric.gpu_id).where(Metric.pack_id == pack_ids["gpus"], Metric.order == 30)
        ).scalar_one()

    assert result["updated"] == 1
    assert d3_gpu == "3"
    assert gpus_gpu == "0"


def test_delete_pack_metrics_by_name(repair_db):
    engine, exec_id, pack_ids = repair_db
    with Session(engine) as sess:
        result = delete_pack_metrics(sess, exec_id, name="lightning-gpus", dry_run=False)
        sess.commit()
        remaining = sess.execute(select(Metric).where(Metric.exec_id == exec_id)).scalars().all()

    assert result["deleted"] == 2
    assert {m.pack_id for m in remaining} == {pack_ids["d0"], pack_ids["d3"]}


def test_delete_pack_metrics_requires_exact_selector(repair_db):
    engine, exec_id, _ = repair_db
    with Session(engine) as sess:
        with pytest.raises(ValueError):
            delete_pack_metrics(sess, exec_id)
        with pytest.raises(ValueError):
            delete_pack_metrics(sess, exec_id, tag="x", name="y")
