from collections import defaultdict
from dataclasses import dataclass
import os
from functools import lru_cache

from flask import request

from milabench.report.read import (
    EventProcessor,
    DataProcessor,
    LogExtractor,
    ConfigExtractor,
    MetaExtractor,
    Threading,
    fetch_data_file,
    extract_milabench_metrics
)


@dataclass
class Bench:
    config: dict
    meta: dict
    start: dict
    end: dict
    data: list[dict]
    stdout: list[str]
    stderr: list[str]
    stop: dict
    keys: dict



class BenchRestExtractor(EventProcessor):
    """Informatioon extractor for milabench dashboard.
    Extract and format the data into a single pass
    """
    def insert(self, meta, **kwargs):
        meta["results"].setdefault("config", {}).update(kwargs)

    def append(self, meta, **kwargs):
        for k, v in kwargs.items():
            meta["results"].setdefault("config", {}).setdefault(k, []).append(v)

    def config(self, event, meta):
        self.insert(meta, config=event["config"])

    def meta(self, event, meta):
        self.insert(meta, meta=event["meta"])

    def start(self, event, meta):
        self.insert(meta, start=event["start"])

    def data(self, data, meta):
        self.append(meta, data=data)

    def line(self, line, pipe, meta):
        self.append(meta, pipe=line)

    def error(self, event, meta):
        self.insert(meta, config=event)

    def message(self, message, meta):
        self.append(meta, message=message)

    def stop(self, event, meta):
        self.insert(meta, stop=event)

    def end(self, event, meta):
        self.insert(meta, end=event["end"])
        obj = meta.pop("results")
        obj["keys"] = meta
        self.push_result(obj)



class BenchSelector:
    def __init__(self, bench):
        self.bench = bench

    def __call__(self, filepath, meta):
        return meta["bench"] == self.bench



def fetch_one(worker_cls, folder, *args, ignore_groups=True, **kwargs):
    # Process a single file with the worker
    # we do not need more than one worker since workers work per file
    with DataProcessor(worker_cls, *args, **kwargs, worker_count=1, backend=Threading) as proc:
        for item in proc(folder):
            if ignore_groups and "kind" in item:
                continue

            yield item


def get_config(runfile, *args):
    for item in fetch_one(ConfigExtractor, runfile, *args):
        return item


def get_meta(runfile, *args, **kwargs):
    for item in fetch_one(MetaExtractor, runfile, *args):
        return item

def get_log(runfile, *args, **kwargs):
    yield from fetch_one(LogExtractor, runfile, *args, **kwargs)


def datafile_processor(app, cache):
    from pathlib import Path
    from ..slurm.constant import ROOT

    def make_absolute(path: str | Path) -> Path:
        path = Path(path)
        if path.is_absolute():
            return path
        return str((Path(ROOT) / path).resolve())

    def run_folder():
        return make_absolute(request.cookies.get('folder'))

    @lru_cache
    def list_benchmarks(folder):
        benchmarks = defaultdict(list)
        for item in fetch_data_file(folder):
            if "kind" in item:
                if "file" in item["fields"]:
                    benchmarks[item["fields"]["bench"]].append(item["fields"])

            # print(item)
            #
            pass
        return benchmarks

    @lru_cache
    def fetch_groups(folder):
        groups = dict()
        for item in fetch_data_file(folder):
            if "kind" in item:
                if "file" in item["fields"]:
                    groups[item["fields"]["id"]] = item["fields"]
        return groups

    @lru_cache
    def _list_fields(folder):
        fields = defaultdict(list)

        for k, group_fields in fetch_groups(folder).items():
            for field, value in group_fields.items():
                if field not in ["file", "id", "parent_id"]:  # Skip internal fields
                    fields[field].append(value)

        # Deduplicate values for each field
        return {k: sorted(list(set(v))) for k, v in fields.items()}

    @app.route('/api/datafile/select/fields', methods=["GET"])
    def list_fields():
        return _list_fields(run_folder())

    @app.route('/api/datafile/select/benchmark', methods=["POST"])
    def preview_selected():
        selected_fields = request.get_json()

        from milabench.report.read import GroupMetricExpander
        group_selector = GroupMetricExpander(fetch_groups(run_folder()))
        return group_selector.query(**selected_fields)

    @app.route('/api/datafile/select/metrics', methods=["POST", "GET"])
    def selected_metrics():
        import base64
        import json

        if request.method == "POST":
            selected_fields = request.get_json() 
        else: 
            # GET request: expects ?filters=<base64> or ?selected_fields=<base64>
            b64str = request.args.get('filters') or request.args.get('selected_fields', '')
            if not b64str:
                return {"error": "Missing filters parameter"}, 400
            try:
                decoded = base64.b64decode(b64str).decode('utf-8') 
                selected_fields = json.loads(decoded)
            except Exception as e:
                return {"error": f"Invalid base64 or JSON in filters: {str(e)}"}, 400

        from milabench.report.read import GroupMetricExpander
        group_selector = GroupMetricExpander(fetch_groups(run_folder()))
        return list(group_selector.extract_metric(**selected_fields))
 
    def get_benchmark_file(bench):
        benchs = list_benchmarks(run_folder())
        file_list = benchs[bench]
        return file_list[0]["file"]

    @app.route('/api/datafile/list/benchmark')
    def _list_benchmarks():
        benchs = list_benchmarks(run_folder())
        return list(benchs.keys())

    @app.route('/api/datafile/config/<string:bench>')
    def benchmark_config(bench):
        r = get_config(get_benchmark_file(bench))
        return r

    @app.route('/api/datafile/meta/<string:bench>')
    def benchmark_meta(bench):
        return get_meta(get_benchmark_file(bench))

    @app.route('/api/datafile/stdout/<string:bench>')
    def benchmark_stdout(bench):
        return list(get_log(get_benchmark_file(bench), pipe_filter="stdout"))

    @app.route('/api/datafile/stderr/<string:bench>')
    def benchmark_stderr(bench):
        return list(get_log(get_benchmark_file(bench), pipe_filter="stderr"))

    @app.route('/api/datafile/metrics/<string:bench>')
    def benchmark_metrics(bench):
        return list(extract_milabench_metrics(get_benchmark_file(bench)))

    @app.route('/api/datafile/metrics/preview/<string:bench>')
    def benchmark_metrics_preview(bench):
        full = benchmark_metrics(bench)
        return {
            "full_length": len(full),
            "metrics": full[:100]
        }
