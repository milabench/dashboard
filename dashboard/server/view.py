from io import StringIO
import os
import json
from collections import defaultdict
import base64
from datetime import datetime
import importlib_resources

import pandas as pd
from flask import Flask, jsonify, render_template_string, render_template, send_file, send_from_directory
from flask_caching import Cache
from flask import request
from flask_socketio import SocketIO, emit
import sqlalchemy
from sqlalchemy import select, func, cast, TEXT

from dashboard.server.database.models import Exec, Metric, Pack, Weight, SavedQuery
from dashboard.server.report_data import fetch_data, make_pivot_summary, fetch_data_by_id
from milabench.report import make_report

from .db import Database
from .plot import (
    pivot_query,
    apply_pivot_statement_timeout,
    is_statement_timeout,
    PIVOT_TIMEOUT_MS,
)
from .utils import database_uri, page, make_selection_key, make_filters, cursor_to_json, cursor_to_dataframe
from .slurm import slurm_integration
from .realtime import metric_receiver, set_socketio_instance
from .push import push_routes
from .report import datafile_processor
from .metal import baremetal_server
from .sync import sync_routes


def _get_version():
    """Return git commit SHAs for dashboard and milabench."""
    dashboard_sha = os.environ.get("DASHBOARD_COMMIT")
    milabench_sha = os.environ.get("MILABENCH_COMMIT")

    if dashboard_sha or milabench_sha:
        return {
            "dashboard": dashboard_sha or "unknown",
            "milabench": milabench_sha or "unknown",
        }

    import subprocess
    result = {}
    for name, path in [("dashboard", os.path.join(os.getcwd())), ("milabench", None)]:
        try:
            if name == "milabench":
                import milabench
                path = os.path.dirname(os.path.dirname(milabench.__file__))
            sha = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=path, stderr=subprocess.DEVNULL
            ).decode().strip()
            result[name] = sha
        except Exception:
            result[name] = "unknown"
    return result


class MultiIndexFormater:
    """Format a dataframe using the last element on a multi index"""
    def __init__(self, df, default_float="{:.2f}".format):
        self.df = df
        self.default = default_float
        self.style = {
            "gpu.load": "{:.2%}".format,
            "gpu.memory": "{:.2%}".format,
            "gpu.power": "{:.2f}".format,
            "gpu.temperature": "{:.2f}".format,
            "loss": "{:.2f}".format,
            "walltime": "{:.2f}".format,
            "rate": "{:.2f}".format,
            "return_code": "{:.0f}".format,
            "memory_peak": "{:.0f}".format,
        }

    def __len__(self):
        return len(self.df.columns)

    def get(self, item, default=None):
        for col in item:
            if col in self.style:
                return self.style.get(col)

        if isinstance(item, str):
            return default

        return self.default


def gradient(x, mn, mx):
    import numpy as np

    c1 = np.array([255, 0, 0])
    c2 = np.array([255, 255, 255])
    c3 = np.array([0, 255, 0])

    pct = (x - mn) / (mx - mn)

    if pct < 0.5:
        t = pct / 0.5
        return (1 - t) * c1 + t * c2

    else:
        t = (pct - 0.5) / 0.5
        return (1 - t) * c2 + t * c3


def conditional_format(v, props=''):
    color = gradient(v, mn=0.5, mx=1.5)
    return f"background: rgb({color[0]}, {color[1]}, {color[2]})"


def pandas_to_html(df, default_float="{:.2f}".format):
    fmt = MultiIndexFormater(df, default_float=default_float)

    table = df.to_html(
        formatters=fmt,
        classes=["table", "table-striped", "table-hover", "table-sm"],
        na_rep="",
        justify="right"
    )

    return page("df", table, more_css="""
        .table {
            width: auto;
        }
    """)


def pandas_to_html_relative(df, default_float="{:.2f}".format):
    table = (df.style
        .map(conditional_format)
        .format(precision=2, thousands="'", decimal=".")
        .set_table_attributes("class='table table-striped table-hover table-sm'")
        .to_html()
    )

    return page("df", table, more_css="""
        .table {
            width: auto;
        }
    """)



def _alembic_config(database_url):
    """Build an Alembic Config pointing at dashboard/alembic.ini."""
    from pathlib import Path

    from alembic.config import Config

    # dashboard/server/view.py -> package root dashboard/
    pkg_root = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(pkg_root / "alembic.ini"))
    url_str = (
        database_url.render_as_string(hide_password=False)
        if hasattr(database_url, "render_as_string")
        else str(database_url)
    )
    alembic_cfg.set_main_option("sqlalchemy.url", url_str)
    return alembic_cfg


def _run_migrations(database_url):
    """Run Alembic migrations automatically on startup."""
    try:
        from alembic import command

        alembic_cfg = _alembic_config(database_url)
        command.upgrade(alembic_cfg, "head")
        print("[migrations] Database is up to date.")
    except Exception as err:
        print(f"[migrations] Warning: auto-migration failed: {err}")


def _scaling_from_db(sqlexec, gpus):
    """Return scaling rows from Postgres, or None if the table is missing/empty."""
    try:
        from dashboard.server.database.scaling import ScalingObservation

        stmt = select(ScalingObservation)
        if gpus:
            stmt = stmt.where(ScalingObservation.gpu.in_(gpus))
        stmt = stmt.order_by(
            ScalingObservation.gpu,
            ScalingObservation.bench,
            ScalingObservation.batch_size,
        )
        with sqlexec() as sess:
            rows = sess.execute(stmt).scalars().all()
        if not rows:
            return None
        return [row.as_api_dict() for row in rows]
    except Exception as err:
        print(f"[scaling] DB query failed, falling back to YAML: {err}")
        return None


def _scaling_from_yaml(gpus):
    """Filesystem fallback for /api/scaling (skips default.yaml)."""
    from milabench.analysis.scaling import read_config

    scaling_dir = str(importlib_resources.files("dashboard.data") / "scaling")
    if not os.path.isdir(scaling_dir):
        return {"error": f"Scaling config directory not found: {scaling_dir}"}

    if len(gpus) == 0:
        gpus = [
            f.split(".")[0]
            for f in os.listdir(scaling_dir)
            if f.endswith(".yaml") and f not in ("default.yaml", "inference.yaml")
        ]

    output = []
    for gpu in gpus:
        path = os.path.join(scaling_dir, f"{gpu}.yaml")
        if os.path.isfile(path):
            read_config(f"{gpu}.yaml", output, folder=scaling_dir)
    return output


def view_server(config):
    """Display milabench results"""

    DATABASE_URI = database_uri()
    database = Database(DATABASE_URI)

    app = Flask(__name__)
    app.config.update(config)
    app.config.update({
        "CACHE_TYPE": "SimpleCache",
        "CACHE_DEFAULT_TIMEOUT": 300
    })
    app.extensions["database"] = database

    cache = Cache(app)
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.schedulers import SchedulerNotRunningError

    scheduler = BackgroundScheduler()
    app.scheduler = scheduler
    app.scheduler.start()

    # Initialize SocketIO
    socketio = SocketIO(app, cors_allowed_origins="*")

    # Set the socketio instance for the realtime module
    set_socketio_instance(socketio)

    @app.teardown_appcontext
    def cleanup(exception):
        try:
            scheduler.shutdown()
        except SchedulerNotRunningError:
            pass

    print(DATABASE_URI)


    sqlexec = database.connect

    dev_mode = os.environ.get("DEV_MODE", "true").lower() not in ("0", "false", "no")
    app.config["DEV_MODE"] = dev_mode

    def dev_only(f):
        from functools import wraps
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not app.config["DEV_MODE"]:
                return jsonify({"error": "Server is in read-only mode"}), 403
            return f(*args, **kwargs)
        return wrapper

    push_routes(app, database)

    @app.route('/api/ping')
    def api_ping():
        return "pong"

    @app.route('/api/status')
    def api_status():
        return jsonify({"status": "ok", "version": _get_version()})

    @app.route('/api/routes')
    def api_routes():
        rules = []
        for rule in app.url_map.iter_rules():
            rules.append({"endpoint": rule.endpoint, "methods": list(rule.methods), "rule": rule.rule})
        return jsonify(sorted(rules, key=lambda r: r["rule"]))

    if dev_mode:
        sync_routes(app, DATABASE_URI)

        try:
            slurm_integration(app, cache, database)
        except Exception as exc:
            import traceback
            print(f"[slurm] slurm_integration FAILED: {exc}")
            traceback.print_exc()

        baremetal_server(app)

        metric_receiver(app)

        # FIXME: create a way to ignore failing extension
        try:
            datafile_processor(app, cache)
        except:
            pass

    @socketio.on('connect')
    def handle_connect():
        print('Client connected')
        emit('status', {'msg': 'Connected to milabench metrics server'})

    @socketio.on('disconnect')
    def handle_disconnect():
        print('Client disconnected')

    @socketio.on('subscribe_job')
    def handle_subscribe_job(data):
        """Allow clients to subscribe to specific job IDs"""
        job_id = data.get('jr_job_id')
        if job_id:
            # Join a room specific to this job ID
            from flask_socketio import join_room
            join_room(job_id)
            emit('status', {'msg': f'Subscribed to job {job_id}'})

    @socketio.on('unsubscribe_job')
    def handle_unsubscribe_job(data):
        """Allow clients to unsubscribe from specific job IDs"""
        job_id = data.get('jr_job_id')
        if job_id:
            # Leave the room specific to this job ID
            from flask_socketio import leave_room
            leave_room(job_id)
            emit('status', {'msg': f'Unsubscribed from job {job_id}'})

    #
    # API routes
    #

    @app.route('/api/summary/<runame>')
    def api_summary(runame):
        df_post = fetch_data(database.engine, runame)

        multirun = {}
        for real_runname in df_post["run"].unique():
            multirun[real_runname] = make_pivot_summary(real_runname, df_post)

        return jsonify(multirun)

    @app.route('/api/exec/list')
    @app.route('/api/exec/list/<int:limit>')
    def api_exec_list(limit=25):
        stmt = sqlalchemy.select(Exec).order_by(Exec._id.desc()).limit(limit)

        results = []
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())

        return results

    @app.route('/api/exec/<int:exec_id>/packs')
    def api_packs_show(exec_id):
        stmt = sqlalchemy.select(Pack).where(Pack.exec_id == exec_id)

        results = []
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())

        # group packs by benchmarks
        grouped = defaultdict(list)
        for row in results:
            grouped[row["name"]] = row

        return jsonify(results)

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

    @app.route('/api/exec/<int:exec_id>/packs/<int:pack_id>/metrics')
    def api_pack_metrics(exec_id, pack_id):
        stmt = sqlalchemy.select(Metric).where(Metric.exec_id == exec_id, Metric.pack_id == pack_id)
        stmt = _exclude_hidden(stmt)

        results = []
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())

        return results

    @app.route('/api/exec/<int:exec_id>/packs/<string:pack_name>/metrics')
    def api_pack_summary_metrics(exec_id, pack_name):
        stmt = sqlalchemy.select(Metric).where(Metric.exec_id == exec_id, Pack.name.startswith(pack_name)).join(Pack, Metric.pack_id == Pack._id)
        stmt = _exclude_hidden(stmt)

        results = []
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())

        return jsonify(results)

    @app.route('/api/keys')
    def api_ls_keys():
        data_path = importlib_resources.files("dashboard.data")
        return send_file(data_path / "keys.json", mimetype="application/json")

    @app.route('/api/gpu/list')
    def api_ls_gpu():
        stmt = select(func.distinct(cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT)))
        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    from .gpu_summary import gpu_summary_routes
    gpu_summary_routes(app, sqlexec)

    from .gpu_specs import gpu_specs_routes
    gpu_specs_routes(app, sqlexec, dev_only)

    # Ensure the gpus table exists and has all columns
    try:
        from .database.gpu import GPU
        from dashboard.server.database.models import Base as MetricsBase
        with sqlexec() as sess:
            MetricsBase.metadata.create_all(sess.bind, tables=[GPU.__table__], checkfirst=True)
            # Add any columns that were added after the table was first created
            from sqlalchemy import inspect as sa_inspect, text
            inspector = sa_inspect(sess.bind)
            existing = {c["name"] for c in inspector.get_columns("gpus")}
            for col in GPU.__table__.columns:
                if col.name not in existing:
                    col_type = col.type.compile(sess.bind.dialect)
                    sess.execute(text(f'ALTER TABLE gpus ADD COLUMN "{col.name}" {col_type}'))
                    print(f"[gpu_specs] Added column gpus.{col.name}")
            sess.commit()
    except Exception as err:
        print(f"[gpu_specs] Could not create/update gpus table: {err}")

    try:
        from .database.scheduled_job import ScheduledJob, ScheduledJobRun
        from dashboard.server.database.models import Base as MetricsBase
        with sqlexec() as sess:
            MetricsBase.metadata.create_all(
                sess.bind,
                tables=[ScheduledJob.__table__, ScheduledJobRun.__table__],
                checkfirst=True,
            )
            sess.commit()
        print("[scheduled_jobs] Tables ready.")
    except Exception as err:
        print(f"[scheduled_jobs] Could not create tables: {err}")

    def _evict_report_cache():
        try:
            from .report_cache import evict_old_entries, _table_exists
            with sqlexec() as sess:
                if _table_exists(sess):
                    evict_old_entries(sess)
        except Exception as err:
            print(f"[report_cache] Eviction failed: {err}")

    scheduler.add_job(_evict_report_cache, 'interval', minutes=30, id='evict_report_cache')

    @app.route('/api/metrics/list/<int:exec_id>')
    @app.route('/api/metrics/list')
    def api_ls_metrics(exec_id=None):
        if exec_id:
            stmt = select(func.distinct(Metric.name)).where(Metric.exec_id == exec_id)
        else:
            stmt = select(func.distinct(Metric.name))

        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    @app.route('/api/pytorch/list')
    def api_ls_pytorch():
        stmt = select(func.distinct(cast(Exec.meta["pytorch"]["torch"], TEXT)))
        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    @app.route('/api/profile/list')
    def api_ls_profile():
        stmt = select(func.distinct(Weight.profile))
        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    @app.route('/api/profile/show/<string:profile>')
    def api_show_profile(profile):
        stmt = select(Weight).where(Weight.profile == profile)

        results = []
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())


        results.sort(key=lambda x: x['priority'])

        return jsonify(results)

    @app.route('/api/profile/save/<string:profile>', methods=['POST'])
    @dev_only
    def api_save_profile(profile):
        from flask import request
        weights = request.json

        with sqlexec() as sess:
            for weight in weights:
                stmt = (
                    sqlalchemy.update(Weight)
                    .where(Weight._id == weight['_id'])
                    .values(
                        weight=weight['weight'],
                        priority=weight['priority'],
                        enabled=weight['enabled'],
                        group1=weight.get('group1'),
                        group2=weight.get('group2'),
                        group3=weight.get('group3'),
                        group4=weight.get('group4'),
                    )
                )
                sess.execute(stmt)
            sess.commit()

        return jsonify({"status": "success"})

    @app.route('/api/profile/copy', methods=['POST'])
    @dev_only
    def api_copy_profile():
        from flask import request
        data = request.json
        source_profile = data['sourceProfile']
        new_profile = data['newProfile']

        with sqlexec() as sess:
            # Get all weights from source profile
            stmt = select(Weight).where(Weight.profile == source_profile)
            source_weights = []
            cursor = sess.execute(stmt)
            for row in cursor:
                for col in row:
                    source_weights.append(col.as_dict())

            # Create new weights for the new profile
            for weight in source_weights:
                new_weight = Weight(
                    profile=new_profile,
                    pack=weight['pack'],
                    weight=weight['weight'],
                    priority=weight['priority'],
                    enabled=weight['enabled'],
                    group1=weight.get('group1'),
                    group2=weight.get('group2'),
                    group3=weight.get('group3'),
                    group4=weight.get('group4'),
                )
                sess.add(new_weight)
            sess.commit()

        return jsonify({"status": "success"})

    @app.route('/api/query/list')
    def api_ls_saved():
        stmt = select(func.distinct(SavedQuery.name))
        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    @app.route('/api/query/all')
    def api_get_all_saved_queries():
        stmt = select(SavedQuery).order_by(SavedQuery.created_time.desc())
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            results = []
            for row in cursor:
                for col in row:
                    results.append(col.as_dict())
            return jsonify(results)

    @app.route('/api/query/<string:name>')
    def api_get_saved_query(name):
        stmt = select(SavedQuery).where(SavedQuery.name == name)
        with sqlexec() as sess:
            result = sess.execute(stmt).scalar_one_or_none()
            if result:
                return jsonify(result.as_dict())
            else:
                return jsonify({"error": "Query not found"}), 404

    @app.route('/api/query/save', methods=['POST'])
    @dev_only
    def api_save_query():
        from flask import request
        data = request.json
        name = data.get('name')
        query = data.get('query')

        if not name or not query:
            return jsonify({"error": "Name and query are required"}), 400

        with sqlexec() as sess:
            # Check if query with this name already exists
            existing = sess.execute(select(SavedQuery).where(SavedQuery.name == name)).scalar_one_or_none()

            if existing:
                # Update existing query
                existing.query = query
                existing.created_time = datetime.utcnow()
            else:
                # Create new query
                saved_query = SavedQuery(
                    name=name,
                    query=query,
                    created_time=datetime.utcnow()
                )
                sess.add(saved_query)

            sess.commit()

        return jsonify({"status": "success"})

    @app.route('/api/query/delete/<string:name>', methods=['DELETE'])
    @dev_only
    def api_delete_saved_query(name):
        with sqlexec() as sess:
            result = sess.execute(select(SavedQuery).where(SavedQuery.name == name)).scalar_one_or_none()
            if result:
                sess.delete(result)
                sess.commit()
                return jsonify({"status": "success"})
            else:
                return jsonify({"error": "Query not found"}), 404

    @app.route('/api/milabench/list')
    def api_ls_milabench():
        stmt = select(func.distinct(cast(Exec.meta["milabench"]["tag"], TEXT)))
        with sqlexec() as sess:
            return jsonify(sess.execute(stmt).scalars().all())

    @app.route('/api/exec/<id>')
    def api_exec_show(id):
        stmt = sqlalchemy.select(Exec).where(Exec._id == id)
        with sqlexec() as sess:
            cursor = sess.execute(stmt)
            for row in cursor:
                result = row[0]
                return jsonify(result.as_dict())

        return jsonify({})

    @app.route('/api/exec/explore')
    def api_explore():
        from flask import request
        fields = {}
        tables = []
        sql_filters = None

        if request.args.get('filters'):
            filters = json.loads(base64.b64decode(request.args.get('filters')))
            # extract the fields that are queried upon
            # we will add them to the query and display the values
            sql_filters = make_filters(filters, fields=fields, used_tables=tables)

        table = (
            sqlalchemy.select(
                Exec._id.label("id"),
                Exec.name.label("run"),
                # Pack.name.label("bench"),
                *fields.values()
            )
            #
            #
        ).distinct(Exec._id)

        if sql_filters:
            table = table.where(*sql_filters)

        if 'Pack' in tables:
            table = table.join(Pack, Exec._id == Pack._id)

        if "Metric" in tables:
            table = table.join(Metric, Exec._id == Metric.exec_id)

        with sqlexec() as sess:
            cursor = sess.execute(table)
            columns = list(cursor.keys())
            results = []

            for row in cursor:
                results.append({k: v for k, v in zip(columns, row)})

        return jsonify(results)


    #
    # html routes
    #

    def fetch_data_type(client, run_id, profile="default"):
        if isinstance(run_id, str):
            return fetch_data(client, run_id, profile=profile)
        else:
            return fetch_data_by_id(client, run_id, profile=profile)

    def report(run_id, profile="default"):
        df_post = fetch_data_type(database.engine, run_id, profile=profile)

        names = list(df_post["run"].unique())

        if len(names) > 1:
            print("multiple run report")

        full_name = names[0]
        replicated = make_pivot_summary(full_name, df_post)

        stream = StringIO()
        with open(os.devnull, "w") as devnull:
            make_report(replicated, stream=devnull, html=stream, weights=replicated)

        print(names)
        return stream.getvalue()

    @app.route('/html/report/<string:runame>')
    def html_report_name(runame):
        profile = request.cookies.get('scoreProfile')

        return report(runame, profile=profile)

    @app.route('/html/report/<int:run_id>')
    def html_report(run_id):
        profile = request.cookies.get('scoreProfile')

        return report(run_id, profile=profile)

    @app.route('/html/exec/<int:exec_id>/packs/<pack_id>/metrics')
    def html_pack_metrics(exec_id, pack_id):
        import altair as alt
        from .utils import plot

        chart = alt.Chart(f"/api/exec/{exec_id}/packs/{pack_id}/metrics").transform_joinaggregate(
            min_order="min(order)",
            groupby=["name"],
        ).transform_calculate(
            elapsed="datum.order - datum.min_order",
        ).mark_line().encode(
            x=alt.X("elapsed:Q", scale=alt.Scale(zero=True), title="Elapsed (s)"),
            y=alt.Y("value:Q", scale=alt.Scale(zero=False)),
            color=alt.Color("gpu_id:O"),
            tooltip=[
                alt.Tooltip("unit:N", title="Unit"),
                alt.Tooltip("elapsed:Q", title="Elapsed (s)", format=".1f"),
            ]
        ).facet(
            facet=alt.Facet("name:N", title="Metric"),
            columns=4
        ).resolve_scale(y='independent', x='independent')

        return plot(chart.to_json())

    @app.route('/html/form/pivot')
    def html_format_pivot():
        with open("/home/newton/work/milabench_dev/milabench/milabench/web/template/pivot.html", "r") as fp:
            return render_template_string(fp.read())

    @app.route('/api/report/fast')
    def api_report_fast():
        from .plot import sql_direct_report
        from .report_cache import get_cached_report, store_report, _table_exists

        profile = request.cookies.get('scoreProfile') or 'default'
        exec_ids = request.args.get('exec_ids', '').split(',')
        drop_min_max = request.args.get('drop_min_max', 'true').lower() == 'true'

        more_raw = filter(lambda x: x != '', request.args.get('more', '').split(','))
        more = [make_selection_key(key) for key in more_raw]

        can_cache = len(exec_ids) == 1 and not more and drop_min_max

        if can_cache:
            with sqlexec() as sess:
                if _table_exists(sess):
                    cached = get_cached_report(sess, exec_ids[0], profile)
                    if cached is not None:
                        return jsonify(cached)

        with sqlexec() as sess:
            stmt = sql_direct_report(exec_ids, profile=profile, drop_min_max=drop_min_max, more=more)
            cursor = sess.execute(stmt)
            results = cursor_to_json(cursor)

        if can_cache and results:
            try:
                with sqlexec() as sess:
                    if _table_exists(sess):
                        store_report(sess, exec_ids[0], profile, results)
            except Exception as err:
                print(f"[report_cache] Could not store cache: {err}")

        return jsonify(results)

    @app.route('/api/scaling')
    def api_scaling():
        """Fetch scaling observations (Postgres preferred, YAML fallback)."""
        gpus = request.args.getlist("gpus")

        db_rows = _scaling_from_db(sqlexec, gpus)
        if db_rows is not None:
            return jsonify(db_rows)

        output = _scaling_from_yaml(gpus)
        if isinstance(output, dict) and "error" in output:
            return jsonify(output), 404
        return jsonify(output)

    @app.route('/html/scaling/x=<string:x>/y=<string:y>')
    def scaling_plot(x, y):
        """Fetch scaling data from the scaling configuration files"""
        import altair as alt
        from .utils import plot

        print(x, y)

        chart = (
            alt.Chart(f"/api/scaling").mark_point().encode(
                    x=f"{x}:Q",
                    y=f"{y}:Q",
                    shape="gpu:N",
                    color="gpu:N",
                    size="perf:Q",
                )
                .facet(
                    facet=alt.Facet("bench:N", title="Benchmark"),
                    columns=4
                )
        ).resolve_scale(y='independent', x='independent', size='independent')

        return plot(chart.to_json())

    @app.route('/api/bench/list')
    def api_bench_list():
        """Return benchmark names sorted by most recent run date, then name."""
        stmt = (
            select(Pack.name, func.max(Exec.created_time).label("latest"))
            .join(Exec, Exec._id == Pack.exec_id)
            .group_by(Pack.name)
            .order_by(func.max(Exec.created_time).desc(), Pack.name)
        )
        with sqlexec() as sess:
            return jsonify([row[0] for row in sess.execute(stmt)])

    @app.route('/api/bench/history')
    def api_bench_history():
        """Return candlestick statistics for a benchmark across runs over time.

        Query params:
            bench: benchmark name (required)
            metric: metric name (default: rate)
            gpu: filter by GPU product name (optional)
        """
        bench_name = request.args.get('bench')
        metric_name = request.args.get('metric', 'rate')
        gpu_filter = request.args.get('gpu')
        limit = min(int(request.args.get('limit', 365)), 1000)
        trim = request.args.get('trim', '0') == '1'

        if not bench_name:
            return jsonify({"error": "bench parameter is required"}), 400

        gpu_col = cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT).label("gpu")

        recent_execs = (
            select(Exec._id, Exec.created_time)
            .join(Pack, Pack.exec_id == Exec._id)
            .where(Pack.name == bench_name, Exec.visibility == 0)
            .distinct()
            .order_by(Exec.created_time.desc())
            .limit(limit)
        ).subquery()

        raw = (
            select(
                Metric.exec_id,
                Metric.value,
                Exec.created_time,
                gpu_col,
            )
            .join(Pack, Metric.pack_id == Pack._id)
            .join(Exec, Exec._id == Metric.exec_id)
            .where(
                Pack.name == bench_name,
                Metric.name == metric_name,
                Exec.visibility == 0,
                Metric.exec_id.in_(select(recent_execs.c._id)),
            )
        )

        if gpu_filter:
            raw = raw.where(
                cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT) == gpu_filter
            )

        sub = raw.subquery()

        if trim:
            # Per (exec, gpu) group, find the min and max values, then
            # exclude rows that match those extremes before aggregating.
            from sqlalchemy import and_
            group_extremes = (
                select(
                    sub.c.exec_id,
                    sub.c.gpu,
                    func.min(sub.c.value).label("group_min"),
                    func.max(sub.c.value).label("group_max"),
                )
                .group_by(sub.c.exec_id, sub.c.gpu)
            ).subquery()

            trimmed = (
                select(
                    sub.c.exec_id,
                    sub.c.value,
                    sub.c.created_time,
                    sub.c.gpu,
                )
                .join(
                    group_extremes,
                    and_(
                        sub.c.exec_id == group_extremes.c.exec_id,
                        sub.c.gpu == group_extremes.c.gpu,
                    ),
                )
                .where(
                    sub.c.value > group_extremes.c.group_min,
                    sub.c.value < group_extremes.c.group_max,
                )
            ).subquery()
            agg_source = trimmed
        else:
            agg_source = sub

        stats = (
            select(
                agg_source.c.exec_id,
                agg_source.c.created_time,
                agg_source.c.gpu,
                func.min(agg_source.c.value).label("min"),
                func.max(agg_source.c.value).label("max"),
                func.avg(agg_source.c.value).label("mean"),
                func.count(agg_source.c.value).label("n"),
                sqlalchemy.func.percentile_cont(0.25).within_group(agg_source.c.value).label("q25"),
                sqlalchemy.func.percentile_cont(0.50).within_group(agg_source.c.value).label("median"),
                sqlalchemy.func.percentile_cont(0.75).within_group(agg_source.c.value).label("q75"),
            )
            .group_by(agg_source.c.exec_id, agg_source.c.created_time, agg_source.c.gpu)
            .order_by(agg_source.c.created_time)
        )

        with sqlexec() as sess:
            cursor = sess.execute(stats)
            results = cursor_to_json(cursor)

        return jsonify(results)

    @app.route('/api/grouped/plot')
    def api_grouped_plot():
        from .plot import grouped_plot

        n1 = request.args.get('n1')
        n2 = request.args.get('n2')
        g1 = request.args.get('g1')
        g2 = request.args.get('g2')
        metric = request.args.get('metric')
        more = request.args.get('more')
        exec_ids = request.args.get('exec_ids')
        profile = request.args.get('profile', request.cookies.get('scoreProfile'))
        weighted = request.args.get('weighted', 'false').lower() == 'true'

        color = request.args.get('color')
        relative = request.args.get('relative', '=')
        color_key, color_val = relative.split("=")

        # Handle None/empty values for g1 and g2
        group1_col = getattr(Weight, g1) if g1 else None
        group2_col = getattr(Weight, g2) if g2 else None
        group1_name = n1
        group2_name = n2

        metric=metric

        exec_ids = exec_ids.split(',')
        more = [make_selection_key(key) for key in more.split(',')]

        with sqlexec() as sess:
            stmt = grouped_plot(
                group1_col,
                group2_col,
                group1_name,
                group2_name,
                exec_ids,
                metric,
                more,
                weighted=weighted,
                profile=profile)

            cursor = sess.execute(stmt)

            results = cursor_to_json(cursor)

        if color_key != "" and color_val != "":
            values = {}
            for row in results:
                name_x = row.get(group1_name, "")
                name_y = row.get(group2_name, "")

                value = row[color_key]
                base = row[metric]

                if value == color_val:
                    values[(name_x, name_y, value)] = base

            for row in results:
                name_x = row.get(group1_name, "")
                name_y = row.get(group2_name, "")

                baseline = values.get((name_x, name_y, color_val), 1)
                row[metric] = row[metric] / baseline

        return jsonify(results)

    @app.route('/html/grouped/plot')
    def html_grouped_plot():
        import altair as alt
        from .utils import plot

        n1 = request.args.get('n1')
        n2 = request.args.get('n2')
        metric = request.args.get('metric')
        color = request.args.get('color')

        query_string = request.query_string.decode('utf-8')

        # TODO: make those arguments
        row_order = ["fp16", "tf32", "fp32"]
        column_order = ["FLOPS", "BERT", "CONVNEXT"]

        # ----
        x = alt.X(metric, type="quantitative", scale=alt.Scale(zero=False))
        y = alt.Y(color, type="nominal", scale=alt.Scale(zero=False))

        if request.args.get('inverted') is not None:
            x, y = y, x

        config = {
            "y": y,
            "x": x,
            "color": alt.Color(color, type="nominal"),
        }

        if request.args.get('g2') is not None:
            config["row"] = alt.Row(f"{n2}", type="nominal", title=n2, sort=row_order)

        if request.args.get('g1') is not None:
            config["column"] = alt.Column(f"{n1}", type="nominal", title=n1, sort=column_order)

        chart = alt.Chart(f"/api/grouped/plot?{query_string}").mark_bar().encode(
            **config
        )

        return plot(chart.to_json())


    @cache.memoize(timeout=3600)
    def cached_query(rows, cols, values, filters, profile="default"):
        from dashboard.server.report_data import base_report_view

        filter_fields = [f['field'] for f in filters]

        selected_keys = [
            make_selection_key(key) for key in [*rows, *cols, *values, *filter_fields]
        ]

        table = base_report_view(*selected_keys, profile=profile)

        if filters:
            table = table.where(*make_filters(filters))

        with sqlexec() as sess:
            cursor = sess.execute(table)
            results = cursor_to_json(cursor)

        return results

    def make_pivot(profile="default"):
        # If no parameters are provided, serve the pivot builder interface
        if not request.args:
            return render_template('pivot.html')

        args = request.args

        rows = args.get('rows', '').split(',') if args.get('rows') else ["run", "gpu", "pytorch", "bench"]
        cols = args.get('cols', '').split(',') if args.get('cols') else ["metric"]
        values = json.loads(base64.b64decode(args.get('values', '{}')))

        def get_aggregator(v):
            def to_fun(agg):
                if agg == "avg":
                    return "mean"
                return agg

            return [
                to_fun(agg) for agg in v
            ]


        values = {k: get_aggregator(v) for k, v in values.items()}
        filters = []

        if args.get('filters'):
            filters = json.loads(base64.b64decode(args.get('filters')))

        results = cached_query(rows, cols, values, filters, profile=profile)

        pivot_spec = {
            "rows": rows,
            "cols": cols,
            "values": values,
            # We make the filter in SQL so we have less data to process
            "filters": []
        }

        df = pd.DataFrame(results)

        overall = pd.pivot_table(
            df,
            values=pivot_spec["values"].keys(),
            index=pivot_spec["rows"],
            columns=pivot_spec["cols"],
            aggfunc=pivot_spec["values"],
            dropna=True,
        )

        import numpy as np

        pack_name = "Pack:name"
        if pack_name in overall.index.names:
            priority_map = df.drop_duplicates(subset=pack_name, keep='first').set_index(pack_name)['priority']

            bench_vals = overall.index.get_level_values(pack_name)
            priorities = bench_vals.map(priority_map)

            overall = overall.iloc[priorities.argsort()]

            # Compute the score
            rate_cols_mask = overall.columns.get_level_values('Metric:name') == 'rate'
            rate_columns = overall.columns[rate_cols_mask]

            if len(rate_columns) > 0:
                weight_map = df.drop_duplicates(subset=pack_name, keep='first').set_index(pack_name)['weight']
                weights = bench_vals.map(weight_map)

                scores = {}
                for col in rate_columns:
                    x = overall[col]
                    weighted_log_sum = (np.log(x + 1) * weights).sum()
                    weight_sum = sum(weights.values)
                    scores[col] = np.exp(weighted_log_sum / weight_sum)

                # Add the score as a row to overall
                scores_series = pd.Series(scores)
                score_row = pd.DataFrame([scores_series], columns=overall.columns)

                existing_index = overall.index[0]
                pack_name_pos = overall.index.names.index("Pack:name")

                if isinstance(overall.index, pd.MultiIndex):
                    new_index_label = list(existing_index)
                    new_index_label[pack_name_pos] = "score"
                    new_index_label = tuple(new_index_label)
                    score_row.index = pd.MultiIndex.from_tuples([new_index_label], names=overall.index.names)
                else:
                    score_row.index = pd.Index(["score"])

                overall = pd.concat([overall, score_row])

        # We need to reorder the df by the same order
        return overall

    @app.route('/html/relative/pivot')
    def html_relative_pivot():
        # retrieve the cookie `scoreProfile` and use that as the profile
        profile = request.cookies.get('scoreProfile')
        df = make_pivot(profile=profile)

        first_col = df.iloc[:, 0]

        df = df.div(first_col, axis=0)

        return pandas_to_html_relative(df)

    @app.route('/html/pivot')
    def html_pivot():
        profile = request.cookies.get('scoreProfile')

        df = make_pivot(profile)

        return pandas_to_html(df)

    @app.route('/api/pivot')
    def api_pivot():
        profile = request.cookies.get('scoreProfile')
        args = request.args

        if profile is None:
            print("PROFILE is none")
            profile = 'default'

        i = 0
        def counter():
            nonlocal i
            i += 1
            return i

        def rename_column(col):
            if 'as' in col:
                return col
            else:
                return f"{col} as {col.replace(':', '_')}"

        rows = args.get('rows', '').split(',') if args.get('rows') else ["run", "gpu", "pytorch", "bench"]
        rows = [rename_column(r) for i, r in enumerate(rows)]

        cols = args.get('cols', '').split(',') if args.get('cols') else ["metric"]
        cols = [rename_column(r) for i, r in enumerate(cols)]

        values = json.loads(base64.b64decode(args.get('values', '{}')))
        values = {rename_column(k): v for k, v in values.items()}

        filters = []
        if args.get('filters'):
            filters = json.loads(base64.b64decode(args.get('filters')))

        if len(filters) == 0:
            print("No filters, returning empty to avoid crashing the database")
            return jsonify({})

        try:
            with sqlexec() as sess:
                apply_pivot_statement_timeout(sess)
                query = pivot_query(sess, rows, cols, values, filters, profile)
                cursor = sess.execute(query)
                results = cursor_to_json(cursor)
        except sqlalchemy.exc.OperationalError as exc:
            if is_statement_timeout(exc):
                return jsonify({
                    "error": f"Pivot query timed out after {PIVOT_TIMEOUT_MS // 1000}s",
                }), 408
            raise

        return results

    # Serve the built React SPA when bundled in the wheel
    _static_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
    )

    if os.path.isdir(_static_dir):
        @app.errorhandler(404)
        def spa_fallback(e):
            if request.path.startswith(("/api/", "/html/", "/socket.io/")):
                return jsonify({"error": "Not found"}), 404

            requested = request.path.lstrip("/")
            if requested:
                try:
                    return send_from_directory(_static_dir, requested)
                except Exception:
                    pass

            return send_file(os.path.join(_static_dir, "index.html"))

    return app, socketio


def main():
    app, socketio = view_server({})
    return app


if __name__ == "__main__":
    main()
