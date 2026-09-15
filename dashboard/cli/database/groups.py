"""Manage RunGroup assignments for benchmark runs.

Examples::

    # assign groups to all execs that have none yet
    dashboard db groups backfill

    # re-compute groups for every exec (re-hashes everything)
    dashboard db groups backfill --all

    # list groups, optionally filtered by strategy
    dashboard db groups list
    dashboard db groups list --strategy hardware

    # show detail + member exec_ids for one group
    dashboard db groups show 42
"""

from __future__ import annotations

from argklass.command import Command, newparser


class Groups(Command):
    """Assign, list, or inspect RunGroup memberships."""

    name: str = "groups"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, Groups)
        parser.add_argument(
            "action",
            choices=["backfill", "list", "show"],
            help="Action to perform",
        )
        parser.add_argument(
            "group_id",
            nargs="?",
            type=int,
            default=None,
            help="RunGroup _id (for 'show')",
        )
        parser.add_argument(
            "--strategy",
            choices=["hardware", "config", "software", "milabench", "manual"],
            default=None,
            help="Filter 'list' or 'backfill' by strategy",
        )
        parser.add_argument(
            "--all",
            dest="all_execs",
            action="store_true",
            help="With 'backfill': re-assign groups for ALL execs, not just ungrouped ones",
        )
        parser.add_argument(
            "--batch",
            type=int,
            default=500,
            help="Commit every N execs during backfill (default: 500)",
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to directory containing secrets.toml or .secrets (default: repo data/)",
        )
        parser.add_argument(
            "--env",
            default=None,
            choices=["dev", "prod"],
            help="Config section to load from secrets.toml; defaults to 'dev'. Pass --env prod explicitly to target production.",
        )

    @staticmethod
    def execute(args):
        from dashboard.server.utils import database_uri, load_db_secrets

        load_db_secrets(root=args.secrets, env=args.env)
        try:
            uri = database_uri()
        except ValueError as err:
            print(f"[groups] {err}")
            return 1

        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from bson.json_util import dumps as to_json, loads as from_json

        engine = create_engine(
            uri,
            echo=False,
            future=True,
            json_serializer=to_json,
            json_deserializer=from_json,
        )

        if args.action == "backfill":
            return _action_backfill(engine, args)
        if args.action == "list":
            with Session(engine) as sess:
                return _action_list(sess, args)
        if args.action == "show":
            if args.group_id is None:
                print("[groups] 'show' requires a group_id argument")
                return 1
            with Session(engine) as sess:
                return _action_show(sess, args.group_id)

        print(f"[groups] Unknown action: {args.action}")
        return 1


def _action_backfill(engine, args):
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from dashboard.server.database.models import Exec, RunGroupMember
    from dashboard.server.database.grouping import assign_groups

    batch_size = args.batch

    with Session(engine) as sess:
        if args.all_execs:
            exec_ids = sess.execute(
                select(Exec._id).order_by(Exec._id)
            ).scalars().all()
            label = "all"
        else:
            # Only execs that have no group membership at all
            has_group = select(RunGroupMember.exec_id).distinct()
            exec_ids = sess.execute(
                select(Exec._id)
                .where(Exec._id.notin_(has_group))
                .order_by(Exec._id)
            ).scalars().all()
            label = "ungrouped"

    total = len(exec_ids)
    print(f"[groups] {total} {label} exec(s) to process")
    if total == 0:
        return 0

    processed = errors = 0
    for i, exec_id in enumerate(exec_ids, 1):
        try:
            with Session(engine) as sess:
                exec_ = sess.get(Exec, exec_id)
                if exec_ is None:
                    continue
                assign_groups(exec_id, exec_.meta or {}, sess)
            processed += 1
        except Exception as err:
            errors += 1
            print(f"[groups]   exec_id={exec_id}: {err}")

        if i % batch_size == 0 or i == total:
            pct = i / total * 100
            print(f"[groups]   {i}/{total} ({pct:.0f}%) — ok={processed} err={errors}")

    print(f"[groups] Done. processed={processed} errors={errors}")
    return 0 if errors == 0 else 1


def _action_list(sess, args):
    from sqlalchemy import func, select

    from dashboard.server.database.models import RunGroup, RunGroupMember

    q = select(RunGroup).order_by(RunGroup.strategy, RunGroup.label)
    if args.strategy:
        q = q.where(RunGroup.strategy == args.strategy)
    rows = sess.execute(q).scalars().all()

    if not rows:
        print("[groups] No groups found.")
        return 0

    # Fetch member counts in one query
    group_ids = [r._id for r in rows]
    counts = {}
    for row in sess.execute(
        select(RunGroupMember.group_id, func.count().label("n"))
        .where(RunGroupMember.group_id.in_(group_ids))
        .group_by(RunGroupMember.group_id)
    ).mappings():
        counts[row["group_id"]] = row["n"]

    col_w = 14
    print(f"{'ID':>6}  {'STRATEGY':<10}  {'RUNS':>5}  LABEL")
    print("-" * 70)
    prev_strategy = None
    for g in rows:
        if g.strategy != prev_strategy:
            if prev_strategy is not None:
                print()
            prev_strategy = g.strategy
        n = counts.get(g._id, 0)
        print(f"{g._id:>6}  {g.strategy:<10}  {n:>5}  {g.label}")

    print(f"\n{len(rows)} group(s) total")
    return 0


def _action_show(sess, group_id):
    from sqlalchemy import select

    from dashboard.server.database.models import Exec, RunGroup, RunGroupMember

    g = sess.get(RunGroup, group_id)
    if g is None:
        print(f"[groups] No group with _id={group_id}")
        return 1

    print(f"  id:          {g._id}")
    print(f"  strategy:    {g.strategy}")
    print(f"  granularity: {g.granularity or '-'}")
    print(f"  label:       {g.label}")
    print(f"  fingerprint: {g.fingerprint or '(manual)'}")
    print(f"  updated:     {g.updated_at}")

    if g.meta:
        import json
        print(f"  meta:        {json.dumps(g.meta, indent=14)[:-1].strip()}")

    members = sess.execute(
        select(RunGroupMember.exec_id)
        .where(RunGroupMember.group_id == group_id)
        .order_by(RunGroupMember.exec_id)
    ).scalars().all()

    print(f"\n  {len(members)} member(s):")
    for exec_id in members:
        exec_ = sess.get(Exec, exec_id)
        name = exec_.name if exec_ else "?"
        date = exec_.created_time.strftime("%Y-%m-%d") if exec_ and exec_.created_time else "?"
        status = exec_.status if exec_ else "?"
        print(f"    {exec_id:>6}  {date}  {status:<12}  {name}")

    return 0


COMMANDS = Groups
