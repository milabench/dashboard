"""Unit tests for milabench health helpers."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from dashboard.server.database.models import Base, Exec, Pack
from dashboard.server.milabench_health import (
    classify_ci_gb10,
    classify_docker,
    commits_match,
    exec_is_gb10,
    lookup_gb10,
    pack_counts,
    repo_matches,
)
from dashboard.server.visibility import VISIBILITY_PRIVATE, VISIBILITY_PUBLIC


def test_commits_match_prefix():
    full = "abcdef1234567890"
    assert commits_match(full, full[:8])
    assert commits_match(full[:8], full)
    assert not commits_match(full, "12345678")
    assert not commits_match("abc", "abcdef1")


def test_repo_matches_url_and_slug():
    assert repo_matches("https://github.com/milabench/milabench.git", "milabench", "milabench")
    assert repo_matches("git@github.com:mila-iqia/milabench.git", "mila-iqia", "milabench")
    assert repo_matches("milabench/milabench", "milabench", "milabench")
    assert not repo_matches("https://github.com/mila-iqia/milabench", "milabench", "milabench")
    assert not repo_matches(None, "milabench", "milabench")


def test_exec_is_gb10():
    assert exec_is_gb10({"accelerators": {"gpus": {"0": {"product": "NVIDIA GB10"}}}})
    assert not exec_is_gb10({"accelerators": {"gpus": {"0": {"product": "NVIDIA H100"}}}})
    assert not exec_is_gb10({})


def test_pack_counts():
    assert pack_counts(["done", "early_stop", "error", "failed"]) == {
        "total": 4,
        "passed": 2,
        "failed": 2,
    }


def test_classify_docker_published_for_latest_main():
    sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    workflow = {
        "found": True,
        "head_sha": sha,
        "conclusion": "success",
        "jobs": [
            {"name": "build-image (cuda)", "conclusion": "success"},
            {"name": "build-image (rocm)", "conclusion": "failure"},
        ],
    }
    result = classify_docker(sha, workflow)
    assert result["published"] is True
    assert result["cuda_published"] is True
    assert result["rocm_published"] is False
    assert result["matches_latest_main"] is True


def test_classify_docker_stale_when_sha_differs():
    workflow = {
        "found": True,
        "head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "conclusion": "success",
        "jobs": [{"name": "build-image (cuda)", "conclusion": "success"}],
    }
    result = classify_docker("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workflow)
    assert result["published"] is False
    assert result["matches_latest_main"] is False


def test_classify_ci_gb10_counts_failed_groups():
    sha = "cccccccccccccccccccccccccccccccccccccccc"
    workflow = {
        "found": True,
        "head_sha": sha,
        "jobs": [
            {"name": "groups", "status": "completed", "conclusion": "success"},
            {"name": "bench/huggingface", "status": "completed", "conclusion": "failure"},
            {"name": "bench/llm", "status": "completed", "conclusion": "success"},
            {"name": "report", "status": "completed", "conclusion": "success"},
        ],
    }
    result = classify_ci_gb10(sha, workflow)
    assert result["ran"] is True
    assert result["bench_total"] == 2
    assert result["bench_failed"] == 1
    assert result["failed_jobs"] == ["bench/huggingface"]


@pytest.fixture()
def sess():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[Exec.__table__, Pack.__table__])
    with Session(engine) as session:
        yield session


def _gb10_exec(name, commit, repo, *, visibility=VISIBILITY_PUBLIC, packs=None):
    run = Exec(
        name=name,
        visibility=visibility,
        created_time=datetime.utcnow(),
        status="completed",
        meta={
            "accelerators": {"gpus": {"0": {"product": "NVIDIA GB10"}}},
            "milabench": {"repo": repo, "branch": "main", "commit": commit},
        },
    )
    return run, packs or []


def test_lookup_gb10_prefers_latest_main_commit(sess):
    latest = "dddddddddddddddddddddddddddddddddddddddd"
    older, older_packs = _gb10_exec(
        "old",
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "https://github.com/milabench/milabench.git",
        packs=[("done", 3), ("error", 2)],
    )
    current, current_packs = _gb10_exec(
        latest,
        latest,
        "https://github.com/milabench/milabench.git",
        packs=[("done", 4), ("error", 1)],
    )
    other, _ = _gb10_exec(
        "upstream",
        latest,
        "https://github.com/mila-iqia/milabench.git",
        packs=[("done", 1)],
    )
    private, _ = _gb10_exec(
        "hidden",
        latest,
        "https://github.com/milabench/milabench.git",
        visibility=VISIBILITY_PRIVATE,
        packs=[("error", 9)],
    )
    sess.add_all([older, current, other, private])
    sess.flush()
    for run, specs in ((older, older_packs), (current, current_packs)):
        for status, count in specs:
            for _ in range(count):
                sess.add(Pack(exec_id=run._id, name="bench", status=status))
    sess.commit()

    result = lookup_gb10(sess, "milabench", "milabench", latest)
    assert result["ran"] is True
    assert result["failures"] == 1
    assert result["for_latest_main"]["exec_id"] == current._id
    assert result["for_latest_main"]["packs"] == {"total": 5, "passed": 4, "failed": 1}


def test_lookup_gb10_reports_failures_when_latest_did_not_run(sess):
    latest = "ffffffffffffffffffffffffffffffffffffffff"
    older, _ = _gb10_exec(
        "old-main",
        "1111111111111111111111111111111111111111",
        "milabench/milabench",
        packs=[("done", 1), ("failed", 3)],
    )
    sess.add(older)
    sess.flush()
    sess.add(Pack(exec_id=older._id, name="ok", status="done"))
    sess.add(Pack(exec_id=older._id, name="a", status="failed"))
    sess.add(Pack(exec_id=older._id, name="b", status="failed"))
    sess.add(Pack(exec_id=older._id, name="c", status="failed"))
    sess.commit()

    result = lookup_gb10(sess, "milabench", "milabench", latest)
    assert result["ran"] is False
    assert result["for_latest_main"] is None
    assert result["failures"] == 3
    assert result["latest_on_main"]["exec_id"] == older._id
