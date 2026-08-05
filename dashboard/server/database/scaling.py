"""Scaling observation rows imported from milabench config/scaling YAML."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
)

from .models import Base


class ScalingObservation(Base):
    """One batch-size / memory observation for a benchmark on a GPU."""

    __tablename__ = "scaling_observations"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    gpu = Column(String(128), nullable=False)
    bench = Column(String(256), nullable=False)
    batch_size = Column(Integer, nullable=False)
    cpu = Column(Integer, nullable=True)

    memory_mib = Column(Float, nullable=True)
    torchmem_mib = Column(Float, nullable=True)
    jaxmem_mib = Column(Float, nullable=True)
    perf = Column(Float, nullable=True)

    observed_at = Column(DateTime(timezone=True), nullable=True)

    torch = Column(String(128), nullable=True)
    backend = Column(String(32), nullable=True)
    backend_version = Column(String(64), nullable=True)
    revision = Column(String(128), nullable=True)  # reserved; unused for now

    source_file = Column(String(256), nullable=True)

    __table_args__ = (
        Index("idx_scaling_gpu", "gpu"),
        Index("idx_scaling_bench", "bench"),
        Index("idx_scaling_gpu_bench", "gpu", "bench"),
    )

    def as_api_dict(self):
        """Shape expected by /api/scaling consumers (Altair plots, etc.)."""
        row = {
            "gpu": self.gpu,
            "bench": self.bench,
            "batch_size": self.batch_size,
            "cpu": self.cpu,
            "memory": self.memory_mib,
            "torchmem": self.torchmem_mib,
            "jaxmem": self.jaxmem_mib,
            "perf": self.perf,
            "torch": self.torch,
            "backend": self.backend,
            "backend_version": self.backend_version,
            "revision": self.revision,
        }
        if self.observed_at is not None:
            ts = self.observed_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            row["time"] = int(ts.timestamp())
        return row
