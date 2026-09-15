"""Scaling observations computed directly from pushed run data (Exec/Pack/
Metric), as a cache table — distinct from ``scaling_observations``, which is
a manual snapshot of the ``milabench/config/scaling/*.yaml`` files.

Experimental: only reachable via DEV routes for now (see
``server/scaling_live.py``). Recomputed on demand, not automatically kept
in sync with new pushes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
)

from .models import Base


class LiveScalingObservation(Base):
    """One (gpu, bench, batch_size) scaling point computed from real runs."""

    __tablename__ = "scaling_observations_live"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    gpu = Column(String(128), nullable=False)
    bench = Column(String(256), nullable=False)
    batch_size = Column(Integer, nullable=False)

    memory_mib = Column(Float, nullable=True)
    perf = Column(Float, nullable=True)
    n_samples = Column(Integer, nullable=False, default=1)

    torch = Column(String(128), nullable=True)
    backend = Column(String(32), nullable=True)

    # Provenance: one representative exec/pack this point was derived from
    # (there may be several contributing runs — n_samples counts them).
    exec_id = Column(Integer, nullable=True)
    pack_id = Column(Integer, nullable=True)

    computed_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("gpu", "bench", "batch_size", name="uq_live_scaling_point"),
        Index("idx_live_scaling_gpu", "gpu"),
        Index("idx_live_scaling_bench", "bench"),
        Index("idx_live_scaling_gpu_bench", "gpu", "bench"),
    )

    def as_api_dict(self):
        """Same shape as ScalingObservation.as_api_dict() for reuse in the UI."""
        row = {
            "gpu": self.gpu,
            "bench": self.bench,
            "batch_size": self.batch_size,
            "memory": self.memory_mib,
            "perf": self.perf,
            "n_samples": self.n_samples,
            "torch": self.torch,
            "backend": self.backend,
            "exec_id": self.exec_id,
        }
        if self.computed_at is not None:
            ts = self.computed_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            row["time"] = int(ts.timestamp())
        return row
