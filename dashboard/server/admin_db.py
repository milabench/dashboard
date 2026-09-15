"""Per-request DEV/PROD database targeting for the ADMIN section.

Every other part of the dashboard (PUBLIC/DEV routes) talks to the one
database the server was started against (``view_server``'s own
``database`` object, resolved once at startup via ``load_db_secrets`` +
``database_uri()``, which mutates process env vars). ADMIN actions need
to be able to point at *either* dev or prod on a per-request basis
without disturbing that startup connection — so this module reads
connection info directly from ``secrets.toml``'s ``[dev]``/``[prod]``
sections via ``TomlSecretProvider`` and builds a throwaway engine/session,
never touching ``os.environ``.
"""

from contextlib import contextmanager
from pathlib import Path

import sqlalchemy
from sqlalchemy.orm import sessionmaker

from .database.models import from_json, to_json
from .slurm.constant import JOBRUNNER_LOCAL_CACHE
from .slurm.secrets import TomlSecretProvider

TARGETS = ("dev", "prod")


def _secrets_path() -> Path:
    return Path(JOBRUNNER_LOCAL_CACHE) / "secrets.toml"


def _require_target(target: str) -> str:
    if target not in TARGETS:
        raise ValueError(f"Unknown DB target {target!r}; expected one of {TARGETS}")
    return target


def _build_uri(provider: TomlSecretProvider, *, user: str, password: str | None):
    if not password:
        raise ValueError(
            f"No password configured for user {user!r} in secrets.toml [{provider._env}]"
        )
    host = provider.get("POSTGRES_HOST") or "localhost"
    port = provider.get("POSTGRES_PORT") or "5432"
    dbname = provider.get("POSTGRES_DB") or "milabench"
    sslmode = provider.get("POSTGRES_SSLMODE") or ""

    query = {"sslmode": sslmode} if sslmode else {}
    return sqlalchemy.URL.create(
        "postgresql",
        username=user,
        password=password,
        host=host,
        port=int(port),
        database=dbname,
        query=query,
    )


def resolve_target_uri(target: str):
    """Build an app-role Postgres connection URL for ``target`` from secrets.toml.

    Raises ValueError if the target is unknown or has no app password
    configured (distinct from admin_database_uri()/database_uri(), which
    read from process env and thus always reflect the *server's own*
    target — this always re-reads secrets.toml for the requested section).
    """
    _require_target(target)
    provider = TomlSecretProvider(_secrets_path(), env=target)
    user = provider.get("POSTGRES_USER") or "milabench_write"
    password = provider.get("DB_APP_PASSWORD") or provider.get("POSTGRES_PSWD")
    return _build_uri(provider, user=user, password=password)


def resolve_target_admin_uri(target: str):
    """Build an admin-role Postgres connection URL for ``target`` (DDL, e.g.
    migrations) — same secrets.toml section, ``POSTGRES_ADMIN_*`` keys.
    """
    _require_target(target)
    provider = TomlSecretProvider(_secrets_path(), env=target)
    user = provider.get("POSTGRES_ADMIN_USER") or "pgadmin"
    password = provider.get("POSTGRES_ADMIN_PASSWORD")
    return _build_uri(provider, user=user, password=password)


def target_available(target: str) -> bool:
    try:
        resolve_target_uri(target)
        return True
    except ValueError:
        return False


@contextmanager
def admin_session(target: str):
    """A short-lived Session against ``target`` ('dev' or 'prod').

    Creates and disposes its own engine per call — admin actions are
    infrequent/human-driven, so this favors correctness (always reflects
    the current secrets.toml, never a stale cached connection) over the
    cost of a fresh connection.
    """
    engine = sqlalchemy.create_engine(
        resolve_target_uri(target),
        echo=False,
        future=True,
        json_serializer=to_json,
        json_deserializer=from_json,
        pool_pre_ping=True,
    )
    try:
        with sessionmaker(bind=engine)() as sess:
            yield sess
    finally:
        engine.dispose()
