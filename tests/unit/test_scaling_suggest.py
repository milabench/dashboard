"""Tests for scaling_suggest.py's sizing.yaml parsing and command building."""

from dashboard.server.scaling_suggest import (
    _FALLBACK_TARGET_BATCH_SIZES,
    suggest_command,
    target_batch_sizes,
)


class TestTargetBatchSizes:
    def test_returns_sorted_list_of_ints(self):
        sizes = target_batch_sizes()
        assert sizes == sorted(sizes)
        assert all(isinstance(s, int) for s in sizes)

    def test_matches_known_fixed_bs_sweep(self):
        # Whether parsed from the real sizing.yaml (present in this repo
        # layout) or the hardcoded fallback, both describe the same sweep.
        assert target_batch_sizes() == _FALLBACK_TARGET_BATCH_SIZES


class TestSuggestCommand:
    def test_includes_bench_and_batch_size(self):
        cmd = suggest_command("bf16", 64)
        assert "--select bf16" in cmd
        assert "--override sizer.batch_size=64" in cmd
        assert "--override sizer.auto=1" in cmd
        assert cmd.startswith("milabench run")
