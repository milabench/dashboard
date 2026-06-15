"""Scheduled Slurm jobs — CRUD endpoints and periodic scheduler."""

from __future__ import annotations

from datetime import datetime
import logging
import traceback

from flask import request, jsonify
from sqlalchemy import select
from sqlalchemy.orm import Session

from milabench.metrics.sqlalchemy import SQLAlchemy

from ..database.scheduled_job import ScheduledJob, ScheduledJobRun
from ..utils import database_uri

log = logging.getLogger("scheduled_jobs")
log.setLevel(logging.DEBUG)
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[scheduled_jobs] %(message)s"))
    _h.stream = __import__("sys").stderr
    log.addHandler(_h)


def _compute_next_run(cron_expr: str, base_time: datetime | None = None) -> datetime | None:
    from croniter import croniter
    if not croniter.is_valid(cron_expr):
        return None
    base = base_time or datetime.utcnow()
    return croniter(cron_expr, base).get_next(datetime)


def scheduled_jobs_routes(app, cache):
    """Register scheduled-job CRUD routes and the periodic checker."""

    DATABASE_URI = database_uri()

    def _sqlexec():
        from contextlib import contextmanager

        @contextmanager
        def ctx():
            with SQLAlchemy(DATABASE_URI) as logger:
                with Session(logger.client) as sess:
                    yield sess
        return ctx()

    @app.route('/api/slurm/scheduled/list')
    def api_scheduled_list():
        with _sqlexec() as sess:
            rows = sess.execute(
                select(ScheduledJob).order_by(ScheduledJob._id.desc())
            ).scalars().all()
            return jsonify([r.as_dict() for r in rows])

    @app.route('/api/slurm/scheduled/create', methods=['POST'])
    def api_scheduled_create():
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        name = data.get("name", "").strip()
        cron_expression = data.get("cron_expression", "").strip()
        script = data.get("script", "").strip()

        if not name:
            return jsonify({"error": "name is required"}), 400
        if not cron_expression:
            return jsonify({"error": "cron_expression is required"}), 400
        if not script:
            return jsonify({"error": "script is required"}), 400

        next_run = _compute_next_run(cron_expression)
        if next_run is None:
            return jsonify({"error": "Invalid cron expression"}), 400

        job = ScheduledJob(
            name=name,
            enabled=data.get("enabled", True),
            cron_expression=cron_expression,
            cluster=data.get("cluster", "mila"),
            script=script,
            sbatch_args=data.get("sbatch_args", []),
            job_name_prefix=data.get("job_name_prefix"),
            next_run_time=next_run,
        )

        with _sqlexec() as sess:
            sess.add(job)
            sess.commit()
            result = job.as_dict()

        return jsonify(result), 201

    @app.route('/api/slurm/scheduled/<int:job_id>', methods=['PUT'])
    def api_scheduled_update(job_id):
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        with _sqlexec() as sess:
            job = sess.get(ScheduledJob, job_id)
            if not job:
                return jsonify({"error": "Not found"}), 404

            if "name" in data:
                job.name = data["name"].strip()
            if "cron_expression" in data:
                cron = data["cron_expression"].strip()
                next_run = _compute_next_run(cron)
                if next_run is None:
                    return jsonify({"error": "Invalid cron expression"}), 400
                job.cron_expression = cron
                job.next_run_time = next_run
            if "cluster" in data:
                job.cluster = data["cluster"]
            if "script" in data:
                job.script = data["script"]
            if "sbatch_args" in data:
                job.sbatch_args = data["sbatch_args"]
            if "job_name_prefix" in data:
                job.job_name_prefix = data["job_name_prefix"]
            if "enabled" in data:
                job.enabled = data["enabled"]

            job.modified_time = datetime.utcnow()
            sess.commit()
            result = job.as_dict()

        return jsonify(result)

    @app.route('/api/slurm/scheduled/<int:job_id>', methods=['DELETE'])
    def api_scheduled_delete(job_id):
        with _sqlexec() as sess:
            job = sess.get(ScheduledJob, job_id)
            if not job:
                return jsonify({"error": "Not found"}), 404
            sess.delete(job)
            sess.commit()
        return jsonify({"status": "deleted"})

    @app.route('/api/slurm/scheduled/<int:job_id>/toggle', methods=['POST'])
    def api_scheduled_toggle(job_id):
        with _sqlexec() as sess:
            job = sess.get(ScheduledJob, job_id)
            if not job:
                return jsonify({"error": "Not found"}), 404
            job.enabled = not job.enabled
            if job.enabled and not job.next_run_time:
                job.next_run_time = _compute_next_run(job.cron_expression)
            job.modified_time = datetime.utcnow()
            sess.commit()
            result = job.as_dict()
        return jsonify(result)

    @app.route('/api/slurm/scheduled/<int:job_id>/run-now', methods=['POST'])
    def api_scheduled_run_now(job_id):
        with _sqlexec() as sess:
            job = sess.get(ScheduledJob, job_id)
            if not job:
                return jsonify({"error": "Not found"}), 404
            result = _submit_scheduled_job(sess, job)
        return jsonify(result)

    @app.route('/api/slurm/scheduled/<int:job_id>/runs')
    def api_scheduled_runs(job_id):
        with _sqlexec() as sess:
            rows = sess.execute(
                select(ScheduledJobRun)
                .where(ScheduledJobRun.scheduled_job_id == job_id)
                .order_by(ScheduledJobRun.submitted_at.desc())
                .limit(50)
            ).scalars().all()
            return jsonify([r.as_dict() for r in rows])

    def _submit_scheduled_job(sess: Session, job: ScheduledJob) -> dict:
        """Submit a scheduled job by calling the core submit function directly."""
        now = datetime.utcnow()
        run = ScheduledJobRun(scheduled_job_id=job._id, submitted_at=now)
        success = False

        try:
            result = app._do_slurm_submit({
                "script": job.script,
                "job_name": job.job_name_prefix or job.name,
                "cluster": job.cluster,
                "sbatch_args": list(job.sbatch_args or []),
            })

            if result.get("success"):
                run.jr_job_id = result.get("jr_job_id")
                run.slurm_job_id = result.get("job_id")
                run.status = "submitted"
                success = True
                log.info("Submitted '%s' -> slurm_id=%s, jr_id=%s", job.name, run.slurm_job_id, run.jr_job_id)
            else:
                run.status = "failed"
                run.error = result.get("error", "unknown error")
                log.warning("Submit failed for '%s': %s", job.name, run.error)

        except Exception as exc:
            run.status = "failed"
            run.error = traceback.format_exc()
            log.error("Submit exception for '%s': %s", job.name, exc, exc_info=True)

        if success:
            job.last_run_time = now
            job.last_job_id = run.jr_job_id
            job.next_run_time = _compute_next_run(job.cron_expression)
        else:
            log.info("Keeping next_run_time=%s for '%s' (will retry)", job.next_run_time, job.name)

        job.modified_time = now
        sess.add(run)
        sess.commit()

        return run.as_dict()

    def _check_scheduled_jobs():
        """Periodic checker: submit any jobs that are due."""
        log.info("Checker tick")
        try:
            now = datetime.utcnow()
            with _sqlexec() as sess:
                null_jobs = sess.execute(
                    select(ScheduledJob).where(
                        ScheduledJob.enabled == True,
                        ScheduledJob.next_run_time == None,
                    )
                ).scalars().all()

                for job in null_jobs:
                    nrt = _compute_next_run(job.cron_expression)
                    if nrt:
                        log.info("Fixed NULL next_run_time for '%s' -> %s", job.name, nrt)
                        job.next_run_time = nrt
                if null_jobs:
                    sess.commit()

                due_jobs = sess.execute(
                    select(ScheduledJob).where(
                        ScheduledJob.enabled == True,
                        ScheduledJob.next_run_time <= now,
                    )
                ).scalars().all()

                log.info("Checked: %d due job(s) at %s", len(due_jobs), now.isoformat())

                for job in due_jobs:
                    log.info("Submitting: '%s' (next_run_time=%s)", job.name, job.next_run_time)
                    try:
                        _submit_scheduled_job(sess, job)
                        log.info("Done: '%s' -> next=%s", job.name, job.next_run_time)
                    except Exception as exc:
                        log.error("Error submitting %s: %s", job.name, exc, exc_info=True)
        except Exception as exc:
            log.error("Checker error: %s", exc, exc_info=True)

    app.scheduler.add_job(
        _check_scheduled_jobs,
        'interval',
        seconds=60,
        id='check_scheduled_jobs',
    )
    log.info("Periodic checker registered (60s interval, running now).")
    _check_scheduled_jobs()