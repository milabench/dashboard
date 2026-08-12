"""Manage PostgreSQL indexes for milabench tables.

The database URL is resolved the same way as for views
(see ``dashboard db views --help`` for details).

Examples::

    # Show which indexes exist and which are missing
    dashboard db indexes status

    # Create all missing indexes
    dashboard db indexes create

    # Drop all managed indexes
    dashboard db indexes drop
"""

from argklass.command import Command, newparser
from sqlalchemy import text


INDEXES = {
    "packs": [
        ("exec_pack_query", "CREATE INDEX IF NOT EXISTS exec_pack_query ON packs (exec_id)"),
        ("pack_query", "CREATE INDEX IF NOT EXISTS pack_query ON packs (name, exec_id)"),
        ("pack_tag", "CREATE INDEX IF NOT EXISTS pack_tag ON packs (tag)"),
        ("idx_pack_name", "CREATE INDEX IF NOT EXISTS idx_pack_name ON packs (name)"),
        ("idx_pack_status", "CREATE INDEX IF NOT EXISTS idx_pack_status ON packs (status)"),
        ("idx_pack_exec_status", "CREATE INDEX IF NOT EXISTS idx_pack_exec_status ON packs (exec_id, status)"),
        ("idx_pack_exec_name_status", "CREATE INDEX IF NOT EXISTS idx_pack_exec_name_status ON packs (exec_id, name, status)"),
    ],
    "metrics": [
        ("metric_query", "CREATE INDEX IF NOT EXISTS metric_query ON metrics (exec_id, pack_id)"),
        ("metric_name", "CREATE INDEX IF NOT EXISTS metric_name ON metrics (name)"),
        ("idx_metric_name_value", "CREATE INDEX IF NOT EXISTS idx_metric_name_value ON metrics (name, value)"),
        ("idx_metric_exec_pack_name", "CREATE INDEX IF NOT EXISTS idx_metric_exec_pack_name ON metrics (exec_id, pack_id, name)"),
        ("idx_metric_pack_name", "CREATE INDEX IF NOT EXISTS idx_metric_pack_name ON metrics (pack_id, name)"),
        ("idx_metric_exec_name", "CREATE INDEX IF NOT EXISTS idx_metric_exec_name ON metrics (exec_id, name)"),
    ],
    "execs": [
        ("exec_name", "CREATE INDEX IF NOT EXISTS exec_name ON execs (name)"),
        ("exec_visibility", "CREATE INDEX IF NOT EXISTS exec_visibility ON execs (visibility)"),
        ("exec_share_token", "CREATE UNIQUE INDEX IF NOT EXISTS exec_share_token ON execs (share_token)"),
        ("execs_meta_gpus_0_product_idx", "CREATE INDEX IF NOT EXISTS execs_meta_gpus_0_product_idx ON execs ((meta -> 'accelerators' -> 'gpus' -> '0' ->> 'product'))"),
    ],
    "weights": [
        ("weight_profile_pack", "CREATE INDEX IF NOT EXISTS weight_profile_pack ON weights (profile, pack)"),
        ("idx_weight_profile_enabled", "CREATE INDEX IF NOT EXISTS idx_weight_profile_enabled ON weights (profile, enabled)"),
        ("idx_weight_pack", "CREATE INDEX IF NOT EXISTS idx_weight_pack ON weights (pack)"),
        ("idx_weight_profile_priority", "CREATE INDEX IF NOT EXISTS idx_weight_profile_priority ON weights (profile, priority)"),
    ],
}


def _existing_indexes(sess):
    """Return a set of all index names in the database."""
    result = sess.execute(text(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    ))
    return {row[0] for row in result}


def create_indexes(sess):
    """Create all missing indexes."""
    import time

    existing = _existing_indexes(sess)
    created = 0
    for table, indexes in INDEXES.items():
        for name, sql in indexes:
            if name in existing:
                print(f"  [index] {name} on {table}: already exists")
                continue
            print(f"  [index] Creating {name} on {table}...", end=" ", flush=True)
            start = time.monotonic()
            sess.execute(text(sql))
            sess.commit()
            elapsed = time.monotonic() - start
            print(f"done ({elapsed:.1f}s)")
            created += 1
    if created == 0:
        print("  [index] All indexes already exist.")
    else:
        print(f"  [index] Created {created} index(es).")


def drop_indexes(sess):
    """Drop all managed indexes."""
    existing = _existing_indexes(sess)
    dropped = 0
    for table, indexes in INDEXES.items():
        for name, _ in indexes:
            if name not in existing:
                continue
            print(f"  [index] Dropping {name}...")
            sess.execute(text(f"DROP INDEX IF EXISTS {name}"))
            sess.commit()
            dropped += 1
    if dropped == 0:
        print("  [index] No managed indexes to drop.")
    else:
        print(f"  [index] Dropped {dropped} index(es).")


def status_indexes(sess):
    """Show status of all managed indexes."""
    existing = _existing_indexes(sess)
    for table, indexes in INDEXES.items():
        print(f"  {table}:")
        for name, _ in indexes:
            status = "OK" if name in existing else "MISSING"
            print(f"    {name}: {status}")


class Indexes(Command):
    """Create, drop, or inspect table indexes."""

    name: str = "indexes"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Indexes)
        parser.add_argument(
            "action",
            choices=["create", "drop", "status"],
            help="Action to perform on indexes",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri

        engine = create_engine(database_uri())

        with Session(engine) as sess:
            match args.action:
                case "create":
                    create_indexes(sess)
                case "drop":
                    drop_indexes(sess)
                case "status":
                    status_indexes(sess)


COMMANDS = Indexes
