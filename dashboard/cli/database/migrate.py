"""Run Alembic migrations against PostgreSQL.

Uses **admin** credentials for DDL (not the app role)::

    POSTGRES_ADMIN_USER       (default: pgadmin)
    POSTGRES_ADMIN_PASSWORD   (required — from env or data/.secrets)

Application credentials (for reference / grants targeting the app role)::

    POSTGRES_USER             (default: milabench_write / username)
    DB_APP_PASSWORD           (canonical app password secret name)
    POSTGRES_PSWD             (runtime alias; filled from DB_APP_PASSWORD)

Shared connection settings::

    POSTGRES_HOST / PORT / DB / SSLMODE
    or DATABASE_URI (app only — migrations always build an admin URL)

Secrets under ``data/.secrets`` are loaded automatically when unset.

Examples::

    # upgrade to latest revision (prod/dev)
    dashboard db migrate upgrade

    # inspect current revision
    dashboard db migrate check

    # stamp without running (existing DBs)
    dashboard db migrate stamp
    dashboard db migrate stamp head

    # re-apply table grants / ownership
    dashboard db migrate grant-all
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from argklass.arguments import argument, choice
from argklass.command import Command


TABLES = [
    "execs",
    "packs",
    "metrics",
    "weights",
    "saved_queries",
    "push_keys",
    "report_cache",
    "gpus",
    "scaling_observations",
]
# App role must own matviews so REFRESH works from the dashboard (not just admin).
MATERIALIZED_VIEWS = [
    "gpu_summary_mv",
]
READ_ROLES = ["milabench_write", "milabench_read", "milabench_migration"]
WRITE_ROLES = ["milabench_write", "milabench_migration"]
OWNER_ROLE = "milabench_migration"
VIEW_OWNER_ROLE = "milabench_write"


class Migrate(Command):
    """Run Alembic migrations and related admin DB tasks."""

    name = "migrate"

    # fmt: off
    @dataclass
    class Arguments:
        """Run Alembic migrations and related admin DB tasks."""
        action : str           = choice("upgrade", "check", "stamp", "grant", "grant-all")  # Migration action
        rest   : list[str]     = argument(nargs="*")  # Extra: revision for stamp, or <table> [app_user] for grant
        secrets: Optional[str] = None  # Path to data directory containing .secrets (default: repo data/)
    # fmt: on

    @staticmethod
    def execute(args):
        from dashboard.server.utils import load_db_secrets

        load_db_secrets(root=args.secrets)
        rest = args.rest or []

        match args.action:
            case "upgrade":
                return _upgrade()
            case "check":
                return _check()
            case "stamp":
                rev = rest[0] if rest else "head"
                return _stamp(rev)
            case "grant":
                if not rest:
                    print("Usage: dashboard db migrate grant <table> [app_user]")
                    return 1
                table = rest[0]
                user = rest[1] if len(rest) > 1 else None
                return _grant(table, user)
            case "grant-all":
                return _grant_all()


def _alembic_config(db_url):
    from alembic.config import Config

    import dashboard.server as dashboard_server

    pkg_root = Path(dashboard_server.__file__).resolve().parent.parent
    cfg = Config(str(pkg_root / "alembic.ini"))
    # ConfigParser treats % as interpolation; Alembic requires %% escaping.
    url_str = db_url.render_as_string(hide_password=False).replace("%", "%%")
    cfg.set_main_option("sqlalchemy.url", url_str)
    return cfg


def _admin_url():
    from dashboard.server.utils import admin_database_uri

    return admin_database_uri()


def _upgrade():
    from alembic import command

    db_url = _admin_url()
    cfg = _alembic_config(db_url)
    print(f"[migrate] Upgrading {db_url.host} as {db_url.username}...")
    command.upgrade(cfg, "head")
    print("[migrate] Done.")
    return 0


def _check():
    from alembic import command

    db_url = _admin_url()
    cfg = _alembic_config(db_url)
    print(f"[migrate] Database: {db_url.host} as {db_url.username}")
    print()
    print("=== Current revision ===")
    command.current(cfg, verbose=True)
    print()
    print("=== Migration history ===")
    command.history(cfg)
    print()
    print("=== Heads ===")
    command.heads(cfg, verbose=True)
    return 0


def _stamp(revision="head"):
    from alembic import command

    db_url = _admin_url()
    cfg = _alembic_config(db_url)
    print(f"[migrate] Stamping {db_url.host} at revision '{revision}'...")
    command.stamp(cfg, revision)
    print("[migrate] Stamped.")
    return 0


def _grant(table, app_user=None):
    from sqlalchemy import create_engine, text

    app_user = app_user or "milabench_write"
    db_url = _admin_url()
    engine = create_engine(db_url.render_as_string(hide_password=False))
    with engine.connect() as conn:
        conn.execute(
            text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO "{app_user}"')
        )
        conn.execute(
            text(f'GRANT USAGE, SELECT ON SEQUENCE {table}__id_seq TO "{app_user}"')
        )
        conn.commit()
    print(f"[migrate] Granted permissions on {table} to {app_user}")
    return 0


def _grant_all():
    """Re-apply permissions matching deploy/terraform/init-db.tf."""
    from sqlalchemy import create_engine, text

    db_url = _admin_url()
    engine = create_engine(db_url.render_as_string(hide_password=False))

    readers = ", ".join(READ_ROLES)
    writers = ", ".join(WRITE_ROLES)
    tables = ", ".join(TABLES)

    statements = [
        f"GRANT USAGE ON SCHEMA public TO {readers}",
        f"GRANT SELECT ON {tables} TO {readers}",
        f"GRANT INSERT, UPDATE, DELETE ON {tables} TO {writers}",
        f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {writers}",
        f"GRANT CREATE ON SCHEMA public TO {OWNER_ROLE}",
    ] + [f"ALTER TABLE {t} OWNER TO {OWNER_ROLE}" for t in TABLES]

    with engine.connect() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
            print(f"[grant-all] {stmt}")

        # Matviews: app role owns them so REFRESH works on push / CLI refresh.
        for mv in MATERIALIZED_VIEWS:
            exists = conn.execute(
                text("SELECT 1 FROM pg_matviews WHERE matviewname = :name"),
                {"name": mv},
            ).scalar()
            if not exists:
                print(f"[grant-all] {mv}: not present, skip ownership")
                continue
            for stmt in (
                f"ALTER MATERIALIZED VIEW {mv} OWNER TO {VIEW_OWNER_ROLE}",
                f"GRANT SELECT ON {mv} TO {readers}",
            ):
                conn.execute(text(stmt))
                print(f"[grant-all] {stmt}")

        conn.commit()

    print(f"[grant-all] Done - permissions applied to {tables}")
    return 0


COMMANDS = Migrate
