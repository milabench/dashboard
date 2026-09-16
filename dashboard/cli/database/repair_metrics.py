"""Audit and repair mixed dashboard metrics for a run."""

from __future__ import annotations

from argklass.command import Command, newparser

from dashboard.server.database.metric_repair import (
    audit_exec,
    delete_pack_metrics,
    fix_local_gpu_ids,
)


class RepairMetrics(Command):
    """Detect or repair metrics that mixed ranks/benchmarks in group charts."""

    name: str = "repair-metrics"

    @staticmethod
    def arguments(subparsers):
        parser = newparser(subparsers, RepairMetrics)
        parser.add_argument(
            "action",
            choices=["audit", "fix-gpu-ids", "delete-pack"],
            help="audit: report issues; fix-gpu-ids: remap local gpu_id; delete-pack: remove metrics for a pack",
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
            help="Resolve run by exact exec name",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report changes without writing",
        )
        parser.add_argument(
            "--yes",
            "-y",
            action="store_true",
            help="Skip confirmation for destructive actions",
        )
        parser.add_argument(
            "--tag",
            type=str,
            default=None,
            help="With delete-pack: exact pack tag (e.g. lightning-gpus.0)",
        )
        parser.add_argument(
            "--pack-name",
            type=str,
            default=None,
            help="With delete-pack: exact benchmark pack name (e.g. lightning-gpus)",
        )
        parser.add_argument(
            "--secrets",
            default=None,
            help="Path to data directory containing secrets.toml or .secrets",
        )
        parser.add_argument(
            "--env",
            default=None,
            choices=["dev", "prod"],
            help="Secrets section (default: dev)",
        )

    @staticmethod
    def execute(args):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from dashboard.cli.database.runs import _resolve_exec_id
        from dashboard.server.utils import database_uri, load_db_secrets

        load_db_secrets(root=args.secrets, env=args.env)
        try:
            uri = database_uri()
        except ValueError as err:
            print(f"[repair-metrics] {err}")
            return 1

        engine = create_engine(uri)
        with Session(engine) as sess:
            try:
                exec_id = _resolve_exec_id(sess, args.exec_id, args.name)
            except LookupError as err:
                print(f"[repair-metrics] {err}")
                return 1

            if args.action == "audit":
                return _action_audit(sess, exec_id)

            if args.action == "fix-gpu-ids":
                return _action_fix_gpu_ids(sess, exec_id, args)

            return _action_delete_pack(sess, exec_id, args)


def _action_audit(sess, exec_id: int) -> int:
    issues = audit_exec(sess, exec_id)
    if not issues:
        print(f"[repair-metrics] exec {exec_id}: no mixed-metric issues detected")
        return 0

    print(f"[repair-metrics] exec {exec_id}: {len(issues)} issue(s)")
    for issue in issues:
        where = issue.pack_tag or issue.pack_name or "-"
        print(
            f"  [{issue.kind}] pack={where} count={issue.metric_count}: {issue.message}"
        )

    kinds = {i.kind for i in issues}
    if "LOCAL_GPU_ID" in kinds or "GROUP_SERIES_COLLISION" in kinds:
        print("[repair-metrics] Suggested fix: dashboard db repair-metrics fix-gpu-ids <exec_id>")
    if "PREFIX_COLLISION" in kinds:
        print(
            "[repair-metrics] Prefix collisions are query-side; upgrade dashboard and/or "
            "delete unrelated pack metrics with delete-pack --pack-name <name>"
        )
    return 0


def _action_fix_gpu_ids(sess, exec_id: int, args) -> int:
    dry_run = args.dry_run or not args.yes
    if not dry_run and not args.yes:
        prompt = f"Remap local gpu_id metrics for exec {exec_id}? [y/N] "
        if input(prompt).strip().lower() not in ("y", "yes"):
            print("[repair-metrics] Aborted.")
            return 1

    result = fix_local_gpu_ids(sess, exec_id, dry_run=dry_run)
    if dry_run:
        print(f"[repair-metrics] Dry run: would update {result['updated']} metric row(s)")
    else:
        sess.commit()
        print(f"[repair-metrics] Updated {result['updated']} metric row(s)")

    for pack_id, count in sorted(result["packs"].items()):
        print(f"  pack_id={pack_id}: {count}")
    return 0


def _action_delete_pack(sess, exec_id: int, args) -> int:
    if args.tag is None and args.pack_name is None:
        print("[repair-metrics] delete-pack requires --tag or --pack-name")
        return 1

    dry_run = args.dry_run or not args.yes
    if not dry_run and not args.yes:
        target = args.tag or args.pack_name
        prompt = f"Delete metrics for pack {target!r} in exec {exec_id}? [y/N] "
        if input(prompt).strip().lower() not in ("y", "yes"):
            print("[repair-metrics] Aborted.")
            return 1

    try:
        result = delete_pack_metrics(
            sess,
            exec_id,
            tag=args.tag,
            name=args.pack_name,
            dry_run=dry_run,
        )
    except LookupError as err:
        print(f"[repair-metrics] {err}")
        return 1

    tags = ", ".join(result["pack_tags"])
    if dry_run:
        print(
            f"[repair-metrics] Dry run: would delete {result['deleted']} metric row(s) "
            f"from {result['packs']} pack(s): {tags}"
        )
    else:
        sess.commit()
        print(
            f"[repair-metrics] Deleted {result['deleted']} metric row(s) "
            f"from {result['packs']} pack(s): {tags}"
        )
    return 0


COMMANDS = RepairMetrics
