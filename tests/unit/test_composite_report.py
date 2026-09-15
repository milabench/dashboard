"""Tests for composite report bench-assignment logic.

The assignment step is the only part that doesn't touch Postgres-specific SQL
(window functions, percentile_cont), so it can be tested with pure Python.
"""

import pytest

from dashboard.server.database.grouping import assign_benches_to_execs, rank_execs_by_success


# ── helpers ───────────────────────────────────────────────────────────────────


def _run(ordered_ids, packs_by_exec):
    """Thin wrapper that normalises the result for easier assertions."""
    result = assign_benches_to_execs(ordered_ids, packs_by_exec)
    # sort bench lists so comparisons are order-independent
    return {eid: sorted(benches) for eid, benches in result.items()}


# ── happy-path scenarios ──────────────────────────────────────────────────────


class TestAssignBenchesToExecs:

    def test_single_exec_gets_all_benches(self):
        result = _run(
            ordered_ids=[1],
            packs_by_exec={1: {"bert", "resnet", "llama"}},
        )
        assert result == {1: ["bert", "llama", "resnet"]}

    def test_latest_run_wins_when_complete(self):
        """Latest exec has all benches → only it is used."""
        result = _run(
            ordered_ids=[2, 1],
            packs_by_exec={
                2: {"bert", "resnet"},
                1: {"bert", "resnet"},
            },
        )
        assert result == {2: ["bert", "resnet"]}
        assert 1 not in result

    def test_older_run_fills_missing_bench(self):
        """Latest exec is missing 'llama' → older run provides it."""
        result = _run(
            ordered_ids=[2, 1],
            packs_by_exec={
                2: {"bert", "resnet"},
                1: {"bert", "resnet", "llama"},
            },
        )
        assert result[2] == ["bert", "resnet"]
        assert result[1] == ["llama"]

    def test_multiple_fill_ins_across_runs(self):
        """Each older run fills whatever the newer ones lacked."""
        result = _run(
            ordered_ids=[3, 2, 1],
            packs_by_exec={
                3: {"bert"},
                2: {"resnet"},
                1: {"bert", "resnet", "llama"},
            },
        )
        assert result[3] == ["bert"]
        assert result[2] == ["resnet"]
        assert result[1] == ["llama"]

    def test_no_mixing_within_bench(self):
        """A bench that appears in both runs is always taken from the newest."""
        result = _run(
            ordered_ids=[3, 2, 1],
            packs_by_exec={
                3: {"bert", "resnet"},
                2: {"bert", "resnet", "llama"},
                1: {"bert", "resnet", "llama", "gpt"},
            },
        )
        # exec 3 claims bert + resnet, exec 2 claims llama, exec 1 claims gpt
        assert result[3] == ["bert", "resnet"]
        assert result[2] == ["llama"]
        assert result[1] == ["gpt"]

    def test_all_benches_in_oldest_run(self):
        """Latest run is completely empty; oldest run provides everything."""
        result = _run(
            ordered_ids=[3, 2, 1],
            packs_by_exec={
                3: set(),
                2: set(),
                1: {"bert", "resnet"},
            },
        )
        assert 3 not in result
        assert 2 not in result
        assert result[1] == ["bert", "resnet"]

    def test_empty_group(self):
        assert _run([], {}) == {}

    def test_exec_with_no_packs_is_skipped(self):
        result = _run(
            ordered_ids=[2, 1],
            packs_by_exec={
                2: set(),
                1: {"bert"},
            },
        )
        assert 2 not in result
        assert result[1] == ["bert"]

    def test_exec_not_in_packs_dict(self):
        """Exec IDs absent from packs_by_exec are treated as having no packs."""
        result = _run(
            ordered_ids=[2, 1],
            packs_by_exec={1: {"bert"}},
        )
        assert 2 not in result
        assert result[1] == ["bert"]

    def test_single_bench_many_runs(self):
        """Only the newest run that has the bench should win."""
        result = _run(
            ordered_ids=[5, 4, 3, 2, 1],
            packs_by_exec={eid: {"bert"} for eid in [5, 4, 3, 2, 1]},
        )
        assert result == {5: ["bert"]}

    def test_ordering_matters(self):
        """Reversing ordered_ids changes which exec wins."""
        packs = {1: {"bert"}, 2: {"bert"}}

        newest_first = _run([2, 1], packs)
        oldest_first = _run([1, 2], packs)

        assert newest_first == {2: ["bert"]}
        assert oldest_first == {1: ["bert"]}


# ── status-aware assignment (avoid failed benchmarks when a clean run exists) ──


class TestAssignBenchesToExecsWithStatus:

    def test_older_success_preferred_over_newer_failure(self):
        """Newest run failed 'bert' but an older run has it clean → use the older one."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert"}},
            status_by_exec={2: {"bert": "failed"}, 1: {"bert": "done"}},
        )
        assert result == {1: ["bert"]}

    def test_newest_success_still_wins(self):
        """Both succeeded → recency still decides, unchanged from the base case."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert"}},
            status_by_exec={2: {"bert": "done"}, 1: {"bert": "done"}},
        )
        assert result == {2: ["bert"]}

    def test_failed_everywhere_falls_back_to_newest(self):
        """No exec succeeded → still show it (as failed) from the newest run
        rather than silently dropping the bench."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert"}},
            status_by_exec={2: {"bert": "failed"}, 1: {"bert": "failed"}},
        )
        assert result == {2: ["bert"]}

    def test_mixed_benches_pick_independently(self):
        """Each bench is judged on its own status, not the whole run's."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert", "resnet"}, 1: {"bert", "resnet"}},
            status_by_exec={
                2: {"bert": "failed", "resnet": "done"},
                1: {"bert": "done", "resnet": "done"},
            },
        )
        assert result == {2: ["resnet"], 1: ["bert"]}

    def test_no_status_info_matches_original_recency_behavior(self):
        """Omitting status_by_exec reproduces the pre-existing behavior exactly."""
        packs = {2: {"bert"}, 1: {"bert"}}
        assert assign_benches_to_execs([2, 1], packs) == {2: ["bert"]}
        assert assign_benches_to_execs([2, 1], packs, status_by_exec=None) == {2: ["bert"]}

    def test_exec_missing_from_status_dict_treated_as_unknown(self):
        """An exec with no status entries at all still falls back correctly."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert"}},
            status_by_exec={1: {"bert": "done"}},
        )
        assert result == {1: ["bert"]}


# ── drop_unresolved: leave out benches that never succeeded anywhere ───────────


class TestAssignBenchesToExecsDropUnresolved:

    def test_bench_failed_everywhere_is_dropped(self):
        """No exec succeeded on 'bert' → it's left out entirely, not shown as failed."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert", "resnet"}, 1: {"bert", "resnet"}},
            status_by_exec={
                2: {"bert": "failed", "resnet": "done"},
                1: {"bert": "failed", "resnet": "done"},
            },
            drop_unresolved=True,
        )
        assert result == {2: ["resnet"]}
        assert "bert" not in [b for bs in result.values() for b in bs]

    def test_bench_missing_everywhere_is_dropped(self):
        """No exec even has the pack at all → left out, same as a universal failure."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"resnet"}, 1: {"resnet"}},
            status_by_exec={2: {"resnet": "done"}, 1: {"resnet": "done"}},
            drop_unresolved=True,
        )
        assert result == {2: ["resnet"]}

    def test_older_run_still_fills_gap_when_resolvable(self):
        """A bench missing on the newest exec but succeeding on an older one
        is still pulled in — drop_unresolved only affects truly-unresolved
        benches, not the normal older-run-fills-the-gap behavior."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"resnet"}, 1: {"resnet", "bert"}},
            status_by_exec={2: {"resnet": "done"}, 1: {"resnet": "done", "bert": "done"}},
            drop_unresolved=True,
        )
        assert result == {2: ["resnet"], 1: ["bert"]}

    def test_default_still_shows_unresolved_as_failed(self):
        """Without drop_unresolved, existing show-it-as-failed behavior is unchanged."""
        result = assign_benches_to_execs(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert"}},
            status_by_exec={2: {"bert": "failed"}, 1: {"bert": "failed"}},
        )
        assert result == {2: ["bert"]}


# ── ranking execs by success count before assignment ───────────────────────────


class TestRankExecsBySuccess:

    def test_more_successful_run_ranked_first(self):
        """Exec 1 (older) succeeded on more benches than exec 2 (newer)."""
        ranked = rank_execs_by_success(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert", "resnet", "llama"}},
            status_by_exec={
                2: {"bert": "done"},
                1: {"bert": "done", "resnet": "done", "llama": "done"},
            },
        )
        assert ranked == [1, 2]

    def test_ties_keep_incoming_recency_order(self):
        """Equal success counts: the newest-first order passed in is preserved."""
        ranked = rank_execs_by_success(
            ordered_exec_ids=[3, 2, 1],
            packs_by_exec={3: {"bert"}, 2: {"bert"}, 1: {"bert"}},
            status_by_exec={
                3: {"bert": "done"},
                2: {"bert": "done"},
                1: {"bert": "done"},
            },
        )
        assert ranked == [3, 2, 1]

    def test_failed_benches_dont_count_as_successes(self):
        """Exec 2 has more packs but most failed; exec 1 has fewer, all clean."""
        ranked = rank_execs_by_success(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert", "resnet", "llama"}, 1: {"bert", "resnet"}},
            status_by_exec={
                2: {"bert": "done", "resnet": "failed", "llama": "failed"},
                1: {"bert": "done", "resnet": "done"},
            },
        )
        assert ranked == [1, 2]

    def test_missing_status_counts_as_zero_successes(self):
        """Omitting status_by_exec entirely: every exec has 0 successes, order unchanged."""
        ranked = rank_execs_by_success(
            ordered_exec_ids=[2, 1],
            packs_by_exec={2: {"bert"}, 1: {"bert", "resnet"}},
        )
        assert ranked == [2, 1]

    def test_feeding_ranked_order_concentrates_composite_into_one_run(self):
        """End-to-end: ranking by success before assignment pulls almost
        everything from the single most-complete run instead of splitting
        across runs bench-by-bench-recency."""
        packs_by_exec = {
            3: {"bert"},  # newest, but only ran one bench
            2: {"bert", "resnet", "llama", "gpt"},  # most complete, slightly older
            1: {"bert", "resnet", "llama", "gpt"},  # oldest, also complete
        }
        status_by_exec = {
            3: {"bert": "done"},
            2: {"bert": "done", "resnet": "done", "llama": "done", "gpt": "done"},
            1: {"bert": "done", "resnet": "done", "llama": "done", "gpt": "done"},
        }
        ranked = rank_execs_by_success([3, 2, 1], packs_by_exec, status_by_exec)
        result = assign_benches_to_execs(ranked, packs_by_exec, status_by_exec)
        # exec 2 (most complete, ranked first) supplies everything; nothing
        # is pulled from exec 3 or exec 1.
        assert sorted(result[2]) == ["bert", "gpt", "llama", "resnet"]
        assert 3 not in result
        assert 1 not in result
