"""Milabench CI / Docker / GB10 health for the dashboard Health page."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import jsonify
from sqlalchemy import TEXT, cast, func, select

from dashboard.server.database.models import Exec, Pack
from dashboard.server.visibility import public_exec_filter

GITHUB_API = "https://api.github.com"
USER_AGENT = "milabench-dashboard-health"
CACHE_TTL_S = 90
PASSED_PACK_STATUSES = frozenset({"done", "early_stop"})
BRANCH = "main"

REPOS = (
    {
        "id": "milabench",
        "owner": "milabench",
        "repo": "milabench",
        "label": "milabench/milabench",
    },
    {
        "id": "mila-iqia",
        "owner": "mila-iqia",
        "repo": "milabench",
        "label": "mila-iqia/milabench",
    },
)

_CACHE: dict = {"ts": 0.0, "payload": None}


def commits_match(left: str | None, right: str | None) -> bool:
    """True when two git SHAs refer to the same commit (prefix-safe)."""
    a = (left or "").strip().lower()
    b = (right or "").strip().lower()
    if len(a) < 7 or len(b) < 7:
        return False
    return a.startswith(b) or b.startswith(a)


def repo_matches(repo_field: str | None, owner: str, repo: str) -> bool:
    """True when milabench.repo points at owner/repo (url, ssh, or slug)."""
    if not repo_field:
        return False
    needle = f"{owner}/{repo}".lower()
    text = repo_field.strip().lower().rstrip("/")
    if text.endswith(".git"):
        text = text[:-4]
    return needle in text


def exec_is_gb10(meta: dict | None) -> bool:
    gpus = ((meta or {}).get("accelerators") or {}).get("gpus") or {}
    first = gpus.get("0") or gpus.get(0) or {}
    product = str(first.get("product") or "")
    return "GB10" in product.upper()


def pack_counts(statuses: list[str]) -> dict:
    total = len(statuses)
    passed = sum(1 for status in statuses if status in PASSED_PACK_STATUSES)
    return {"total": total, "passed": passed, "failed": total - passed}


def github_token() -> str:
    return (
        os.environ.get("GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or os.environ.get("MILABENCH_GITHUB_TOKEN")
        or ""
    ).strip()


def github_get(path: str, params: dict | None = None, timeout: float = 15):
    """GET a GitHub API path. Returns (json, error_dict)."""
    url = GITHUB_API + path
    if params:
        url += "?" + urllib.parse.urlencode(
            {key: value for key, value in params.items() if value is not None}
        )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        return None, {"status": exc.code, "message": str(exc.reason or exc)}
    except Exception as exc:
        return None, {"status": 0, "message": str(exc)}


def _summarize_jobs(jobs: list[dict]) -> list[dict]:
    return [
        {
            "name": job.get("name"),
            "status": job.get("status"),
            "conclusion": job.get("conclusion"),
            "html_url": job.get("html_url"),
        }
        for job in jobs
    ]


def _workflow_summary(owner: str, repo: str, run: dict | None, error: dict | None) -> dict:
    if error and not run:
        return {
            "found": False,
            "error": error,
            "id": None,
            "status": None,
            "conclusion": None,
            "head_sha": None,
            "html_url": None,
            "updated_at": None,
            "jobs": [],
        }
    if not run:
        return {
            "found": False,
            "error": None,
            "id": None,
            "status": None,
            "conclusion": None,
            "head_sha": None,
            "html_url": None,
            "updated_at": None,
            "jobs": [],
        }

    jobs_payload, jobs_error = github_get(
        f"/repos/{owner}/{repo}/actions/runs/{run['id']}/jobs",
        {"per_page": 100},
    )
    jobs = _summarize_jobs((jobs_payload or {}).get("jobs") or [])
    return {
        "found": True,
        "error": jobs_error,
        "id": run.get("id"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "head_sha": run.get("head_sha"),
        "html_url": run.get("html_url"),
        "updated_at": run.get("updated_at") or run.get("created_at"),
        "jobs": jobs,
    }


def fetch_latest_commit(owner: str, repo: str, branch: str = BRANCH) -> tuple[dict | None, dict | None]:
    data, error = github_get(f"/repos/{owner}/{repo}/commits/{branch}")
    if error or not data:
        return None, error
    commit = data.get("commit") or {}
    author = commit.get("committer") or commit.get("author") or {}
    message = (commit.get("message") or "").split("\n", 1)[0]
    return {
        "sha": data.get("sha"),
        "html_url": data.get("html_url"),
        "date": author.get("date"),
        "message": message,
    }, None


def fetch_latest_workflow(owner: str, repo: str, workflow: str, branch: str = BRANCH) -> dict:
    data, error = github_get(
        f"/repos/{owner}/{repo}/actions/workflows/{workflow}/runs",
        {
            "branch": branch,
            "per_page": 1,
            "exclude_pull_requests": "true",
        },
    )
    runs = (data or {}).get("workflow_runs") or []
    return _workflow_summary(owner, repo, runs[0] if runs else None, error)


def classify_docker(latest_sha: str | None, workflow: dict) -> dict:
    """Whether docker.yml published an image for the latest main commit."""
    jobs = workflow.get("jobs") or []
    cuda_job = next(
        (job for job in jobs if "cuda" in (job.get("name") or "").lower()),
        None,
    )
    rocm_job = next(
        (job for job in jobs if "rocm" in (job.get("name") or "").lower()),
        None,
    )
    matches = commits_match(latest_sha, workflow.get("head_sha"))
    cuda_ok = bool(cuda_job and cuda_job.get("conclusion") == "success")
    rocm_ok = bool(rocm_job and rocm_job.get("conclusion") == "success")
    run_ok = workflow.get("conclusion") == "success"
    published = matches and (cuda_ok or (not jobs and run_ok))
    return {
        **workflow,
        "matches_latest_main": matches,
        "cuda_published": matches and (cuda_ok or (not jobs and run_ok)),
        "rocm_published": matches and rocm_ok,
        "published": published,
    }


def classify_ci_gb10(latest_sha: str | None, workflow: dict) -> dict:
    """GitHub CI bench/* jobs are the self-hosted GB10 runners."""
    jobs = workflow.get("jobs") or []
    bench_jobs = [job for job in jobs if (job.get("name") or "").startswith("bench/")]
    completed = [job for job in bench_jobs if job.get("status") == "completed"]
    failed = [
        job
        for job in completed
        if job.get("conclusion") not in (None, "success", "skipped", "cancelled")
    ]
    matches = commits_match(latest_sha, workflow.get("head_sha"))
    ran = matches and bool(bench_jobs)
    return {
        **workflow,
        "matches_latest_main": matches,
        "ran": ran,
        "bench_total": len(bench_jobs),
        "bench_completed": len(completed),
        "bench_failed": len(failed),
        "failed_jobs": [job.get("name") for job in failed],
    }


def _exec_repo_branch_commit(row: Exec) -> tuple[str, str, str]:
    meta = row.meta or {}
    milabench = meta.get("milabench") or {}
    return (
        str(milabench.get("repo") or ""),
        str(milabench.get("branch") or ""),
        str(milabench.get("commit") or ""),
    )


def _fetch_gb10_execs(sess) -> list[Exec]:
    bind = sess.get_bind()
    stmt = (
        select(Exec)
        .where(public_exec_filter())
        .order_by(Exec._id.desc())
        .limit(400)
    )
    if bind is not None and bind.dialect.name == "postgresql":
        gpu_col = cast(Exec.meta["accelerators"]["gpus"]["0"]["product"], TEXT)
        stmt = (
            select(Exec)
            .where(public_exec_filter())
            .where(gpu_col.ilike("%GB10%"))
            .order_by(Exec._id.desc())
            .limit(400)
        )
        return list(sess.execute(stmt).scalars().all())
    rows = list(sess.execute(stmt).scalars().all())
    return [row for row in rows if exec_is_gb10(row.meta)]


def _pack_counts_for_exec(sess, exec_id: int) -> dict:
    rows = sess.execute(
        select(Pack.status, func.count())
        .where(Pack.exec_id == exec_id)
        .group_by(Pack.status)
    ).all()
    statuses: list[str] = []
    for status, count in rows:
        statuses.extend([status or "unknown"] * int(count))
    return pack_counts(statuses)


def _serialize_gb10(sess, row: Exec | None, latest_sha: str | None) -> dict | None:
    if row is None:
        return None
    _repo, branch, commit = _exec_repo_branch_commit(row)
    created = row.created_time.isoformat() if row.created_time else None
    counts = _pack_counts_for_exec(sess, row._id)
    return {
        "exec_id": row._id,
        "name": row.name,
        "status": row.status,
        "created_time": created,
        "commit": commit or None,
        "branch": branch or None,
        "matches_latest_main": commits_match(latest_sha, commit) or commits_match(latest_sha, row.name),
        "packs": counts,
    }


def lookup_gb10(sess, owner: str, repo: str, latest_sha: str | None) -> dict:
    rows = _fetch_gb10_execs(sess)
    exact = None
    latest_for_repo = None
    for row in rows:
        repo_field, branch, commit = _exec_repo_branch_commit(row)
        belongs = repo_matches(repo_field, owner, repo) or not repo_field
        if not belongs:
            continue
        if latest_for_repo is None and (branch == BRANCH or not branch):
            latest_for_repo = row
        if latest_sha and (
            commits_match(commit, latest_sha) or commits_match(row.name, latest_sha)
        ):
            exact = row
            break

    matched = _serialize_gb10(sess, exact, latest_sha)
    latest = _serialize_gb10(sess, latest_for_repo, latest_sha)
    if matched is None and latest is not None and latest.get("matches_latest_main"):
        matched = latest

    ran = bool(matched and matched.get("matches_latest_main"))
    source = matched if ran else latest
    failures = None
    if source and source.get("packs"):
        failures = source["packs"]["failed"]
    return {
        "ran": ran,
        "failures": failures,
        "for_latest_main": matched if ran else None,
        "latest_on_main": latest,
    }


def build_repo_health(sess, spec: dict) -> dict:
    owner, repo = spec["owner"], spec["repo"]
    commit, commit_error = fetch_latest_commit(owner, repo)
    sha = (commit or {}).get("sha")
    docker_run = fetch_latest_workflow(owner, repo, "docker.yml")
    ci_run = fetch_latest_workflow(owner, repo, "ci.yml")
    docker = classify_docker(sha, docker_run)
    ci = classify_ci_gb10(sha, ci_run)
    gb10 = lookup_gb10(sess, owner, repo, sha)
    # Self-hosted CI on the milabench fork is the GB10 / Spark runner.
    # Do not treat upstream mila-iqia CI jobs as GB10.
    if spec["id"] == "milabench" and not gb10["ran"] and ci.get("ran"):
        if gb10["failures"] is None:
            gb10["failures"] = ci.get("bench_failed")
        gb10["source"] = "github_ci"
    elif gb10["ran"]:
        gb10["source"] = "dashboard"
    elif gb10["latest_on_main"]:
        gb10["source"] = "dashboard_stale"
    else:
        gb10["source"] = "none"
    return {
        "id": spec["id"],
        "label": spec["label"],
        "owner": owner,
        "repo": repo,
        "html_url": f"https://github.com/{owner}/{repo}",
        "commit": commit,
        "commit_error": commit_error,
        "docker": docker,
        "ci": ci,
        "gb10": gb10,
    }


def build_health_payload(sess) -> dict:
    return {
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "branch": BRANCH,
        "repos": [build_repo_health(sess, spec) for spec in REPOS],
    }


def get_health_payload(sess, *, use_cache: bool = True) -> dict:
    now = time.time()
    if use_cache and _CACHE["payload"] and now - _CACHE["ts"] < CACHE_TTL_S:
        return _CACHE["payload"]
    payload = build_health_payload(sess)
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload


def clear_health_cache() -> None:
    _CACHE["ts"] = 0.0
    _CACHE["payload"] = None


def milabench_health_routes(bp, sqlexec):
    @bp.route("/api/health/milabench")
    def api_milabench_health():
        with sqlexec() as sess:
            return jsonify(get_health_payload(sess))
