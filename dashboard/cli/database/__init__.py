"""Database management commands."""

from argklass.command import ParentCommand


class Database(ParentCommand):
    """Manage database objects: migrations, backups, views, indexes, cache, GPUs, scaling."""

    name: str = "db"

    @classmethod
    def help(cls):
        return (
            "Database management — migrate/restore: POSTGRES_ADMIN_*; "
            "dump: POSTGRES_BACKUP_* or admin/app; "
            "views/cache/gpus/scaling: POSTGRES_USER / DB_APP_PASSWORD; "
            "blob ops: BACKUP_STORAGE_ACCOUNT + az login"
        )

    @staticmethod
    def module():
        import dashboard.cli.database
        return dashboard.cli.database


COMMANDS = Database
