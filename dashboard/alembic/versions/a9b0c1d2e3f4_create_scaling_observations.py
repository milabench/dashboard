"""Create scaling_observations table

Revision ID: a9b0c1d2e3f4
Revises: e8f9a0b1c2d3
Create Date: 2026-08-04 23:30:00.000000

"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a9b0c1d2e3f4"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "scaling_observations" in inspector.get_table_names():
        return

    op.create_table(
        "scaling_observations",
        sa.Column("_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("gpu", sa.String(length=128), nullable=False),
        sa.Column("bench", sa.String(length=256), nullable=False),
        sa.Column("batch_size", sa.Integer(), nullable=False),
        sa.Column("cpu", sa.Integer(), nullable=True),
        sa.Column("memory_mib", sa.Float(), nullable=True),
        sa.Column("torchmem_mib", sa.Float(), nullable=True),
        sa.Column("jaxmem_mib", sa.Float(), nullable=True),
        sa.Column("perf", sa.Float(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("torch", sa.String(length=128), nullable=True),
        sa.Column("backend", sa.String(length=32), nullable=True),
        sa.Column("backend_version", sa.String(length=64), nullable=True),
        sa.Column("revision", sa.String(length=128), nullable=True),
        sa.Column("source_file", sa.String(length=256), nullable=True),
        sa.PrimaryKeyConstraint("_id"),
    )
    op.create_index("idx_scaling_gpu", "scaling_observations", ["gpu"], unique=False)
    op.create_index("idx_scaling_bench", "scaling_observations", ["bench"], unique=False)
    op.create_index(
        "idx_scaling_gpu_bench", "scaling_observations", ["gpu", "bench"], unique=False
    )

    app_user = os.getenv("POSTGRES_USER")
    if app_user:
        op.execute(
            sa.text(
                f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scaling_observations '
                f'TO "{app_user}"'
            )
        )
        op.execute(
            sa.text(
                f'GRANT USAGE, SELECT ON SEQUENCE scaling_observations__id_seq '
                f'TO "{app_user}"'
            )
        )


def downgrade() -> None:
    op.drop_index("idx_scaling_gpu_bench", table_name="scaling_observations")
    op.drop_index("idx_scaling_bench", table_name="scaling_observations")
    op.drop_index("idx_scaling_gpu", table_name="scaling_observations")
    op.drop_table("scaling_observations")
