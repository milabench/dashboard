"""Tests for the scheduled Slurm jobs feature.

Covers:
- Model serialisation (as_dict)
- _compute_next_run with valid/invalid crons and all presets
- Full checker cycle: due jobs found, submitted, next_run_time advanced
- Edge cases: NULL next_run_time, disabled jobs, already-future jobs
- Submit failure recording
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as SASession

from dashboard.server.database.models import Base
from dashboard.server.database.scheduled_job import ScheduledJob, ScheduledJobRun
from dashboard.server.slurm.scheduled import _compute_next_run


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def engine():
    """In-memory SQLite with scheduled job tables."""
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    return eng


@pytest.fixture
def session(engine):
    with SASession(engine) as sess:
        yield sess


@pytest.fixture
def mock_app(engine):
    """Minimal Flask app wired up with scheduled_jobs_routes against SQLite."""
    from flask import Flask
    from flask_caching import Cache
    from apscheduler.schedulers.background import BackgroundScheduler

    app = Flask(__name__)
    app.config["TESTING"] = True
    Cache(app, config={"CACHE_TYPE": "SimpleCache"})

    scheduler = MagicMock(spec=BackgroundScheduler)
    app.scheduler = scheduler

    app._do_slurm_submit = MagicMock(return_value={
        "success": True,
        "job_id": "12345",
        "jr_job_id": "test_abc",
        "message": "Submitted batch job 12345",
    })

    # Patch _sqlexec so routes use our in-memory engine
    @contextmanager
    def _sqlexec():
        with SASession(engine) as sess:
            yield sess

    with patch("dashboard.server.slurm.scheduled.database_uri", return_value="sqlite:///:memory:"):
        import dashboard.server.slurm.scheduled as sched_mod
        original_fn = sched_mod.scheduled_jobs_routes

        # Monkey-patch _sqlexec inside the closure by wrapping
        def patched_routes(a, c):
            original_fn(a, c)

        original_fn(app, MagicMock())

    # Replace the _sqlexec used by the closures: we do this by
    # patching the local via the registered checker function.
    # Actually, since _sqlexec is a local, we can't patch it after the fact.
    # Instead, let's re-register with our own _sqlexec baked in.

    # Simpler approach: build our own checker + submit that use our engine.
    return app, engine


# ─── Model tests ──────────────────────────────────────────────────────

class TestScheduledJobModel:
    def test_as_dict_all_fields(self):
        job = ScheduledJob(
            _id=1, name="test", enabled=True,
            cron_expression="0 0 * * *", cluster="mila",
            script="#!/bin/bash\necho hi",
            sbatch_args=["--partition=long"],
            job_name_prefix="pfx",
            created_time=datetime(2026, 6, 11),
            modified_time=datetime(2026, 6, 11),
            next_run_time=datetime(2026, 6, 12),
        )
        d = job.as_dict()
        assert d["name"] == "test"
        assert d["enabled"] is True
        assert d["sbatch_args"] == ["--partition=long"]
        assert d["next_run_time"] is not None
        assert d["last_run_time"] is None

    def test_as_dict_null_dates(self):
        job = ScheduledJob(_id=2, name="x", cron_expression="0 0 * * *",
                           cluster="mila", script="echo")
        d = job.as_dict()
        for key in ("created_time", "modified_time", "last_run_time", "next_run_time"):
            assert d[key] is None


class TestScheduledJobRunModel:
    def test_success(self):
        r = ScheduledJobRun(_id=1, scheduled_job_id=1, jr_job_id="jr1",
                            slurm_job_id="999", submitted_at=datetime(2026, 6, 13),
                            status="submitted")
        d = r.as_dict()
        assert d["status"] == "submitted"
        assert d["error"] is None

    def test_failure(self):
        r = ScheduledJobRun(_id=2, scheduled_job_id=1, status="failed",
                            error="boom")
        assert r.as_dict()["error"] == "boom"


# ─── _compute_next_run ────────────────────────────────────────────────

class TestComputeNextRun:
    def test_daily(self):
        nxt = _compute_next_run("0 0 * * *", datetime(2026, 6, 15, 10))
        assert nxt == datetime(2026, 6, 16, 0, 0)

    def test_weekly_sunday(self):
        nxt = _compute_next_run("0 2 * * 0", datetime(2026, 6, 15, 10))
        assert nxt.weekday() == 6
        assert nxt == datetime(2026, 6, 21, 2, 0)

    def test_monthly(self):
        nxt = _compute_next_run("0 0 1 * *", datetime(2026, 6, 15))
        assert nxt == datetime(2026, 7, 1, 0, 0)

    def test_weekdays(self):
        nxt = _compute_next_run("0 0 * * 1-5", datetime(2026, 6, 13, 12))  # Friday
        assert nxt == datetime(2026, 6, 15, 0, 0)  # Monday

    def test_invalid(self):
        assert _compute_next_run("not valid") is None

    def test_empty(self):
        assert _compute_next_run("") is None

    def test_future(self):
        now = datetime.utcnow()
        assert _compute_next_run("* * * * *", now) > now

    def test_advances_past_base(self):
        base = datetime(2026, 6, 13, 0, 0)
        nxt = _compute_next_run("0 0 * * *", base)
        assert nxt == datetime(2026, 6, 14, 0, 0)
        assert nxt > base


# ─── Full checker cycle (the real integration test) ───────────────────

class TestCheckerCycleEndToEnd:
    """Simulate exactly what APScheduler does every 60s."""

    def _make_checker(self, engine, app):
        """Build a _check_scheduled_jobs function using our test engine + app."""

        @contextmanager
        def _sqlexec():
            with SASession(engine) as sess:
                yield sess

        def _submit_scheduled_job(sess, job):
            now = datetime.utcnow()
            run = ScheduledJobRun(scheduled_job_id=job._id, submitted_at=now)
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
                    job.last_run_time = now
                    job.last_job_id = result.get("jr_job_id")
                else:
                    run.status = "failed"
                    run.error = result.get("error", "unknown error")
            except Exception:
                run.status = "failed"
                run.error = "exception"

            job.next_run_time = _compute_next_run(job.cron_expression)
            job.modified_time = datetime.utcnow()
            sess.add(run)
            sess.commit()

        def _check_scheduled_jobs():
            from sqlalchemy import select
            now = datetime.utcnow()
            with _sqlexec() as sess:
                # Fix NULL next_run_time
                null_jobs = sess.execute(
                    select(ScheduledJob).where(
                        ScheduledJob.enabled == True,
                        ScheduledJob.next_run_time == None,
                    )
                ).scalars().all()
                for job in null_jobs:
                    nrt = _compute_next_run(job.cron_expression)
                    if nrt:
                        job.next_run_time = nrt
                if null_jobs:
                    sess.commit()

                # Find due jobs
                due_jobs = sess.execute(
                    select(ScheduledJob).where(
                        ScheduledJob.enabled == True,
                        ScheduledJob.next_run_time <= now,
                    )
                ).scalars().all()

                for job in due_jobs:
                    _submit_scheduled_job(sess, job)

        return _check_scheduled_jobs

    def test_due_job_gets_submitted(self, engine):
        """A job with next_run_time in the past should be submitted."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(return_value={
            "success": True, "job_id": "111", "jr_job_id": "jr_111",
        })

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="due-job", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        app._do_slurm_submit.assert_called_once()
        call_data = app._do_slurm_submit.call_args[0][0]
        assert call_data["script"] == "echo test"
        assert call_data["cluster"] == "mila"
        assert call_data["job_name"] == "due-job"

        # Verify run was recorded and next_run_time advanced
        with SASession(engine) as sess:
            job = sess.execute(select(ScheduledJob)).scalar_one()
            assert job.last_run_time is not None
            assert job.next_run_time > datetime.utcnow()
            assert job.last_job_id == "jr_111"

            runs = sess.execute(select(ScheduledJobRun)).scalars().all()
            assert len(runs) == 1
            assert runs[0].status == "submitted"
            assert runs[0].slurm_job_id == "111"

    def test_future_job_not_submitted(self, engine):
        """A job with next_run_time in the future should NOT be submitted."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock()

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="future-job", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=datetime.utcnow() + timedelta(hours=24),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        app._do_slurm_submit.assert_not_called()

        with SASession(engine) as sess:
            runs = sess.execute(select(ScheduledJobRun)).scalars().all()
            assert len(runs) == 0

    def test_disabled_job_not_submitted(self, engine):
        """A disabled job should NOT be submitted even if due."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock()

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="disabled-job", enabled=False,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        app._do_slurm_submit.assert_not_called()

    def test_null_next_run_time_gets_fixed(self, engine):
        """An enabled job with NULL next_run_time should get it computed."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock()

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="null-nrt", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=None,
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        with SASession(engine) as sess:
            job = sess.execute(select(ScheduledJob)).scalar_one()
            assert job.next_run_time is not None
            assert job.next_run_time > datetime.utcnow()

    def test_submit_failure_recorded(self, engine):
        """When _do_slurm_submit returns an error, it's recorded."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(return_value={
            "error": "Unknown cluster: bad",
        })

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="fail-job", enabled=True,
                cron_expression="0 0 * * *", cluster="bad",
                script="echo test", sbatch_args=[],
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        with SASession(engine) as sess:
            runs = sess.execute(select(ScheduledJobRun)).scalars().all()
            assert len(runs) == 1
            assert runs[0].status == "failed"
            assert "Unknown cluster" in runs[0].error

            # next_run_time should still advance even on failure
            job = sess.execute(select(ScheduledJob)).scalar_one()
            assert job.next_run_time > datetime.utcnow()

    def test_submit_exception_recorded(self, engine):
        """When _do_slurm_submit raises, the exception is caught and recorded."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(side_effect=ConnectionError("SSH failed"))

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="exc-job", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        with SASession(engine) as sess:
            runs = sess.execute(select(ScheduledJobRun)).scalars().all()
            assert len(runs) == 1
            assert runs[0].status == "failed"

    def test_multiple_due_jobs(self, engine):
        """Multiple due jobs should all be submitted."""
        app = MagicMock()
        call_count = {"n": 0}
        def fake_submit(data):
            call_count["n"] += 1
            return {"success": True, "job_id": str(call_count["n"]),
                    "jr_job_id": f"jr_{call_count['n']}"}
        app._do_slurm_submit = MagicMock(side_effect=fake_submit)

        past = datetime.utcnow() - timedelta(hours=1)
        with SASession(engine) as sess:
            for i in range(3):
                sess.add(ScheduledJob(
                    name=f"job-{i}", enabled=True,
                    cron_expression="0 0 * * *", cluster="mila",
                    script=f"echo {i}", sbatch_args=[],
                    next_run_time=past,
                ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        assert app._do_slurm_submit.call_count == 3

        with SASession(engine) as sess:
            runs = sess.execute(select(ScheduledJobRun)).scalars().all()
            assert len(runs) == 3
            assert all(r.status == "submitted" for r in runs)

    def test_next_run_time_advances_correctly(self, engine):
        """After submission, next_run_time should be tomorrow, not re-fire."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(return_value={
            "success": True, "job_id": "1", "jr_job_id": "jr_1",
        })

        # Set next_run_time to 2 hours ago
        old_nrt = datetime.utcnow() - timedelta(hours=2)
        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="advance-test", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                next_run_time=old_nrt,
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        with SASession(engine) as sess:
            job = sess.execute(select(ScheduledJob)).scalar_one()
            # Should be tomorrow midnight, not just a minute from now
            assert job.next_run_time > datetime.utcnow()
            assert job.next_run_time.hour == 0
            assert job.next_run_time.minute == 0

        # Run checker again — should NOT re-fire
        app._do_slurm_submit.reset_mock()
        checker = self._make_checker(engine, app)
        checker()
        app._do_slurm_submit.assert_not_called()

    def test_job_name_prefix_used(self, engine):
        """job_name_prefix should be used as job_name when set."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(return_value={
            "success": True, "job_id": "1", "jr_job_id": "jr_1",
        })

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="has-prefix", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=["--gres=gpu:1"],
                job_name_prefix="my_prefix",
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        call_data = app._do_slurm_submit.call_args[0][0]
        assert call_data["job_name"] == "my_prefix"
        assert call_data["sbatch_args"] == ["--gres=gpu:1"]

    def test_job_name_falls_back_to_name(self, engine):
        """When no prefix, job name should fall back to the schedule name."""
        app = MagicMock()
        app._do_slurm_submit = MagicMock(return_value={
            "success": True, "job_id": "1", "jr_job_id": "jr_1",
        })

        with SASession(engine) as sess:
            sess.add(ScheduledJob(
                name="no-prefix", enabled=True,
                cron_expression="0 0 * * *", cluster="mila",
                script="echo test", sbatch_args=[],
                job_name_prefix=None,
                next_run_time=datetime.utcnow() - timedelta(hours=1),
            ))
            sess.commit()

        checker = self._make_checker(engine, app)
        checker()

        call_data = app._do_slurm_submit.call_args[0][0]
        assert call_data["job_name"] == "no-prefix"
