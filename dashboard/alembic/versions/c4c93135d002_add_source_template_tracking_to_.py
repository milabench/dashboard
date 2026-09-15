"""Add source_template tracking to scheduled_jobs

Revision ID: c4c93135d002
Revises: d3e4f5a6b7c8
Create Date: 2026-09-10 09:45:34.308943

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4c93135d002'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'scheduled_jobs',
        sa.Column('source_template', sa.String(length=256), nullable=True),
    )
    op.add_column(
        'scheduled_jobs',
        sa.Column('source_template_hash', sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('scheduled_jobs', 'source_template_hash')
    op.drop_column('scheduled_jobs', 'source_template')
