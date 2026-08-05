"""Postgres dump/restore and Azure Blob backup helpers.

Credentials (via env or ``data/.secrets``)::

    # dump target (preference order)
    POSTGRES_BACKUP_USER / POSTGRES_BACKUP_PASSWORD
    POSTGRES_ADMIN_USER  / POSTGRES_ADMIN_PASSWORD
    POSTGRES_USER        / DB_APP_PASSWORD (POSTGRES_PSWD)

    # restore defaults to admin (needed for --clean DROP)
    # use --app to restore as the application role instead

    # Azure Blob (download / list --remote / upload / prune)
    BACKUP_STORAGE_ACCOUNT   (default: stbackupmilabenchdev)
    container db-backups     (override with --container)

Requires ``pg_dump`` / ``pg_restore`` locally; Azure ops need ``az`` + ``az login``.

Examples::

    # dump configured DB into backups/
    dashboard db backup dump

    # restore latest local dump (admin, --clean)
    dashboard db backup restore

    # restore a specific dump into local app DB
    POSTGRES_HOST=localhost POSTGRES_SSLMODE= \\
        dashboard db backup restore backups/foo.dump --app

    # Azure blob backups
    dashboard db backup list --remote
    dashboard db backup download
    dashboard db backup upload backups/foo.dump
    dashboard db backup prune --retain 4
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from argklass.arguments import argument, choice
from argklass.command import Command

DEFAULT_STORAGE_ACCOUNT = "stbackupmilabenchdev"
DEFAULT_CONTAINER = "db-backups"
DEFAULT_RETAIN = 4


class Backup(Command):
    """Dump, restore, and manage Azure/local database backups."""

    name = "backup"

    # fmt: off
    @dataclass
    class Arguments:
        """Dump, restore, and manage Azure/local database backups."""
        action         : str           = choice("dump", "restore", "download", "list", "upload", "prune")  # Backup action
        path           : Optional[str] = argument(nargs="?")  # Local .dump path (dump output / restore input / upload source)
        secrets        : Optional[str] = None  # Path to data directory containing .secrets (default: repo data/)
        outdir         : Optional[str] = None  # Local backups directory (default: <repo>/backups)
        storage_account: Optional[str] = None  # Azure storage account (default: $BACKUP_STORAGE_ACCOUNT or stbackupmilabenchdev)
        container      : str           = DEFAULT_CONTAINER  # Azure blob container
        retain         : int           = DEFAULT_RETAIN  # Number of remote backups to keep when pruning
        remote         : bool          = False  # For list: show Azure blobs instead of local dumps
        admin          : bool          = False  # Force admin credentials (dump/restore)
        app            : bool          = False  # Force app credentials (dump/restore); restore defaults to admin
        no_clean       : bool          = False  # Restore without --clean --if-exists
        grant_to       : Optional[str] = None  # After restore, GRANT SELECT ON ALL TABLES to this role
    # fmt: on

    @staticmethod
    def execute(args):
        from dashboard.server.utils import load_db_secrets

        load_db_secrets(root=args.secrets)
        outdir = Path(args.outdir) if args.outdir else _default_backups_dir()

        match args.action:
            case "dump":
                return _dump(args, outdir)
            case "restore":
                return _restore(args, outdir)
            case "download":
                return _download(args, outdir)
            case "list":
                return _list(args, outdir)
            case "upload":
                return _upload(args, outdir)
            case "prune":
                return _prune(args)


def _default_backups_dir() -> Path:
    from dashboard.server.slurm.constant import ROOT

    return Path(ROOT) / "backups"


def _storage_account(args) -> str:
    return (
        args.storage_account
        or os.getenv("BACKUP_STORAGE_ACCOUNT")
        or DEFAULT_STORAGE_ACCOUNT
    )


def _conn_params(args, *, for_restore: bool):
    """Resolve dump/restore connection params.

    Always builds from ``POSTGRES_*`` components (never ``DATABASE_URI``),
    so an app-runtime URI override cannot redirect dump/restore.

    Restore defaults to admin (DROP privileges for --clean).
    Dump prefers backup role → admin → app.
    """
    from dashboard.server.sync import _parse_local_db
    from dashboard.server.utils import _postgres_url, admin_database_uri

    if args.app and args.admin:
        raise SystemExit("Use only one of --app / --admin")

    def app_uri():
        user = os.getenv("POSTGRES_USER", "milabench_write")
        password = (
            os.getenv("POSTGRES_PSWD")
            or os.getenv("DB_APP_PASSWORD")
            or "password"
        )
        return _postgres_url(username=user, password=password)

    def backup_uri():
        backup_user = os.getenv("POSTGRES_BACKUP_USER")
        backup_password = os.getenv("POSTGRES_BACKUP_PASSWORD")
        if backup_user and backup_password:
            return _postgres_url(username=backup_user, password=backup_password)
        try:
            return admin_database_uri()
        except ValueError:
            return app_uri()

    if args.app:
        uri = app_uri()
    elif args.admin or for_restore:
        uri = admin_database_uri()
    else:
        uri = backup_uri()

    return _parse_local_db(uri)


def _dump(args, outdir: Path):
    from dashboard.server.sync import _pg_dump

    conn = _conn_params(args, for_restore=False)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.path:
        dest = Path(args.path)
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        dest = outdir / f"milabench-backup-{stamp}.dump"

    print(f"[backup] Dumping {conn['host']}/{conn['dbname']} as {conn['user']}...")
    try:
        stdout, stderr, rc = _pg_dump(**conn)
    except FileNotFoundError:
        print("[backup] pg_dump not found — install PostgreSQL client tools")
        return 1

    if rc != 0:
        print(f"[backup] pg_dump failed:\n{stderr}")
        return rc

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(stdout)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"[backup] Wrote {dest} ({size_mb:.1f} MiB)")
    return 0


def _latest_local_dump(outdir: Path) -> Path | None:
    dumps = sorted(outdir.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    return dumps[0] if dumps else None


def _restore(args, outdir: Path):
    from dashboard.server.sync import _pg_restore

    if args.path:
        dump_path = Path(args.path)
    else:
        dump_path = _latest_local_dump(outdir)
        if dump_path is None:
            print(f"[backup] No dump found in {outdir}. Run 'dashboard db backup download' first.")
            return 1

    if not dump_path.is_file():
        print(f"[backup] Dump not found: {dump_path}")
        return 1

    conn = _conn_params(args, for_restore=True)
    clean = not args.no_clean
    print(
        f"[backup] Restoring {dump_path.name} -> "
        f"{conn['host']}/{conn['dbname']} as {conn['user']} "
        f"(clean={clean})..."
    )
    try:
        stderr, rc = _pg_restore(
            str(dump_path),
            **conn,
            clean=clean,
            grant_to=args.grant_to,
        )
    except FileNotFoundError:
        print("[backup] pg_restore not found — install PostgreSQL client tools")
        return 1

    # pg_restore often exits 1 with non-fatal warnings
    if rc != 0 and "ERROR" in stderr:
        print(f"[backup] Restore finished with errors:\n{stderr}")
        return rc
    if rc != 0:
        print(f"[backup] Restore finished with warnings:\n{stderr}")
    else:
        print("[backup] Restore complete.")
    return 0


def _require_az():
    if shutil.which("az") is None:
        print("[backup] Azure CLI (az) not found")
        return False
    return True


def _az_blob_names(account: str, container: str) -> list[str]:
    result = subprocess.run(
        [
            "az", "storage", "blob", "list",
            "--account-name", account,
            "--container-name", container,
            "--auth-mode", "login",
            "--query", "[].name",
            "--output", "tsv",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "az storage blob list failed")
    names = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return sorted(names, reverse=True)


def _download(args, outdir: Path):
    if not _require_az():
        return 1

    account = _storage_account(args)
    container = args.container
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"[backup] Listing {account}/{container}...")
    try:
        names = _az_blob_names(account, container)
    except RuntimeError as err:
        print(f"[backup] {err}")
        return 1

    if not names:
        print("[backup] No backups found in the container.")
        return 1

    latest = names[0]
    dest = outdir / latest
    if dest.is_file():
        print(f"[backup] Already have {latest}, skipping download.")
        return 0

    print(f"[backup] Downloading {latest} -> {dest}")
    result = subprocess.run(
        [
            "az", "storage", "blob", "download",
            "--account-name", account,
            "--container-name", container,
            "--name", latest,
            "--file", str(dest),
            "--auth-mode", "login",
        ],
        timeout=600,
    )
    if result.returncode != 0:
        return result.returncode

    print(f"[backup] Done. Backup saved to {dest}")
    return 0


def _list(args, outdir: Path):
    if args.remote:
        if not _require_az():
            return 1
        account = _storage_account(args)
        container = args.container
        print(f"[backup] Remote blobs in {account}/{container}:")
        try:
            names = _az_blob_names(account, container)
        except RuntimeError as err:
            print(f"[backup] {err}")
            return 1
        if not names:
            print("  (none)")
            return 0
        for name in names:
            print(f"  {name}")
        return 0

    print(f"[backup] Local dumps in {outdir}:")
    dumps = sorted(outdir.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not dumps:
        print("  (none)")
        return 0
    for path in dumps:
        size_mb = path.stat().st_size / (1024 * 1024)
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        print(f"  {path.name}  {size_mb:7.1f} MiB  {mtime:%Y-%m-%d %H:%M UTC}")
    return 0


def _upload(args, outdir: Path):
    if not _require_az():
        return 1

    if args.path:
        dump_path = Path(args.path)
    else:
        dump_path = _latest_local_dump(outdir)
        if dump_path is None:
            print(f"[backup] No dump found in {outdir}. Run 'dashboard db backup dump' first.")
            return 1

    if not dump_path.is_file():
        print(f"[backup] Dump not found: {dump_path}")
        return 1

    account = _storage_account(args)
    container = args.container
    blob_name = dump_path.name

    print(f"[backup] Uploading {dump_path} -> {account}/{container}/{blob_name}")
    result = subprocess.run(
        [
            "az", "storage", "blob", "upload",
            "--account-name", account,
            "--container-name", container,
            "--name", blob_name,
            "--file", str(dump_path),
            "--auth-mode", "login",
            "--overwrite",
        ],
        timeout=600,
    )
    if result.returncode != 0:
        return result.returncode

    print("[backup] Upload complete.")
    return 0


def _prune(args):
    if not _require_az():
        return 1

    account = _storage_account(args)
    container = args.container
    retain = args.retain

    print(f"[backup] Pruning {account}/{container} (keep {retain})...")
    try:
        names = _az_blob_names(account, container)
    except RuntimeError as err:
        print(f"[backup] {err}")
        return 1

    to_delete = names[retain:]
    if not to_delete:
        print("[backup] Nothing to prune.")
        return 0

    for name in to_delete:
        print(f"[backup] Deleting {name}")
        result = subprocess.run(
            [
                "az", "storage", "blob", "delete",
                "--account-name", account,
                "--container-name", container,
                "--name", name,
                "--auth-mode", "login",
            ],
            timeout=120,
        )
        if result.returncode != 0:
            return result.returncode

    print(f"[backup] Pruned {len(to_delete)} blob(s).")
    return 0


COMMANDS = Backup
