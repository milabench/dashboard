"""Token-based access to private runs (obfuscated URLs, no exec id)."""

from flask import jsonify, request

import sqlalchemy
from sqlalchemy import select

from dashboard.server.database.models import Metric, Pack
from dashboard.server.visibility import lookup_by_share_token


def share_routes(app, sqlexec):
    HIDDEN_METRICS = [
        "__iter__",
        "iter_create",
        "iter_start",
        "iter_end",
        "total_elapsed",
        "return_code",
        "status",
        "walltime",
    ]

    def _exclude_hidden(stmt):
        stmt = stmt.where(Metric.name.notin_(HIDDEN_METRICS))
        stmt = stmt.where(~Metric.name.like("process.%"))
        return stmt

    def _not_found():
        return jsonify({"error": "Not found"}), 404

    @app.route("/api/share/<share_token>")
    def api_share_show(share_token):
        with sqlexec() as sess:
            exec_row = lookup_by_share_token(sess, share_token)
            if exec_row is None:
                return _not_found()
            return jsonify(exec_row.as_dict(include_private_fields=True))

    @app.route("/api/share/<share_token>/packs")
    def api_share_packs(share_token):
        with sqlexec() as sess:
            exec_row = lookup_by_share_token(sess, share_token)
            if exec_row is None:
                return _not_found()

            stmt = sqlalchemy.select(Pack).where(Pack.exec_id == exec_row._id)
            results = []
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())
            return jsonify(results)

    @app.route("/api/share/<share_token>/packs/<int:pack_id>/metrics")
    def api_share_pack_metrics(share_token, pack_id):
        with sqlexec() as sess:
            exec_row = lookup_by_share_token(sess, share_token)
            if exec_row is None:
                return _not_found()

            stmt = sqlalchemy.select(Metric).where(
                Metric.exec_id == exec_row._id,
                Metric.pack_id == pack_id,
            )
            stmt = _exclude_hidden(stmt)
            results = []
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())
            return results

    @app.route("/api/share/<share_token>/packs/<string:pack_name>/metrics")
    def api_share_pack_summary_metrics(share_token, pack_name):
        with sqlexec() as sess:
            exec_row = lookup_by_share_token(sess, share_token)
            if exec_row is None:
                return _not_found()

            stmt = (
                sqlalchemy.select(Metric)
                .where(
                    Metric.exec_id == exec_row._id,
                    Pack.name.startswith(pack_name),
                )
                .join(Pack, Metric.pack_id == Pack._id)
            )
            stmt = _exclude_hidden(stmt)
            results = []
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())
            return jsonify(results)

    @app.route("/api/share/<share_token>/report/fast")
    def api_share_report_fast(share_token):
        from .plot import sql_direct_report
        from .report_cache import get_cached_report, store_report, _table_exists
        from .utils import cursor_to_json, make_selection_key
        from dashboard.server.visibility import is_public

        with sqlexec() as sess:
            exec_row = lookup_by_share_token(sess, share_token)
            if exec_row is None:
                return _not_found()
            exec_id = str(exec_row._id)
            exec_is_public = is_public(exec_row)

        profile = request.cookies.get("scoreProfile") or "default"
        drop_min_max = request.args.get("drop_min_max", "true").lower() == "true"
        more_raw = filter(lambda x: x != "", request.args.get("more", "").split(","))
        more = [make_selection_key(key) for key in more_raw]

        can_cache = not more and drop_min_max and exec_is_public

        if can_cache:
            with sqlexec() as sess:
                if _table_exists(sess):
                    cached = get_cached_report(sess, exec_id, profile)
                    if cached is not None:
                        return jsonify(cached)

        with sqlexec() as sess:
            stmt = sql_direct_report([exec_id], profile=profile, drop_min_max=drop_min_max, more=more)
            cursor = sess.execute(stmt)
            results = cursor_to_json(cursor)

        if can_cache and results:
            try:
                with sqlexec() as sess:
                    if _table_exists(sess):
                        store_report(sess, exec_id, profile, results)
            except Exception as err:
                print(f"[report_cache] Could not store cache: {err}")

        return jsonify(results)
