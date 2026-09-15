"""Push a tree of local milabench run folders into the database.

Walks a root folder looking for run directories (any directory that directly
contains ``*.data`` files whose first event is ``config`` — install/prepare
logs and empty folders are skipped since they carry no ``run_name``).

Runs are de-duplicated by ``run_name`` *before* touching the database: the
same run folder is often copied into several places (tarballs re-extracted,
"missing" / "scaling" sub-collections, ...). Among duplicates, the copy with
the most ``.data`` bytes is kept.

Pushing is idempotent: for each (deduped) run_name, the target database is
checked first (``execs.name``); a run already present is left untouched, so
running the same command twice — or against a root that itself changed —
never creates duplicate execs.

Examples::

    # preview only: show what would be pushed/skipped, touch nothing
    dashboard db push AMD_MI355 --dry-run

    # push new runs to the dev db (default)
    dashboard db push AMD_MI355

    # push to prod, tagging the runs, skipping the confirmation prompt
    dashboard db push AMD_MI355 --env prod --tag source=AMD_MI355 --yes
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from argklass.command import Command, newparser


class Push(Command):
    """De-dup a folder of run directories and idempotently push new ones to the DB."""

    name: str = "push"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Push)
        parser.add_argument(
            "root",
            type=str,
            help="Root folder to scan recursively for run directories",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Scan, dedup and check the DB, but do not push anything",
        )
        parser.add_argument(
            "--yes",
            "-y",
            action="store_true",
            help="Skip the confirmation prompt before pushing",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Only push the first N new runs (after dedup); useful to try it out",
        )
        parser.add_argument(
            "--contributor",
            type=str,
            default=None,
            help="Attribute pushed runs to this contributor name",
        )
        parser.add_argument(
            "--tag",
            action="append",
            default=[],
            metavar="KEY=VALUE",
            help="Extra metadata tag to attach to pushed runs (repeatable)",
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to data directory containing secrets.toml or .secrets (default: repo data/)",
        )
        parser.add_argument(
            "--env",
            default=None,
            choices=["dev", "prod"],
            help="Config section to load from secrets.toml; defaults to 'dev'. Pass --env prod explicitly to target production.",
        )

    @staticmethod
    def execute(args):
        root = Path(args.root).resolve()
        if not root.is_dir():
            print(f"[push] Not a directory: {root}")
            return 1

        try:
            meta_tags = _parse_tags(args.tag)
        except ValueError as err:
            print(f"[push] {err}")
            return 1

        print(f"[push] Scanning {root} for run directories...")
        candidates = list(_find_run_candidates(root))
        print(f"[push] Found {len(candidates)} directories with .data files")

        runs, skipped_non_bench = _classify_candidates(candidates)
        print(
            f"[push] {len(runs)} look like benchmark runs "
            f"({skipped_non_bench} skipped: no run_name / config event, e.g. install-only logs)"
        )

        deduped, duplicates = _dedup_runs(runs)
        if duplicates:
            print(f"[push] {len(duplicates)} duplicate copie(s) found, keeping the largest of each:")
            for run_name, kept, dropped in duplicates:
                print(f"  {run_name}")
                print(f"    keep: {kept}")
                for d in dropped:
                    print(f"    skip: {d}")

        env = args.env or "dev"
        from dashboard.server.utils import database_uri, load_db_secrets

        load_db_secrets(root=args.secrets, env=args.env)
        try:
            uri = database_uri()
        except ValueError as err:
            print(f"[push] {err}")
            return 1

        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import Session

        from dashboard.server.database.models import Exec, from_json, to_json

        engine = create_engine(
            uri,
            echo=False,
            future=True,
            json_serializer=to_json,
            json_deserializer=from_json,
            pool_pre_ping=True,
        )

        if hasattr(uri, "host"):
            print(f"[push] Target ({env}): {uri.host} as {uri.username}/{uri.database}")
        else:
            from urllib.parse import urlparse

            p = urlparse(str(uri))
            print(f"[push] Target ({env}): {p.hostname} as {p.username}/{p.path.lstrip('/')}")

        try:
            run_names = sorted(deduped)
            with Session(engine) as sess:
                existing = set(
                    sess.execute(
                        select(Exec.name).where(Exec.name.in_(run_names))
                    ).scalars().all()
                )

            to_push = [(name, path) for name, path in deduped.items() if name not in existing]
            to_push.sort(key=lambda item: item[0])

            print(
                f"[push] {len(existing)} run(s) already in the database (skipped), "
                f"{len(to_push)} new run(s) to push"
            )

            if args.limit is not None:
                to_push = to_push[: args.limit]
                print(f"[push] --limit applied: pushing at most {len(to_push)} run(s)")

            if args.dry_run:
                print("[push] Dry run — nothing pushed.")
                for name, path in to_push:
                    print(f"  would push: {name}  ({path})")
                return 0

            if not to_push:
                print("[push] Nothing to push.")
                return 0

            if not args.yes:
                prompt = f"Push {len(to_push)} new run(s) to the {env} database? [y/N] "
                answer = input(prompt).strip().lower()
                if answer not in ("y", "yes"):
                    print("[push] Aborted.")
                    return 1

            pushed, failed = _push_runs(engine, to_push, args.contributor, meta_tags)
            print(f"[push] Done. pushed={pushed} failed={failed} already_existed={len(existing)}")
            return 0 if failed == 0 else 1
        finally:
            engine.dispose()


def _parse_tags(raw_tags):
    tags = {}
    for item in raw_tags:
        if "=" not in item:
            raise ValueError(f"Invalid --tag {item!r}, expected KEY=VALUE")
        key, value = item.split("=", 1)
        tags[key.strip()] = value.strip()
    return tags


def _find_run_candidates(root: Path):
    """Yield (dir_path, [.data filenames]) for every directory holding .data files."""
    for dirpath, _dirnames, filenames in os.walk(root):
        data_files = sorted(f for f in filenames if f.endswith(".data"))
        if data_files:
            yield Path(dirpath), data_files


def _peek_run_name(dir_path: Path, data_files: list[str]) -> str | None:
    """Read only the first event of each .data file, looking for run_name.

    milabench always writes ``config`` as the very first line of a real
    benchmark log; install/prepare logs never emit a ``config`` event.
    """
    for fname in data_files:
        try:
            with open(dir_path / fname, "r", errors="replace") as fh:
                for _ in range(5):
                    line = fh.readline()
                    if not line:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        break
                    if entry.get("event") == "config":
                        run_name = entry.get("data", {}).get("run_name")
                        if run_name:
                            return run_name
                    break
        except OSError:
            continue
    return None


def _classify_candidates(candidates):
    """Split candidates into {run_name: (path, size, data_files)} and a skip count."""
    runs = {}
    skipped = 0
    for dir_path, data_files in candidates:
        run_name = _peek_run_name(dir_path, data_files)
        if run_name is None:
            skipped += 1
            continue
        size = sum((dir_path / f).stat().st_size for f in data_files)
        runs.setdefault(run_name, []).append((dir_path, size))
    return runs, skipped


def _dedup_runs(runs):
    """Keep the largest copy of each run_name. Returns (deduped, duplicates_report)."""
    deduped = {}
    duplicates = []
    for run_name, copies in runs.items():
        if len(copies) == 1:
            deduped[run_name] = copies[0][0]
            continue
        copies_sorted = sorted(copies, key=lambda c: (-c[1], str(c[0])))
        kept_path, _ = copies_sorted[0]
        dropped_paths = [str(p) for p, _ in copies_sorted[1:]]
        deduped[run_name] = kept_path
        duplicates.append((run_name, str(kept_path), dropped_paths))
    return deduped, duplicates


def _push_runs(engine, to_push, contributor, meta_tags):
    from dashboard.server.archive import publish_archived_run
    from dashboard.server.database.writer import SQLAlchemy

    meta_forced = {}
    if contributor:
        meta_forced["contributor"] = contributor

    pushed = failed = 0
    total = len(to_push)
    for i, (run_name, path) in enumerate(to_push, 1):
        try:
            with SQLAlchemy(
                engine=engine,
                meta_tags=meta_tags,
                meta_forced=meta_forced,
            ) as backend:
                publish_archived_run(backend, path, stop_on_exception=True)
                exec_id = backend._run_id

            if exec_id is None:
                print(f"[push]   ({i}/{total}) SKIP (no data replayed): {run_name}  ({path})")
                continue

            pushed += 1
            print(f"[push]   ({i}/{total}) pushed exec_id={exec_id}: {run_name}")
        except Exception as err:
            failed += 1
            print(f"[push]   ({i}/{total}) FAILED: {run_name}  ({path}): {err}")

    return pushed, failed


COMMANDS = Push
