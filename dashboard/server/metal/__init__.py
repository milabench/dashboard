#
#  Run on baremetal machine
#
#   We can still ssh and run things but we need to be fire and forget
#
#     Options:
#
#       ssh node "nohup milabench > output.log 2>&1 &"
#       ssh node "echo 'milabench' | at now"
#       ssh node "systemd-run --unit=myjob.service --user long_command"
#
#       ssh node "ps -ef | grep milabench"
#
from __future__ import annotations

from typing import Any

import requests
from flask import Response, abort, jsonify, request

class Baremetal:
    # Schedule a job
    def sbatch():
        pass

    # List running jobs
    def squeue():
        pass

    # Get accounting info about a job
    def sacct():
        pass

    # Get info about a job
    def sinfo():
        pass


def baremetal_server(app):
    # Baremetal
    #   we can SSH to them
    #   milabench has an agent running there
    baremetal_hosts: dict[str, dict[str, Any]] = {
        "NVL": {
            "url": "http://localhost:5001"
        }
    }

    def get_host(name: str) -> dict[str, Any]:
        info = baremetal_hosts.get(name)
        if not info:
            abort(404, description=f"Unknown baremetal host '{name}'")
        return info

    def forward_request(name: str, route: str = "") -> Response:
        info = get_host(name)
        base_url = info["url"].rstrip("/")
        route = route.lstrip("/")
        url = f"{base_url}/{route}" if route else base_url

        upstream = requests.request(
            method=request.method,
            url=url,
            params=request.args,
            headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
        )

        response = Response(upstream.content, status=upstream.status_code)
        if "Content-Type" in upstream.headers:
            response.headers["Content-Type"] = upstream.headers["Content-Type"]
        
        print(response)
        return response

    def setup_agent():
        # Install the milabench agent on the machine
        # This can use ansible
        pass

    @app.route("/api/metal/sync/<string:name>")
    def sync_jobs(name):
        info = get_host(name)
        # How can I get this ?
        ssh = info["ssh"]
        folder = info["remote_folder"]
        dest = ".."

        cmd = "rsync {ssh}:{folder} {dest}"

    @app.route("/api/metal/list")
    def list_hosts():
        return baremetal_hosts


    #
    #
    #

    #
    #   This is problematic when we need to pass through SSH
    #   We can parse ~/.ssh/config instead and get the nodes from there
    #
    @app.route("/api/metal/register/<string:address>/<int:port>", methods=["POST"])
    @app.route("/api/metal/register/<string:address>/<int:port>/<string:name>", methods=["POST"])
    def register_new_host(address: str, port: int, name: str | None = None):
        # Register a new host to this server
        # NOTE: we need to ssh to the server fo open the connection, which kind of sucks
        try:
            url = f"http://{address}:{port}"
            host_info = requests.get(f"{url}/config", timeout=5).json()

            if name is None:
                name = f"{address}:{port}"

            host_info["url"] = url
            baremetal_hosts[name] = host_info
            return jsonify({"status": "ok"})
        except requests.RequestException as exc:
            return jsonify({"status": "no", "error": str(exc)}), 502
        except ValueError:
            return jsonify({"status": "no", "error": "Invalid /config response"}), 502

    @app.route("/api/metal/<string:name>", defaults={"route": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    @app.route("/api/metal/<string:name>/<path:route>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def forward_to_agent(name: str, route: str):
        # Forward all requests to the agent based on the host name
        return forward_request(name, route)

