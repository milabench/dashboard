"""Admin endpoints for syncing data between local and deployed databases.

Local-DB backup/restore accept an explicit ``target`` ('dev' or 'prod',
see ``admin_db.py``) resolved fresh from ``secrets.toml`` on every call —
they intentionally do *not* go through the ``Backup`` CLI's env-based
resolution, since that always reflects whichever DB the server itself
was started against, not whichever one the admin picked in the UI.
They still reuse the CLI module's ``_pg_dump``/``_pg_restore`` subprocess
helpers, same as the two arbitrary-remote-credential operations below
(dumping/restoring against a host/user/password supplied in the request
body), which have no equivalent CLI action at all.
"""

import io
import subprocess
import tempfile

from flask import jsonify, request, send_file

from dashboard.cli.database.backup import _parse_local_db, _pg_dump, _pg_restore
from .admin_db import TARGETS, resolve_target_uri, target_available

DEFAULT_REMOTE_URL = "https://www.milabench.com"


def _target_from_request(source=None) -> str:
    source = source if source is not None else request.args
    target = source.get("target", "dev")
    if target not in TARGETS:
        raise ValueError(f"Invalid target {target!r}; expected one of {TARGETS}")
    return target


def sync_routes(bp):

    @bp.route('/api/sync/backup', methods=['POST'])
    def backup_remote_database():
        """Download a pg_dump from an explicitly-specified PostgreSQL database."""
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
            return jsonify({"status": "ERR", "message": "pg_dump not found - install PostgreSQL client tools"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @bp.route('/api/sync/restore', methods=['POST'])
    def restore_backup():
        """Restore a pg_dump backup into the selected target database."""
        if 'file' not in request.files:
            return jsonify({"status": "ERR", "message": "No file provided"}), 400

        try:
            target = _target_from_request(request.form)
            conn = _parse_local_db(resolve_target_uri(target))
        except ValueError as err:
            return jsonify({"status": "ERR", "message": str(err)}), 400

        with tempfile.NamedTemporaryFile(suffix=".dump", delete=True) as tmp:
            request.files['file'].save(tmp.name)

            try:
                stderr, rc = _pg_restore(tmp.name, **conn)
                if rc != 0 and "ERROR" in stderr:
                    return jsonify({"status": "WARN", "message": f"Restore completed with warnings:\n{stderr}"})
                if rc != 0:
                    return jsonify({"status": "WARN", "message": stderr})
                return jsonify({"status": "OK", "message": f"Database restored successfully to {target}"})
            except subprocess.TimeoutExpired:
                return jsonify({"status": "ERR", "message": "pg_restore timed out after 600s"}), 504
            except FileNotFoundError:
                return jsonify({"status": "ERR", "message": "pg_restore not found - install PostgreSQL client tools"}), 500
            except Exception as err:
                return jsonify({"status": "ERR", "message": str(err)}), 500

    @bp.route('/api/sync/push-to-remote', methods=['POST'])
    def push_to_remote():
        """Dump the selected source target (dev/prod) and restore it into an arbitrary remote database."""
        data = request.json or {}
        remote_host = data.get("host")
        remote_port = data.get("port", "5432")
        remote_dbname = data.get("dbname")
        remote_user = data.get("user")
        remote_password = data.get("password")
        remote_sslmode = data.get("sslmode", "require")

        if not all([remote_host, remote_dbname, remote_user, remote_password]):
            return jsonify({"status": "ERR", "message": "Remote host, dbname, user, and password are required"}), 400

        try:
            target = _target_from_request(data)
            source = _parse_local_db(resolve_target_uri(target))
        except ValueError as err:
            return jsonify({"status": "ERR", "message": str(err)}), 400

        try:
            # Step 1: pg_dump from the selected source target
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
            return jsonify({"status": "ERR", "message": "pg_dump/pg_restore not found - install PostgreSQL client tools"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @bp.route('/api/sync/local-backup', methods=['GET'])
    def local_backup():
        """Create a pg_dump of the selected target database and download it."""
        try:
            target = _target_from_request()
            conn = _parse_local_db(resolve_target_uri(target))
        except ValueError as err:
            return jsonify({"status": "ERR", "message": str(err)}), 400

        try:
            stdout, stderr, rc = _pg_dump(**conn)
            if rc != 0:
                return jsonify({"status": "ERR", "message": stderr}), 500

            return send_file(
                io.BytesIO(stdout),
                mimetype="application/octet-stream",
                as_attachment=True,
                download_name=f"milabench_{target}_backup.dump",
            )
        except subprocess.TimeoutExpired:
            return jsonify({"status": "ERR", "message": "pg_dump timed out"}), 504
        except FileNotFoundError:
            return jsonify({"status": "ERR", "message": "pg_dump not found"}), 500
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

    @bp.route('/api/sync/db-targets', methods=['GET'])
    def db_targets():
        """List which DB targets (dev/prod) are configured in secrets.toml."""
        return jsonify({
            "targets": [
                {"name": t, "available": target_available(t)}
                for t in TARGETS
            ],
            "default": "dev",
        })

    @bp.route('/api/sync/remote-info', methods=['GET'])
    def remote_info():
        """Return the default remote dashboard URL."""
        return jsonify({
            "default_url": DEFAULT_REMOTE_URL,
        })
