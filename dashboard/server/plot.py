import sqlalchemy
from sqlalchemy import select, func, Float, Integer, text

from dashboard.server.database.models import Exec, Metric, Pack, Weight

from .utils import make_selection_key, make_filters


def regular_average(exec_ids, visibility=0):
    average_perf_per_pack = (
        select(
            Metric.pack_id,
            Metric.exec_id,
            func.avg(Metric.value).label("perf"),
            func.stddev(Metric.value).label("std"),
        )
        .join(Exec, Exec._id == Metric.exec_id)
        .where(
            Exec.visibility == visibility,
            Metric.name == "rate",
            Metric.exec_id.in_(exec_ids)
        )
        .group_by(Metric.pack_id, Metric.exec_id)
    )

    return average_perf_per_pack


def average_drop_min_max(exec_ids, visibility=0):
    # Step 1: Assign row numbers or ranks to values per group
    ranked_metrics = (
        select(
            Metric.pack_id,
            Metric.exec_id,
            Metric.value,
            func.row_number().over(
                partition_by=(Metric.pack_id,),
                order_by=Metric.value.asc()
            ).label("row_asc"),
            func.row_number().over(
                partition_by=(Metric.pack_id,),
                order_by=Metric.value.desc()
            ).label("row_desc"),
        )
        .join(Exec, Exec._id == Metric.exec_id)
        .where(
            Exec.visibility == visibility,
            Metric.name == "rate",
            Metric.exec_id.in_(exec_ids)
        )
    ).subquery()

    # Step 2: Filter out min and max rows (row_asc = 1 or row_desc = 1)
    filtered_metrics = (
        select(
            ranked_metrics.c.pack_id,
            ranked_metrics.c.exec_id,
            ranked_metrics.c.value,
        )
        .where(
            ranked_metrics.c.row_asc > 1,
            ranked_metrics.c.row_desc > 1,
        )
    ).subquery()

    # Step 3: Aggregate the remaining values
    return (
        select(
            filtered_metrics.c.pack_id,
            filtered_metrics.c.exec_id,
            func.avg(filtered_metrics.c.value).label("perf"),
            func.stddev(filtered_metrics.c.value).label("std"),
            # func.count().label("count"),
        )
        .group_by(filtered_metrics.c.pack_id, filtered_metrics.c.exec_id)
    )


def median_perf(exec_ids, visibility=0):
    return (
        select(
            Metric.pack_id,
            Metric.exec_id,
            func.percentile_cont(0.5).within_group(Metric.value).label("perf"),
            func.stddev(Metric.value).label("std"),
        )
        .join(Exec, Exec._id == Metric.exec_id)
        .where(
            Exec.visibility == visibility,
            Metric.name == "rate",
            Metric.exec_id.in_(exec_ids),
        )
        .group_by(Metric.pack_id, Metric.exec_id)
    )


PERF_AGG_METHODS = frozenset({"median", "mean", "mean_drop_min_max"})


def resolve_perf_agg(perf_agg: str | None = None, *, drop_min_max: bool | None = None) -> str:
    """Resolve benchmark perf aggregation; ``drop_min_max`` kept for legacy callers."""
    if perf_agg:
        method = perf_agg.strip().lower()
        if method in PERF_AGG_METHODS:
            return method
    if drop_min_max is None:
        return "mean_drop_min_max"
    return "mean_drop_min_max" if drop_min_max else "mean"


def perf_per_bench_query(
    exec_ids,
    profile="default",
    drop_min_max=True,
    perf_agg: str | None = None,
    visibility=0,
):
    method = resolve_perf_agg(perf_agg, drop_min_max=drop_min_max)
    if method == "median":
        average_perf_per_pack = median_perf(exec_ids, visibility=visibility)
    elif method == "mean":
        average_perf_per_pack = regular_average(exec_ids, visibility=visibility)
    else:
        average_perf_per_pack = average_drop_min_max(exec_ids, visibility=visibility)

    sub = average_perf_per_pack.subquery()

    perf_per_bench = (
        select(
            Pack.name.label("bench"),
            sub.c.exec_id,
            func.avg(sub.c.std).label("std"),
            # Count the number of processes per bench
            # NOTE: this does not work for multi node (should be 2 but will return 1)
            func.count().label("n"),
            func.avg(Pack.ngpu).label("ngpu"),
            func.avg(sub.c.perf).label("avg"),

            # func.sum(sub.c.count).label("count"),

            # HERE: This is a sum of the average
            # so multiple runs (i.e mono-gpu runs) are summed up
            func.sum(sub.c.perf).label("score")
        )
        .join(Pack, sub.c.pack_id == Pack._id)
        .group_by(Pack.name, sub.c.exec_id)
    )

    return perf_per_bench


def weighted_perf_per_bench_query(exec_ids, profile="default", drop_min_max=True, perf_agg: str | None = None):
    perf_per_bench = perf_per_bench_query(exec_ids, profile, drop_min_max, perf_agg=perf_agg)

    # This gives the raw score per bench before weighting
    sub = perf_per_bench.subquery()

    # Build a superset of all bench names from both perf data and weights
    perf_benches = select(sub.c.bench.label("bench")).distinct()
    weight_benches = select(Weight.pack.label("bench")).where(Weight.profile == profile).distinct()
    all_benches = perf_benches.union(weight_benches).subquery()

    if len(exec_ids) == 1:
        exec_id = func.coalesce(sub.c.exec_id, exec_ids[0])
    else:
        exec_id = sub.c.exec_id

    weighted_perf_per_bench = (
        select(
            exec_id.label("exec_id"),
            all_benches.c.bench.label("bench"),
            func.avg(func.coalesce(sub.c.ngpu, 0)).label("ngpu"),
            func.avg(func.coalesce(sub.c.n, 0)).label("n"),
            func.avg(func.coalesce(sub.c.avg, 0)).label("perf"),
            func.avg(func.coalesce(sub.c.score, 0)).label("score"),
            func.avg(func.coalesce(sub.c.std, 0)).label("std"),
            func.avg(func.ln(func.coalesce(sub.c.score, 0) + 1) * func.coalesce(Weight.weight, 0) * func.coalesce(Weight.enabled.cast(Integer), 0)).label("log_score")
        )
        .select_from(all_benches)
        .outerjoin(sub, sub.c.bench == all_benches.c.bench)
        .outerjoin(Weight, sqlalchemy.and_(Weight.pack == all_benches.c.bench, Weight.profile == profile))
        .group_by(all_benches.c.bench, sub.c.exec_id)
    )

    return weighted_perf_per_bench


def sql_direct_report(exec_ids, profile="default", drop_min_max=True, more=None, benches=None, perf_agg: str | None = None):
    """Use SQL to directly compute the report from the metrics.

    But we lose a bit of flexibility when it comes to how things get computed.
    But it is much faster.

    When ``benches`` is set, only those pack names are included (``bench IN benches``).
    """
    if more is None:
        more = []

    weighted_perf_per_bench = weighted_perf_per_bench_query(
        exec_ids, profile, drop_min_max, perf_agg=perf_agg
    )

    sub = weighted_perf_per_bench.subquery()

    weight_filters = [Weight.profile == profile]
    if benches:
        weight_filters.append(Weight.pack.in_(benches))
    weight_total = (
        select(func.sum(Weight.weight * Weight.enabled.cast(Integer)))
        .where(*weight_filters)
        .scalar_subquery()
    )

    pack_benches_stmt = (
        select(
            Pack.name.label("bench"),
            Pack.exec_id,
            func.count().label("total"),
            func.sum(
                sqlalchemy.case(
                    (Pack.status.notin_(["done", "early_stop"]), 1),
                    else_=0,
                )
            ).label("fail"),
        )
        .where(Pack.exec_id.in_(exec_ids))
    )
    if benches:
        pack_benches_stmt = pack_benches_stmt.where(Pack.name.in_(benches))
    pack_benches = pack_benches_stmt.group_by(Pack.name, Pack.exec_id).subquery()

    # Final query to consolidate all the data into the report table we know
    perf_per_group = (
        select(
            pack_benches.c.exec_id,

            pack_benches.c.bench.label("bench"),

            *more,

            func.coalesce(func.avg(pack_benches.c.total), 0).cast(Integer).label("total"),

            func.coalesce(func.avg(pack_benches.c.fail), 0).cast(Integer).label("fail"),

            func.coalesce(func.avg(sub.c.n), 0).cast(Float).label("n"),

            func.coalesce(func.avg(sub.c.ngpu), 0).cast(Float).label("ngpu"),

            func.coalesce(func.avg(sub.c.perf), 0).label("perf"),

            func.avg(
                sqlalchemy.case(
                    (sub.c.perf > 0, sub.c.std / sub.c.perf), 
                    else_=0
                )
            ).label("sem"),

            func.coalesce(func.avg(sub.c.std), 0).label("std"),

            func.coalesce(func.avg(sub.c.score), 0).label("score"),

            func.coalesce(func.avg(Weight.weight), 0).cast(Float).label("weight"),

            func.coalesce(func.avg(Weight.enabled.cast(Integer)), 0).cast(Float).label("enabled"),

            func.coalesce(func.avg(sub.c.log_score), 0).label("log_score"),

            func.coalesce(func.avg(Weight.priority), 999).cast(Float).label("order"),

            weight_total.label("weight_total"),
        )
        .select_from(pack_benches)
        .outerjoin(
            sub,
            sqlalchemy.and_(
                sub.c.bench == pack_benches.c.bench,
                sub.c.exec_id == pack_benches.c.exec_id,
            )
        )
        .outerjoin(
            Weight,
            sqlalchemy.and_(
                Weight.pack == pack_benches.c.bench,
                Weight.profile == profile,
            )
        )
        .join(Exec, Exec._id == pack_benches.c.exec_id)
        .group_by(pack_benches.c.bench, pack_benches.c.exec_id, *more)
        .order_by("order")
    )

    return perf_per_group



def _pivot_agg(name, expr):
    """Map UI aggregator names to Postgres-compatible SQLAlchemy aggregates."""
    if name == "median":
        return func.percentile_cont(0.5).within_group(expr)
    if name == "std":
        return func.stddev(expr)
    if name == "var":
        return func.variance(expr)
    return getattr(func, name)(expr)


# Authoritative pivot query limit (Postgres statement_timeout). Clients must not exceed this.
PIVOT_TIMEOUT_MS = 30_000


def apply_pivot_statement_timeout(sess):
    """Cancel pivot SQL after PIVOT_TIMEOUT_MS (Postgres only; no-op elsewhere)."""
    bind = sess.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return
    # Integer form is milliseconds: https://www.postgresql.org/docs/current/runtime-config-client.html
    sess.execute(text(f"SET LOCAL statement_timeout = {int(PIVOT_TIMEOUT_MS)}"))


def is_statement_timeout(exc: BaseException) -> bool:
    """True if ``exc`` is a Postgres statement_timeout cancel."""
    orig = getattr(exc, "orig", None)
    if getattr(orig, "pgcode", None) == "57014":
        return True
    msg = str(exc).lower()
    return "statement timeout" in msg or "canceling statement due to statement timeout" in msg


def pivot_query(sesh, rows, cols, values, filters, profile="default", visibility=0):
    from dashboard.server.report_data import base_report_view

    filter_fields = [f['field'] for f in filters]
    names = {}

    groub_by_rows = [
        make_selection_key(key, names=names) for key in [*rows]
    ]

    selected_keys = groub_by_rows + [
        make_selection_key(key, names=names) for key in [*cols, *list(values.keys()), *filter_fields]
    ]

    query = base_report_view(*selected_keys, profile=profile, visibility=visibility)

    if filters:
        query = query.where(*make_filters(filters))

    sub = query.subquery()

    # This only fetches the unique columns
    col_names = [names[col] for col in cols]
    query = select(*[getattr(sub.c, col_name) for col_name in col_names]).distinct()
    final_columns = [row for row in sesh.execute(query)]  

    # Generate the SQL query to make the pivot
    agg = []
    for value_col, functions in values.items():
        for product_value in final_columns:
            frags = []
            conds = []

            for col_name, v in zip(col_names, product_value):
                frags.append(f"{col_name}={v}")
                conds.append(getattr(sub.c, col_name) == v)

            for f in functions:
                k_name = names.get(value_col)
                
                label = "/".join(frags + [k_name, f])
                value = getattr(sub.c, k_name)

                switch = sqlalchemy.case((sqlalchemy.and_(*conds), value), else_=None).cast(Float)
                agg.append(_pivot_agg(f, switch).label(label))

    final_group_by = [
        getattr(sub.c, names[key]) for key in rows
    ]

    return select(*final_group_by, *agg).group_by(*final_group_by).order_by(*final_group_by)