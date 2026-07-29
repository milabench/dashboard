"""Scheduled Slurm job definitions and run history.

Stores cron-scheduled job templates that the dashboard periodically checks
and submits to Slurm clusters when due.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)

from .models import Base


class ScheduledJob(Base):
    """A cron-scheduled Slurm job definition."""

    __tablename__ = "scheduled_jobs"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(256), nullable=False, unique=True)
    enabled = Column(Boolean, nullable=False, default=True)

    cron_expression = Column(String(128), nullable=False)
    cluster = Column(String(128), nullable=False, default="mila")

    script = Column(Text, nullable=False)
    sbatch_args = Column(JSON, nullable=False, default=list)
    job_name_prefix = Column(String(256), nullable=True)

    created_time = Column(DateTime, default=datetime.utcnow)
    modified_time = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    last_run_time = Column(DateTime, nullable=True)
    last_job_id = Column(String(256), nullable=True)
    next_run_time = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_scheduled_jobs_enabled", "enabled"),
        Index("idx_scheduled_jobs_next_run", "next_run_time"),
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "name": self.name,
            "enabled": self.enabled,
            "cron_expression": self.cron_expression,
            "cluster": self.cluster,
            "script": self.script,
            "sbatch_args": self.sbatch_args,
            "job_name_prefix": self.job_name_prefix,
            "created_time": self.created_time.isoformat() if self.created_time else None,
            "modified_time": self.modified_time.isoformat() if self.modified_time else None,
            "last_run_time": self.last_run_time.isoformat() if self.last_run_time else None,
            "last_job_id": self.last_job_id,
            "next_run_time": self.next_run_time.isoformat() if self.next_run_time else None,
        }


class ScheduledJobRun(Base):
    """History log for each time a scheduled job was submitted."""

    __tablename__ = "scheduled_job_runs"

    _id = Column(Integer, primary_key=True, autoincrement=True)
    scheduled_job_id = Column(Integer, ForeignKey("scheduled_jobs._id"), nullable=False)
    jr_job_id = Column(String(256), nullable=True)
    slurm_job_id = Column(String(64), nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(32), nullable=False, default="submitted")
    error = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_scheduled_job_runs_job_id", "scheduled_job_id"),
        Index("idx_scheduled_job_runs_submitted", "submitted_at"),
    )

    def as_dict(self):
        return {
            "_id": self._id,
            "scheduled_job_id": self.scheduled_job_id,
            "jr_job_id": self.jr_job_id,
            "slurm_job_id": self.slurm_job_id,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "status": self.status,
            "error": self.error,
        }
