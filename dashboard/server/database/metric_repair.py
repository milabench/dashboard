"""Detect and repair dashboard metrics mixed across ranks or benchmark names."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import sqlalchemy
from sqlalchemy import delete, func, select, update

from dashboard.server.database.models import Metric, Pack
from dashboard.server.database.writer import _normalize_gpu_id

_GPU_METRIC_PREFIX = "gpu."


@dataclass
class MetricIssue:
    kind: str
    exec_id: int
    pack_id: int | None = None
    pack_tag: str | None = None
    pack_name: str | None = None
    message: str = ""
    metric_count: int = 0

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "exec_id": self.exec_id,
            "pack_id": self.pack_id,
            "pack_tag": self.pack_tag,
            "pack_name": self.pack_name,
            "message": self.message,
            "metric_count": self.metric_count,
        }


def find_prefix_collision_pairs(pack_names: Iterable[str]) -> list[tuple[str, str]]:
    """Return benchmark name pairs that ``startswith`` group queries would have mixed."""
    names = sorted(set(pack_names))
    pairs: list[tuple[str, str]] = []
    for left in names:
        for right in names:
            if left != right and right.startswith(left):
                pairs.append((left, right))
    return pairs


def audit_exec(session, exec_id: int) -> list[MetricIssue]:
    """Find stored metrics that would render as mixed series in group charts."""
    exec_id = int(exec_id)
    packs = session.execute(select(Pack).where(Pack.exec_id == exec_id)).scalars().all()
    issues: list[MetricIssue] = []

    for left, right in find_prefix_collision_pairs(p.name for p in packs):
        left_ids = [p._id for p in packs if p.name == left]
        right_ids = [p._id for p in packs if p.name == right]
        n_left = session.execute(
            select(func.count()).select_from(Metric).where(Metric.exec_id == exec_id, Metric.pack_id.in_(left_ids))
        ).scalar_one()
        n_right = session.execute(
            select(func.count()).select_from(Metric).where(Metric.exec_id == exec_id, Metric.pack_id.in_(right_ids))
        ).scalar_one()
        issues.append(
            MetricIssue(
                kind="PREFIX_COLLISION",
                exec_id=exec_id,
                pack_name=left,
                message=(
                    f"benchmark {left!r} group view would also include {right!r} "
                    f"({n_right} metrics) when using startswith queries"
                ),
                metric_count=int(n_right),
            )
        )

    by_name: dict[str, list[Pack]] = {}
    for pack in packs:
        by_name.setdefault(pack.name, []).append(pack)

    for pack_name, group in by_name.items():
        if len(group) < 2:
            continue
        pack_ids = [p._id for p in group]
        rows = session.execute(
            select(
                Metric.name,
                Metric.gpu_id,
                func.count(func.distinct(Metric.pack_id)),
                func.count(),
            )
            .where(
                Metric.exec_id == exec_id,
                Metric.pack_id.in_(pack_ids),
                Metric.name.like(f"{_GPU_METRIC_PREFIX}%"),
            )
            .group_by(Metric.name, Metric.gpu_id)
        ).all()
        for metric_name, gpu_id, n_packs, n_metrics in rows:
            if int(n_packs) <= 1:
                continue
            issues.append(
                MetricIssue(
                    kind="GROUP_SERIES_COLLISION",
                    exec_id=exec_id,
                    pack_name=pack_name,
                    message=(
                        f"{int(n_packs)} rank packs share {metric_name} with gpu_id={gpu_id!r} "
                        f"({int(n_metrics)} rows) — group charts merge them into one line"
                    ),
                    metric_count=int(n_metrics),
                )
            )

    for pack in packs:
        devices = (pack.config or {}).get("devices") or []
        if len(devices) != 1:
            continue
        physical = _normalize_gpu_id("0", devices)
        if physical == "0":
            continue
        n_bad = session.execute(
            select(func.count())
            .select_from(Metric)
            .where(
                Metric.exec_id == exec_id,
                Metric.pack_id == pack._id,
                Metric.name.like(f"{_GPU_METRIC_PREFIX}%"),
                Metric.gpu_id == "0",
            )
        ).scalar_one()
        if n_bad:
            issues.append(
                MetricIssue(
                    kind="LOCAL_GPU_ID",
                    exec_id=exec_id,
                    pack_id=pack._id,
                    pack_tag=pack.tag,
                    pack_name=pack.name,
                    message=(
                        f"{int(n_bad)} gpu.* metrics still use local gpu_id='0' "
                        f"but pack devices={devices} — should be {physical!r}"
                    ),
                    metric_count=int(n_bad),
                )
            )

    return issues


def fix_local_gpu_ids(session, exec_id: int, *, dry_run: bool = True) -> dict[str, int]:
    """Remap rank-local gpu_id='0' rows to the pack's physical GPU index."""
    exec_id = int(exec_id)
    packs = session.execute(select(Pack).where(Pack.exec_id == exec_id)).scalars().all()
    updated = 0
    by_pack: dict[int, int] = {}

    for pack in packs:
        devices = (pack.config or {}).get("devices") or []
        if len(devices) != 1:
            continue
        physical = _normalize_gpu_id("0", devices)
        if physical == "0":
            continue

        where = sqlalchemy.and_(
            Metric.exec_id == exec_id,
            Metric.pack_id == pack._id,
            Metric.name.like(f"{_GPU_METRIC_PREFIX}%"),
            Metric.gpu_id == "0",
        )
        n_bad = session.execute(select(func.count()).select_from(Metric).where(where)).scalar_one()
        if not n_bad:
            continue

        if not dry_run:
            session.execute(update(Metric).where(where).values(gpu_id=physical))

        n_bad = int(n_bad)
        updated += n_bad
        by_pack[pack._id] = n_bad

    return {"updated": updated, "packs": by_pack}


def delete_pack_metrics(
    session,
    exec_id: int,
    *,
    tag: str | None = None,
    name: str | None = None,
    dry_run: bool = True,
) -> dict[str, int]:
    """Delete all metrics for pack(s) matched by exact tag or benchmark name."""
    if (tag is None) == (name is None):
        raise ValueError("Provide exactly one of tag= or name=")

    exec_id = int(exec_id)
    stmt = select(Pack).where(Pack.exec_id == exec_id)
    if tag is not None:
        stmt = stmt.where(Pack.tag == tag)
    else:
        stmt = stmt.where(Pack.name == name)

    packs = session.execute(stmt).scalars().all()
    if not packs:
        raise LookupError(f"No pack in exec {exec_id} matching {tag or name!r}")

    pack_ids = [p._id for p in packs]
    where = sqlalchemy.and_(Metric.exec_id == exec_id, Metric.pack_id.in_(pack_ids))
    n_metrics = session.execute(select(func.count()).select_from(Metric).where(where)).scalar_one()

    if not dry_run:
        session.execute(delete(Metric).where(where))

    return {
        "deleted": int(n_metrics),
        "packs": len(packs),
        "pack_ids": pack_ids,
        "pack_tags": [p.tag for p in packs],
    }
