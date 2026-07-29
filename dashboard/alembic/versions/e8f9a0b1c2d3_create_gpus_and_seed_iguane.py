"""Create gpus table and seed IGUANE GPU specs

Revision ID: e8f9a0b1c2d3
Revises: d4e5f6a7b8c9
Create Date: 2026-07-28 22:30:00.000000

"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.orm import Session


revision: str = 'e8f9a0b1c2d3'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_gpus_table() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "gpus" in inspector.get_table_names():
        return

    op.create_table(
        "gpus",
        sa.Column("_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("vendor", sa.String(length=64), nullable=False),
        sa.Column("architecture", sa.String(length=128), nullable=True),
        sa.Column("release_date", sa.String(length=16), nullable=True),
        sa.Column("specs", sa.JSON(), nullable=False),
        sa.Column("int4", sa.Float(), nullable=True),
        sa.Column("int8", sa.Float(), nullable=True),
        sa.Column("fp4", sa.Float(), nullable=True),
        sa.Column("fp8", sa.Float(), nullable=True),
        sa.Column("fp16", sa.Float(), nullable=True),
        sa.Column("fp32", sa.Float(), nullable=True),
        sa.Column("fp64", sa.Float(), nullable=True),
        sa.Column("tf32", sa.Float(), nullable=True),
        sa.Column("memgb", sa.Float(), nullable=True),
        sa.Column("membw", sa.Float(), nullable=True),
        sa.Column("tdp", sa.Float(), nullable=True),
        sa.Column("created_time", sa.DateTime(), nullable=True),
        sa.Column("modified_time", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("_id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("idx_gpu_name", "gpus", ["name"], unique=False)
    op.create_index("idx_gpu_vendor", "gpus", ["vendor"], unique=False)
    op.create_index("idx_gpu_architecture", "gpus", ["architecture"], unique=False)

    app_user = os.getenv("POSTGRES_USER")
    if app_user:
        op.execute(
            sa.text(
                f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gpus TO "{app_user}"'
            )
        )
        op.execute(
            sa.text(
                f'GRANT USAGE, SELECT ON SEQUENCE gpus__id_seq TO "{app_user}"'
            )
        )


def upgrade() -> None:
    _ensure_gpus_table()

    from dashboard.server.database.gpu import seed_gpus

    bind = op.get_bind()
    with Session(bind=bind) as session:
        count = seed_gpus(session, commit=False)
        print(f"[migrations] Seeded {count} GPU(s) from IGUANE")


def downgrade() -> None:
    """Remove IGUANE-seeded GPU rows. Leaves the gpus table in place."""
    from dashboard.server.database.gpu import GPU, _load_iguane_rawdata

    names = list(_load_iguane_rawdata().keys())
    if not names:
        return

    bind = op.get_bind()
    with Session(bind=bind) as session:
        session.query(GPU).filter(GPU.name.in_(names)).delete(synchronize_session=False)
