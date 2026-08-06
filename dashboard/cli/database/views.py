"""Manage PostgreSQL materialized views.

Includes ``gpu_summary_mv`` — the “Latest GPU runs” table on the Supported
GPUs page.

Ownership
---------
Materialized views are owned by the **app role** (``milabench_write`` by
default) so ``REFRESH`` works from the dashboard / push path. Create,
recreate, drop, and ``own`` use **admin** credentials
(``POSTGRES_ADMIN_*``); refresh and status use the app role.

Examples::

    # one-shot: transfer ownership of existing views to milabench_write
    dashboard db views own

    # then refresh as the app role
    dashboard db views refresh
    dashboard db views refresh gpu_summary_mv

    # recreate (admin) + set owner to milabench_write
    dashboard db views recreate gpu_summary_mv

    dashboard db views status
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

from argklass.command import Command, newparser
from sqlalchemy import text

from dashboard.server.materialized_views import (
    GPU_SUMMARY_VIEW,
    VIEWS,
    _view_exists,
    _view_schema_ok,
)

# App role that must own matviews so REFRESH works without admin.
DEFAULT_VIEW_OWNER = "milabench_write"
READ_ROLES = ("milabench_write", "milabench_read", "milabench_migration")

# Actions that need to create/drop/ALTER OWNER (admin).
_ADMIN_ACTIONS = frozenset({"create", "recreate", "drop", "own"})


class Views(Command):
    """Create, refresh, own, or inspect materialized views (Latest GPU runs)."""

    name: str = "views"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Views)
        parser.add_argument(
            "action",
            choices=["create", "recreate", "refresh", "drop", "status", "own"],
            help=(
                "Action to perform. "
                "own/create/recreate/drop use POSTGRES_ADMIN_*; "
                "refresh/status use POSTGRES_USER (milabench_write)"
            ),
        )
        parser.add_argument(
            "views",
            nargs="*",
            default=None,
            help=(
                "View names to target (default: all). "
                f"Latest GPU runs view: {GPU_SUMMARY_VIEW}"
            ),
        )
        parser.add_argument(
            "--owner",
            default=None,
            help=(
                f"Role that should own the views (default: "
                f"$POSTGRES_USER or {DEFAULT_VIEW_OWNER})"
            ),
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to data directory containing .secrets (default: repo data/)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import (
            admin_database_uri,
            database_uri,
            load_db_secrets,
        )

        load_db_secrets(root=args.secrets)
        owner = args.owner or os.getenv("POSTGRES_USER") or DEFAULT_VIEW_OWNER
        views = args.views or None

        try:
            if args.action in _ADMIN_ACTIONS:
                uri = admin_database_uri()
            else:
                uri = database_uri()
        except ValueError as err:
            print(f"[matview] {err}")
            return 1

        _print_connection(uri)

        engine = create_engine(
            uri.render_as_string(hide_password=False)
            if hasattr(uri, "render_as_string")
            else uri
        )

        with Session(engine) as sess:
            match args.action:
                case "create":
                    create_views(sess, views, owner=owner)
                case "recreate":
                    create_views(sess, views, force=True, owner=owner)
                case "refresh":
                    refresh_views(sess, views)
                case "drop":
                    drop_views(sess, views)
                case "status":
                    status_views(sess, views)
                case "own":
                    own_views(sess, views, owner=owner)

        return 0


def _print_connection(uri) -> None:
    if hasattr(uri, "host"):
        print(f"[matview] Connecting to {uri.host} as {uri.username}/{uri.database}")
        return
    p = urlparse(str(uri))
    print(
        f"[matview] Connecting to {p.hostname} as "
        f"{p.username}/{p.path.lstrip('/')}"
    )


def _quote_ident(name: str) -> str:
    """Quote a PostgreSQL identifier (role / relation)."""
    return '"' + name.replace('"', '""') + '"'


def ensure_view_grants(sess, name: str, owner: str = DEFAULT_VIEW_OWNER) -> None:
    """Set owner + SELECT grants so the app role can refresh and readers can SELECT."""
    owner_q = _quote_ident(owner)
    name_q = _quote_ident(name)
    sess.execute(text(f"ALTER MATERIALIZED VIEW {name_q} OWNER TO {owner_q}"))
    readers = ", ".join(_quote_ident(r) for r in READ_ROLES)
    sess.execute(text(f"GRANT SELECT ON {name_q} TO {readers}"))
    sess.commit()
    print(f"[matview] {name}: owner={owner}, SELECT granted to {', '.join(READ_ROLES)}")


def own_views(sess, names=None, owner: str = DEFAULT_VIEW_OWNER) -> None:
    """Transfer ownership of existing matviews to the app role."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        if name not in VIEWS:
            print(f"[matview] Unknown view: {name}")
            continue
        if not _view_exists(sess, name):
            print(f"[matview] {name} does not exist, skipping")
            continue
        ensure_view_grants(sess, name, owner=owner)


def create_views(sess, names=None, force=False, owner: str = DEFAULT_VIEW_OWNER):
    """Create materialized views. If force=True, drop and recreate.

    After create, ownership is transferred to ``owner`` (app role).
    """
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
                ensure_view_grants(sess, name, owner=owner)
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
        ensure_view_grants(sess, name, owner=owner)


def refresh_views(sess, names=None):
    """Refresh materialized views concurrently (must be run as the view owner)."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        if name not in VIEWS:
            print(f"[matview] Unknown view: {name}")
            continue

        if not _view_exists(sess, name):
            print(f"[matview] {name} does not exist, skipping refresh")
            continue

        try:
            sess.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name}"))
            sess.commit()
            print(f"[matview] Refreshed {name}")
        except Exception as err:
            sess.rollback()
            print(f"[matview] Refresh failed for {name}: {err}")
            print(
                "[matview] Hint: run `dashboard db views own` with admin "
                f"credentials so {DEFAULT_VIEW_OWNER} owns the view."
            )
            raise


def drop_views(sess, names=None):
    """Drop materialized views."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        sess.execute(text(f"DROP MATERIALIZED VIEW IF EXISTS {name}"))
        sess.commit()
        print(f"[matview] Dropped {name}")


def status_views(sess, names=None):
    """Print status of materialized views (incl. owner)."""
    targets = names or list(VIEWS.keys())
    for name in targets:
        exists = _view_exists(sess, name)
        if not exists:
            print(f"  {name}: NOT CREATED")
            continue
        row_count = sess.execute(text(f"SELECT count(*) FROM {name}")).scalar()
        owner = sess.execute(
            text(
                "SELECT pg_catalog.pg_get_userbyid(c.relowner) "
                "FROM pg_catalog.pg_class c "
                "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
                "WHERE c.relkind = 'm' AND n.nspname = 'public' AND c.relname = :name"
            ),
            {"name": name},
        ).scalar()
        print(f"  {name}: {row_count} rows, owner={owner}")


COMMANDS = Views
