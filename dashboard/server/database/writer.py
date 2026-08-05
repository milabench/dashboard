import numbers
import time
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy
from sqlalchemy.orm import sessionmaker

from milabench.structs import BenchLogEntry

from .models import (
    Exec,
    Metric,
    Pack,
    create_database,
    from_json,
    to_json,
)

FORCED_META_KEYS = {"contributor"}

META = 0
START = 1
DATA = 2


@dataclass
class PackState:
    # Order safety check
    # makes sure events are called in order
    step: int = 0
    pack: dict = None
    config: dict = None
    early_stop: bool = False
    error: int = 0
    start: int = 0
    command = None

def _get_pack_ids(pack):
    devices = pack.config.get("devices", ["ALL"])

    job_id = str(pack.config.get("job-number", 0))
    gpu_id = ",".join(str(i) for i in devices)

    return job_id, gpu_id


class SQLAlchemy:
    def __init__(
        self,
        uri="sqlite:///sqlite.db",
        meta_override=None,
        meta_tags=None,
        meta_forced=None,
        visibility=0,
        engine=None,
    ) -> None:
        self._owns_engine = engine is None

        if engine is not None:
            self.engine = engine
        else:
            if hasattr(uri, 'startswith') and uri.startswith("sqlite"):
                create_database(uri)

            self.engine = sqlalchemy.create_engine(
                uri,
                echo=False,
                future=True,
                json_serializer=to_json,
                json_deserializer=from_json,
                pool_pre_ping=True,
            )

        self.meta_override = meta_override
        self.meta_tags = meta_tags or {}
        # Authoritative overlay applied last (e.g. push-key metadata + contributor).
        self.meta_forced = meta_forced or {}
        self.session = sessionmaker(bind=self.engine)
        self.meta = None
        self.run = None
        self._run_id = None
        self.states = defaultdict(PackState)

        self.pending_metrics = []
        self.batch_size = 1000
        self.visibility = visibility
        self.assertion_error_count = 0
        self.error_count = 0

    def start_new_run(self):
        self.meta = None
        self.run = None
        self._run_id = None
        self.states = defaultdict(PackState)

    @property
    def client(self):
        return self.engine

    def pack_state(self, entry) -> PackState:
        return self.states[entry.tag]

    def __call__(self, entry):
        try:
            return self.on_event(entry)

        # Start to ignore errors after a while
        # To avoid printing the same errors all the time
        except AssertionError:
            self.assertion_error_count += 1
            if self.assertion_error_count > 100:
                return
            else:
                raise

        except Exception as err:
            self.error_count += 1
            if self.error_count > 100:
                return
            else:
                raise

    def __enter__(self):
        return self

    def __exit__(self, *args, **kwargs):
        try:
            self._bulk_insert()

            # Interrupted because on_end() was not called
            for state in self.states.values():
                if state.pack:
                    self.update_pack_status(state.pack, "interrupted")

            status = "done"
            if len(self.states) > 0:
                status = "interrupted"

            if self._run_id is not None:
                self.update_run_status(status)

            self.states = defaultdict(PackState)
        finally:
            if self._owns_engine:
                self.engine.dispose()

    def update_run_status(self, status):
        with self.session() as sesh:
            sesh.execute(
                sqlalchemy.update(Exec)
                .where(Exec._id == self._run_id)
                .values(status=status)
            )
            sesh.commit()

    def update_pack_status(self, pack_or_id, status):
        pack_id = pack_or_id if isinstance(pack_or_id, int) else pack_or_id._id
        with self.session() as sesh:
            sesh.execute(
                sqlalchemy.update(Pack)
                .where(Pack._id == pack_id)
                .values(status=status)
            )
            sesh.commit()

    def on_event(self, entry: BenchLogEntry):
        method = getattr(self, f"on_{entry.event}", None)

        if method is not None:
            method(entry)

    def on_new_run(self, entry):
        metadata = dict(self.meta_override or entry.data or {})

        # Strip protected keys from run/override data so they cannot be spoofed;
        # they are re-applied from meta_forced (and FORCED_META_KEYS in meta_tags).
        for key in FORCED_META_KEYS | set(self.meta_forced):
            metadata.pop(key, None)

        metadata = {
            **self.meta_tags,
            **metadata,
            **self.meta_forced,
        }

        created_time = datetime.utcnow()
        meta_ts = metadata.get("date")
        if meta_ts is not None:
            try:
                created_time = datetime.utcfromtimestamp(float(meta_ts))
            except (ValueError, TypeError, OSError):
                pass

        self.run = Exec(
            name=entry.pack.config["run_name"],
            namespace=None,
            created_time=created_time,
            meta=metadata,
            status="running",
            visibility=self.visibility
        )
        with self.session() as sesh:
            sesh.add(self.run)
            sesh.commit()
            sesh.refresh(self.run)
            self._run_id = self.run._id

    def on_new_pack(self, entry):
        state = self.pack_state(entry)
        state.pack = Pack(
            exec_id=self._run_id,
            created_time=datetime.utcnow(),
            name=entry.pack.config["name"],
            tag=entry.tag,
            config=entry.pack.config,
        )

        with self.session() as sesh:
            sesh.add(state.pack)
            sesh.commit()
            sesh.refresh(state.pack)

    def on_meta(self, entry: BenchLogEntry):
        if self.run is None:
            self.on_new_run(entry)

        if entry.tag not in self.states:
            self.on_new_pack(entry)

        state = self.pack_state(entry)
        assert state.step == META
        state.step += 1

    def on_start(self, entry):
        if entry.tag not in self.states:
            # We have not received the meta tag
            self.on_meta(BenchLogEntry(entry.pack, event="meta", data={}))

        state = self.pack_state(entry)

        state.pack.command = entry.data["command"]
        state.start = entry.data["time"]

        assert state.step == START
        state.step += 1

    def on_phase(self, entry):
        pass

    def on_error(self, entry):
        state = self.pack_state(entry)
        state.error += 1

    def on_line(self, entry):
        pass

    def _push_metric(
        self,
        run_id,
        pack_id,
        name,
        value,
        order=None,
        gpu_id=None,
        job_id=None,
        namespace=None,
        unit=None,
    ):
        # Empty sampler payloads (torchmem/jaxmem when CUDA/JAX unavailable).
        if isinstance(value, dict) and not value:
            return

        if not isinstance(value, numbers.Number):
            print(f"Unexpected value {value} for metric {name}")
            return

        if order is None:
            order = time.time()

        def get_gpu_id(gid):
            try:
                return int(gid)
            except:
                return -1

        self.pending_metrics.append(
            Metric(
                exec_id=run_id,
                pack_id=pack_id,
                order=order,
                name=name,
                namespace=namespace,
                unit=unit,
                value=value,
                gpu_id=gpu_id, # get_gpu_id(gpu_id),
                job_id=job_id,
            )
        )

    def _change_gpudata(self, run_id, pack_id, k, v, jobid, metric_time=None):
        for gpu_id, values in v.items():
            for metric, value in values.items():
                unit = None
                match metric:
                    case "memory":
                        use, mx = value
                        value = use / mx
                        unit = "%"
                    case "load":
                        unit = "%"
                    case "temperature":
                        unit = "°C"
                    case "power":
                        unit = "W"

                self._push_metric(
                    run_id, pack_id, f"gpu.{metric}", value, gpu_id=gpu_id, job_id=jobid, order=metric_time, unit=unit
                )

    def _change_allocmem(self, run_id, pack_id, prefix, payload, jobid, metric_time=None):
        """Expand per-device allocator stats (torchmem / jaxmem) into numeric rows.

        Expected shape::

            {"0": {"allocated": ..., "reserved": ..., "max_allocated": ..., "max_reserved": ...}}
        """
        if not isinstance(payload, dict):
            print(f"Unexpected value {payload} for metric {prefix}")
            return

        for gpu_id, values in payload.items():
            if not isinstance(values, dict):
                print(f"Unexpected value {values} for metric {prefix}[{gpu_id}]")
                continue
            for metric, value in values.items():
                self._push_metric(
                    run_id,
                    pack_id,
                    f"{prefix}.{metric}",
                    value,
                    gpu_id=gpu_id,
                    job_id=jobid,
                    order=metric_time,
                    unit="MiB",
                )

    def _push_composed_data(self, run_id, pack_id, gpu_id, k, v, jobid, metric_time):
        for metric, value in v.items():
            unit = None

            match metric:
                case "memory":
                    used, mx = value
                    value = used / mx
                    unit = "%"

            self._push_metric(
                run_id, pack_id, f"{k}.{metric}", value, gpu_id=gpu_id, job_id=jobid, order=metric_time, unit=unit
            )

    def on_data(self, entry):
        state = self.pack_state(entry)
        assert state.step == DATA

        run_id = self._run_id
        pack_id = state.pack._id
        job_id, gpu_id = _get_pack_ids(state.pack)

        if "progress" in entry.data:
            return

        data = deepcopy(entry.data)

        metric_time = data.pop("time", time.time())

        # GPU
        if (gpudata := data.pop("gpudata", None)) is not None:
            # GPU data would have been too hard to query
            # so the gpu_id is moved to its own column
            # and each metric is pushed as a separate document
            self._change_gpudata(run_id, pack_id, "gpudata", gpudata, job_id, metric_time=metric_time)

        elif (torchmem := data.pop("torchmem", None)) is not None:
            self._change_allocmem(
                run_id, pack_id, "torchmem", torchmem, job_id, metric_time=metric_time
            )

        elif (jaxmem := data.pop("jaxmem", None)) is not None:
            self._change_allocmem(
                run_id, pack_id, "jaxmem", jaxmem, job_id, metric_time=metric_time
            )

        elif (process := data.pop("process", None)) is not None:
            self._push_composed_data(run_id, pack_id, gpu_id, "process", process, job_id, metric_time=metric_time)

        elif (cpudata := data.pop("cpudata", None)) is not None:
            self._push_composed_data(run_id, pack_id, gpu_id, "cpudata", cpudata, job_id, metric_time=metric_time)

        elif (iodata := data.pop("iodata", None)) is not None:
            self._push_composed_data(run_id, pack_id, gpu_id, "iodata", iodata, job_id, metric_time=metric_time)

        elif (netdata := data.pop("netdata", None)) is not None:
            self._push_composed_data(run_id, pack_id, gpu_id, "netdata", netdata, job_id, metric_time=metric_time)

        elif (rate := data.pop("rate", None)) is not None:
            unit = data.pop("units", data.pop("unit", None))
            task = data.pop("task", None)

            self._push_metric(
                    run_id,
                    pack_id,
                    "rate",
                    rate,
                    gpu_id=gpu_id,
                    job_id=job_id,
                    unit=unit,
                    namespace=task,
                    order=metric_time,
            )
        else:
            # Standard
            unit = data.pop("units", data.pop("unit", None))
            task = data.pop("task", None)

            if len(data) == 1:
                k, v = list(data.items())[0]

                self._push_metric(
                    run_id,
                    pack_id,
                    k,
                    v,
                    gpu_id=gpu_id,
                    job_id=job_id,
                    unit=unit,
                    namespace=task,
                    order=metric_time,
                )
            else:
                print(f"Unknown format {entry.data}, remains: {data}")
                print(f"Offending benchmark: {state.pack.name}")

        if len(self.pending_metrics) >= self.batch_size:
            self._bulk_insert()

    def _bulk_insert(self):
        if len(self.pending_metrics) <= 0:
            return

        with self.session() as sesh:
            sesh.add_all(self.pending_metrics)
            sesh.commit()

        self.pending_metrics = []

    def on_stop(self, entry):
        state = self.pack_state(entry)
        assert state.step == DATA
        state.early_stop = True

    def on_end(self, entry):
        state = self.pack_state(entry)
        assert state.step == DATA

        run_id = self._run_id
        pack_id = state.pack._id

        job_id, gpu_id = _get_pack_ids(state.pack)

        end = entry.data["time"]
        self._push_metric(
            run_id, pack_id, "walltime", end - state.start, gpu_id=gpu_id, job_id=job_id
        )

        return_code = entry.data["return_code"]

        status = "done"
        
        if state.error > 0 or return_code != 0:
            status = "error"

        if state.early_stop:
            status = "early_stop"

        self._push_metric(
            run_id, pack_id, "return_code", return_code, gpu_id=gpu_id, job_id=job_id,
            namespace=status
        )

        status_code = 1
        if status in ("early_stop", "done"):
            status_code = 0

        self._push_metric(
            run_id, pack_id, "status", status_code, gpu_id=gpu_id, job_id=job_id
        )

        self.update_pack_status(state.pack, status)
        self.states.pop(entry.tag)

        # even if the pack has ended we have other
        # packs still pushing metrics
        if len(self.states) == 0:
            self._bulk_insert()
