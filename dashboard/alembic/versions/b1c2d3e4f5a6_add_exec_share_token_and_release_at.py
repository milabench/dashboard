"""Add exec share_token and release_at

Revision ID: b1c2d3e4f5a6
Revises: a9b0c1d2e3f4
Create Date: 2026-08-08 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("execs", sa.Column("share_token", sa.String(length=64), nullable=True))
    op.add_column("execs", sa.Column("release_at", sa.DateTime(), nullable=True))
    op.create_index("exec_share_token", "execs", ["share_token"], unique=True)


def downgrade() -> None:
    op.drop_index("exec_share_token", table_name="execs")
    op.drop_column("execs", "release_at")
    op.drop_column("execs", "share_token")
