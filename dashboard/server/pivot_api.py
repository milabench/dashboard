"""Shared pivot API helpers."""

from __future__ import annotations

import base64
import json
from typing import Any

import sqlalchemy

from dashboard.server.plot import (
    PIVOT_TIMEOUT_MS,
    apply_pivot_statement_timeout,
    is_statement_timeout,
    pivot_query,
)
from dashboard.server.pivot_melt import (
    build_chart_fields_for_melt_rows,
    melt_pivot_rows,
    parse_pivot_fields_from_request_args,
)
from dashboard.server.pivot_spec import build_pivot_spec_response
from dashboard.server.utils import cursor_to_json


PIVOT_API_QUERY_KEYS = {"rows", "cols", "values", "filters", "fieldLabels", "plot"}


def rename_column(col: str) -> str:
    if "as" in col:
        return col
    return f"{col} as {col.replace(':', '_')}"


def normalize_pivot_values(decoded: Any) -> dict[str, list[str]]:
    """Accept URL array format or legacy map format for pivot value fields."""
    if isinstance(decoded, list):
        values: dict[str, list[str]] = {}
        for item in decoded:
            if not isinstance(item, dict):
                continue
            field = item.get("field")
            if not field:
                continue
            aggs = item.get("aggregators") or ["avg"]
            if not isinstance(aggs, list):
                aggs = [aggs]
            if not aggs:
                aggs = ["avg"]
            key = rename_column(str(field))
            values.setdefault(key, []).extend(str(agg) for agg in aggs)
        return values

    if isinstance(decoded, dict):
        normalized: dict[str, list[str]] = {}
        for key, aggregators in decoded.items():
            key = rename_column(str(key))
            if isinstance(aggregators, list):
                aggs = aggregators
            else:
                aggs = [aggregators]
            if not aggs:
                aggs = ["avg"]
            normalized[key] = [str(agg) for agg in aggs]
        return normalized

    return {}


def parse_pivot_request_args(args) -> tuple[list[str], list[str], dict[str, list[str]], list[dict[str, Any]]]:
    rows = args.get("rows", "").split(",") if args.get("rows") else ["run", "gpu", "pytorch", "bench"]
    rows = [rename_column(row.strip()) for row in rows if row.strip()]

    cols = args.get("cols", "").split(",") if args.get("cols") else ["metric"]
    cols = [rename_column(col.strip()) for col in cols if col.strip()]

    values = normalize_pivot_values(json.loads(base64.b64decode(args.get("values", "e30="))))

    filters: list[dict[str, Any]] = []
    if args.get("filters"):
        filters = json.loads(base64.b64decode(args.get("filters")))

    return rows, cols, values, filters


def fetch_pivot_table(sqlexec, args, profile: str | None = None) -> tuple[Any, int]:
    profile = profile or "default"

    rows, cols, values, filters = parse_pivot_request_args(args)
    if len(filters) == 0:
        return {}, 200

    try:
        with sqlexec() as sess:
            apply_pivot_statement_timeout(sess)
            query = pivot_query(sess, rows, cols, values, filters, profile)
            cursor = sess.execute(query)
            results = cursor_to_json(cursor)
    except sqlalchemy.exc.OperationalError as exc:
        if is_statement_timeout(exc):
            return {
                "error": f"Pivot query timed out after {PIVOT_TIMEOUT_MS // 1000}s",
            }, 408
        raise

    return results, 200


def fetch_pivot_melt(sqlexec, args, profile: str | None = None) -> tuple[Any, int]:
    table, status = fetch_pivot_table(sqlexec, args, profile)
    if status != 200:
        return table if isinstance(table, dict) else {"error": "Pivot query failed"}, status

    if not isinstance(table, list):
        return table, 200

    pivot_fields = parse_pivot_fields_from_request_args(args)
    return melt_pivot_rows(table, pivot_fields), 200


def fetch_pivot_spec(sqlexec, args, profile: str | None = None) -> tuple[dict[str, Any], int]:
    rows, status = fetch_pivot_melt(sqlexec, args, profile)
    if status != 200:
        return rows if isinstance(rows, dict) else {"error": "Pivot query failed"}, status

    pivot_fields = parse_pivot_fields_from_request_args(args)
    fields = build_chart_fields_for_melt_rows(rows if isinstance(rows, list) else [], pivot_fields)
    return build_pivot_spec_response(args, chart_fields=fields)
