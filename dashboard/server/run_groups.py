"""API endpoints for RunGroup / RunGroupMember.

GET  /api/run-groups                          list all groups (optional ?strategy=)
GET  /api/run-groups/<id>                     single group
GET  /api/run-groups/<id>/members             exec_ids in a group
GET  /api/run-groups/<id>/composite-report    composite report for a group
GET  /api/exec/<id>/groups                    groups for an exec

POST /api/run-groups                 create a manual group
POST /api/run-groups/<id>/members    add exec to group (manual groups only)
DELETE /api/run-groups/<id>/members/<exec_id>  remove exec from manual group
"""

from flask import jsonify, request
import sqlalchemy
from sqlalchemy import select, func

from dashboard.server.database.models import RunGroup, RunGroupMember, Exec
from dashboard.server.database.grouping import (
    assign_groups,
    assign_benches_to_execs,
    pack_status_by_exec,
    rank_execs_by_success,
)
from dashboard.server.visibility import public_exec_filter, require_public_exec


def run_group_routes(bp, sqlexec):
    """Read-only group browsing — stays public; group assignment already
    happens automatically on every push (see ``server/database/writer.py``).
    """

    @bp.route("/api/run-groups", methods=["GET"])
    def api_list_run_groups():
        strategy = request.args.get("strategy")
        with sqlexec() as sess:
            q = select(RunGroup).order_by(RunGroup.strategy, RunGroup.label)
            if strategy:
                q = q.where(RunGroup.strategy == strategy)
            rows = sess.execute(q).scalars().all()

            # Annotate each group with member count
            group_ids = [r._id for r in rows]
            counts = {}
            if group_ids:
                count_q = (
                    select(RunGroupMember.group_id, func.count().label("n"))
                    .where(RunGroupMember.group_id.in_(group_ids))
                    .group_by(RunGroupMember.group_id)
                )
                for row in sess.execute(count_q).mappings():
                    counts[row["group_id"]] = row["n"]

            result = []
            for r in rows:
                d = r.as_dict()
                d["member_count"] = counts.get(r._id, 0)
                result.append(d)

        return jsonify(result)

    @bp.route("/api/run-groups/<int:group_id>", methods=["GET"])
    def api_get_run_group(group_id):
        with sqlexec() as sess:
            row = sess.get(RunGroup, group_id)
            if row is None:
                return jsonify({"error": "not found"}), 404
            return jsonify(row.as_dict())

    @bp.route("/api/run-groups/<int:group_id>/members", methods=["GET"])
    def api_run_group_members(group_id):
        limit = min(int(request.args.get("limit", 200)), 1000)
        offset = int(request.args.get("offset", 0))
        intersect_group_id = request.args.get("intersect_group_id", type=int)
        with sqlexec() as sess:
            group = sess.get(RunGroup, group_id)
            if group is None:
                return jsonify({"error": "not found"}), 404

            if intersect_group_id is not None and sess.get(RunGroup, intersect_group_id) is None:
                return jsonify({"error": "intersect_group_id not found"}), 404

            q = (
                select(Exec)
                .join(RunGroupMember, RunGroupMember.exec_id == Exec._id)
                .where(RunGroupMember.group_id == group_id)
                .where(public_exec_filter())
            )
            if intersect_group_id is not None:
                q = q.where(
                    Exec._id.in_(
                        select(RunGroupMember.exec_id).where(
                            RunGroupMember.group_id == intersect_group_id
                        )
                    )
                )
            q = q.order_by(Exec.created_time.desc()).limit(limit).offset(offset)
            execs = sess.execute(q).scalars().all()
            return jsonify([e.as_dict() for e in execs])

    @bp.route("/api/run-groups/<int:group_id>/composite-report", methods=["GET"])
    def api_run_group_composite_report(group_id):
        """Composite report for a run-group.

        Algorithm:
        - Rank execs in the group by successful-bench count first (ties
          broken by recency), so the composite draws from as few runs as
          possible: the single most-complete run first, others only filling
          in benches it's missing.
        - For each benchmark (pack name), use the highest-ranked exec where
          it actually succeeded; anything still missing falls back to
          whichever exec has it at all.
        - A pack is never split across execs: all GPU-workers for a pack come
          from the same run.
        - Returns rows in the same format as /api/report/fast.
        """
        from dashboard.server.plot import sql_direct_report
        from dashboard.server.utils import cursor_to_json

        profile = request.cookies.get("scoreProfile") or request.args.get("profile", "default")
        drop_min_max = request.args.get("drop_min_max", "true").lower() == "true"
        perf_agg = request.args.get("perf_agg") or None
        intersect_group_id = request.args.get("intersect_group_id", type=int)

        with sqlexec() as sess:
            group = sess.get(RunGroup, group_id)
            if group is None:
                return jsonify({"error": "not found"}), 404

            if intersect_group_id is not None and sess.get(RunGroup, intersect_group_id) is None:
                return jsonify({"error": "intersect_group_id not found"}), 404

            # Execs in group (optionally narrowed to also belong to
            # intersect_group_id — e.g. a hardware group — for a "this
            # config, on this hardware" report), newest first.
            query = (
                select(Exec._id, Exec.created_time)
                .join(RunGroupMember, RunGroupMember.exec_id == Exec._id)
                .where(RunGroupMember.group_id == group_id)
                .where(public_exec_filter())
            )
            if intersect_group_id is not None:
                query = query.where(
                    Exec._id.in_(
                        select(RunGroupMember.exec_id).where(
                            RunGroupMember.group_id == intersect_group_id
                        )
                    )
                )
            execs = sess.execute(query.order_by(Exec.created_time.desc())).all()

            if not execs:
                return jsonify([])

            exec_ids = [e._id for e in execs]

            packs_by_exec, status_by_exec = pack_status_by_exec(sess, exec_ids)
            ranked_exec_ids = rank_execs_by_success(exec_ids, packs_by_exec, status_by_exec)

            exec_to_benches = assign_benches_to_execs(
                ranked_exec_ids, packs_by_exec, status_by_exec
            )

            # Run a sub-report per exec and collect rows
            all_rows: list[dict] = []
            for exec_id, benches in exec_to_benches.items():
                stmt = sql_direct_report(
                    [exec_id],
                    profile=profile,
                    drop_min_max=drop_min_max,
                    benches=benches,
                    perf_agg=perf_agg,
                )
                all_rows.extend(cursor_to_json(sess.execute(stmt)))

        # Unify weight_total across the composite (each sub-report only counted
        # its own bench subset, so the sub-totals are all wrong).
        total_weight = sum(
            r["weight"]
            for r in all_rows
            if (r.get("enabled") or 0) > 0 and (r.get("weight") or 0) > 0
        )
        for row in all_rows:
            row["weight_total"] = total_weight

        all_rows.sort(key=lambda r: r.get("order") or 999)
        return jsonify(all_rows)

    @bp.route("/api/run-groups/<int:group_id>/related", methods=["GET"])
    def api_run_group_related(group_id):
        """Other-strategy groups this group's members also belong to.

        E.g. from a "config" group (resized batch_size=1), find which
        "hardware" group(s) those same runs come from — so the UI can then
        ask for a composite report over just that config × hardware slice.
        """
        strategy = request.args.get("strategy")
        if not strategy:
            return jsonify({"error": "strategy is required"}), 400

        with sqlexec() as sess:
            group = sess.get(RunGroup, group_id)
            if group is None:
                return jsonify({"error": "not found"}), 404

            member_execs = select(RunGroupMember.exec_id).where(
                RunGroupMember.group_id == group_id
            )
            rows = sess.execute(
                select(
                    RunGroup._id,
                    RunGroup.label,
                    func.count(RunGroupMember.exec_id).label("n"),
                )
                .join(RunGroupMember, RunGroupMember.group_id == RunGroup._id)
                .where(
                    RunGroupMember.exec_id.in_(member_execs),
                    RunGroup.strategy == strategy,
                )
                .group_by(RunGroup._id, RunGroup.label)
                .order_by(func.count(RunGroupMember.exec_id).desc())
            ).all()

            return jsonify([
                {"_id": r._id, "label": r.label, "count": r.n}
                for r in rows
            ])

    @bp.route("/api/exec/<int:exec_id>/groups", methods=["GET"])
    def api_exec_groups(exec_id):
        with sqlexec() as sess:
            if require_public_exec(sess, exec_id) is None:
                return jsonify({"error": "not found"}), 404

            q = (
                select(RunGroup)
                .join(RunGroupMember, RunGroupMember.group_id == RunGroup._id)
                .where(RunGroupMember.exec_id == exec_id)
                .order_by(RunGroup.strategy)
            )
            rows = sess.execute(q).scalars().all()
            return jsonify([r.as_dict() for r in rows])


def run_group_admin_routes(bp, session_factory=None):
    """Manual group create/edit/backfill — maintenance/correction tools,
    not part of the normal push flow (assignment already happens on push).

    Every route accepts a ``target`` ('dev' or 'prod', default 'dev') and
    operates against that database via ``session_factory`` — independent
    of whichever DB the server itself is connected to.

    ``session_factory(target)`` defaults to ``admin_db.admin_session``
    (real dev/prod Postgres via secrets.toml) — tests inject a fake
    returning an in-memory-SQLite-backed session instead.
    """
    from .admin_db import TARGETS
    if session_factory is None:
        from .admin_db import admin_session as session_factory

    def _target(source) -> str:
        target = source.get("target", "dev")
        if target not in TARGETS:
            raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
        return target

    @bp.route("/api/run-groups", methods=["POST"])
    def api_create_run_group():
        body = request.get_json(force=True)
        label = body.get("label", "").strip()
        if not label:
            return jsonify({"error": "label is required"}), 400

        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        group = RunGroup(
            strategy="manual",
            fingerprint=None,
            granularity=None,
            label=label,
            meta=body.get("meta"),
        )
        with session_factory(target) as sess:
            sess.add(group)
            sess.commit()
            sess.refresh(group)
            return jsonify(group.as_dict()), 201

    @bp.route("/api/run-groups/<int:group_id>/members", methods=["POST"])
    def api_add_group_member(group_id):
        body = request.get_json(force=True)
        exec_id = body.get("exec_id")
        if exec_id is None:
            return jsonify({"error": "exec_id is required"}), 400

        try:
            target = _target(body)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            group = sess.get(RunGroup, group_id)
            if group is None:
                return jsonify({"error": "group not found"}), 404
            if group.strategy != "manual":
                return jsonify({"error": "can only manually add members to manual groups"}), 400

            exec_ = sess.get(Exec, exec_id)
            if exec_ is None:
                return jsonify({"error": "exec not found"}), 404

            existing = sess.execute(
                select(RunGroupMember).where(
                    RunGroupMember.exec_id == exec_id,
                    RunGroupMember.group_id == group_id,
                )
            ).scalar_one_or_none()
            if existing:
                return jsonify({"message": "already a member"}), 200

            sess.add(RunGroupMember(exec_id=exec_id, group_id=group_id))
            sess.commit()
            return jsonify({"message": "added"}), 201

    @bp.route("/api/run-groups/<int:group_id>/members/<int:exec_id>", methods=["DELETE"])
    def api_remove_group_member(group_id, exec_id):
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            group = sess.get(RunGroup, group_id)
            if group is None:
                return jsonify({"error": "group not found"}), 404
            if group.strategy != "manual":
                return jsonify({"error": "can only remove members from manual groups"}), 400

            row = sess.execute(
                select(RunGroupMember).where(
                    RunGroupMember.exec_id == exec_id,
                    RunGroupMember.group_id == group_id,
                )
            ).scalar_one_or_none()
            if row is None:
                return jsonify({"error": "member not found"}), 404

            sess.delete(row)
            sess.commit()
            return jsonify({"message": "removed"}), 200

    @bp.route("/api/run-groups/backfill", methods=["POST"])
    def api_backfill_groups():
        """Re-assign groups for all execs that have no group membership yet.

        Pass ?strategy=strict to backfill only execs missing that one strategy
        (useful after adding a new strategy to an existing deployment).
        """
        strategy = request.args.get("strategy")
        try:
            target = _target(request.args)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        with session_factory(target) as sess:
            if strategy:
                # Execs that are not yet members of any group with that strategy
                already = (
                    select(RunGroupMember.exec_id)
                    .join(RunGroup, RunGroup._id == RunGroupMember.group_id)
                    .where(RunGroup.strategy == strategy)
                    .distinct()
                )
                q = select(Exec).where(Exec._id.notin_(already)).order_by(Exec._id)
            else:
                subq = select(RunGroupMember.exec_id).distinct()
                q = select(Exec).where(Exec._id.notin_(subq)).order_by(Exec._id)
            execs = sess.execute(q).scalars().all()

        processed = 0
        errors = 0
        for exec_ in execs:
            try:
                with session_factory(target) as sess:
                    assign_groups(exec_._id, exec_.meta or {}, sess)
                processed += 1
            except Exception as err:
                errors += 1
                print(f"[backfill] exec_id={exec_._id}: {err}")

        return jsonify({"processed": processed, "errors": errors})
