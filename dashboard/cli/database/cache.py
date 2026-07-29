"""Manage the report cache table.

Examples::

    # show cache statistics
    dashboard db cache status

    # pre-warm cache for a specific exec_id
    dashboard db cache warmup 48

    # evict old entries (keep only the N most recent exec_ids)
    dashboard db cache evict
    dashboard db cache evict --keep 20

    # invalidate (delete) cached rows for a specific exec_id
    dashboard db cache invalidate 48

    # clear the entire cache
    dashboard db cache clear
"""

from argklass.command import Command, newparser


class Cache(Command):
    """Warmup, evict, or inspect the report cache."""

    name: str = "cache"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Cache)
        parser.add_argument(
            "action",
            choices=["status", "warmup", "evict", "invalidate", "clear"],
            help="Action to perform on the report cache",
        )
        parser.add_argument(
            "exec_id",
            nargs="?",
            type=int,
            default=None,
            help="Exec ID (required for warmup and invalidate)",
        )
        parser.add_argument(
            "--keep",
            type=int,
            default=None,
            help="Number of most-recent exec_ids to keep (for evict)",
        )
        parser.add_argument(
            "--profile",
            type=str,
            default="default",
            help="Weight profile to use (for warmup)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.server.utils import database_uri
        from dashboard.server.report_cache import (
            cache_status,
            evict_old_entries,
            get_cached_report,
            invalidate_exec,
            store_report,
            _table_exists,
        )

        engine = create_engine(database_uri())

        with Session(engine) as sess:
            if not _table_exists(sess):
                print("[cache] report_cache table does not exist. Run the migration first.")
                return

            match args.action:
                case "status":
                    info = cache_status(sess)
                    print(f"  rows:     {info['total_rows']}")
                    print(f"  exec_ids: {info['distinct_execs']}")
                    print(f"  profiles: {info['distinct_profiles']}")

                case "warmup":
                    if args.exec_id is None:
                        print("[cache] warmup requires an exec_id argument")
                        return
                    existing = get_cached_report(sess, args.exec_id, args.profile)
                    if existing:
                        print(f"[cache] exec_id={args.exec_id} profile={args.profile} already cached ({len(existing)} rows)")
                        return

                    from dashboard.server.plot import sql_direct_report
                    from dashboard.server.utils import cursor_to_json

                    stmt = sql_direct_report([str(args.exec_id)], profile=args.profile)
                    cursor = sess.execute(stmt)
                    results = cursor_to_json(cursor)

                    if not results:
                        print(f"[cache] No report data for exec_id={args.exec_id}")
                        return

                    store_report(sess, args.exec_id, args.profile, results)
                    print(f"[cache] Cached {len(results)} rows for exec_id={args.exec_id} profile={args.profile}")

                case "evict":
                    evict_old_entries(sess, keep=args.keep)
                    print("[cache] Eviction complete")

                case "invalidate":
                    if args.exec_id is None:
                        print("[cache] invalidate requires an exec_id argument")
                        return
                    invalidate_exec(sess, args.exec_id)
                    print(f"[cache] Invalidated exec_id={args.exec_id}")

                case "clear":
                    from sqlalchemy import delete
                    from dashboard.server.database.models import ReportCache

                    result = sess.execute(delete(ReportCache))
                    sess.commit()
                    print(f"[cache] Cleared {result.rowcount} rows")


COMMANDS = Cache
