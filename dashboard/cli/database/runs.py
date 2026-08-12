"""Delete benchmark runs (execs) and dependent rows, or manage visibility.

Cascade order (FKs are not ``ON DELETE CASCADE`` in the schema)::

    metrics → report_cache → packs → execs

Examples::

    # preview what would be deleted (no write)
    dashboard db runs delete 48 --dry-run

    # interactive confirm, then delete
    dashboard db runs delete 48

    # non-interactive (scripts / CI)
    dashboard db runs delete 48 --yes

    # also refresh gpu_summary_mv after delete
    dashboard db runs delete 48 --yes --refresh-views

    # delete by run name (must be unique)
    dashboard db runs delete --name my-run-2026-03-01 --yes

    # release a private run to public
    dashboard db runs release 48

    # mark a run private (generates share token if missing)
    dashboard db runs set-visibility 48 --private

    # promote all runs past their release_at timestamp
    dashboard db runs release-due
"""

from __future__ import annotations

from argklass.command import Command, newparser


class Runs(Command):
    """Show, delete, or manage visibility of benchmark runs (execs)."""

    name: str = "runs"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Runs)
        parser.add_argument(
            "action",
            choices=["delete", "show", "release", "set-visibility", "release-due"],
            help="Action to perform",
        )
        parser.add_argument(
            "exec_id",
            nargs="?",
            type=int,
            default=None,
            help="Exec / run id",
        )
        parser.add_argument(
            "--name",
            type=str,
            default=None,
            help="Resolve run by exact name (must match a single exec)",
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
            help="Print counts only; do not delete",
        )
        parser.add_argument(
            "--refresh-views",
            action="store_true",
            help="Refresh materialized views after a successful delete",
        )
        parser.add_argument(
            "--private",
            action="store_true",
            help="With set-visibility: mark run private",
        )
        parser.add_argument(
            "--public",
            action="store_true",
            help="With set-visibility: mark run public",
        )
        parser.add_argument(
            "--release-at",
            type=str,
            default=None,
            help="With set-visibility --private: scheduled auto-release datetime",
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to data directory containing .secrets (default: repo data/)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri, load_db_secrets

        load_db_secrets(root=args.secrets)
        try:
            uri = database_uri()
        except ValueError as err:
            print(f"[runs] {err}")
            return 1

        if hasattr(uri, "host"):
            print(f"[runs] Connecting to {uri.host} as {uri.username}/{uri.database}")
        else:
            # String URI — avoid printing password.
            from urllib.parse import urlparse

            p = urlparse(str(uri))
            print(f"[runs] Connecting to {p.hostname} as {p.username}/{p.path.lstrip('/')}")

        engine = create_engine(uri)

        with Session(engine) as sess:
            if args.action == "release-due":
                return _action_release_due(sess, args)

            try:
                exec_id = _resolve_exec_id(sess, args.exec_id, args.name)
            except LookupError as err:
                print(f"[runs] {err}")
                return 1

            summary = _run_summary(sess, exec_id)
            if summary is None:
                print(f"[runs] No exec with _id={exec_id}")
                return 1

            _print_summary(summary)

            if args.action == "show":
                return 0

            if args.action == "release":
                return _action_release(sess, exec_id, summary)

            if args.action == "set-visibility":
                return _action_set_visibility(sess, exec_id, args)

            # action == delete
            if args.dry_run:
                print("[runs] Dry run — nothing deleted.")
                return 0

            if not args.yes:
                prompt = (
                    f"Cascade-delete exec {exec_id} "
                    f"({summary['metrics']} metrics, {summary['packs']} packs)? [y/N] "
                )
                answer = input(prompt).strip().lower()
                if answer not in ("y", "yes"):
                    print("[runs] Aborted.")
                    return 1

            counts = cascade_delete_exec(sess, exec_id)
            sess.commit()
            print(
                f"[runs] Deleted exec={exec_id}: "
                f"metrics={counts['metrics']}, "
                f"report_cache={counts['report_cache']}, "
                f"packs={counts['packs']}, "
                f"execs={counts['execs']}"
            )

            if args.refresh_views:
                from dashboard.cli.database.views import refresh_views
                from dashboard.server.materialized_views import GPU_SUMMARY_VIEW

                print(f"[runs] Refreshing {GPU_SUMMARY_VIEW}…")
                refresh_views(sess, [GPU_SUMMARY_VIEW])
                print("[runs] Views refreshed.")

        return 0


def _resolve_exec_id(sess, exec_id, name):
    from sqlalchemy import select

    from dashboard.server.database.models import Exec

    if exec_id is not None and name is not None:
        raise LookupError("Pass either exec_id or --name, not both")
    if exec_id is None and name is None:
        raise LookupError("Provide an exec_id or --name")

    if exec_id is not None:
        return int(exec_id)

    rows = sess.execute(select(Exec._id).where(Exec.name == name)).scalars().all()
    if not rows:
        raise LookupError(f"No exec named {name!r}")
    if len(rows) > 1:
        ids = ", ".join(str(i) for i in rows)
        raise LookupError(f"Multiple execs named {name!r}: {ids} — use exec_id")
    return int(rows[0])


def _run_summary(sess, exec_id):
    from sqlalchemy import func, select

    from dashboard.server.database.models import Exec, Metric, Pack, ReportCache

    run = sess.get(Exec, exec_id)
    if run is None:
        return None

    n_packs = sess.execute(
        select(func.count()).select_from(Pack).where(Pack.exec_id == exec_id)
    ).scalar_one()
    n_metrics = sess.execute(
        select(func.count()).select_from(Metric).where(Metric.exec_id == exec_id)
    ).scalar_one()
    n_cache = sess.execute(
        select(func.count()).select_from(ReportCache).where(ReportCache.exec_id == exec_id)
    ).scalar_one()

    gpu = None
    meta = run.meta or {}
    try:
        gpu = meta["accelerators"]["gpus"]["0"]["product"]
    except (KeyError, TypeError):
        pass

    return {
        "exec_id": run._id,
        "name": run.name,
        "namespace": run.namespace,
        "status": run.status,
        "created_time": run.created_time,
        "visibility": run.visibility,
        "share_token": run.share_token,
        "release_at": run.release_at,
        "gpu": gpu,
        "packs": int(n_packs),
        "metrics": int(n_metrics),
        "report_cache": int(n_cache),
    }


def _print_summary(summary):
    print(f"  exec_id:      {summary['exec_id']}")
    print(f"  name:         {summary['name']}")
    print(f"  namespace:    {summary['namespace']}")
    print(f"  status:       {summary['status']}")
    print(f"  created:      {summary['created_time']}")
    print(f"  visibility:   {summary['visibility']}")
    if summary.get("share_token"):
        print(f"  share_path:   /share/{summary['share_token']}")
    if summary.get("release_at"):
        print(f"  release_at:   {summary['release_at']}")
    print(f"  gpu:          {summary['gpu']}")
    print(f"  packs:        {summary['packs']}")
    print(f"  metrics:      {summary['metrics']}")
    print(f"  report_cache: {summary['report_cache']}")


def cascade_delete_exec(sess, exec_id: int) -> dict[str, int]:
    """Delete metrics, report_cache, packs, then the exec row.

    Caller owns the transaction (commit / rollback).
    """
    from sqlalchemy import delete, func, select

    from dashboard.server.database.models import Exec, Metric, Pack, ReportCache

    exec_id = int(exec_id)
    if sess.get(Exec, exec_id) is None:
        raise LookupError(f"No exec with _id={exec_id}")

    def _count_delete(model, where):
        n = sess.execute(
            select(func.count()).select_from(model).where(where)
        ).scalar_one()
        sess.execute(delete(model).where(where))
        return int(n)

    counts = {
        "metrics": _count_delete(Metric, Metric.exec_id == exec_id),
        "report_cache": _count_delete(ReportCache, ReportCache.exec_id == exec_id),
        "packs": _count_delete(Pack, Pack.exec_id == exec_id),
        "execs": _count_delete(Exec, Exec._id == exec_id),
    }
    return counts


def _action_release(sess, exec_id, summary):
    from dashboard.server.database.models import Exec
    from dashboard.server.visibility import VISIBILITY_PUBLIC

    run = sess.get(Exec, exec_id)
    if run.visibility == VISIBILITY_PUBLIC:
        print(f"[runs] Exec {exec_id} is already public.")
        return 0

    run.visibility = VISIBILITY_PUBLIC
    sess.commit()
    print(f"[runs] Released exec {exec_id} ({summary['name']}) to public.")
    return 0


def _action_set_visibility(sess, exec_id, args):
    import secrets

    from dashboard.server.database.models import Exec
    from dashboard.server.visibility import (
        VISIBILITY_PRIVATE,
        VISIBILITY_PUBLIC,
        parse_release_at,
        share_url_for,
    )

    if args.private and args.public:
        print("[runs] Pass only one of --private or --public")
        return 1
    if not args.private and not args.public:
        print("[runs] Pass --private or --public")
        return 1

    run = sess.get(Exec, exec_id)
    if run is None:
        print(f"[runs] No exec with _id={exec_id}")
        return 1

    if args.public:
        run.visibility = VISIBILITY_PUBLIC
        sess.commit()
        print(f"[runs] Exec {exec_id} is now public.")
        return 0

    run.visibility = VISIBILITY_PRIVATE
    if not run.share_token:
        run.share_token = secrets.token_urlsafe(32)
    if args.release_at:
        try:
            run.release_at = parse_release_at(args.release_at)
        except ValueError as err:
            print(f"[runs] {err}")
            return 1
    sess.commit()
    print(f"[runs] Exec {exec_id} is now private.")
    print(f"[runs] Share path: {share_url_for(run.share_token)}")
    if run.release_at:
        print(f"[runs] Scheduled release: {run.release_at}")
    return 0


def _action_release_due(sess, args):
    from dashboard.server.visibility import release_due_runs
    from dashboard.server.materialized_views import GPU_SUMMARY_VIEW

    count = release_due_runs(sess)
    if count:
        sess.commit()
    else:
        print("[runs] No embargoed runs due for release.")
        return 0

    if args.refresh_views:
        from dashboard.cli.database.views import refresh_views

        print(f"[runs] Refreshing {GPU_SUMMARY_VIEW}…")
        refresh_views(sess, [GPU_SUMMARY_VIEW])

    print(f"[runs] Released {count} run(s) to public.")
    return 0


COMMANDS = Runs
