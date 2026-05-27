import os
import secrets
import traceback
from flask import Flask, flash, request, redirect, jsonify
from werkzeug.utils import secure_filename
from sqlalchemy.orm import Session
from sqlalchemy import select

from milabench.metrics.archive import publish_zipped_run
from milabench.metrics.sqlalchemy import SQLAlchemy, PushKey
from .utils import database_uri


def push_routes(app, database_uri):
    UPLOAD_FOLDER = '/tmp/'
    ALLOWED_EXTENSIONS = {'zip'}

    app.config['UPLOAD_FOLDER'] = os.getenv("UPLOAD_FOLDER", UPLOAD_FOLDER)

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
                filename = secure_filename(file.filename)
                dest = os.path.join(app.config['UPLOAD_FOLDER'], filename)
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
