"""Manage PostgreSQL materialized views.

The database URL is resolved from environment variables::

    POSTGRES_HOST     (default: localhost)
    POSTGRES_PORT     (default: 5432)
    POSTGRES_USER     (default: username)
    POSTGRES_PSWD     (default: password)
    POSTGRES_DB       (default: milabench)
    POSTGRES_SSLMODE  (default: "")

Or override everything with a single ``DATABASE_URI`` variable::

    DATABASE_URI=postgresql://user:pass@host:5432/milabench

Examples::

    # local dev - uses POSTGRES_* env defaults
    dashboard db views status
    dashboard db views create
    dashboard db views refresh

    # target a specific view
    dashboard db views recreate gpu_summary_mv

    # point at a remote database
    POSTGRES_HOST=remote.example.com POSTGRES_PSWD=secret \\
        dashboard db views refresh
"""

from argklass.command import Command, newparser
from sqlalchemy import text

from dashboard.server.materialized_views import (
    VIEWS,
    _view_exists,
    _view_schema_ok,
)


class Views(Command):
    """Create, refresh, drop, or inspect materialized views."""

    name: str = "views"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Views)
        parser.add_argument(
            "action",
            choices=["create", "recreate", "refresh", "drop", "status"],
            help="Action to perform on materialized views",
        )
        parser.add_argument(
            "views",
            nargs="*",
            default=None,
            help="View names to target (all views if omitted)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri

        views = args.views or None
        engine = create_engine(database_uri())

        with Session(engine) as sess:
            match args.action:
                case "create":
                    create_views(sess, views)
                case "recreate":
                    create_views(sess, views, force=True)
                case "refresh":
                    refresh_views(sess, views)
                case "drop":
                    drop_views(sess, views)
                case "status":
                    status_views(sess, views)


def create_views(sess, names=None, force=False):
    """Create materialized views. If force=True, drop and recreate."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        defn = VIEWS.get(name)
        if defn is None:
            print(f"[matview] Unknown view: {name}")
            continue

        exists = _view_exists(sess, name)

        if exists and not force:
            if _view_schema_ok(sess, name, defn):
                print(f"[matview] {name} already exists with correct schema")
                continue
            print(f"[matview] {name} schema mismatch, recreating")

        if exists:
            sess.execute(text(f"DROP MATERIALIZED VIEW IF EXISTS {name}"))
            print(f"[matview] Dropped {name}")

        sess.execute(text(defn["sql"]))
        for idx_sql in defn["indexes"]:
            sess.execute(text(idx_sql))

        sess.commit()
        print(f"[matview] Created {name}")


def refresh_views(sess, names=None):
    """Refresh materialized views concurrently."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        if name not in VIEWS:
            print(f"[matview] Unknown view: {name}")
            continue

        if not _view_exists(sess, name):
            print(f"[matview] {name} does not exist, skipping refresh")
            continue

        sess.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name}"))
        sess.commit()
        print(f"[matview] Refreshed {name}")


def drop_views(sess, names=None):
    """Drop materialized views."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        sess.execute(text(f"DROP MATERIALIZED VIEW IF EXISTS {name}"))
        sess.commit()
        print(f"[matview] Dropped {name}")


def status_views(sess, names=None):
    """Print status of materialized views."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        exists = _view_exists(sess, name)
        if exists:
            row_count = sess.execute(
                text(f"SELECT count(*) FROM {name}")
            ).scalar()
            print(f"  {name}: {row_count} rows")
        else:
            print(f"  {name}: NOT CREATED")


COMMANDS = Views
