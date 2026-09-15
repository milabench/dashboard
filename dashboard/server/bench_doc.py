"""Per-benchmark "documentation" data (DEV only, experimental): a sample
command line, a VRAM-at-batch-size-10 estimate, and a typical runtime, built
on top of the scaling_observations_live cache (see scaling_live_compute.py),
Pack.command, and the "walltime" Metric written by writer.py::on_end.
Companion to BenchmarkHistoryView's performance-over-time chart — same
"pick a benchmark" concept, turned into a reference page.

Disk size requirements are deliberately not included: nothing in milabench
or the dashboard currently tracks dataset/weights disk usage, so there is
no real data to show yet.
"""

import statistics

from flask import jsonify
from sqlalchemy import desc, select

from .database.models import Exec, Metric, Pack, RunGroup, RunGroupMember
from .database.scaling_live import LiveScalingObservation
from .visibility import public_exec_filter, valid_pack_filter


def bench_doc_routes(bp, sqlexec):
    @bp.route("/api/bench/doc/<string:bench_name>")
    def api_bench_doc(bench_name):
        with sqlexec() as sess:
            sample = sess.execute(
                select(Pack.command, Pack.exec_id, Exec.created_time, Exec.meta)
                .join(Exec, Exec._id == Pack.exec_id)
                .where(
                    Pack.name == bench_name,
                    Pack.command.is_not(None),
                    public_exec_filter(),
                    valid_pack_filter(),
                )
                .order_by(desc(Exec.created_time))
                .limit(1)
            ).first()

            points = sess.execute(
                select(
                    LiveScalingObservation.gpu,
                    LiveScalingObservation.batch_size,
                    LiveScalingObservation.memory_mib,
                ).where(LiveScalingObservation.bench == bench_name)
            ).all()

            baseline_group_id = sess.execute(
                select(RunGroup._id).where(RunGroup.strategy == "config", RunGroup.label == "baseline")
            ).scalar()

            runtime_values = []
            if baseline_group_id is not None:
                runtime_values = sess.execute(
                    select(Metric.value)
                    .join(Pack, Pack._id == Metric.pack_id)
                    .where(
                        Pack.name == bench_name,
                        Metric.name == "walltime",
                        valid_pack_filter(),
                        Metric.exec_id.in_(
                            select(RunGroupMember.exec_id)
                            .join(Exec, Exec._id == RunGroupMember.exec_id)
                            .where(
                                RunGroupMember.group_id == baseline_group_id,
                                public_exec_filter(),
                            )
                        ),
                    )
                ).scalars().all()

        sample_command = None
        sample_gpu = None
        sample_exec_id = None
        if sample is not None:
            sample_command = sample.command
            sample_exec_id = sample.exec_id
            meta = sample.meta or {}
            sample_gpu = (
                (meta.get("accelerators") or {}).get("gpus", {}).get("0", {}).get("product")
            )

        # For each GPU, keep whichever cached point's batch_size is closest
        # to 10 (the observed sizes rarely land exactly on 10).
        closest_by_gpu: dict[str, tuple[int, float]] = {}
        for gpu, batch_size, memory in points:
            if memory is None:
                continue
            current = closest_by_gpu.get(gpu)
            if current is None or abs(batch_size - 10) < abs(current[0] - 10):
                closest_by_gpu[gpu] = (batch_size, memory)

        vram = sorted(
            (
                {"gpu": gpu, "batch_size": bs, "memory": mem}
                for gpu, (bs, mem) in closest_by_gpu.items()
            ),
            key=lambda row: row["memory"],
        )
        vram_min = vram[0] if vram else None

        runtime_median_seconds = statistics.median(runtime_values) if runtime_values else None

        return jsonify({
            "bench": bench_name,
            "sample_command": sample_command,
            "sample_gpu": sample_gpu,
            "sample_exec_id": sample_exec_id,
            "vram": vram,
            "vram_min": vram_min,
            "runtime_median_seconds": runtime_median_seconds,
            "runtime_samples": len(runtime_values),
        })
