"""Remove old runs from the local jobrunner data cache (``./data``) that
never produced any benchmark data.

A run's status is read straight from what ``rsync_jobrunner_job`` pulled
back from the cluster (see ``dashboard.server.slurm.slurm``), no Slurm or
DB access required:

* no ``runs/`` directory at all -- the sbatch script died during
  ``milabench install``/``prepare``, before ``milabench run`` could even
  start (``set -e`` aborts the script and the final ``rsync`` never runs).
* a ``runs/`` directory with no ``scaling.yaml`` -- prepare/run started but
  the sizer never got to save anything.
* a ``runs/scaling.yaml`` that only has milabench's ``version:`` header --
  the sizer initialized but no benchmark ever reported an observation.

Any run whose ``runs/scaling.yaml`` has at least one benchmark entry is
kept, regardless of age.

Examples::

    # Preview what would be removed (default cutoff: 7 days)
    dashboard jobrunner cleanup --dry-run

    # Remove no-data runs older than 14 days, with a confirmation prompt
    dashboard jobrunner cleanup --min-age-days 14

    # Non-interactive (cron)
    dashboard jobrunner cleanup --yes
"""

from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass

from argklass.command import Command, newparser


@dataclass
class RunInfo:
    path: str
    name: str
    age_days: float
    has_data: bool
    reason: str


def _submission_time(run_dir: str) -> float:
    """Best-effort submission timestamp for a run.

    ``cmd.sh`` is written once by the dashboard at sbatch time and never
    touched again, unlike ``.sys/*`` or ``meta/info.json`` which get
    refreshed by periodic status polling -- so it's a more reliable age
    signal than the run directory's own mtime.
    """
    cmd_sh = os.path.join(run_dir, "cmd.sh")
    try:
        return os.path.getmtime(cmd_sh)
    except OSError:
        return os.path.getmtime(run_dir)


def _scaling_is_populated(scaling_path: str) -> bool:
    import yaml

    try:
        with open(scaling_path, "r") as fp:
            content = yaml.safe_load(fp)
    except Exception:
        return False

    if not isinstance(content, dict):
        return False

    return any(key != "version" for key in content.keys())


def inspect_run(data_dir: str, name: str) -> RunInfo:
    run_dir = os.path.join(data_dir, name)
    age_days = (time.time() - _submission_time(run_dir)) / 86400

    runs_dir = os.path.join(run_dir, "runs")
    if not os.path.isdir(runs_dir):
        return RunInfo(run_dir, name, age_days, False, "no runs/ directory (install/prepare never finished)")

    scaling_path = os.path.join(runs_dir, "scaling.yaml")
    if not os.path.isfile(scaling_path):
        return RunInfo(run_dir, name, age_days, False, "runs/ exists but no scaling.yaml")

    if _scaling_is_populated(scaling_path):
        return RunInfo(run_dir, name, age_days, True, "scaling.yaml has observations")

    return RunInfo(run_dir, name, age_days, False, "scaling.yaml is an empty stub (version header only)")


class Cleanup(Command):
    """Remove old no-data runs from the local jobrunner data cache."""

    name: str = "cleanup"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Cleanup)
        parser.add_argument(
            "--data-dir",
            type=str,
            default=None,
            help="Jobrunner data cache to clean (default: repo's ./data)",
        )
        parser.add_argument(
            "--min-age-days",
            type=float,
            default=7.0,
            help="Only remove no-data runs at least this many days old (default: 7)",
        )
        parser.add_argument(
            "--yes",
            "-y",
            action="store_true",
            help="Skip interactive confirmation",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be removed; do not delete anything",
        )

    @staticmethod
    def execute(args):
        data_dir = args.data_dir
        if not data_dir:
            from dashboard.server.slurm.constant import JOBRUNNER_LOCAL_CACHE
            data_dir = JOBRUNNER_LOCAL_CACHE

        if not os.path.isdir(data_dir):
            print(f"[cleanup] No such directory: {data_dir}")
            return 1

        names = sorted(
            n for n in os.listdir(data_dir)
            if os.path.isdir(os.path.join(data_dir, n)) and not n.startswith(".")
        )

        to_remove = []
        kept_data = 0
        kept_young = 0

        for name in names:
            info = inspect_run(data_dir, name)

            if info.has_data:
                kept_data += 1
                continue

            if info.age_days < args.min_age_days:
                kept_young += 1
                continue

            to_remove.append(info)

        print(f"[cleanup] Scanned {len(names)} run(s) in {data_dir}")
        print(f"[cleanup] Kept (has data):              {kept_data}")
        print(f"[cleanup] Kept (younger than {args.min_age_days:g}d):    {kept_young}")
        print(f"[cleanup] Candidates for removal:       {len(to_remove)}")

        if not to_remove:
            return 0

        for info in to_remove:
            print(f"  - {info.name}  ({info.age_days:.1f}d old, {info.reason})")

        if args.dry_run:
            print("[cleanup] Dry run -- nothing deleted.")
            return 0

        if not args.yes:
            answer = input(f"Delete {len(to_remove)} run(s)? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("[cleanup] Aborted.")
                return 1

        removed = 0
        for info in to_remove:
            try:
                shutil.rmtree(info.path)
                removed += 1
            except OSError as exc:
                print(f"[cleanup] Failed to remove {info.path}: {exc}")

        print(f"[cleanup] Removed {removed}/{len(to_remove)} run(s).")
        return 0


COMMANDS = Cleanup
