"""Convert wide pivot API rows into long/tidy chart rows (mirrors pivotToChartData.ts)."""

from __future__ import annotations

import json
import re
from typing import Any


METRIC_NAME_RE = re.compile(r"(^|:|\.)metric[._]name$", re.I)
METRIC_VALUE_RE = re.compile(r"(^|:|\.)metric[._]value$", re.I)


def field_key(field: str) -> str:
    return field.replace(":", "_")


def short_label(field: str) -> str:
    if ":" in field:
        return field.rsplit(":", 1)[-1]
    if "." in field:
        return field.rsplit(".", 1)[-1]
    return field


def display_field_label(field: str) -> str:
    normalized = field.replace("_", ".")
    if ":" in normalized:
        prefix, rest = normalized.split(":", 1)
        return f"{prefix}:{rest.replace('.', ' · ')}"
    return normalized.replace(".", " · ")


def is_measure_column_key(key: str) -> bool:
    return "/" in key


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_field_assignment(part: str) -> dict[str, str]:
    eq = part.find("=")
    if eq > 0:
        return {
            "field": part[:eq],
            "value": unquote(part[eq + 1 :]),
        }
    return {"field": part, "value": ""}


def is_metric_name_field(field: str) -> bool:
    normalized = field.replace("_", ".")
    return bool(METRIC_NAME_RE.search(normalized) or field.lower() == "metric_name")


def is_metric_value_field(field: str) -> bool:
    normalized = field.replace("_", ".")
    return bool(METRIC_VALUE_RE.search(normalized) or field.lower() == "metric_value")


def metric_name_from_column_parts(column_parts: list[dict[str, str]]) -> str | None:
    for part in column_parts:
        if is_metric_name_field(part["field"]):
            value = (part.get("value") or "").strip()
            if value:
                return value
    return None


def dimension_column_parts(column_parts: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        part
        for part in column_parts
        if not is_metric_name_field(part["field"]) and not is_metric_value_field(part["field"])
    ]


def parse_measure_column(col_name: str) -> dict[str, Any]:
    parts = [p for p in col_name.split("/") if p]

    if len(parts) < 2:
        return {
            "originalName": col_name,
            "wideName": sanitize_vega_field_name(col_name),
            "label": col_name,
            "columnParts": [],
            "valueField": col_name,
            "aggregator": "value",
        }

    aggregator = parts[-1]
    value_field_part = parts[-2]
    dimension_parts = parts[:-2]
    column_parts = [parse_field_assignment(part) for part in dimension_parts]
    value_field = (
        parse_field_assignment(value_field_part)["field"]
        if "=" in value_field_part
        else value_field_part
    )

    label = " · ".join(
        part
        for part in [
            *(p.get("value") or display_field_label(p["field"]) for p in column_parts),
            display_field_label(value_field),
            aggregator,
        ]
        if part
    )

    return {
        "originalName": col_name,
        "wideName": sanitize_vega_field_name(col_name),
        "label": label,
        "columnParts": column_parts,
        "valueField": value_field,
        "aggregator": aggregator,
    }


def build_metric_value_key(measure: dict[str, Any]) -> str:
    metric_name = metric_name_from_column_parts(measure["columnParts"])
    value_field = short_label(measure["valueField"])
    name = metric_name or value_field or "value"
    agg = (measure.get("aggregator") or "").strip()
    if not agg or agg == "value":
        return name
    return f"{name}_{agg}"


def sanitize_vega_field_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned[:96] or "field"


def melt_column_name(sql_alias: str) -> str:
    """Pivot SQL alias (from `rename_column`) → Vega-safe JSON key."""
    return sanitize_vega_field_name(sql_alias)


def coerce_numeric(value: Any) -> Any:
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped and _is_numeric_string(stripped):
            return float(stripped) if "." in stripped or "e" in stripped.lower() else int(stripped)
    return value


def _is_numeric_string(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def _is_nullish(value: Any) -> bool:
    if value is None:
        return True
    if value == "":
        return True
    if isinstance(value, float) and value != value:
        return True
    return False


def infer_column_vega_type(field_name: str, rows: list[dict[str, Any]]) -> str:
    values = [row.get(field_name) for row in rows if not _is_nullish(row.get(field_name))]
    if not values:
        return "nominal"

    coerced = [coerce_numeric(value) for value in values]
    if all(isinstance(value, (int, float)) and not (isinstance(value, float) and value != value) for value in coerced):
        return "quantitative"

    if all(isinstance(value, str) for value in values):
        date_like = [
            value
            for value in values
            if re.match(r"^\d{4}-\d{2}-\d{2}", value)
        ]
        if len(date_like) == len(values):
            return "temporal"

    return "nominal"


def metric_field_label(metric_key: str) -> str:
    sep = metric_key.rfind("_")
    if sep <= 0:
        return display_field_label(metric_key)
    name = metric_key[:sep]
    agg = metric_key[sep + 1 :]
    return f"{display_field_label(name)} ({agg})"


def chart_fields_from_rows(
    rows: list[dict[str, Any]],
    pivot_fields: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not rows:
        return []

    row_by_key = {
        melt_column_name(field_key(pf["field"])): pf
        for pf in (pivot_fields or [])
        if pf.get("type") == "row"
    }
    col_by_key = {
        melt_column_name(field_key(pf["field"])): pf
        for pf in (pivot_fields or [])
        if pf.get("type") == "column"
    }

    key_order: list[str] = []
    seen: set[str] = set()

    def add_key(key: str) -> None:
        if key.startswith("_") or key in seen:
            return
        seen.add(key)
        key_order.append(key)

    for key in rows[0]:
        add_key(key)
    for row in rows:
        for key in row:
            add_key(key)

    fields: list[dict[str, Any]] = []
    for name in key_order:
        pivot_field = row_by_key.get(name) or col_by_key.get(name)
        config_field = pivot_field["field"] if pivot_field else name
        label_source = field_key(config_field)
        vega_type = infer_column_vega_type(name, rows)
        is_measure = vega_type == "quantitative"
        fields.append(
            {
                "name": name,
                "label": metric_field_label(label_source) if is_measure else display_field_label(label_source),
                "sourceName": config_field if config_field != name else None,
                "kind": "measure" if is_measure else "row",
                "vegaType": vega_type,
            }
        )
    return fields


def resolve_row_columns(pivot_rows: list[dict[str, Any]], pivot_fields: list[dict[str, Any]]) -> list[str]:
    if not pivot_rows:
        return []

    keys = list(pivot_rows[0].keys())
    configured = [field_key(item["field"]) for item in pivot_fields if item.get("type") == "row"]
    ordered: list[str] = []

    for key in configured:
        match = next(
            (
                candidate
                for candidate in keys
                if not is_measure_column_key(candidate)
                and (candidate == key or candidate.replace(":", "_") == key)
            ),
            None,
        )
        if match and match not in ordered:
            ordered.append(match)

    for key in keys:
        if not is_measure_column_key(key) and key not in ordered:
            ordered.append(key)

    return ordered


def dimension_signature(
    row: dict[str, Any],
    row_columns: list[str],
    column_parts: list[dict[str, str]],
) -> str:
    parts: list[tuple[str, Any]] = [(col, row.get(col)) for col in row_columns]
    parts.extend((part["field"], part.get("value")) for part in column_parts)
    return json.dumps(parts, sort_keys=True, default=str)



def parse_pivot_fields_from_request_args(args) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []

    rows = args.get("rows", "")
    if rows:
        for field in rows.split(","):
            field = field.strip()
            if field:
                fields.append({"field": field, "type": "row"})

    cols = args.get("cols", "")
    if cols:
        for field in cols.split(","):
            field = field.strip()
            if field:
                fields.append({"field": field, "type": "column"})

    values_param = args.get("values")
    if values_param:
        try:
            decoded = json.loads(__import__("base64").b64decode(values_param))
            if isinstance(decoded, list):
                for item in decoded:
                    if isinstance(item, dict) and item.get("field"):
                        fields.append(
                            {
                                "field": item["field"],
                                "type": "value",
                                "aggregators": [item.get("aggregators", ["avg"])[0] if item.get("aggregators") else "avg"],
                            }
                        )
            elif isinstance(decoded, dict):
                for field, aggregators in decoded.items():
                    aggs = aggregators if isinstance(aggregators, list) else [aggregators]
                    fields.append({"field": field, "type": "value", "aggregators": aggs[:1]})
        except Exception:
            pass

    filters_param = args.get("filters")
    if filters_param:
        try:
            decoded_filters = json.loads(__import__("base64").b64decode(filters_param))
            if isinstance(decoded_filters, list):
                for item in decoded_filters:
                    if isinstance(item, dict) and item.get("field"):
                        fields.append(
                            {
                                "field": item["field"],
                                "type": "filter",
                                "operator": item.get("operator"),
                                "value": item.get("value"),
                            }
                        )
        except Exception:
            pass

    field_labels_param = args.get("fieldLabels")
    if field_labels_param:
        try:
            entries = json.loads(__import__("base64").b64decode(field_labels_param))
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, dict) or not entry.get("label"):
                        continue
                    match = next(
                        (
                            field
                            for field in fields
                            if field.get("type") == entry.get("type")
                            and field.get("field") == entry.get("field")
                            and (
                                field.get("type") != "value"
                                or (entry.get("aggregator") or "avg")
                                == (field.get("aggregators") or ["avg"])[0]
                            )
                        ),
                        None,
                    )
                    if match:
                        match["label"] = entry["label"]
        except Exception:
            pass

    return fields


def apply_pivot_field_labels_to_chart_fields(
    fields: list[dict[str, Any]],
    pivot_fields: list[dict[str, Any]],
    measure_columns: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    row_labels: dict[str, str] = {}
    col_labels: dict[str, str] = {}
    value_labels: dict[str, str] = {}

    for pivot_field in pivot_fields:
        label = (pivot_field.get("label") or "").strip()
        if not label:
            continue
        field_type = pivot_field.get("type")
        if field_type == "row":
            row_labels[melt_column_name(field_key(pivot_field["field"]))] = label
        elif field_type == "column":
            col_labels[melt_column_name(field_key(pivot_field["field"]))] = label
        elif field_type == "value":
            value_labels[field_key(pivot_field["field"])] = label

    metric_key_to_label: dict[str, str] = {}
    for measure in measure_columns:
        base_label = value_labels.get(field_key(measure["valueField"]))
        if not base_label:
            continue
        metric_key = build_metric_value_key(measure)
        agg = (measure.get("aggregator") or "").strip()
        metric_key_to_label[metric_key] = (
            f"{base_label} ({agg})" if agg and agg != "value" else base_label
        )

    updated: list[dict[str, Any]] = []
    for field in fields:
        next_field = dict(field)
        metric_label = metric_key_to_label.get(field["name"])
        if metric_label:
            next_field["label"] = metric_label
        elif field["name"] in row_labels:
            next_field["label"] = row_labels[field["name"]]
        elif field["name"] in col_labels:
            next_field["label"] = col_labels[field["name"]]
        updated.append(next_field)
    return updated


def melt_pivot_rows(
    pivot_rows: list[dict[str, Any]],
    pivot_fields: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Wide pivot table rows → long/tidy JSON array for Vega (`data.values`)."""
    if not pivot_rows:
        return []

    pivot_fields = pivot_fields or []
    all_keys = list(pivot_rows[0].keys())
    row_columns = resolve_row_columns(pivot_rows, pivot_fields)
    measure_keys = [key for key in all_keys if is_measure_column_key(key)]
    measure_columns = [parse_measure_column(key) for key in measure_keys]

    long_rows: list[dict[str, Any]] = []

    for row in pivot_rows:
        merged: dict[str, dict[str, Any]] = {}

        for measure in measure_columns:
            metric_key = build_metric_value_key(measure)
            dimension_parts = dimension_column_parts(measure["columnParts"])
            signature = dimension_signature(row, row_columns, dimension_parts)

            entry = merged.get(signature)
            if entry is None:
                entry = {}
                for col in row_columns:
                    entry[melt_column_name(col)] = row.get(col)
                for part in dimension_parts:
                    entry[melt_column_name(part["field"])] = part.get("value")
                merged[signature] = entry

            entry[metric_key] = coerce_numeric(row.get(measure["originalName"]))

        long_rows.extend(merged.values())

    return long_rows


def build_chart_fields_for_melt_rows(
    rows: list[dict[str, Any]],
    pivot_fields: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Field metadata for the plot builder / spec endpoint (not returned by /melt)."""
    pivot_fields = pivot_fields or []
    fields = chart_fields_from_rows(rows, pivot_fields)
    return apply_pivot_field_labels_to_chart_fields(fields, pivot_fields, [])


def convert_pivot_to_chart_data(
    pivot_rows: list[dict[str, Any]],
    pivot_fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Internal helper — prefer `melt_pivot_rows` for API responses."""
    rows = melt_pivot_rows(pivot_rows, pivot_fields)
    if not rows:
        return None
    pivot_fields = pivot_fields or []
    row_columns = resolve_row_columns(pivot_rows, pivot_fields)
    fields = build_chart_fields_for_melt_rows(rows, pivot_fields)
    return {
        "rows": rows,
        "fields": fields,
        "rowColumns": [melt_column_name(col) for col in row_columns],
        "measureColumns": [],
    }
