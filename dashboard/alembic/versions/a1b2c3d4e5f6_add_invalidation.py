"""Add Exec/Pack.invalidated columns and invalidation_rules table

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    exec_columns = {c["name"] for c in inspector.get_columns("execs")}
    if "invalidated" not in exec_columns:
        op.add_column(
            "execs",
            sa.Column("invalidated", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("exec_invalidated", "execs", ["invalidated"], unique=False)

    pack_columns = {c["name"] for c in inspector.get_columns("packs")}
    if "invalidated" not in pack_columns:
        op.add_column(
            "packs",
            sa.Column("invalidated", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("idx_pack_invalidated", "packs", ["invalidated"], unique=False)

    if "invalidation_rules" not in inspector.get_table_names():
        op.create_table(
            "invalidation_rules",
            sa.Column("_id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("exec_id", sa.Integer(), nullable=True),
            sa.Column("bench_name", sa.String(length=256), nullable=True),
            sa.Column("before", sa.DateTime(), nullable=True),
            sa.Column("after", sa.DateTime(), nullable=True),
            sa.Column("reason", sa.String(length=1024), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("_id"),
            sa.ForeignKeyConstraint(["exec_id"], ["execs._id"]),
        )
        op.create_index("idx_invalidation_rule_exec", "invalidation_rules", ["exec_id"], unique=False)
        op.create_index("idx_invalidation_rule_bench", "invalidation_rules", ["bench_name"], unique=False)

    app_user = os.getenv("POSTGRES_USER")
    if app_user:
        op.execute(
            sa.text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE invalidation_rules TO "{app_user}"')
        )
        op.execute(
            sa.text(
                f'GRANT USAGE, SELECT ON SEQUENCE invalidation_rules__id_seq TO "{app_user}"'
            )
        )


def downgrade() -> None:
    op.drop_index("idx_invalidation_rule_bench", table_name="invalidation_rules")
    op.drop_index("idx_invalidation_rule_exec", table_name="invalidation_rules")
    op.drop_table("invalidation_rules")
    op.drop_index("idx_pack_invalidated", table_name="packs")
    op.drop_column("packs", "invalidated")
    op.drop_index("exec_invalidated", table_name="execs")
    op.drop_column("execs", "invalidated")
