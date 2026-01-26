from dataclasses import dataclass
from milabench.report.read import (
    EventProcessor, 
    DataProcessor, 
    LogExtractor, 
    ConfigExtractor, 
    MetaExtractor,
    Threading,
    Multiprocessing, 
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



def fetch_one(worker_cls, folder, *args):
    # Process a single file with the worker
    # we do not need more than one worker since workers work per file
    with DataProcessor(worker_cls, *args, worker_count=1, backend=Threading) as proc:
        for item in proc(folder):
            yield item


def get_config(runfile):
    for item in fetch_one(ConfigExtractor, runfile):
        return item


def get_meta(runfile):
    for item in fetch_one(MetaExtractor, runfile):
        return item

def get_log(runfile):
    yield from fetch_one(LogExtractor, runfile)

