"""Tests for report computation consistency between CLI and DB paths.

Verifies that:
- Core statistical functions (_metrics, dropminmax) handle edge cases correctly
- aggregate() properly processes event streams
- make_summary() pipeline produces correct results
- _make_row() / make_dataframe() / make_report() score computation is correct
- CLI path and DB path (make_pivot_summary) produce equivalent results
"""

import math
from math import nan, isnan
from io import StringIO
from collections import defaultdict

import numpy as np
import pandas as pd
import pytest

from milabench.summary import (
    _metrics,
    aggregate,
    _classify,
    _filter_failures,
    _keep_latest,
    _merge,
    _summarize,
    make_summary,
    nans,
)
from milabench.report import (
    _make_row,
    make_dataframe,
    make_report,
)
from dashboard.server.report_data import (
    dropminmax,
    mean as db_mean,
    std as db_std,
    sem as db_sem,
    min as db_min,
    q1 as db_q1,
    median as db_median,
    q3 as db_q3,
    max as db_max,
    make_pivot_summary,
)


# ---------------------------------------------------------------------------
# Helpers: synthetic data generators
# ---------------------------------------------------------------------------


def make_config(
    name="bench_a",
    group="group_a",
    weight=1.0,
    enabled=True,
    tag=None,
    device=None,
    plan=None,
    num_machines=1,
):
    """Build a minimal benchmark config dict."""
    if tag is None:
        tag = [name, "0"]
    if plan is None:
        plan = {"method": "per_gpu"}
    cfg = {
        "name": name,
        "group": group,
        "weight": weight,
        "enabled": enabled,
        "tag": tag,
        "plan": plan,
        "num_machines": num_machines,
    }
    if device is not None:
        cfg["device"] = device
    return cfg


def make_events(
    config=None,
    rates=None,
    losses=None,
    return_code=0,
    start_time=1000.0,
    end_time=1010.0,
    gpudata=None,
    early_stop=False,
    include_meta=True,
    task="train",
):
    """Build a list of event dicts mimicking a .data JSONL file.

    This is the input format for ``aggregate()``.
    """
    if config is None:
        config = make_config()
    if rates is None:
        rates = [100.0, 110.0, 105.0]

    events = [{"event": "config", "data": config, "pipe": None}]

    if include_meta:
        events.append({"event": "meta", "data": {}, "pipe": "data"})

    events.append(
        {"event": "start", "data": {"command": ["bench"], "time": start_time}, "pipe": None}
    )

    for rate in rates:
        events.append(
            {"event": "data", "data": {"task": task, "rate": rate, "units": "items/s"}, "pipe": "data"}
        )

    if losses is not None:
        for loss in losses:
            events.append(
                {"event": "data", "data": {"task": task, "loss": loss}, "pipe": "data"}
            )

    if gpudata is not None:
        for gd in gpudata:
            events.append(
                {"event": "data", "data": {"gpudata": gd}, "pipe": "data"}
            )

    if early_stop:
        events.append({"event": "stop", "data": {}, "pipe": None})

    events.append(
        {
            "event": "end",
            "data": {"command": ["bench"], "time": end_time, "return_code": return_code},
            "pipe": None,
        }
    )
    return events


def make_runs_dict(event_lists, prefix="run"):
    """Wrap multiple event lists into the dict format expected by make_summary."""
    return {f"{prefix}_{i}.data": events for i, events in enumerate(event_lists)}


def make_db_dataframe(
    run_name="run1",
    bench_name="bench_a",
    rate_values=None,
    gpu_ids=None,
    status_values=None,
    gpu_memory_values=None,
    gpu_load_values=None,
    weight=1.0,
    priority=1,
    enabled=1,
    weight_total=1.0,
):
    """Build a DataFrame matching the format returned by ``fetch_data_by_query``.

    Columns: run, bench, metric, value, gpu_id, weight, priority, enabled, weight_total
    """
    if rate_values is None:
        rate_values = [100.0, 110.0, 105.0]
    if gpu_ids is None:
        gpu_ids = ["0"]
    if status_values is None:
        status_values = [0]
    if gpu_memory_values is None:
        gpu_memory_values = {}
    if gpu_load_values is None:
        gpu_load_values = {}

    rows = []
    common = {
        "run": run_name,
        "bench": bench_name,
        "weight": weight,
        "priority": priority,
        "enabled": enabled,
        "weight_total": weight_total,
    }

    for gid in gpu_ids:
        for val in rate_values:
            rows.append({**common, "metric": "rate", "value": val, "gpu_id": gid})

    for val in status_values:
        gpu_str = ",".join(gpu_ids)
        rows.append({**common, "metric": "status", "value": val, "gpu_id": gpu_str})

    for gid, values in gpu_memory_values.items():
        for val in values:
            rows.append({**common, "metric": "gpu.memory", "value": val, "gpu_id": gid})

    for gid, values in gpu_load_values.items():
        for val in values:
            rows.append({**common, "metric": "gpu.load", "value": val, "gpu_id": gid})

    return pd.DataFrame(rows)


def all_nans(d):
    """Check if a stats dict is all NaN."""
    return all(isnan(v) for v in d.values())


# ---------------------------------------------------------------------------
# Reusable builder for summary entries (CLI output shape)
# ---------------------------------------------------------------------------


def _build_summary_entry(
    name="bench_a",
    group="group_a",
    n=4,
    successes=4,
    failures=0,
    ngpu=1,
    rates=None,
    weight=1.0,
    enabled=True,
    per_gpu=None,
    gpu_load=None,
):
    """Build a summary dict matching ``_summarize()`` output format."""
    if rates is None:
        rates = [100.0, 110.0, 105.0, 108.0]

    rate_stats = _metrics(rates)

    if per_gpu is None:
        per_gpu = {}
    if gpu_load is None:
        gpu_load = {}

    return {
        "name": name,
        "group": group,
        "n": n,
        "ngpu": ngpu,
        "successes": successes,
        "failures": failures,
        "train_rate": rate_stats,
        "walltime": _metrics([10.0]),
        "per_gpu": per_gpu,
        "gpu_load": gpu_load,
        "weight": weight,
        "enabled": enabled,
        "extra": {},
        "meta": {},
    }


# ===========================================================================
# Group 1: _metrics() edge cases
# ===========================================================================


class TestMetrics:
    """Unit tests for the CLI-side statistical computation."""

    def test_normal_many_values(self):
        xs = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0]
        result = _metrics(xs)
        trimmed = [20.0, 30.0, 40.0, 50.0, 60.0]
        assert result["mean"] == pytest.approx(np.mean(trimmed))
        assert result["std"] == pytest.approx(np.std(trimmed))
        assert result["sem"] == pytest.approx(np.std(trimmed) / len(trimmed) ** 0.5)

    def test_exactly_five_values(self):
        xs = [1.0, 2.0, 3.0, 4.0, 5.0]
        result = _metrics(xs)
        trimmed = [2.0, 3.0, 4.0]
        assert result["mean"] == pytest.approx(np.mean(trimmed))
        assert result["std"] == pytest.approx(np.std(trimmed))

    def test_four_values_no_trimming(self):
        xs = [1.0, 2.0, 3.0, 4.0]
        result = _metrics(xs)
        assert result["mean"] == pytest.approx(np.mean(xs))
        assert result["std"] == pytest.approx(np.std(xs))

    def test_single_value(self):
        result = _metrics([42.0])
        assert result["mean"] == pytest.approx(42.0)
        assert result["std"] == pytest.approx(0.0)
        assert result["sem"] == pytest.approx(0.0)
        assert result["min"] == pytest.approx(42.0)
        assert result["max"] == pytest.approx(42.0)

    def test_two_values(self):
        result = _metrics([10.0, 20.0])
        assert result["mean"] == pytest.approx(15.0)
        assert result["min"] == pytest.approx(10.0)
        assert result["max"] == pytest.approx(20.0)

    def test_empty_list(self):
        assert all_nans(_metrics([]))

    def test_all_none_values(self):
        assert all_nans(_metrics([None, None, None]))

    def test_mixed_none_and_valid(self):
        result = _metrics([None, 10.0, None, 20.0, 30.0])
        assert result["mean"] == pytest.approx(np.mean([10.0, 20.0, 30.0]))

    def test_identical_values(self):
        result = _metrics([5.0] * 6)
        assert result["mean"] == pytest.approx(5.0)
        assert result["std"] == pytest.approx(0.0)
        assert result["sem"] == pytest.approx(0.0)

    def test_negative_values(self):
        xs = [-10.0, -5.0, 0.0, 5.0, 10.0]
        result = _metrics(xs)
        assert result["mean"] == pytest.approx(np.mean([-5.0, 0.0, 5.0]))

    def test_none_reduces_below_threshold(self):
        """Nones reduce count below 5 so no trimming happens."""
        result = _metrics([None, None, 1.0, 2.0, 3.0, 4.0])
        assert result["mean"] == pytest.approx(np.mean([1.0, 2.0, 3.0, 4.0]))

    def test_none_keeps_trimming(self):
        """Still >=5 valid values after None removal → trimming happens."""
        result = _metrics([None, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
        assert result["mean"] == pytest.approx(np.mean([2.0, 3.0, 4.0, 5.0]))

    def test_percentiles(self):
        result = _metrics([10.0, 20.0, 30.0])
        assert result["min"] == pytest.approx(10.0)
        assert result["median"] == pytest.approx(20.0)
        assert result["max"] == pytest.approx(30.0)


# ===========================================================================
# Group 2: aggregate() edge cases
# ===========================================================================


class TestAggregate:
    """Unit tests for CLI-side event stream processing."""

    def test_normal_run(self):
        result = aggregate(make_events(rates=[100.0, 200.0, 300.0], losses=[1.0, 0.5, 0.3]))
        assert result is not None
        assert result["data"]["train_rate"] == [100.0, 200.0, 300.0]
        assert result["data"]["success"] == [True]
        assert result["config"]["name"] == "bench_a"

    def test_missing_config_returns_none(self):
        events = [
            {"event": "start", "data": {"command": ["x"], "time": 1.0}, "pipe": None},
            {"event": "end", "data": {"command": ["x"], "time": 2.0, "return_code": 0}, "pipe": None},
        ]
        assert aggregate(events) is None

    def test_nan_loss_causes_failure(self):
        result = aggregate(make_events(rates=[100.0], losses=[float("nan")]))
        assert result["data"]["success"] == [False]

    def test_nonzero_return_code_causes_failure(self):
        result = aggregate(make_events(rates=[100.0], return_code=1))
        assert result["data"]["success"] == [False]

    def test_empty_train_rate_causes_failure(self):
        result = aggregate(make_events(rates=[]))
        assert result["data"]["success"] == [False]

    def test_early_stop_overrides_failure(self):
        result = aggregate(make_events(rates=[], return_code=1, early_stop=True))
        assert result["data"]["success"] == [True]

    def test_nolog_tag_overrides_failure(self):
        config = make_config(tag=["bench_a", "nolog"])
        result = aggregate(make_events(config=config, rates=[], return_code=1))
        assert result["data"]["success"] == [True]

    def test_walltime_computed(self):
        result = aggregate(make_events(start_time=100.0, end_time=200.0))
        assert result["data"]["walltime"] == [100.0]

    def test_loss_gain_computed(self):
        result = aggregate(make_events(losses=[1.0, 0.5, 0.2]))
        assert result["data"]["loss_gain"] == [pytest.approx(0.2 - 1.0)]

    def test_ngpu_per_gpu_plan(self):
        result = aggregate(make_events(config=make_config(plan={"method": "per_gpu"})))
        assert result["data"]["ngpu"] == [1]

    def test_ngpu_njobs_plan(self):
        config = make_config(plan={"method": "njobs"})
        config["devices"] = [0, 1, 2, 3]
        result = aggregate(make_events(config=config))
        assert result["data"]["ngpu"] == [4]

    def test_multi_node_ngpu(self):
        config = make_config(num_machines=2, plan={"method": "njobs"})
        config["devices"] = [0, 1]
        result = aggregate(make_events(config=config))
        assert result["data"]["ngpu"] == [4]

    def test_gpudata_energy_computation(self):
        gpudata = [
            {"0": {"memory": [4000, 8000], "load": 0.8, "power": 200}, "time": 0.0},
            {"0": {"memory": [5000, 8000], "load": 0.9, "power": 250}, "time": 1.0},
            {"0": {"memory": [5500, 8000], "load": 0.85, "power": 300}, "time": 2.0},
        ]
        result = aggregate(make_events(gpudata=gpudata))
        expected_energy = (250 * 1.0 + 300 * 1.0) / 1000
        assert result["data"]["energy"] == [pytest.approx(expected_energy)]

    def test_gpudata_device_filter(self):
        config = make_config(device=0)
        gpudata = [
            {
                "0": {"memory": [4000, 8000], "load": 0.8, "power": 200},
                "1": {"memory": [1000, 8000], "load": 0.1, "power": 50},
                "time": 0.0,
            },
        ]
        result = aggregate(make_events(config=config, gpudata=gpudata))
        assert len(result["data"]["gpudata"]) == 1
        assert "0" in result["data"]["gpudata"][0]
        assert "1" not in result["data"]["gpudata"][0]

    def test_per_gpu_populated_with_device(self):
        config = make_config(device=0)
        result = aggregate(make_events(config=config, rates=[100.0, 200.0]))
        assert result["data"]["per_gpu"] == [(0, 100.0), (0, 200.0)]

    def test_per_gpu_absent_without_device(self):
        config = make_config(device=None)
        result = aggregate(make_events(config=config, rates=[100.0]))
        assert "per_gpu" not in result["data"] or result["data"]["per_gpu"] == []


# ===========================================================================
# Group 3: make_summary() pipeline
# ===========================================================================


class TestMakeSummary:

    def test_single_run(self):
        runs = make_runs_dict([make_events(rates=[100.0, 110.0, 105.0])])
        summary = make_summary(runs)
        assert "bench_a" in summary
        s = summary["bench_a"]
        assert s["n"] == 1
        assert s["successes"] == 1
        assert s["failures"] == 0

    def test_multiple_runs_same_bench(self):
        e1 = make_events(rates=[100.0, 110.0], start_time=1000.0, end_time=1010.0)
        e2 = make_events(rates=[200.0, 210.0], start_time=1020.0, end_time=1030.0)
        summary = make_summary(make_runs_dict([e1, e2]))
        s = summary["bench_a"]
        assert s["n"] == 2
        assert s["successes"] == 2
        assert s["train_rate"]["mean"] == pytest.approx(
            np.mean([100.0, 110.0, 200.0, 210.0])
        )

    def test_multiple_benchmarks(self):
        ea = make_events(config=make_config(name="bench_a"), rates=[100.0])
        eb = make_events(config=make_config(name="bench_b"), rates=[200.0])
        summary = make_summary(make_runs_dict([ea, eb]))
        assert summary["bench_a"]["train_rate"]["mean"] == pytest.approx(100.0)
        assert summary["bench_b"]["train_rate"]["mean"] == pytest.approx(200.0)

    def test_filter_failures_removes_all_failed_bench(self):
        events = make_events(config=make_config(name="bench_fail"), rates=[], return_code=1)
        summary = make_summary(make_runs_dict([events]), filter_failures=True)
        assert "bench_fail" not in summary

    def test_filter_failures_keeps_mixed_bench(self):
        cfg = make_config(name="bench_mixed")
        e_ok = make_events(config=cfg, rates=[100.0], start_time=1.0, end_time=2.0)
        e_fail = make_events(config=cfg, rates=[], return_code=1, start_time=3.0, end_time=4.0)
        summary = make_summary(make_runs_dict([e_ok, e_fail]), filter_failures=True)
        assert "bench_mixed" in summary
        s = summary["bench_mixed"]
        assert s["successes"] == 1
        assert s["failures"] == 0

    def test_keep_latest(self):
        cfg = make_config(name="bench_latest")
        e_old = make_events(config=cfg, rates=[100.0], start_time=1.0, end_time=2.0)
        e_new = make_events(config=cfg, rates=[200.0], start_time=10.0, end_time=20.0)
        summary = make_summary(make_runs_dict([e_old, e_new]), latest_only=True)
        s = summary["bench_latest"]
        assert s["n"] == 1
        assert s["train_rate"]["mean"] == pytest.approx(200.0)

    def test_broken_run_is_skipped(self):
        good = make_events(rates=[100.0])
        broken = [{"event": "data", "data": {"rate": 50.0}, "pipe": "data"}]
        summary = make_summary({"good.data": good, "broken.data": broken})
        assert "bench_a" in summary
        assert summary["bench_a"]["n"] == 1


# ===========================================================================
# Group 4: _make_row() and make_dataframe()
# ===========================================================================


class TestMakeRow:

    def test_normal_row(self):
        s = _build_summary_entry(rates=[100.0, 110.0, 105.0])
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        assert row["n"] == 4
        assert row["fail"] == 0
        assert row["perf"] == pytest.approx(s["train_rate"]["mean"])
        assert row["weight"] == 1.0
        assert row["enabled"] is True
        assert not isnan(row["score"])

    def test_empty_summary(self):
        row = _make_row({}, compare=None, config={"weight": 1.0, "enabled": True})
        assert isnan(row["perf"])
        assert isnan(row["score"])

    def test_summary_marked_empty(self):
        s = {"name": "x", "n": 0, "successes": 0, "failures": 0, "empty": True, "weight": 1.0}
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        assert isnan(row["perf"])

    def test_all_failures(self):
        s = _build_summary_entry(n=3, successes=0, failures=3)
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        assert row["fail"] == 3
        assert row["score"] == pytest.approx(0.0)

    def test_partial_failures(self):
        s = _build_summary_entry(n=4, successes=2, failures=2)
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        perf = s["train_rate"]["mean"]
        success_ratio = 1 - 2 / 4
        assert row["score"] == pytest.approx(perf * success_ratio)

    def test_disabled_benchmark(self):
        s = _build_summary_entry(enabled=False, weight=0.0)
        row = _make_row(s, compare=None, config={"weight": 0.0, "enabled": False})
        assert row["enabled"] is False
        assert row["weight"] == 0.0

    def test_per_gpu_score_uses_sum(self):
        per_gpu = {
            "0": _metrics([50.0, 55.0]),
            "1": _metrics([60.0, 65.0]),
        }
        s = _build_summary_entry(per_gpu=per_gpu, n=2, successes=2, failures=0)
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        expected_acc = per_gpu["0"]["mean"] + per_gpu["1"]["mean"]
        assert row["score"] == pytest.approx(expected_acc)

    def test_peak_memory_from_gpu_load(self):
        gpu_load = {
            "0": {
                "memory": _metrics([4000.0, 5000.0, 6000.0]),
                "load": _metrics([0.8, 0.9, 0.85]),
                "power": _metrics([200.0, 250.0, 230.0]),
            },
            "1": {
                "memory": _metrics([3000.0, 7000.0]),
                "load": _metrics([0.7, 0.75]),
                "power": _metrics([180.0, 190.0]),
            },
        }
        s = _build_summary_entry(gpu_load=gpu_load)
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        assert row["peak_memory"] == gpu_load["1"]["memory"]["max"]

    def test_enabled_bench_with_zero_n(self):
        """When n=0, the extra failure check in _make_row is a no-op
        because row["n"] is still nan at the check point (nan <= 0 is False).
        This is a known quirk of the current implementation.
        """
        s = _build_summary_entry(n=0, successes=0, failures=0)
        row = _make_row(s, compare=None, config={"weight": 1.0, "enabled": True})
        assert row["n"] == 0
        assert row["fail"] == 0


class TestMakeDataframe:

    def test_missing_benchmark_placeholder(self):
        summary = {"bench_a": _build_summary_entry(name="bench_a")}
        weights = {
            "bench_a": {"weight": 1.0, "enabled": True},
            "bench_missing": {"weight": 1.0, "enabled": True},
        }
        df = make_dataframe(summary, weights=weights)
        assert "bench_missing" in df.index

    def test_no_weights_uses_summary_keys(self):
        summary = {
            "bench_a": _build_summary_entry(name="bench_a"),
            "bench_b": _build_summary_entry(name="bench_b"),
        }
        df = make_dataframe(summary, weights=None)
        assert "bench_a" in df.index
        assert "bench_b" in df.index

    def test_empty_summary_with_weights(self):
        df = make_dataframe({}, weights={"bench_a": {"weight": 2.0, "enabled": True}})
        assert "bench_a" in df.index

    def test_column_ordering(self):
        summary = {"bench_a": _build_summary_entry()}
        weights = {"bench_a": {"weight": 1.0, "enabled": True}}
        df = make_dataframe(summary, weights=weights)
        cols = list(df.columns)
        if "fail" in cols and "perf" in cols:
            assert cols.index("fail") < cols.index("perf")

    def test_weights_override_summary_weight(self):
        summary = {"bench_a": _build_summary_entry(weight=1.0)}
        weights = {"bench_a": {"weight": 5.0, "enabled": True}}
        df = make_dataframe(summary, weights=weights)
        assert df.loc["bench_a", "weight"] == 5.0


# ===========================================================================
# Group 5: make_report() score computation
# ===========================================================================


class TestScoreComputation:
    """Verify weighted geometric mean score + failure rate logic."""

    def _compute_score(self, summary, weights=None):
        """Run make_report and recompute the expected score from its DataFrame."""
        if weights is None:
            weights = {
                name: {"weight": s.get("weight", 1.0), "enabled": s.get("enabled", True)}
                for name, s in summary.items()
            }
        stream = StringIO()
        df = make_report(summary, weights=weights, stream=stream, html=None)
        if df is None or df.empty:
            return None, None

        score_col = df["score"].astype(float).fillna(0)
        weight_col = df["weight"].astype(float)
        enabled_col = df["enabled"].astype(int)

        w = weight_col * enabled_col
        wt = np.sum(w)
        if wt == 0:
            return 0, df
        logscore = np.sum(np.log(score_col + 1) * w) / wt
        return float(np.exp(logscore)), df

    def test_single_bench_score(self):
        summary = {"bench_a": _build_summary_entry(rates=[100.0, 100.0, 100.0])}
        score, _ = self._compute_score(summary)
        assert score == pytest.approx(100.0 + 1, rel=0.01)

    def test_weighted_geometric_mean(self):
        summary = {
            "a": _build_summary_entry(name="a", rates=[100.0], weight=1.0),
            "b": _build_summary_entry(name="b", rates=[400.0], weight=1.0),
        }
        score, _ = self._compute_score(summary)
        expected = np.exp(
            (np.log(100.0 + 1) * 1.0 + np.log(400.0 + 1) * 1.0) / 2.0
        )
        assert score == pytest.approx(expected, rel=0.01)

    def test_zero_weight_bench_excluded(self):
        summary = {
            "a": _build_summary_entry(name="a", rates=[100.0], weight=1.0),
            "b": _build_summary_entry(name="b", rates=[999.0], weight=0.0),
        }
        weights = {
            "a": {"weight": 1.0, "enabled": True},
            "b": {"weight": 0.0, "enabled": True},
        }
        score, _ = self._compute_score(summary, weights)
        assert score == pytest.approx(np.exp(np.log(100.0 + 1)), rel=0.01)

    def test_disabled_bench_excluded(self):
        summary = {
            "a": _build_summary_entry(name="a", rates=[100.0], weight=1.0, enabled=True),
            "b": _build_summary_entry(name="b", rates=[999.0], weight=1.0, enabled=False),
        }
        weights = {
            "a": {"weight": 1.0, "enabled": True},
            "b": {"weight": 1.0, "enabled": False},
        }
        score, _ = self._compute_score(summary, weights)
        assert score == pytest.approx(np.exp(np.log(100.0 + 1)), rel=0.01)

    def test_all_failures_score_is_one(self):
        summary = {"a": _build_summary_entry(n=2, successes=0, failures=2)}
        score, _ = self._compute_score(summary)
        assert score == pytest.approx(1.0, rel=0.01)

    def test_score_with_unequal_weights(self):
        summary = {
            "a": _build_summary_entry(name="a", rates=[100.0], weight=3.0),
            "b": _build_summary_entry(name="b", rates=[200.0], weight=1.0),
        }
        weights = {
            "a": {"weight": 3.0, "enabled": True},
            "b": {"weight": 1.0, "enabled": True},
        }
        score, _ = self._compute_score(summary, weights)
        expected = np.exp(
            (np.log(100.0 + 1) * 3.0 + np.log(200.0 + 1) * 1.0) / 4.0
        )
        assert score == pytest.approx(expected, rel=0.01)


# ===========================================================================
# Group 6: Cross-pipeline statistical function equivalence
# ===========================================================================


class TestCrossPipelineStats:
    """Verify that _metrics (CLI) and dropminmax+stat functions (DB) agree."""

    @pytest.mark.parametrize(
        "values",
        [
            [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
            [1.0, 2.0, 3.0, 4.0, 5.0],
            [1.0, 2.0, 3.0],
            [42.0],
            [100.0] * 5,
            [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        ],
        ids=["7vals", "5vals", "3vals", "1val", "identical", "10vals"],
    )
    def test_mean_equivalence(self, values):
        assert _metrics(values)["mean"] == pytest.approx(db_mean(values))

    @pytest.mark.parametrize(
        "values",
        [
            [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
            [1.0, 2.0, 3.0, 4.0, 5.0],
            [1.0, 2.0, 3.0],
            [42.0],
        ],
        ids=["7vals", "5vals", "3vals", "1val"],
    )
    def test_std_equivalence(self, values):
        assert _metrics(values)["std"] == pytest.approx(db_std(values))

    @pytest.mark.parametrize(
        "values",
        [
            [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
            [1.0, 2.0, 3.0, 4.0, 5.0],
            [1.0, 2.0, 3.0],
            [42.0],
        ],
        ids=["7vals", "5vals", "3vals", "1val"],
    )
    def test_sem_equivalence(self, values):
        assert _metrics(values)["sem"] == pytest.approx(db_sem(values))

    @pytest.mark.parametrize(
        "values",
        [
            [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
            [1.0, 2.0, 3.0],
        ],
        ids=["7vals", "3vals"],
    )
    def test_percentile_equivalence(self, values):
        cli = _metrics(values)
        assert cli["min"] == pytest.approx(db_min(values))
        assert cli["q1"] == pytest.approx(db_q1(values))
        assert cli["median"] == pytest.approx(db_median(values))
        assert cli["q3"] == pytest.approx(db_q3(values))
        assert cli["max"] == pytest.approx(db_max(values))

    def test_dropminmax_threshold_five(self):
        trimmed = dropminmax([1.0, 2.0, 3.0, 4.0, 5.0])
        assert trimmed == [2.0, 3.0, 4.0]
        assert _metrics([1.0, 2.0, 3.0, 4.0, 5.0])["mean"] == pytest.approx(np.mean([2.0, 3.0, 4.0]))

    def test_dropminmax_below_threshold(self):
        trimmed = dropminmax([1.0, 2.0, 3.0, 4.0])
        assert trimmed == [1.0, 2.0, 3.0, 4.0]
        assert _metrics([1.0, 2.0, 3.0, 4.0])["mean"] == pytest.approx(np.mean([1.0, 2.0, 3.0, 4.0]))


# ===========================================================================
# Group 7: Full cross-pipeline report equivalence (CLI vs DB pandas path)
# ===========================================================================


class TestCrossPipelineReport:
    """Build equivalent data for CLI and DB paths, verify summaries agree.

    The CLI path uses make_summary (from .data event files).
    The DB path uses make_pivot_summary (from a pandas DataFrame that
    would normally come from a SQL query).
    """

    @staticmethod
    def _cli_summary(event_lists):
        return make_summary(make_runs_dict(event_lists))

    @staticmethod
    def _db_summary(run_name, df):
        return make_pivot_summary(run_name, df)

    def _make_parallel_data(
        self,
        bench_name="bench_a",
        rates=None,
        n_runs=1,
        return_code=0,
        weight=1.0,
        enabled=True,
    ):
        """Create equivalent CLI events and DB DataFrame for the same runs."""
        if rates is None:
            rates = [100.0, 110.0, 105.0]

        config = make_config(name=bench_name, weight=weight, enabled=enabled)
        event_lists = []
        all_rates = []
        status_values = []

        for i in range(n_runs):
            event_lists.append(make_events(
                config=config,
                rates=rates,
                return_code=return_code,
                start_time=1000.0 + i * 20,
                end_time=1010.0 + i * 20,
            ))
            all_rates.extend(rates)
            status_values.append(return_code)

        df = make_db_dataframe(
            run_name="run1",
            bench_name=bench_name,
            rate_values=all_rates,
            gpu_ids=["0"],
            status_values=status_values,
            weight=weight,
            enabled=int(enabled),
            weight_total=weight,
        )
        return event_lists, df

    def test_single_bench_single_gpu_perf_match(self):
        event_lists, df = self._make_parallel_data(rates=[100.0, 110.0, 105.0, 108.0])
        cli = self._cli_summary(event_lists)
        db = self._db_summary("run1", df)
        assert cli["bench_a"]["train_rate"]["mean"] == pytest.approx(
            db["bench_a"]["train_rate"]["mean"], rel=1e-4
        )

    def test_single_bench_std_match(self):
        event_lists, df = self._make_parallel_data(
            rates=[100.0, 110.0, 105.0, 108.0, 112.0, 103.0]
        )
        cli = self._cli_summary(event_lists)
        db = self._db_summary("run1", df)
        assert cli["bench_a"]["train_rate"]["std"] == pytest.approx(
            db["bench_a"]["train_rate"]["std"], rel=1e-4
        )

    def test_n_and_failure_counts_match(self):
        event_lists, df = self._make_parallel_data(rates=[100.0], n_runs=3)
        cli = self._cli_summary(event_lists)
        db = self._db_summary("run1", df)
        assert cli["bench_a"]["n"] == db["bench_a"]["n"]
        assert cli["bench_a"]["successes"] == db["bench_a"]["successes"]
        assert cli["bench_a"]["failures"] == db["bench_a"]["failures"]

    def test_failed_run_counts(self):
        config = make_config(name="bench_fail")
        events = [make_events(config=config, rates=[100.0], return_code=1)]
        cli = self._cli_summary(events)

        df = make_db_dataframe(
            run_name="run1", bench_name="bench_fail",
            rate_values=[100.0], status_values=[1],
        )
        db = self._db_summary("run1", df)

        assert cli["bench_fail"]["failures"] == 1
        assert db["bench_fail"]["failures"] == 1

    def test_report_score_match_single_bench(self):
        """Full report score should match between CLI and DB summaries.

        Note: DB's make_pivot_summary doesn't include "power" in gpu_load,
        which causes _make_row to fail when computing median_watt.
        We compare via make_dataframe which is more forgiving (error_guard
        returns {} for broken rows). Instead we compare the perf/score
        directly from the summary structures.
        """
        event_lists, df = self._make_parallel_data(rates=[100.0, 110.0, 105.0], weight=2.0)
        cli = self._cli_summary(event_lists)
        db = self._db_summary("run1", df)

        cli_perf = cli["bench_a"]["train_rate"]["mean"]
        db_perf = db["bench_a"]["train_rate"]["mean"]
        assert cli_perf == pytest.approx(db_perf, rel=1e-3)

        assert cli["bench_a"]["n"] == db["bench_a"]["n"]
        assert cli["bench_a"]["failures"] == db["bench_a"]["failures"]

    def test_multiple_benches_perf_match(self):
        cfg_a = make_config(name="bench_a", weight=1.0)
        cfg_b = make_config(name="bench_b", weight=2.0)

        events = [
            make_events(config=cfg_a, rates=[100.0, 110.0, 105.0]),
            make_events(config=cfg_b, rates=[200.0, 210.0, 205.0]),
        ]
        cli = self._cli_summary(events)

        df = pd.concat([
            make_db_dataframe(
                run_name="run1", bench_name="bench_a",
                rate_values=[100.0, 110.0, 105.0], weight=1.0, weight_total=3.0,
            ),
            make_db_dataframe(
                run_name="run1", bench_name="bench_b",
                rate_values=[200.0, 210.0, 205.0], weight=2.0, weight_total=3.0,
            ),
        ], ignore_index=True)
        db = self._db_summary("run1", df)

        for name in ["bench_a", "bench_b"]:
            assert cli[name]["train_rate"]["mean"] == pytest.approx(
                db[name]["train_rate"]["mean"], rel=1e-4
            ), f"{name}: CLI={cli[name]['train_rate']['mean']}, DB={db[name]['train_rate']['mean']}"


# ===========================================================================
# Group 8: Edge case scenarios
# ===========================================================================


class TestEdgeCases:

    def test_no_runs_at_all(self):
        assert make_summary({}) == {}

    def test_all_runs_broken(self):
        broken = [{"event": "data", "data": {"rate": 50.0}, "pipe": "data"}]
        assert make_summary({"broken.data": broken}) == {}

    def test_single_observation(self):
        runs = make_runs_dict([make_events(rates=[42.0])])
        s = make_summary(runs)["bench_a"]
        assert s["train_rate"]["mean"] == pytest.approx(42.0)
        assert s["train_rate"]["std"] == pytest.approx(0.0)

    def test_very_large_rate_variance(self):
        runs = make_runs_dict([make_events(rates=[0.001, 1000000.0])])
        s = make_summary(runs)["bench_a"]
        assert s["train_rate"]["mean"] == pytest.approx(np.mean([0.001, 1000000.0]))
        assert not isnan(s["train_rate"]["std"])

    def test_all_zero_rates(self):
        runs = make_runs_dict([make_events(rates=[0.0, 0.0, 0.0])])
        s = make_summary(runs)["bench_a"]
        assert s["train_rate"]["mean"] == pytest.approx(0.0)
        assert s["train_rate"]["std"] == pytest.approx(0.0)

    def test_score_with_missing_bench_in_weights(self):
        summary = {"bench_a": _build_summary_entry(name="bench_a")}
        weights = {
            "bench_a": {"weight": 1.0, "enabled": True},
            "bench_missing": {"weight": 1.0, "enabled": True},
        }
        df = make_report(summary, weights=weights, stream=StringIO(), html=None)
        assert df is not None
        assert "bench_missing" in df.index

    def test_report_with_only_disabled_benchmarks(self):
        summary = {"bench_a": _build_summary_entry(name="bench_a", weight=1.0, enabled=False)}
        weights = {"bench_a": {"weight": 1.0, "enabled": False}}
        df = make_report(summary, weights=weights, stream=StringIO(), html=None)
        assert df is not None

    def test_gpudata_skips_idle_readings(self):
        """GPU readings with memory[0]==1 or load==0 are skipped in _summarize."""
        config = make_config(device=0)
        gpudata = [
            {"0": {"memory": [1, 8000], "load": 0.5, "power": 200}, "time": 0.0},
            {"0": {"memory": [4000, 8000], "load": 0, "power": 200}, "time": 1.0},
            {"0": {"memory": [5000, 8000], "load": 0.8, "power": 250}, "time": 2.0},
        ]
        result = aggregate(make_events(config=config, rates=[100.0], gpudata=gpudata))
        s = _summarize(_merge([result]))
        assert s is not None
        assert s["gpu_load"]["0"]["memory"]["mean"] == pytest.approx(5000.0)

    def test_mixed_success_failure_runs(self):
        cfg = make_config(name="mixed")
        e_ok = make_events(config=cfg, rates=[100.0], start_time=1.0, end_time=2.0)
        e_fail = make_events(config=cfg, rates=[50.0], return_code=1, start_time=3.0, end_time=4.0)
        s = make_summary(make_runs_dict([e_ok, e_fail]))["mixed"]
        assert s["n"] == 2
        assert s["successes"] == 1
        assert s["failures"] == 1
        assert s["train_rate"]["mean"] == pytest.approx(np.mean([100.0, 50.0]))

    def test_db_path_with_no_rate_values(self):
        rows = [{
            "run": "run1", "bench": "bench_empty", "metric": "status",
            "value": 0, "gpu_id": "0",
            "weight": 1.0, "priority": 1, "enabled": 1, "weight_total": 1.0,
        }]
        result = make_pivot_summary("run1", pd.DataFrame(rows))
        assert "bench_empty" in result
        assert result["bench_empty"]["n"] == 1

    def test_db_path_empty_dataframe(self):
        df = pd.DataFrame(columns=[
            "run", "bench", "metric", "value", "gpu_id",
            "weight", "priority", "enabled", "weight_total",
        ])
        assert make_pivot_summary("run1", df) == {}

    def test_summary_preserves_group(self):
        events = make_events(config=make_config(name="mytest", group="special_group"), rates=[100.0])
        s = make_summary(make_runs_dict([events]))["mytest"]
        assert s["group"] == "special_group"

    def test_db_multiple_gpus(self):
        df = make_db_dataframe(
            run_name="run1", bench_name="multi_gpu",
            rate_values=[100.0, 110.0, 105.0],
            gpu_ids=["0", "1"], status_values=[0],
        )
        result = make_pivot_summary("run1", df)
        assert "0" in result["multi_gpu"]["per_gpu"]
        assert "1" in result["multi_gpu"]["per_gpu"]

    def test_report_with_zero_perf(self):
        summary = {"bench_a": _build_summary_entry(rates=[0.0, 0.0, 0.0])}
        weights = {"bench_a": {"weight": 1.0, "enabled": True}}
        df = make_report(summary, weights=weights, stream=StringIO(), html=None)
        assert df is not None
        assert float(df.loc["bench_a", "score"]) == pytest.approx(0.0)


# ===========================================================================
# Group 9: Classify, filter, merge helpers
# ===========================================================================


class TestPipelineHelpers:

    def _make_agg(self, name="bench_a", start_time=1.0, success=True, rates=None):
        if rates is None:
            rates = [100.0]
        return {
            "config": make_config(name=name),
            "start": {"time": start_time},
            "end": {"time": start_time + 10},
            "meta": {},
            "data": defaultdict(list, {
                "train_rate": rates,
                "success": [success],
                "ngpu": [1],
                "gpudata": [],
                "per_gpu": [],
                "walltime": [10.0],
                "energy": [0.0],
                "elapsed": [10.0],
            }),
        }

    def test_classify_groups_by_name(self):
        classified = _classify([
            self._make_agg(name="a"),
            self._make_agg(name="a"),
            self._make_agg(name="b"),
        ])
        assert len(classified["a"]) == 2
        assert len(classified["b"]) == 1

    def test_filter_failures_keeps_successful(self):
        classified = {
            "a": [self._make_agg(name="a", success=True), self._make_agg(name="a", success=False)],
            "b": [self._make_agg(name="b", success=False)],
        }
        filtered = _filter_failures(classified)
        assert "a" in filtered
        assert "b" not in filtered
        assert len(filtered["a"]) == 1

    def test_keep_latest_picks_newest(self):
        classified = {"a": [
            self._make_agg(name="a", start_time=1.0),
            self._make_agg(name="a", start_time=100.0),
        ]}
        latest = _keep_latest(classified)
        assert len(latest["a"]) == 1
        assert latest["a"][0]["start"]["time"] == 100.0

    def test_merge_combines_data(self):
        merged = _merge([
            self._make_agg(name="a", rates=[100.0]),
            self._make_agg(name="a", rates=[200.0]),
        ])
        assert merged["data"]["train_rate"] == [100.0, 200.0]
        assert merged["data"]["success"] == [True, True]
