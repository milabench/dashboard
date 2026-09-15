"""Add run_groups and run_group_members tables

Revision ID: d3e4f5a6b7c8
Revises: b1c2d3e4f5a6
Create Date: 2026-08-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "run_groups",
        sa.Column("_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("strategy", sa.String(64), nullable=False),
        sa.Column("granularity", sa.String(64), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=True),
        sa.Column("label", sa.String(512), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("strategy", "fingerprint", name="uq_run_group_strategy_fingerprint"),
    )
    op.create_index("idx_run_group_strategy", "run_groups", ["strategy"])
    op.create_index("idx_run_group_fingerprint", "run_groups", ["fingerprint"])

    op.create_table(
        "run_group_members",
        sa.Column("exec_id", sa.Integer(), sa.ForeignKey("execs._id"), nullable=False, primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("run_groups._id"), nullable=False, primary_key=True),
        sa.Column("assigned_at", sa.DateTime(), nullable=True),
    )
    op.create_index("idx_rgm_group_exec", "run_group_members", ["group_id", "exec_id"])
    op.create_index("idx_rgm_exec_group", "run_group_members", ["exec_id", "group_id"])


def downgrade() -> None:
    op.drop_index("idx_rgm_exec_group", table_name="run_group_members")
    op.drop_index("idx_rgm_group_exec", table_name="run_group_members")
    op.drop_table("run_group_members")

    op.drop_index("idx_run_group_fingerprint", table_name="run_groups")
    op.drop_index("idx_run_group_strategy", table_name="run_groups")
    op.drop_table("run_groups")
