"""GPU specification database.

Stores theoretical GPU performance specs (TFLOPS, memory bandwidth, TDP, etc.)
in an extensible JSON column so new properties can be added without migrations.

The ``specs`` column holds a dict like::

    {
        "fp16":  125.3376,    # TFLOPS - FP16 tensor throughput
        "fp32":   15.6672,    # TFLOPS - scalar FP32 throughput
        "fp64":    7.8336,    # TFLOPS - scalar FP64 throughput
        "tf32":  false,       # TFLOPS - TF32 tensor throughput (false if unsupported)
        "memgb":  16,         # GB     - GPU memory capacity
        "membw": 900,         # GB/s   - memory bandwidth
        "tdp":   300,         # W      - thermal design power
    }

Spec keys follow the IGUANE rawdata.toml conventions.  GPU data is sourced
from the ``iguane`` package (https://github.com/mila-iqia/IGUANE) at seed
time -- no specs are hardcoded here.

New keys (e.g. ``fp8``, ``int8``, ``nvlink_bw``) can be added freely.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    JSON,
    String,
)

from .models import Base


class GPU(Base):
    """A GPU model with its theoretical performance specifications."""

    __tablename__ = "gpus"

    _id = Column(Integer, primary_key=True, autoincrement=True)

    name = Column(String(256), nullable=False, unique=True)
    vendor = Column(String(64), nullable=False, default="nvidia")
    architecture = Column(String(128), nullable=True)
    release_date = Column(String(16), nullable=True)

    # Extensible JSON blob for all perf specs (TFLOPS, memory, power, …).
    specs = Column(JSON, nullable=False, default=dict)

    # Convenience scalar columns for the most-queried values,
    # kept in sync with ``specs`` for fast SQL filtering / joins.
    int4 = Column(Float, nullable=True)
    int8 = Column(Float, nullable=True)
    fp4 = Column(Float, nullable=True)
    fp8 = Column(Float, nullable=True)
    fp16 = Column(Float, nullable=True)
    fp32 = Column(Float, nullable=True)
    fp64 = Column(Float, nullable=True)
    tf32 = Column(Float, nullable=True)
    memgb = Column(Float, nullable=True)
    membw = Column(Float, nullable=True)
    tdp = Column(Float, nullable=True)

    created_time = Column(DateTime, default=datetime.utcnow)
    modified_time = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_gpu_name", "name"),
        Index("idx_gpu_vendor", "vendor"),
        Index("idx_gpu_architecture", "architecture"),
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "name": self.name,
            "vendor": self.vendor,
            "architecture": self.architecture,
            "release_date": self.release_date,
            "specs": self.specs,
            "int4": self.int4,
            "int8": self.int8,
            "fp4": self.fp4,
            "fp8": self.fp8,
            "fp16": self.fp16,
            "fp32": self.fp32,
            "fp64": self.fp64,
            "tf32": self.tf32,
            "memgb": self.memgb,
            "membw": self.membw,
            "tdp": self.tdp,
        }

    @classmethod
    def from_spec(cls, name: str, raw: dict, *, vendor: str = "nvidia", architecture: str | None = None) -> "GPU":
        """Create a GPU instance from IGUANE-style spec dict.

        Handles the ``false`` sentinel used for unsupported precisions.
        """
        def _float_or_none(v):
            if v is False or v is None:
                return None
            return float(v)

        return cls(
            name=name,
            vendor=vendor,
            architecture=architecture,
            release_date=raw.get("reldate"),
            specs=raw,
            int4=_float_or_none(raw.get("int4")),
            int8=_float_or_none(raw.get("int8")),
            fp4=_float_or_none(raw.get("fp4")),
            fp8=_float_or_none(raw.get("fp8")),
            fp16=_float_or_none(raw.get("fp16")),
            fp32=_float_or_none(raw.get("fp32")),
            fp64=_float_or_none(raw.get("fp64")),
            tf32=_float_or_none(raw.get("tf32")),
            memgb=_float_or_none(raw.get("memgb")),
            membw=_float_or_none(raw.get("membw")),
            tdp=_float_or_none(raw.get("tdp")),
        )


# ---------------------------------------------------------------------------
# Architecture heuristics (IGUANE does not provide this)
# ---------------------------------------------------------------------------

_ARCH_PREFIXES = [
    ("K",       "Kepler"),
    ("M",       "Maxwell"),
    ("P100",    "Pascal"),
    ("V100",    "Volta"),
    ("RTX-20",  "Turing"),
    ("RTX-2080","Turing"),
    ("TITAN-R", "Turing"),
    ("T4",      "Turing"),
    ("RTX6000", "Turing"),
    ("RTX8000", "Turing"),
    ("A100",    "Ampere"),
    ("A40",     "Ampere"),
    ("A5000",   "Ampere"),
    ("A6000",   "Ampere"),
    ("RTX-30",  "Ampere"),
    ("RTX-40",  "Ada Lovelace"),
    ("L40",     "Ada Lovelace"),
    ("H100",    "Hopper"),
    ("H200",    "Hopper"),
    ("RTX-50",  "Blackwell"),
    ("RTX-PRO", "Blackwell"),
    ("B100",    "Blackwell"),
    ("B200",    "Blackwell"),
    ("GB",      "Blackwell"),
    ("MI300",   "CDNA3"),
    ("MI325",   "CDNA3"),
]


def _guess_architecture(name: str) -> str | None:
    for prefix, arch in _ARCH_PREFIXES:
        if name.startswith(prefix):
            return arch
    return None


def _guess_vendor(name: str) -> str:
    upper = name.upper()
    if (
        "TENSTORRENT" in upper
        or "WORMHOLE" in upper
        or "BLACKHOLE" in upper
        or "GRAYSKULL" in upper
        or upper.startswith("N300")
        or upper.startswith("P150")
    ):
        return "tenstorrent"
    if (
        "INTEL" in upper
        or "GAUDI" in upper
        or "HABANA" in upper
        or "ARC A" in upper
        or "DATA CENTER GPU" in upper
        or "XPU" in upper
        or "PVC" in upper
    ):
        return "intel"
    if name.startswith("MI"):
        return "amd"
    return "nvidia"


def _load_iguane_rawdata() -> dict[str, dict]:
    """Load GPU specs from the iguane package."""
    from iguane.fom import RAWDATA
    return RAWDATA


_ROW_FIELDS = [
    "name", "vendor", "architecture", "release_date", "specs",
    "int4", "int8", "fp4", "fp8", "fp16", "fp32", "fp64", "tf32",
    "memgb", "membw", "tdp",
]


def _gpu_to_row(gpu: GPU) -> dict:
    return {k: getattr(gpu, k) for k in _ROW_FIELDS}


def seed_gpus(session, *, commit: bool = True) -> int:
    """Insert or update GPU specs from IGUANE data. Returns count of upserted rows."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    rawdata = _load_iguane_rawdata()
    if not rawdata:
        return 0

    rows = []
    for name, raw in rawdata.items():
        gpu = GPU.from_spec(
            name,
            raw,
            vendor=_guess_vendor(name),
            architecture=_guess_architecture(name),
        )
        rows.append(_gpu_to_row(gpu))

    stmt = pg_insert(GPU).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["name"],
        set_={k: getattr(stmt.excluded, k) for k in _ROW_FIELDS},
    )
    session.execute(stmt)
    if commit:
        session.commit()
    return len(rows)
