"""Add metadata column to push_keys

Revision ID: d4e5f6a7b8c9
Revises: a1b2c3d4e5f6
Create Date: 2026-07-28 15:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'push_keys',
        sa.Column('metadata', sa.JSON(), nullable=True),
    )
    op.execute("UPDATE push_keys SET metadata = '{}' WHERE metadata IS NULL")
    op.alter_column('push_keys', 'metadata', nullable=False)


def downgrade() -> None:
    op.drop_column('push_keys', 'metadata')
