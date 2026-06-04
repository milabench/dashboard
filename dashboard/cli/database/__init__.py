"""Database management commands."""

from argklass.command import ParentCommand


class Database(ParentCommand):
    """Manage database objects: materialized views, migrations."""

    name: str = "db"

    @classmethod
    def help(cls):
        return "Database management subcommands"

    @staticmethod
    def module():
        import dashboard.cli.database
        return dashboard.cli.database


COMMANDS = Database
