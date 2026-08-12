import math

import pytest

from dashboard.server.breakdown import aggregate_score, parse_perf_agg


def _row(score, weight=1.0, enabled=1.0, log_score=None, weight_total=3.0):
    return {
        "score": score,
        "weight": weight,
        "enabled": enabled,
        "log_score": log_score if log_score is not None else math.log(score + 1) * weight * enabled,
        "weight_total": weight_total,
    }


class TestParsePerfAgg:
    def test_default_is_median(self):
        assert parse_perf_agg(None) == "median"
        assert parse_perf_agg("") == "median"

    def test_unknown_falls_back_to_median(self):
        assert parse_perf_agg("bogus") == "median"


class TestAggregateScore:
    def test_weighted_geometric_mean(self):
        rows = [_row(100, weight_total=2.0), _row(400, weight_total=2.0)]
        score, count = aggregate_score(rows)
        expected = math.exp((math.log(101) + math.log(401)) / 2.0)
        assert count == 2
        assert score == pytest.approx(expected, rel=1e-3)

    def test_disabled_rows_excluded(self):
        rows = [_row(100), _row(999, enabled=0)]
        score, count = aggregate_score(rows)
        assert count == 1
        assert score == pytest.approx(math.exp(math.log(101)), rel=1e-3)
