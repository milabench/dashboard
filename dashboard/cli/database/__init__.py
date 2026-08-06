"""Database management commands."""

from argklass.command import ParentCommand


class Database(ParentCommand):
    """Manage database objects: migrations, backups, views, indexes, cache, GPUs, scaling, runs."""

    name: str = "db"

    @classmethod
    def help(cls):
        return (
            "Database management — migrate/restore/views own|create: POSTGRES_ADMIN_*; "
            "dump: POSTGRES_BACKUP_* or admin/app; "
            "views refresh|status / cache/gpus/scaling/runs: POSTGRES_USER / DB_APP_PASSWORD; "
            "blob ops: BACKUP_STORAGE_ACCOUNT + az login"
        )

    @staticmethod
    def module():
        import dashboard.cli.database
        return dashboard.cli.database


COMMANDS = Database
