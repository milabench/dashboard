"""Add feature_flags table

Revision ID: 34c5ac652f11
Revises: c3a962cbcadd
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "34c5ac652f11"
down_revision: Union[str, None] = "c3a962cbcadd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if "feature_flags" not in inspector.get_table_names():
        op.create_table(
            "feature_flags",
            sa.Column("_id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("description", sa.String(length=512), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("_id"),
            sa.UniqueConstraint("name", name="uq_feature_flag_name"),
        )
        op.create_index("idx_feature_flag_name", "feature_flags", ["name"], unique=False)

    app_user = os.getenv("POSTGRES_USER")
    if app_user:
        op.execute(
            sa.text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feature_flags TO "{app_user}"')
        )
        op.execute(
            sa.text(f'GRANT USAGE, SELECT ON SEQUENCE feature_flags__id_seq TO "{app_user}"')
        )


def downgrade() -> None:
    op.drop_index("idx_feature_flag_name", table_name="feature_flags")
    op.drop_table("feature_flags")
