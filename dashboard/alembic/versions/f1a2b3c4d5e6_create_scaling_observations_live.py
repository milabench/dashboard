"""Create scaling_observations_live table

Revision ID: f1a2b3c4d5e6
Revises: c4c93135d002
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "c4c93135d002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "scaling_observations_live" in inspector.get_table_names():
        return

    op.create_table(
        "scaling_observations_live",
        sa.Column("_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("gpu", sa.String(length=128), nullable=False),
        sa.Column("bench", sa.String(length=256), nullable=False),
        sa.Column("batch_size", sa.Integer(), nullable=False),
        sa.Column("memory_mib", sa.Float(), nullable=True),
        sa.Column("perf", sa.Float(), nullable=True),
        sa.Column("n_samples", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("torch", sa.String(length=128), nullable=True),
        sa.Column("backend", sa.String(length=32), nullable=True),
        sa.Column("exec_id", sa.Integer(), nullable=True),
        sa.Column("pack_id", sa.Integer(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("_id"),
        sa.UniqueConstraint("gpu", "bench", "batch_size", name="uq_live_scaling_point"),
    )
    op.create_index("idx_live_scaling_gpu", "scaling_observations_live", ["gpu"], unique=False)
    op.create_index("idx_live_scaling_bench", "scaling_observations_live", ["bench"], unique=False)
    op.create_index(
        "idx_live_scaling_gpu_bench", "scaling_observations_live", ["gpu", "bench"], unique=False
    )

    app_user = os.getenv("POSTGRES_USER")
    if app_user:
        op.execute(
            sa.text(
                f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scaling_observations_live '
                f'TO "{app_user}"'
            )
        )
        op.execute(
            sa.text(
                f'GRANT USAGE, SELECT ON SEQUENCE scaling_observations_live__id_seq '
                f'TO "{app_user}"'
            )
        )


def downgrade() -> None:
    op.drop_index("idx_live_scaling_gpu_bench", table_name="scaling_observations_live")
    op.drop_index("idx_live_scaling_bench", table_name="scaling_observations_live")
    op.drop_index("idx_live_scaling_gpu", table_name="scaling_observations_live")
    op.drop_table("scaling_observations_live")
