"""Scheduled promotion of embargoed runs to public visibility."""

import logging

from dashboard.server.visibility import release_due_runs

log = logging.getLogger("embargo")


def check_embargo_releases(database):
    """Promote private runs whose release_at has passed."""
    try:
        with database.connect() as sess:
            count = release_due_runs(sess)
            if count:
                sess.commit()
                log.info("Released %s embargoed run(s) to public", count)
            return count
    except Exception as err:
        log.warning("Embargo release check failed: %s", err)
        return 0


def register_embargo_scheduler(app, database):
    """Register periodic embargo release with the app scheduler."""
    scheduler = getattr(app, "scheduler", None)
    if scheduler is None:
        return

    def _job():
        check_embargo_releases(database)

    scheduler.add_job(
        _job,
        "interval",
        minutes=5,
        id="embargo_release",
        replace_existing=True,
    )

    # Run once at startup
    _job()
