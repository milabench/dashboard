"""Dev-only endpoints for syncing data between local and deployed databases."""

import io
import os
import subprocess
import tempfile

from flask import jsonify, request, send_file

DEFAULT_REMOTE_URL = "https://www.milabench.com"


def _parse_local_db(db_uri):
    """Extract connection params from the database URI.

    Handles both sqlalchemy.URL objects and plain URI strings.
    """
    from sqlalchemy import URL

    if isinstance(db_uri, URL):
        return {
            "host": db_uri.host or "localhost",
            "port": str(db_uri.port or 5432),
            "dbname": db_uri.database or "",
            "user": db_uri.username or "",
            "password": db_uri.password or "",
            "sslmode": db_uri.query.get("sslmode", ""),
        }

    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(str(db_uri))
    query = parse_qs(parsed.query)
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "dbname": parsed.path.lstrip("/"),
        "user": parsed.username or "",
        "password": parsed.password or "",
        "sslmode": query.get("sslmode", [""])[0],
    }


def _pg_dump(host, port, user, password, dbname, sslmode=""):
    """Run pg_dump and return (stdout_bytes, stderr_str, returncode)."""
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    if sslmode:
        env["PGSSLMODE"] = sslmode

    result = subprocess.run(
        [
            "pg_dump",
            "-h", host,
            "-p", str(port),
            "-U", user,
            "-d", dbname,
            "--format=custom",
            "--no-owner",
            "--no-acl",
        ],
        capture_output=True,
        env=env,
        timeout=600,
    )
    return result.stdout, result.stderr.decode("utf-8", errors="replace"), result.returncode


def _pg_restore(dump_path, host, port, user, password, dbname, sslmode="", clean=True, grant_to=None):
    """Run pg_restore and return (stderr_str, returncode).

    If grant_to is provided, grants SELECT on all tables to that role
    after restore (to fix permissions lost by --clean).
    """
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    if sslmode:
        env["PGSSLMODE"] = sslmode

    cmd = [
        "pg_restore",
        "-h", host,
        "-p", str(port),
        "-U", user,
        "-d", dbname,
        "--no-owner",
        "--no-acl",
    ]
    if clean:
        cmd += ["--clean", "--if-exists"]
    cmd.append(dump_path)

    result = subprocess.run(cmd, capture_output=True, env=env, timeout=600)
    stderr = result.stderr.decode("utf-8", errors="replace")

    if grant_to and result.returncode in (0, 1):
        grant_sql = f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{grant_to}\";"
        grant_result = subprocess.run(
            ["psql", "-h", host, "-p", str(port), "-U", user, "-d", dbname, "-c", grant_sql],
            capture_output=True, env=env, timeout=30,
        )
        if grant_result.returncode != 0:
            stderr += f"\nGrant failed: {grant_result.stderr.decode('utf-8', errors='replace')}"

    return stderr, result.returncode


def sync_routes(app, db_uri):

    @app.route('/api/sync/backup', methods=['POST'])
    def backup_remote_database():
        """Download a pg_dump from a remote PostgreSQL database."""
        data = request.json or {}
        host = data.get("host")
        port = data.get("port", "5432")
        dbname = data.get("dbname")
        user = data.get("user")
        password = data.get("password")
        sslmode = data.get("sslmode", "require")

        if not all([host, dbname, user, password]):
            return jsonify({"status": "ERR", "message": "host, dbname, user, and password are required"}), 400

        try:
            stdout, stderr, rc = _pg_dump(host, port, user, password, dbname, sslmode)
            if rc != 0:
                return jsonify({"status": "ERR", "message": stderr}), 500

            buf = io.BytesIO(stdout)
            buf.seek(0)
            return send_file(
                buf,
                mimetype="application/octet-stream",
                as_attachment=True,
                download_name="milabench_backup.dump",
            )
        except subprocess.TimeoutExpired:
            return jsonify({"status": "ERR", "message": "pg_dump timed out after 600s"}), 504
        except FileNotFoundError:
            return jsonify({"status": "ERR", "message": "pg_dump not found — install PostgreSQL client tools"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @app.route('/api/sync/restore', methods=['POST'])
    def restore_backup():
        """Restore a pg_dump backup into the local database."""
        if 'file' not in request.files:
            return jsonify({"status": "ERR", "message": "No file provided"}), 400

        local = _parse_local_db(db_uri)

        with tempfile.NamedTemporaryFile(suffix=".dump", delete=True) as tmp:
            request.files['file'].save(tmp.name)

            try:
                stderr, rc = _pg_restore(tmp.name, **local)
                if rc != 0 and "ERROR" in stderr:
                    return jsonify({"status": "WARN", "message": f"Restore completed with warnings:\n{stderr}"})
                if rc != 0:
                    return jsonify({"status": "WARN", "message": stderr})
                return jsonify({"status": "OK", "message": "Database restored successfully"})
            except subprocess.TimeoutExpired:
                return jsonify({"status": "ERR", "message": "pg_restore timed out after 600s"}), 504
            except FileNotFoundError:
                return jsonify({"status": "ERR", "message": "pg_restore not found — install PostgreSQL client tools"}), 500
            except Exception as err:
                return jsonify({"status": "ERR", "message": str(err)}), 500

    @app.route('/api/sync/push-to-remote', methods=['POST'])
    def push_to_remote():
        """Dump the source database and restore it into the remote deployed database."""
        data = request.json or {}
        remote_host = data.get("host")
        remote_port = data.get("port", "5432")
        remote_dbname = data.get("dbname")
        remote_user = data.get("user")
        remote_password = data.get("password")
        remote_sslmode = data.get("sslmode", "require")

        if not all([remote_host, remote_dbname, remote_user, remote_password]):
            return jsonify({"status": "ERR", "message": "Remote host, dbname, user, and password are required"}), 400

        source = _parse_local_db(db_uri)

        try:
            # Step 1: pg_dump from the database the app is connected to
            stdout, stderr, rc = _pg_dump(**source)
            if rc != 0:
                return jsonify({"status": "ERR", "message": f"Source pg_dump failed: {stderr}"}), 500

            # Step 2: pg_restore into remote
            with tempfile.NamedTemporaryFile(suffix=".dump", delete=True) as tmp:
                tmp.write(stdout)
                tmp.flush()

                stderr, rc = _pg_restore(
                    tmp.name,
                    host=remote_host,
                    port=remote_port,
                    user=remote_user,
                    password=remote_password,
                    dbname=remote_dbname,
                    sslmode=remote_sslmode,
                )

                if rc != 0 and "ERROR" in stderr:
                    return jsonify({"status": "WARN", "message": f"Push completed with warnings:\n{stderr}"})
                if rc != 0:
                    return jsonify({"status": "WARN", "message": stderr})

                return jsonify({"status": "OK", "message": "Database pushed to remote successfully"})

        except subprocess.TimeoutExpired:
            return jsonify({"status": "ERR", "message": "Operation timed out"}), 504
        except FileNotFoundError:
            return jsonify({"status": "ERR", "message": "pg_dump/pg_restore not found — install PostgreSQL client tools"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @app.route('/api/sync/local-backup', methods=['GET'])
    def local_backup():
        """Create a pg_dump of the local database and download it."""
        local = _parse_local_db(db_uri)

        try:
            stdout, stderr, rc = _pg_dump(**local)
            if rc != 0:
                return jsonify({"status": "ERR", "message": stderr}), 500

            buf = io.BytesIO(stdout)
            buf.seek(0)
            return send_file(
                buf,
                mimetype="application/octet-stream",
                as_attachment=True,
                download_name="milabench_local_backup.dump",
            )
        except subprocess.TimeoutExpired:
            return jsonify({"status": "ERR", "message": "pg_dump timed out"}), 504
        except FileNotFoundError:
            return jsonify({"status": "ERR", "message": "pg_dump not found"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @app.route('/api/sync/remote-info', methods=['GET'])
    def remote_info():
        """Return the default remote dashboard URL."""
        return jsonify({
            "default_url": DEFAULT_REMOTE_URL,
        })
