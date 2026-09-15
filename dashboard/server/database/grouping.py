"""Auto-grouping logic for RunGroup / RunGroupMember.

Strategies
----------
hardware  — GPU × CPU × OS-arch fingerprint (node_profile granularity by default)
config    — Sizer mode / clock-tuning classification
software  — PyTorch + CUDA/HIP major.minor versions

All strategies produce a deterministic SHA-1 fingerprint so that the same
physical environment always maps to the same RunGroup row (upsert semantics).
"""

import hashlib
import json
import re
from datetime import datetime

import sqlalchemy
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import RunGroup, RunGroupMember, Pack, Exec, Metric

# ── helpers ──────────────────────────────────────────────────────────────────

def _sha256(obj) -> str:
    payload = json.dumps(obj, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _major_minor(version_str: str | None) -> str | None:
    if not version_str:
        return None
    m = re.match(r"(\d+\.\d+)", str(version_str))
    return m.group(1) if m else str(version_str)


def _normalize_cpu(brand: str | None) -> str:
    """Reduce CPU brand string to a short canonical key."""
    if not brand:
        return "unknown"
    brand = brand.lower()
    for keyword in ("epyc", "threadripper", "ryzen", "xeon", "core i", "neoverse", "graviton", "ampere"):
        if keyword in brand:
            # keep first two space-separated tokens after keyword for disambiguation
            idx = brand.index(keyword)
            tokens = brand[idx:].split()
            return " ".join(tokens[:2]).strip()
    return brand.split("@")[0].strip()[:40]


def _gpu_list(meta: dict) -> list[str]:
    """Return sorted list of unique GPU product names from exec meta."""
    gpus = (meta.get("accelerators") or {}).get("gpus") or {}
    products = set()
    for v in gpus.values():
        if isinstance(v, dict):
            p = v.get("product")
            if p:
                products.add(str(p))
    return sorted(products)


def _gpu_count(meta: dict) -> int:
    gpus = (meta.get("accelerators") or {}).get("gpus") or {}
    return len(gpus)


def _gpu_memory_gb(meta: dict) -> float | None:
    """Per-device memory in GiB (rounded), from first GPU entry."""
    gpus = (meta.get("accelerators") or {}).get("gpus") or {}
    for v in gpus.values():
        if isinstance(v, dict):
            mem = v.get("memory") or {}
            total = mem.get("total")
            if total:
                try:
                    return round(float(total) / 1024, 1)
                except (ValueError, TypeError):
                    pass
    return None


# ── strategy: hardware ────────────────────────────────────────────────────────

def _hardware_fields(meta: dict, granularity: str = "node_profile") -> dict:
    cpu = meta.get("cpu") or {}
    os_info = meta.get("os") or {}

    fields: dict = {
        "gpu_products": _gpu_list(meta),
        "gpu_count": _gpu_count(meta),
        "gpu_memory_gb": _gpu_memory_gb(meta),
    }

    if granularity in ("node_profile", "machine_profile"):
        fields["cpu_brand"] = _normalize_cpu(cpu.get("brand"))
        fields["cpu_count"] = cpu.get("count")
        fields["os_arch"] = os_info.get("machine") or os_info.get("processor")

    if granularity == "machine_profile":
        fields["hostname"] = os_info.get("nodename")

    return fields


def _hardware_label(fields: dict) -> str:
    count = fields.get("gpu_count", 0)
    products = fields.get("gpu_products") or []
    mem = fields.get("gpu_memory_gb")
    gpu_part = f"{count}× {', '.join(products)}"
    if mem:
        gpu_part += f" {int(mem) if mem == int(mem) else mem}GiB"
    cpu = fields.get("cpu_brand")
    cpu_count = fields.get("cpu_count")
    arch = fields.get("os_arch")
    parts = [gpu_part]
    if cpu:
        cpu_part = cpu
        if cpu_count:
            cpu_part += f" ({cpu_count}c)"
        parts.append(cpu_part)
    if arch:
        parts.append(arch)
    return " / ".join(parts)


def fingerprint_hardware(meta: dict, granularity: str = "node_profile") -> tuple[str, str, dict]:
    fields = _hardware_fields(meta, granularity)
    fp = _sha256({"strategy": "hardware", "granularity": granularity, **fields})
    label = _hardware_label(fields)
    return fp, label, fields


# ── strategy: config ──────────────────────────────────────────────────────────

def _classify_config(meta: dict) -> dict:
    # `overrides` is a flat dict of dotted CLI-override keys (e.g.
    # "sizer.batch_size": 32), not a nested {"sizer": {...}} structure.
    overrides = (meta.get("overrides") or {})

    def sizer(key):
        return overrides.get(f"sizer.{key}")

    # "optimized" is reserved for the single final pick after a resize
    # sweep. Every other explicit resize (fixed batch_size/mult/add, or an
    # auto capacity/fit target) is a "resized" run — broken down by the
    # dimension + value that was actually varied, so e.g. batch_size=32
    # and batch_size=64 land in distinct groups instead of one bucket.
    if sizer("optimized"):
        return {"kind": "optimized"}

    if sizer("batch_size") is not None:
        return {"kind": "resized", "by": "batch_size", "value": sizer("batch_size")}

    if sizer("mult") is not None:
        return {"kind": "resized", "by": "mult", "value": sizer("mult")}

    if sizer("add") is not None:
        return {"kind": "resized", "by": "add", "value": sizer("add")}

    if sizer("auto") and sizer("capacity"):
        return {"kind": "resized", "by": "capacity", "value": str(sizer("capacity"))}

    if sizer("auto"):
        return {"kind": "resized", "by": "auto_fit"}

    return {"kind": "baseline"}


def _config_label(fields: dict) -> str:
    kind = fields.get("kind", "baseline")
    if kind == "baseline":
        return "baseline"
    if kind == "optimized":
        return "optimized (best-batch)"
    if kind == "resized":
        by = fields.get("by")
        if by == "auto_fit":
            return "resized (auto-fit)"
        return f"resized ({by}={fields.get('value')})"
    return kind


_AUTO_CAPACITY_NAME_RE = re.compile(r"^auto_\d+_([^.]+)\.")


def capacity_from_run_name(run_name: str | None) -> str | None:
    """Parse the intended capacity target from an ``auto_<n>_<capacity>``
    run name (e.g. "auto_8_80GiB.1786..." -> "80GiB").

    Used as a fallback/override for ``sizer.capacity`` in already-recorded
    metadata: a confirmed race in milabench's option-tracking (fixed
    upstream in ``milabench/system.py`` — concurrently-executing benchmark
    packs shared one unlocked global dict) meant a pack's recorded
    "overrides.sizer.capacity" could silently be some *other*, concurrently
    running pack's value instead of its own. The run name was set once, by
    hand or by the sweep script, at launch time — unaffected by that race —
    so it's the more trustworthy signal for data collected before the fix.
    """
    if not run_name:
        return None
    m = _AUTO_CAPACITY_NAME_RE.match(run_name)
    return m.group(1) if m else None


def fingerprint_config(meta: dict) -> tuple[str, str, dict]:
    fields = _classify_config(meta)
    fp = _sha256({"strategy": "config", **fields})
    label = _config_label(fields)
    return fp, label, fields


# "baseline" runs aren't distinguished by any sizer override, so the only
# signal left for which benchmark suite (config/*.yaml) actually ran is the
# set of benchmark names it produced. Resolved lazily via milabench's own
# config loader and cached for the process lifetime.
_SUITE_CANDIDATES = ("training", "inference", "synthetic", "experimental", "all")
_suite_benchmark_sets: dict[str, frozenset[str]] | None = None


def _load_suite_benchmark_sets() -> dict[str, frozenset[str]]:
    global _suite_benchmark_sets
    if _suite_benchmark_sets is not None:
        return _suite_benchmark_sets

    from milabench.testing import resolved_config

    sets = {}
    for name in _SUITE_CANDIDATES:
        try:
            cfg = resolved_config(name)
            sets[name] = frozenset(cfg.keys())
        except Exception as err:
            print(f"[grouping] Could not resolve suite config {name!r}: {err}")

    _suite_benchmark_sets = sets
    return sets


def classify_baseline_suite(pack_names: set[str]) -> str | None:
    """Best-matching benchmark suite for a set of pack names, or None.

    Picks the candidate covering the largest fraction of ``pack_names``;
    ties broken toward the smaller (more specific) suite, so a run that
    only touches "training" benches matches "training" rather than the
    "all" superset. Requires >=50% coverage to accept a match at all.
    """
    if not pack_names:
        return None

    best_name = None
    best_coverage = 0.0
    best_size = None
    for name, suite_set in _load_suite_benchmark_sets().items():
        if not suite_set:
            continue
        coverage = len(pack_names & suite_set) / len(pack_names)
        if coverage < 0.5:
            continue
        if best_name is None or coverage > best_coverage or (
            coverage == best_coverage and len(suite_set) < best_size
        ):
            best_name, best_coverage, best_size = name, coverage, len(suite_set)

    return best_name


# ── strategy: milabench ───────────────────────────────────────────────────────

# git describe: v1.2.3              → release
# git describe: v1.2.3-19-gabcdef   → dev, base = v1.2.3
# bare commit hash / anything else  → unknown
_RELEASE_RE  = re.compile(r'^(v\d+\.\d+[\.\d]*)$')
_DESCRIBE_RE = re.compile(r'^(v\d+\.\d+[\.\d]*)-\d+-g[0-9a-f]+$')


def _parse_milabench_tag(tag: str | None) -> tuple[str, str | None]:
    """Return (kind, base_tag).  kind ∈ {release, dev, unknown}."""
    if not tag:
        return "unknown", None
    if _RELEASE_RE.match(tag):
        return "release", tag
    m = _DESCRIBE_RE.match(tag)
    if m:
        return "dev", m.group(1)
    return "unknown", None


def _milabench_fields(meta: dict) -> dict:
    mb = meta.get("milabench") or {}
    tag = mb.get("tag") or None
    kind, base_tag = _parse_milabench_tag(tag)
    return {"kind": kind, "base_tag": base_tag, "raw_tag": tag}


def _milabench_label(fields: dict) -> str:
    kind     = fields.get("kind", "unknown")
    base_tag = fields.get("base_tag")
    if kind == "release":
        return f"milabench {base_tag}"
    if kind == "dev" and base_tag:
        return f"milabench {base_tag}-dev"
    return "milabench unknown"


def fingerprint_milabench(meta: dict) -> tuple[str, str, dict]:
    fields = _milabench_fields(meta)
    # fingerprint on kind + base_tag only — raw commit hash is excluded so all
    # dev builds from the same base release land in the same group.
    fp = _sha256({"strategy": "milabench", "kind": fields["kind"], "base_tag": fields["base_tag"]})
    label = _milabench_label(fields)
    return fp, label, fields


# ── strategy: software ────────────────────────────────────────────────────────

def _software_fields(meta: dict) -> dict:
    pytorch = meta.get("pytorch") or {}
    torch_ver = _major_minor(pytorch.get("torch") or pytorch.get("version"))
    cuda_ver = _major_minor(pytorch.get("cuda"))
    hip_ver = _major_minor(pytorch.get("hip"))
    accel_ver = cuda_ver or hip_ver
    accel_name = "CUDA" if cuda_ver else ("HIP" if hip_ver else None)
    return {
        "torch": torch_ver,
        "accel_name": accel_name,
        "accel_version": accel_ver,
    }


def _software_label(fields: dict) -> str:
    parts = []
    if fields.get("torch"):
        parts.append(f"PyTorch {fields['torch']}")
    if fields.get("accel_name") and fields.get("accel_version"):
        parts.append(f"{fields['accel_name']} {fields['accel_version']}")
    return " + ".join(parts) if parts else "unknown software"


def fingerprint_software(meta: dict) -> tuple[str, str, dict]:
    fields = _software_fields(meta)
    fp = _sha256({"strategy": "software", **fields})
    label = _software_label(fields)
    return fp, label, fields


# ── upsert + link ─────────────────────────────────────────────────────────────

def _upsert_group(session: Session, strategy: str, fingerprint: str, label: str,
                  granularity: str | None, meta: dict) -> int:
    """Return group._id, creating or updating the row as needed."""
    row = session.execute(
        sqlalchemy.select(RunGroup).where(
            RunGroup.strategy == strategy,
            RunGroup.fingerprint == fingerprint,
        )
    ).scalar_one_or_none()

    if row is None:
        row = RunGroup(
            strategy=strategy,
            fingerprint=fingerprint,
            granularity=granularity,
            label=label,
            meta=meta,
        )
        session.add(row)
        session.flush()
    else:
        row.label = label
        row.meta = meta
        row.updated_at = datetime.utcnow()

    return row._id


def _link_exec(session: Session, exec_id: int, group_id: int) -> None:
    exists = session.execute(
        sqlalchemy.select(RunGroupMember).where(
            RunGroupMember.exec_id == exec_id,
            RunGroupMember.group_id == group_id,
        )
    ).scalar_one_or_none()
    if exists is None:
        session.add(RunGroupMember(exec_id=exec_id, group_id=group_id))


# ── strategy: platform (hardware × software × config, milabench-agnostic) ────

def fingerprint_platform(meta: dict) -> tuple[str, str, dict]:
    """Combined fingerprint: hardware × software × config, ignoring milabench version.

    Runs land in the same platform group as long as the machine, software stack,
    and sizer config match — regardless of which milabench release ran them.
    Use this for rolling / trend views across milabench upgrades.
    """
    hw_fp, hw_label, hw_fields = fingerprint_hardware(meta, granularity="node_profile")
    sw_fp, sw_label, sw_fields = fingerprint_software(meta)
    cfg_fp, cfg_label, cfg_fields = fingerprint_config(meta)

    fp = _sha256({
        "strategy": "platform",
        "hardware": hw_fp,
        "software": sw_fp,
        "config": cfg_fp,
    })

    label_parts = [p for p in [hw_label, sw_label, cfg_label] if p]
    label = " | ".join(label_parts)

    fields = {
        "hardware": hw_fields,
        "software": sw_fields,
        "config": cfg_fields,
    }
    return fp, label, fields


# ── strategy: strict (all-four combined) ─────────────────────────────────────

def fingerprint_strict(meta: dict) -> tuple[str, str, dict]:
    """Combined fingerprint: hardware × software × config × milabench.

    Two execs land in the same strict group only when they match on every
    dimension simultaneously.  This is the intended basis for composite reports.
    """
    hw_fp, hw_label, hw_fields = fingerprint_hardware(meta, granularity="node_profile")
    sw_fp, sw_label, sw_fields = fingerprint_software(meta)
    cfg_fp, cfg_label, cfg_fields = fingerprint_config(meta)
    mb_fp, mb_label, mb_fields = fingerprint_milabench(meta)

    fp = _sha256({
        "strategy": "strict",
        "hardware": hw_fp,
        "software": sw_fp,
        "config": cfg_fp,
        "milabench": mb_fp,
    })

    label_parts = [p for p in [hw_label, sw_label, cfg_label, mb_label] if p]
    label = " | ".join(label_parts)

    fields = {
        "hardware": hw_fields,
        "software": sw_fields,
        "config": cfg_fields,
        "milabench": mb_fields,
    }
    return fp, label, fields


# ── composite report helpers ──────────────────────────────────────────────────

DEFAULT_SUCCESS_STATUSES = frozenset({"done"})

# Raw Pack.status values (as recorded by milabench) that represent a worker
# actually running the benchmark to a usable conclusion. "early_stop" is a
# deliberate, successful stop once a benchmark's own stopping criterion is
# hit — it is not a failure and typically carries as much real "rate" data
# as a "done" pack. "error"/"interrupted"/None are not included here: most
# such packs never recorded a "rate" metric at all (verified against
# production data), so they're excluded via the rate check below anyway,
# but a rare one that *did* record a few rate samples before dying is still
# not something to build a comparison on.
PACK_SUCCESS_STATUSES = frozenset({"done", "early_stop"})


def pack_status_by_exec(
    session: Session, exec_ids: list[int]
) -> tuple[dict[int, set[str]], dict[int, dict[str, str]]]:
    """(packs_by_exec, status_by_exec) for ``assign_benches_to_execs``.

    A bench usually maps to several worker Pack rows (e.g. one per GPU), so
    it counts as having *succeeded* on an exec if at least one of them
    reports a genuinely-successful status (``PACK_SUCCESS_STATUSES``) and
    actually recorded a "rate" metric. Only requiring "at least one" (rather
    than "all") matters for multi-GPU benches: an isolated worker erroring
    out shouldn't hide an otherwise-real, multi-worker result — the report
    layer itself (``sql_direct_report``) already just aggregates whatever
    rate samples exist, regardless of a single worker's failure. The "rate"
    check matters because a ``milabench prepare`` (setup-only) push marks
    every pack "done" without ever measuring real throughput; without it,
    such a push looks like a perfect run to composite-report/ranking logic
    while contributing nothing but zero-scores.
    """
    pack_rows = session.execute(
        select(Pack._id, Pack.exec_id, Pack.name, Pack.status).where(
            Pack.exec_id.in_(exec_ids), Pack.invalidated.is_(False)
        )
    ).all()

    packs_with_rate: set[int] = set()
    pack_ids = [row._id for row in pack_rows]
    if pack_ids:
        packs_with_rate = set(
            session.execute(
                select(Metric.pack_id)
                .where(Metric.pack_id.in_(pack_ids), Metric.name == "rate")
                .distinct()
            )
            .scalars()
            .all()
        )

    packs_by_exec: dict[int, set[str]] = {}
    ok_by_bench: dict[int, dict[str, list[bool]]] = {}
    for row in pack_rows:
        packs_by_exec.setdefault(row.exec_id, set()).add(row.name)
        ok = row.status in PACK_SUCCESS_STATUSES and row._id in packs_with_rate
        ok_by_bench.setdefault(row.exec_id, {}).setdefault(row.name, []).append(ok)

    status_by_exec: dict[int, dict[str, str]] = {
        exec_id: {name: "done" if any(oks) else "failed" for name, oks in benches.items()}
        for exec_id, benches in ok_by_bench.items()
    }
    return packs_by_exec, status_by_exec


def assign_benches_to_execs(
    ordered_exec_ids: list[int],
    packs_by_exec: dict[int, set[str]],
    status_by_exec: dict[int, dict[str, str]] | None = None,
    success_statuses: frozenset[str] = DEFAULT_SUCCESS_STATUSES,
    *,
    drop_unresolved: bool = False,
) -> dict[int, list[str]]:
    """Greedy bench→exec assignment for composite reports.

    Iterates ``ordered_exec_ids`` from newest to oldest so that every bench
    is sourced from exactly one run. Two passes:

    1. Claim each bench from the newest exec where it actually *succeeded*
       (``status_by_exec[exec_id][bench] in success_statuses``), so a run
       that errored/timed out on a bench doesn't shadow an older run that
       completed it cleanly.
    2. Anything still unclaimed (failed everywhere, or ``status_by_exec``
       not provided) falls back to the newest exec that has it regardless
       of status — better to show a failed result than silently drop the
       bench from the report. Skipped entirely when ``drop_unresolved``.

    ``status_by_exec`` is optional: omit it (or pass ``None``) to fall back
    to pure recency, matching the original behavior.

    ``drop_unresolved``: when True, a bench that never succeeded on any of
    ``ordered_exec_ids`` is left out of the result instead of falling back
    to a failed exec — for score aggregation, a fabricated zero for a bench
    that never actually worked anywhere in the candidate set skews the
    result far more than simply leaving it out. Use the default (False) for
    a display/diagnostic report where surfacing "this always fails" is the
    point.

    Returns a dict ``{exec_id: [bench_name, ...]}``.
    """
    status_by_exec = status_by_exec or {}
    bench_to_exec: dict[str, int] = {}

    for exec_id in ordered_exec_ids:
        statuses = status_by_exec.get(exec_id, {})
        for bench in packs_by_exec.get(exec_id, set()):
            if bench not in bench_to_exec and statuses.get(bench) in success_statuses:
                bench_to_exec[bench] = exec_id

    if not drop_unresolved:
        for exec_id in ordered_exec_ids:
            for bench in packs_by_exec.get(exec_id, set()):
                bench_to_exec.setdefault(bench, exec_id)

    exec_to_benches: dict[int, list[str]] = {}
    for bench, exec_id in bench_to_exec.items():
        exec_to_benches.setdefault(exec_id, []).append(bench)

    return exec_to_benches


def rank_execs_by_success(
    ordered_exec_ids: list[int],
    packs_by_exec: dict[int, set[str]],
    status_by_exec: dict[int, dict[str, str]] | None = None,
    success_statuses: frozenset[str] = DEFAULT_SUCCESS_STATUSES,
) -> list[int]:
    """Reorder exec ids for ``assign_benches_to_execs`` so the run with the
    most *successful* benches is tried first, and other runs are only used
    to fill in whatever that run is missing.

    Without this, ``assign_benches_to_execs`` claims each bench from
    whichever exec is newest-and-successful *independently per bench* — so
    a composite can end up stitched from many different runs even when one
    single run already covers almost everything, and different pushes of
    the same hardware/config can then report noticeably different numbers
    depending on which runs happened to succeed on which individual bench.
    Ranking by success count first concentrates the composite into as few
    runs as possible.

    ``ordered_exec_ids`` should already be sorted newest-first (as
    ``assign_benches_to_execs`` expects): ties in success count keep that
    incoming order via a stable sort, so recency still breaks ties.
    """
    status_by_exec = status_by_exec or {}

    def success_count(exec_id: int) -> int:
        statuses = status_by_exec.get(exec_id, {})
        return sum(
            1 for bench in packs_by_exec.get(exec_id, ()) if statuses.get(bench) in success_statuses
        )

    return sorted(ordered_exec_ids, key=lambda exec_id: -success_count(exec_id))


# ── public API ────────────────────────────────────────────────────────────────

AUTO_STRATEGIES = ["hardware", "config", "software", "milabench", "platform", "strict"]


def assign_groups(exec_id: int, meta: dict, session: Session) -> list[int]:
    """Compute fingerprints for all auto-strategies and link exec to them.

    Returns list of group IDs assigned.
    """
    group_ids: list[int] = []

    # hardware (node_profile granularity)
    if _gpu_list(meta):
        fp, label, fields = fingerprint_hardware(meta, granularity="node_profile")
        gid = _upsert_group(session, "hardware", fp, label, "node_profile", fields)
        _link_exec(session, exec_id, gid)
        group_ids.append(gid)

    # config
    fp, label, fields = fingerprint_config(meta)
    if fields.get("kind") == "resized" and fields.get("by") == "capacity":
        # The recorded value may be corrupted by the (now-fixed) milabench
        # option-tracking race — prefer whatever the run name implies, when
        # it's parseable, since that was set once at launch time.
        exec_row = session.get(Exec, exec_id)
        name_capacity = capacity_from_run_name(exec_row.name if exec_row else None)
        if name_capacity and name_capacity != fields.get("value"):
            fields = {**fields, "value": name_capacity}
            label = _config_label(fields)
            fp = _sha256({"strategy": "config", **fields})
    if fields.get("kind") == "baseline":
        # No sizer override to distinguish these — fall back to which
        # benchmark suite (config/*.yaml) actually ran. Only meaningful
        # once this exec's packs exist (backfill, not the first on_new_run
        # of a fresh push, which fires before any pack has been created).
        pack_names = set(
            session.execute(
                sqlalchemy.select(Pack.name).where(Pack.exec_id == exec_id)
            ).scalars().all()
        )
        suite = classify_baseline_suite(pack_names)
        # "all" (all.yaml) is the actual baseline/default suite — treated
        # the same as "no suite matched" (both stay plain "baseline", with
        # no "suite" fingerprint field) so they land in the *same* group
        # instead of two same-labeled-but-differently-fingerprinted ones.
        # Every other match is a distinct, named suite in its own right.
        if suite and suite != "all":
            fields = {**fields, "suite": suite}
            label = suite
            fp = _sha256({"strategy": "config", **fields})
    gid = _upsert_group(session, "config", fp, label, None, fields)
    _link_exec(session, exec_id, gid)
    group_ids.append(gid)

    # software
    fp, label, fields = fingerprint_software(meta)
    gid = _upsert_group(session, "software", fp, label, None, fields)
    _link_exec(session, exec_id, gid)
    group_ids.append(gid)

    # milabench version (release vs dev)
    fp, label, fields = fingerprint_milabench(meta)
    gid = _upsert_group(session, "milabench", fp, label, None, fields)
    _link_exec(session, exec_id, gid)
    group_ids.append(gid)

    # platform: hardware × software × config (milabench-agnostic rolling view)
    if _gpu_list(meta):
        fp, label, fields = fingerprint_platform(meta)
        gid = _upsert_group(session, "platform", fp, label, "node_profile", fields)
        _link_exec(session, exec_id, gid)
        group_ids.append(gid)

    # strict: all four combined (only used when GPU info is present)
    if _gpu_list(meta):
        fp, label, fields = fingerprint_strict(meta)
        gid = _upsert_group(session, "strict", fp, label, "node_profile", fields)
        _link_exec(session, exec_id, gid)
        group_ids.append(gid)

    session.commit()
    return group_ids
