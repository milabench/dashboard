"""GPU specification API routes.

Provides endpoints to query GPU theoretical specs and link them to
benchmark results:

  GET  /api/gpu/specs              - list all GPU specs
  GET  /api/gpu/specs/<name>       - get a single GPU spec by name
  GET  /api/gpu/specs/search       - search GPUs (?vendor=, ?arch=, ?min_memgb=)
  GET  /api/gpu/specs/evolution    - flat records for compute progression plots
  POST /api/gpu/specs/seed         - seed the database with IGUANE data (dev only)
  POST /api/gpu/specs              - add or update a GPU spec (dev only)
  GET  /api/gpu/specs/match/<name> - find the best-matching spec for a detected GPU name
  GET  /html/gpu/evolution         - Altair chart: compute progression over time
"""

from flask import jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database.gpu import GPU, seed_gpus, _gpu_to_row, _ROW_FIELDS


def _gpu_to_json(gpu):
    d = gpu.as_dict()
    d["release_date"] = gpu.release_date
    return d


def _normalize_gpu_name(detected: str) -> str:
    """Best-effort normalization of GPU product names reported by drivers.

    E.g. ``"NVIDIA A100-SXM4-80GB"`` -> ``"A100-SXM4-80GB"``.
    """
    name = detected.strip().strip('"').strip("'")
    for prefix in ("NVIDIA ", "AMD ", "nvidia ", "amd "):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name


def gpu_specs_routes(app, sqlexec, dev_only):
    """Register GPU specification endpoints on the Flask app."""

    @app.route("/api/gpu/specs")
    def api_gpu_specs_list():
        """List all GPU specs."""
        with sqlexec() as sess:
            rows = sess.execute(
                select(GPU).order_by(GPU.release_date, GPU.name)
            ).scalars().all()
            return jsonify([_gpu_to_json(g) for g in rows])

    @app.route("/api/gpu/specs/<string:name>")
    def api_gpu_specs_get(name):
        """Get a single GPU spec by exact name."""
        with sqlexec() as sess:
            gpu = sess.execute(
                select(GPU).where(GPU.name == name)
            ).scalar_one_or_none()
            if gpu is None:
                return jsonify({"error": f"GPU '{name}' not found"}), 404
            return jsonify(_gpu_to_json(gpu))

    @app.route("/api/gpu/specs/search")
    def api_gpu_specs_search():
        """Search GPUs by vendor, architecture, or minimum memory.

        Query params: vendor, arch, min_memgb, min_fp16, min_fp32
        """
        stmt = select(GPU)

        vendor = request.args.get("vendor")
        arch = request.args.get("arch")
        min_memgb = request.args.get("min_memgb", type=float)
        min_fp16 = request.args.get("min_fp16", type=float)
        min_fp32 = request.args.get("min_fp32", type=float)

        if vendor:
            stmt = stmt.where(GPU.vendor == vendor)
        if arch:
            stmt = stmt.where(GPU.architecture == arch)
        if min_memgb is not None:
            stmt = stmt.where(GPU.memgb >= min_memgb)
        if min_fp16 is not None:
            stmt = stmt.where(GPU.fp16 >= min_fp16)
        if min_fp32 is not None:
            stmt = stmt.where(GPU.fp32 >= min_fp32)

        stmt = stmt.order_by(GPU.fp16.desc().nullslast())

        with sqlexec() as sess:
            rows = sess.execute(stmt).scalars().all()
            return jsonify([_gpu_to_json(g) for g in rows])

    @app.route("/api/gpu/specs/match/<string:detected_name>")
    def api_gpu_specs_match(detected_name):
        """Find the best-matching GPU spec for a detected product name.

        Tries exact match first, then substring match.
        """
        normalized = _normalize_gpu_name(detected_name)

        with sqlexec() as sess:
            gpu = sess.execute(
                select(GPU).where(GPU.name == normalized)
            ).scalar_one_or_none()

            if gpu is None:
                rows = sess.execute(
                    select(GPU).where(GPU.name.ilike(f"%{normalized}%"))
                ).scalars().all()
                if len(rows) == 1:
                    gpu = rows[0]
                elif len(rows) > 1:
                    return jsonify({
                        "match": "ambiguous",
                        "candidates": [_gpu_to_json(g) for g in rows],
                    })

            if gpu is None:
                return jsonify({"match": "none", "query": normalized}), 404

            return jsonify({"match": "exact", "gpu": _gpu_to_json(gpu)})

    @app.route("/api/gpu/specs/seed", methods=["POST"])
    @dev_only
    def api_gpu_specs_seed():
        """Seed the GPU database from built-in IGUANE data."""
        with sqlexec() as sess:
            count = seed_gpus(sess)
            return jsonify({"status": "ok", "seeded": count})

    @app.route("/api/gpu/specs", methods=["POST"])
    @dev_only
    def api_gpu_specs_upsert():
        """Add or update a GPU spec.

        JSON body::

            {
                "name": "B200-NVL",
                "vendor": "nvidia",
                "architecture": "Blackwell",
                "specs": {"fp16": 2250, "fp32": 140, ...}
            }
        """
        data = request.json
        if not data or "name" not in data or "specs" not in data:
            return jsonify({"error": "name and specs are required"}), 400

        raw = data["specs"]
        gpu = GPU.from_spec(
            data["name"],
            raw,
            vendor=data.get("vendor", "nvidia"),
            architecture=data.get("architecture"),
        )

        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = pg_insert(GPU).values(**_gpu_to_row(gpu))
        stmt = stmt.on_conflict_do_update(
            index_elements=["name"],
            set_={k: getattr(stmt.excluded, k) for k in _ROW_FIELDS},
        )

        with sqlexec() as sess:
            sess.execute(stmt)
            sess.commit()

        return jsonify({"status": "ok", "name": gpu.name})

    @app.route("/api/gpu/specs/evolution")
    def api_gpu_specs_evolution():
        """Flat records of GPU specs for compute-progression plots.

        Each row contains release_date, vendor, architecture, and all
        numeric perf values plus derived perf-per-watt columns.

        Query params:
            vendor  - filter by vendor (nvidia, amd)
        """
        stmt = select(GPU).where(GPU.release_date.isnot(None))

        vendor = request.args.get("vendor")
        if vendor:
            stmt = stmt.where(GPU.vendor == vendor)

        stmt = stmt.order_by(GPU.release_date)

        with sqlexec() as sess:
            rows = sess.execute(stmt).scalars().all()

        records = []
        for gpu in rows:
            fp4  = gpu.fp4
            fp8  = gpu.fp8
            fp16 = gpu.fp16 if gpu.fp16 is not None else gpu.fp32
            fp32 = gpu.fp32
            fp64 = gpu.fp64
            tf32 = gpu.tf32 if gpu.tf32 is not None else gpu.fp32
            tdp  = gpu.tdp or 1

            def _per_watt(v):
                return v / tdp if v else None

            rec = {
                "name": gpu.name,
                "vendor": gpu.vendor,
                "architecture": gpu.architecture or "unknown",
                "release": gpu.release_date,
                "fp4": fp4,
                "fp8": fp8,
                "fp16": fp16,
                "fp32": fp32,
                "fp64": fp64,
                "tf32": tf32,
                "memgb": gpu.memgb,
                "membw": gpu.membw,
                "tdp": gpu.tdp,
                "fp4_per_watt":  _per_watt(fp4),
                "fp8_per_watt":  _per_watt(fp8),
                "fp16_per_watt": _per_watt(fp16),
                "fp32_per_watt": _per_watt(fp32),
                "fp64_per_watt": _per_watt(fp64),
                "tf32_per_watt": _per_watt(tf32),
                "membw_per_watt": _per_watt(gpu.membw),
            }
            records.append(rec)

        return jsonify(records)

    @app.route("/html/gpu/evolution")
    def html_gpu_evolution():
        """Interactive Altair chart: GPU compute progression over time.

        Inspired by the taranis visualization.
        """
        import altair as alt
        from .utils import plot

        vendor_filter = request.args.get("vendor", "")
        url = "/api/gpu/specs/evolution"
        if vendor_filter:
            url += f"?vendor={vendor_filter}"

        def _perf_evolution(measure, title):
            base = alt.Chart(url, title=title)

            points = base.mark_circle(size=60).encode(
                x=alt.X("release:T", title="Release Date"),
                y=alt.Y(f"{measure}:Q", title="TFLOPS", scale=alt.Scale(zero=False, type="log")),
                color=alt.Color("vendor:N"),
                tooltip=[
                    alt.Tooltip("name:N", title="GPU"),
                    alt.Tooltip(f"{measure}:Q", title="TFLOPS", format=".2f"),
                    alt.Tooltip("release:T", title="Release"),
                    alt.Tooltip("architecture:N", title="Arch"),
                    alt.Tooltip("tdp:Q", title="TDP (W)"),
                ],
            )

            text = base.mark_text(
                align="left", baseline="middle",
                dx=7, dy=-5, fontSize=9, angle=-30,
            ).encode(
                x=alt.X("release:T"),
                y=alt.Y(f"{measure}:Q", scale=alt.Scale(zero=False, type="log")),
                text="name:N",
                color="vendor:N",
            )

            return (points + text).properties(width=450, height=350)

        def _perf_per_watt(measure, title):
            pw = f"{measure}_per_watt"
            base = alt.Chart(url, title=title)

            points = base.mark_circle(size=60).encode(
                x=alt.X("release:T", title="Release Date"),
                y=alt.Y(f"{pw}:Q", title="TFLOPS/W", scale=alt.Scale(zero=False, type="log")),
                color=alt.Color("vendor:N"),
                tooltip=[
                    alt.Tooltip("name:N", title="GPU"),
                    alt.Tooltip(f"{pw}:Q", title="TFLOPS/W", format=".4f"),
                    alt.Tooltip(f"{measure}:Q", title="TFLOPS", format=".2f"),
                    alt.Tooltip("tdp:Q", title="TDP (W)"),
                    alt.Tooltip("release:T", title="Release"),
                ],
            )

            text = base.mark_text(
                align="left", baseline="middle",
                dx=7, dy=-5, fontSize=9, angle=-30,
            ).encode(
                x=alt.X("release:T"),
                y=alt.Y(f"{pw}:Q", scale=alt.Scale(zero=False, type="log")),
                text="name:N",
                color="vendor:N",
            )

            return (points + text).properties(width=450, height=350)

        fp64   = _perf_evolution("fp64", "FP64 (TFLOPS)")
        fp32   = _perf_evolution("fp32", "FP32 (TFLOPS)")
        tf32   = _perf_evolution("tf32", "TF32 (TFLOPS)")
        fp16   = _perf_evolution("fp16", "FP16 Tensor (TFLOPS)")
        fp8    = _perf_evolution("fp8",  "FP8 (TFLOPS)")
        fp4    = _perf_evolution("fp4",  "FP4 (TFLOPS)")

        fp64_w = _perf_per_watt("fp64", "FP64 / Watt")
        fp32_w = _perf_per_watt("fp32", "FP32 / Watt")
        tf32_w = _perf_per_watt("tf32", "TF32 / Watt")
        fp16_w = _perf_per_watt("fp16", "FP16 Tensor / Watt")
        fp8_w  = _perf_per_watt("fp8",  "FP8 / Watt")
        fp4_w  = _perf_per_watt("fp4",  "FP4 / Watt")

        membw  = _perf_evolution("membw", "Memory BW (GB/s)")
        membw_w = _perf_per_watt("membw", "Memory BW / Watt")
        memgb  = _perf_evolution("memgb", "Memory (GB)")

        chart = (
            (fp64 | fp32 | tf32 | fp16 | fp8 | fp4) &
            (fp64_w | fp32_w | tf32_w | fp16_w | fp8_w | fp4_w) &
            (membw | membw_w | memgb)
        ).resolve_scale(
            y="independent"
        )

        return plot(chart.to_json())
