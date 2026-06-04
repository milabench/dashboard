import json
import os
import secrets
import tempfile
import traceback
from flask import Flask, flash, request, redirect, jsonify, Response, stream_with_context
from werkzeug.utils import secure_filename
from sqlalchemy.orm import Session
from sqlalchemy import select

from milabench.metrics.archive import publish_zipped_run
from milabench.metrics.sqlalchemy import SQLAlchemy, PushKey
from .utils import database_uri


def _sse(event, data):
    """Format a Server-Sent Event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _sse_heartbeat():
    """Keep-alive comment to prevent proxy timeouts."""
    return ": heartbeat\n\n"


MAX_ZIP_SIZE = int(os.getenv("MAX_ZIP_SIZE", 500 * 1024 * 1024))  # 500 MB
MAX_ENTRY_SIZE = int(os.getenv("MAX_ENTRY_SIZE", 100 * 1024 * 1024))  # 100 MB per entry
MAX_ENTRIES = int(os.getenv("MAX_ZIP_ENTRIES", 50_000))


def push_routes(app, database_uri): 
    UPLOAD_FOLDER = '/tmp/' 
    ALLOWED_EXTENSIONS = {'zip'}

    app.config['UPLOAD_FOLDER'] = os.getenv("UPLOAD_FOLDER", UPLOAD_FOLDER)
    app.config['MAX_CONTENT_LENGTH'] = MAX_ZIP_SIZE

    def allowed_file(filename):
        return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

    def resolve_push_key(key):
        """Look up a push key and return the associated name, or None."""
        with SQLAlchemy(database_uri) as backend:
            with Session(backend.client) as sess:
                row = sess.execute(
                    select(PushKey).where(PushKey.key == key)
                ).scalar_one_or_none()
                return row.name if row else None

    @app.route('/api/push/key/request', methods=['POST'])
    def request_push_key():
        """Generate a new push key for a given name."""
        data = request.json
        name = data.get('name', '').strip()

        if not name:
            return jsonify({"status": "ERR", "message": "Name is required"}), 400

        with SQLAlchemy(database_uri) as backend:
            with Session(backend.client) as sess:
                existing = sess.execute(
                    select(PushKey).where(PushKey.name == name)
                ).scalar_one_or_none()

                if existing:
                    return jsonify({"status": "ERR", "message": f'Name "{name}" is already taken'}), 409

                key = secrets.token_hex(32)
                push_key = PushKey(name=name, key=key)
                sess.add(push_key)
                sess.commit()

                return jsonify({
                    "status": "OK",
                    "name": name,
                    "key": key,
                    "message": "Save this key — it will not be shown again."
                })

    @app.route('/api/push/key/list')
    def list_push_keys():
        """List all registered push key names (without exposing the secrets)."""
        with SQLAlchemy(database_uri) as backend:
            with Session(backend.client) as sess:
                rows = sess.execute(select(PushKey)).scalars().all()
                return jsonify([{"name": row.name} for row in rows])

    @app.route('/api/push/zip', methods=['POST'])
    def upload_zip_file():
        push_key = request.form.get('key') or request.headers.get('X-Push-Key')
        if not push_key:
            return jsonify({"status": "ERR", "message": "Push key is required"}), 401

        contributor = resolve_push_key(push_key)
        if not contributor:
            return jsonify({"status": "ERR", "message": "Invalid push key"}), 403

        if 'file' not in request.files:
            return jsonify({"status": "ERR", "message": "No file provided"}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({"status": "ERR", "message": "No file selected"}), 400

        if file and allowed_file(file.filename):
            try:
                fd, dest = tempfile.mkstemp(suffix=".zip", dir=app.config['UPLOAD_FOLDER'])
                os.close(fd)
                file.save(dest)

                user_meta = {}
                raw = request.form.get('metadata')
                if raw:
                    try:
                        import json
                        user_meta = json.loads(raw)
                        if not isinstance(user_meta, dict):
                            user_meta = {}
                    except (json.JSONDecodeError, TypeError):
                        user_meta = {}

                meta_tags = {**user_meta, "contributor": contributor}
                with SQLAlchemy(database_uri, meta_tags=meta_tags) as backend:
                    publish_zipped_run(backend, dest, stop_on_exception=True)

                os.remove(dest)
                return jsonify({
                    "status": "OK",
                    "message": f"{file.filename} was pushed by {contributor}"
                })
            except Exception as err:
                return jsonify({
                    "status": "ERR",
                    "message": f"{str(err)}"
                })

        return jsonify({"status": "ERR", "message": "Only .zip files are allowed"}), 400

    @app.route('/api/push/zip/stream', methods=['POST'])
    def upload_zip_stream():
        """Push a zip file and stream progress as SSE events."""
        push_key = request.form.get('key') or request.headers.get('X-Push-Key')
        if not push_key:
            return jsonify({"status": "ERR", "message": "Push key is required"}), 401

        contributor = resolve_push_key(push_key)
        if not contributor:
            return jsonify({"status": "ERR", "message": "Invalid push key"}), 403

        if 'file' not in request.files:
            return jsonify({"status": "ERR", "message": "No file provided"}), 400

        file = request.files['file']
        if file.filename == '' or not allowed_file(file.filename):
            return jsonify({"status": "ERR", "message": "Only .zip files are allowed"}), 400

        fd, dest = tempfile.mkstemp(suffix=".zip", dir=app.config['UPLOAD_FOLDER'])
        os.close(fd)
        file.save(dest)

        user_meta = {}
        raw = request.form.get('metadata')
        if raw:
            try:
                user_meta = json.loads(raw)
                if not isinstance(user_meta, dict):
                    user_meta = {}
            except (json.JSONDecodeError, TypeError):
                user_meta = {}

        meta_tags = {**user_meta, "contributor": contributor}

        def generate():
            import time
            import zipfile
            from collections import defaultdict
            from milabench.testing import interleave
            from milabench.utils import multilogger
            from milabench.config import set_run_count

            last_heartbeat = time.monotonic()
            heartbeat_interval = 15

            def maybe_heartbeat():
                nonlocal last_heartbeat
                now = time.monotonic()
                if now - last_heartbeat >= heartbeat_interval:
                    last_heartbeat = now
                    return _sse_heartbeat()
                return None

            try:
                yield _sse_heartbeat()

                with zipfile.ZipFile(dest, "r") as archive:
                    entries = archive.infolist()
                    if len(entries) > MAX_ENTRIES:
                        yield _sse("error", {"status": "ERR", "message": f"Too many entries ({len(entries)} > {MAX_ENTRIES})"})
                        return

                    data = defaultdict(lambda: defaultdict(list))
                    for info in entries:
                        if info.compress_type != zipfile.ZIP_STORED:
                            yield _sse("error", {"status": "ERR", "message": f"Compressed entries are not accepted (use ZIP_STORED)"})
                            return
                        if info.file_size > MAX_ENTRY_SIZE:
                            yield _sse("error", {"status": "ERR", "message": f"Entry {info.filename} too large ({info.file_size} bytes)"})
                            return
                        if info.filename.endswith(".data"):
                            frags = info.filename.split("/")
                            runname = frags[-2]
                            benchname = frags[-1].split(".", maxsplit=1)[0]
                            data[runname][benchname].append(info.filename)

                    yield _sse("info", {"message": f"Found {len(data)} run(s)", "contributor": contributor})

                    with SQLAlchemy(database_uri, meta_tags=meta_tags) as backend:
                        with multilogger(backend, stop_on_exception=True) as log:
                            for runname, rundata in data.items():
                                if hasattr(backend, "start_new_run"):
                                    backend.start_new_run()

                                set_run_count(len(data), len(rundata))
                                yield _sse("run", {"name": runname, "benchmarks": len(rundata)})

                                for bench_name, streams in rundata.items():
                                    yield _sse("bench", {"run": runname, "name": bench_name})
                                    try:
                                        gen = interleave(*streams, open_fun=archive.open)
                                        count = 0
                                        for entry in gen:
                                            log(entry)
                                            count += 1
                                            hb = maybe_heartbeat()
                                            if hb:
                                                yield hb
                                        yield _sse("bench_done", {"name": bench_name, "events": count})
                                    except Exception as err:
                                        yield _sse("bench_error", {"name": bench_name, "error": str(err)})

                yield _sse("done", {"status": "OK", "message": f"{file.filename} pushed by {contributor}"})

            except Exception as err:
                yield _sse("error", {"status": "ERR", "message": str(err), "traceback": traceback.format_exc()})
            finally:
                if os.path.exists(dest):
                    os.remove(dest)

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
        )

    @app.route('/api/push/folder/<string:jr_job_id>', methods=['GET'])
    def upload_job_folder(jr_job_id: str):
        """Push a job runner folder to the database"""

        from .slurm import safe_job_path
        from ..metrics.archive import publish_archived_run

        run_folder = safe_job_path(jr_job_id, "runs")
        failures = []
        success = []
        
        for run in os.scandir(run_folder):
            try:
                run_path = os.path.join(run_folder, run)

                with SQLAlchemy(database_uri, meta_override={}) as backend:
                    publish_archived_run(backend, run_path, stop_on_exception=True)

                success.append(run.name)

            except Exception as err:
                traceback.print_exc()
                failures.append((run.name, str(err)))

        print("DONE")
        return {
            "status": "OK",
            "success": success,
            "failures": failures,
        }



def push_zip_folder(file_path, url='http://localhost:5000/push'):
    #
    # TODO: zip the folder with python and upload it with requests
    #
    import requests

    with open(file_path, 'rb') as f:
        files = {'file': (file_path, f, 'application/zip')}
        response = requests.post(url, files=files)

    print(f"Status Code: {response.status_code}")
    print(response.text)


def push_server(config):
    """Simple push server that takes a zip folder of runs to push to the database"""

    DATABASE_URI = database_uri()

    app = Flask(__name__)
    app.config.update(config)

    push_routes(app, DATABASE_URI)

    return app


def main():
    # flask --app milabench.web.push:main run

    # curl -X POST -F "file=@your_file.zip" http://localhost:5000/push

    app = push_server({})
    return app


if __name__ == "__main__":
    main()
