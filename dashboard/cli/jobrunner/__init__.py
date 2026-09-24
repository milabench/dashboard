"""Local jobrunner data-cache management commands (./data)."""

from argklass.command import ParentCommand


class Jobrunner(ParentCommand):
    """Manage the local jobrunner data cache: prune old runs with no benchmark data."""

    name: str = "jobrunner"

    @classmethod
    def help(cls):
        return "Local jobrunner data cache (./data) management -- cleanup"

    @staticmethod
    def module():
        import dashboard.cli.jobrunner
        return dashboard.cli.jobrunner


COMMANDS = Jobrunner
