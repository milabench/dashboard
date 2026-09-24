"""Trigger the milabench/deploy GitHub Actions workflows (backend/frontend).

https://github.com/milabench/deploy/actions

Requires a GitHub personal access token with ``repo`` scope (classic) or
"Actions: Read and write" (fine-grained) on milabench/deploy, set as
``GITHUB_DEPLOY_TOKEN`` — env var or ``[common]``/``[dev]``/``[prod]`` in
secrets.toml.
"""

from pathlib import Path

import requests
from flask import jsonify, request

from .slurm.constant import JOBRUNNER_LOCAL_CACHE
from .slurm.secrets import EnvSecretProvider, TomlSecretProvider

GITHUB_REPO = "milabench/deploy"
GITHUB_API = "https://api.github.com"

# workflow_dispatch target -> workflow file (see .github/workflows/ in milabench/deploy)
DEPLOY_WORKFLOWS = {
    "backend": "deploy-backend.yml",
    "frontend": "deploy-frontend.yml",
}


def _github_token() -> str | None:
    env_secret = EnvSecretProvider().get("GITHUB_DEPLOY_TOKEN")
    if env_secret:
        return env_secret
    toml_secret = TomlSecretProvider(Path(JOBRUNNER_LOCAL_CACHE) / "secrets.toml", env="dev")
    return toml_secret.get("GITHUB_DEPLOY_TOKEN")


def trigger_deploy(target: str, dashboard_ref: str = "main") -> str:
    """Dispatch the given deploy workflow. Returns the workflow's Actions URL."""
    workflow_file = DEPLOY_WORKFLOWS.get(target)
    if workflow_file is None:
        raise ValueError(f"Unknown deploy target {target!r}; expected one of {sorted(DEPLOY_WORKFLOWS)}")

    token = _github_token()
    if not token:
        raise ValueError(
            "GITHUB_DEPLOY_TOKEN is not configured — set it as an env var or under "
            "[common] in data/secrets.toml. Needs a GitHub PAT with 'repo' scope "
            f"(classic) or Actions read/write (fine-grained) on {GITHUB_REPO}."
        )

    resp = requests.post(
        f"{GITHUB_API}/repos/{GITHUB_REPO}/actions/workflows/{workflow_file}/dispatches",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={"ref": "main", "inputs": {"dashboard_ref": dashboard_ref}},
        timeout=15,
    )
    if resp.status_code != 204:
        raise RuntimeError(f"GitHub API error {resp.status_code}: {resp.text}")

    return f"https://github.com/{GITHUB_REPO}/actions/workflows/{workflow_file}"


def deploy_routes(bp):
    @bp.route("/api/admin/deploy/<string:target>", methods=["POST"])
    def api_admin_deploy(target):
        body = request.get_json(silent=True) or {}
        dashboard_ref = (body.get("dashboard_ref") or "main").strip()

        try:
            actions_url = trigger_deploy(target, dashboard_ref=dashboard_ref)
        except ValueError as err:
            return jsonify({"status": "ERR", "message": str(err)}), 400
        except Exception as err:
            return jsonify({"status": "ERR", "message": str(err)}), 500

        return jsonify(
            {
                "status": "OK",
                "message": f"{target} deploy triggered (dashboard_ref={dashboard_ref})",
                "actions_url": actions_url,
            }
        )
