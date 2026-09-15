"""Experimental: scaling data computed from real pushed runs (DEV only).

See ``scaling_live_compute.py`` for the aggregation logic. Kept off the
public/admin tiers until the batch-size/GPU-name heuristics it relies on
are proven out — see that module's docstring for the known caveats.
"""

from flask import jsonify, request
from sqlalchemy import select

from .database.scaling_live import LiveScalingObservation


def scaling_live_routes(bp, sqlexec):
    @bp.route("/api/scaling-live", methods=["GET"])
    def api_scaling_live():
        gpus = request.args.getlist("gpus")
        benches = request.args.getlist("benches")
        stmt = select(LiveScalingObservation)
        if gpus:
            stmt = stmt.where(LiveScalingObservation.gpu.in_(gpus))
        if benches:
            stmt = stmt.where(LiveScalingObservation.bench.in_(benches))
        stmt = stmt.order_by(
            LiveScalingObservation.gpu,
            LiveScalingObservation.bench,
            LiveScalingObservation.batch_size,
        )
        with sqlexec() as sess:
            rows = sess.execute(stmt).scalars().all()
        return jsonify([r.as_api_dict() for r in rows])

    @bp.route("/api/scaling-live/status", methods=["GET"])
    def api_scaling_live_status():
        with sqlexec() as sess:
            rows = sess.execute(select(LiveScalingObservation)).scalars().all()
        if not rows:
            return jsonify({"n_points": 0, "gpus": [], "benches": [], "last_computed": None})
        return jsonify({
            "n_points": len(rows),
            "gpus": sorted({r.gpu for r in rows}),
            "benches": sorted({r.bench for r in rows}),
            "last_computed": max(
                (r.computed_at.isoformat() for r in rows if r.computed_at), default=None
            ),
        })

    @bp.route("/api/scaling-live/refresh", methods=["POST"])
    def api_scaling_live_refresh():
        from .scaling_live_compute import compute_live_scaling

        body = request.get_json(silent=True) or {}
        benches = body.get("benches") or None

        with sqlexec() as sess:
            try:
                summary = compute_live_scaling(sess, benches=benches)
            except Exception as err:
                return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify({"status": "OK", **summary})
