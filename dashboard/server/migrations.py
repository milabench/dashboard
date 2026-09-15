"""Alembic migration helpers (CLI and dev auto-migrate on startup)."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from dashboard.server.utils import admin_database_uri, database_uri, load_db_secrets

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _database_host() -> str | None:
    uri_override = os.getenv("DATABASE_URI")
    if uri_override:
        host = urlparse(uri_override).hostname
        if host:
            return host
    return os.getenv("POSTGRES_HOST", "localhost")


def is_local_dev_database() -> bool:
    """True when the configured database is a local Postgres instance."""
    return _database_host() in _LOCAL_HOSTS


def should_auto_migrate() -> bool:
    """Whether to run Alembic upgrade on dashboard startup."""
    flag = os.environ.get("AUTO_MIGRATE", "").strip().lower()
    if flag in ("0", "false", "no"):
        return False
    if flag in ("1", "true", "yes"):
        return True

    dev_mode = os.environ.get("DEV_MODE", "true").lower() not in ("0", "false", "no")
    return dev_mode and is_local_dev_database()


def migration_database_url():
    """Pick credentials for Alembic.

    Local dev uses the app role (``milabench_write``); remote uses admin when
    ``POSTGRES_ADMIN_PASSWORD`` is configured.
    """
    if is_local_dev_database():
        return database_uri()
    try:
        return admin_database_uri()
    except ValueError:
        return database_uri()


def alembic_config(database_url):
    """Build an Alembic Config pointing at dashboard/alembic.ini."""
    from alembic.config import Config

    pkg_root = Path(__file__).resolve().parents[1]
    cfg = Config(str(pkg_root / "alembic.ini"))
    url_str = (
        database_url.render_as_string(hide_password=False)
        if hasattr(database_url, "render_as_string")
        else str(database_url)
    )
    # ConfigParser treats % as interpolation; Alembic requires %% escaping.
    cfg.set_main_option("sqlalchemy.url", url_str.replace("%", "%%"))
    return cfg


def run_migrations(database_url=None) -> None:
    """Run Alembic upgrade to head."""
    from alembic import command

    db_url = database_url or migration_database_url()
    command.upgrade(alembic_config(db_url), "head")


def auto_migrate_if_dev() -> None:
    """Run migrations on startup when local dev is detected."""
    if not should_auto_migrate():
        return

    load_db_secrets()
    try:
        db_url = migration_database_url()
        host = _database_host() or "?"
        user = getattr(db_url, "username", None) or "?"
        print(f"[migrations] Auto-migrating {host} as {user}...")
        run_migrations(db_url)
        print("[migrations] Database is up to date.")
    except Exception as err:
        print(f"[migrations] Warning: auto-migration failed: {err}")
