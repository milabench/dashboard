"""Build Vega-Lite specs for pivot plots with remote melt data URLs."""

from __future__ import annotations

import base64
import json
from typing import Any
from urllib.parse import urlencode


def decode_plot_param(plot: str) -> dict[str, Any]:
    base64_text = plot.replace(" ", "+").replace("-", "+").replace("_", "/")
    while len(base64_text) % 4:
        base64_text += "="
    try:
        raw = base64.b64decode(base64_text)
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return json.loads(base64.b64decode(plot.replace(" ", "+")))


def _field_meta_map(fields: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {field["name"]: field for field in fields}


def _build_encoding(
    field_name: str,
    meta: dict[str, Any] | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    encoding: dict[str, Any] = {"field": field_name}
    vega_type = (meta or {}).get("vegaType", "nominal")
    encoding["type"] = vega_type
    label = (meta or {}).get("label")
    if label:
        encoding["title"] = label
    if vega_type == "quantitative":
        encoding["scale"] = {"zero": False}
    if extra:
        encoding.update(extra)
    return encoding


def _swap_xy_encoding(encoding: dict[str, Any]) -> dict[str, Any]:
    if "x" not in encoding or "y" not in encoding:
        return encoding
    swapped = dict(encoding)
    swapped["x"], swapped["y"] = encoding["y"], encoding["x"]
    return swapped


def _facet_resolve(independent_axes: dict[str, Any] | None) -> dict[str, Any] | None:
    if not independent_axes:
        return None
    scale: dict[str, str] = {}
    axis: dict[str, str] = {}
    if independent_axes.get("x"):
        scale["x"] = "independent"
        axis["x"] = "independent"
    if independent_axes.get("y"):
        scale["y"] = "independent"
        axis["y"] = "independent"
    if not scale:
        return None
    return {"scale": scale, "axis": axis}


def build_pivot_plot_spec(
    plot_state: dict[str, Any],
    melt_data_url: str,
    fields: list[dict[str, Any]],
) -> dict[str, Any] | None:
    template = plot_state.get("template") or "scatter"
    slot_fields = plot_state.get("fields") or {}
    field_meta = _field_meta_map(fields)

    required_by_template = {
        "scatter": ["x", "y"],
        "line": ["x", "y"],
        "bar": ["x", "y"],
        "histogram": ["value"],
        "boxplot": ["x", "y"],
        "heatmap": ["x", "y", "value"],
        "area": ["x", "y"],
    }
    required = required_by_template.get(template, ["x", "y"])
    if not all(slot_fields.get(slot, "").strip() for slot in required):
        return None

    def enc(slot_id: str, extra: dict[str, Any] | None = None):
        field_name = (slot_fields.get(slot_id) or "").strip()
        if not field_name:
            return None
        return _build_encoding(field_name, field_meta.get(field_name), extra)

    config = {
        "axis": {"labelColor": "#cbd5e1"},
        "legend": {"labelColor": "#cbd5e1"},
    }

    plot_size = plot_state.get("plotSize") or {}
    width = int(plot_size.get("width") or 480)
    height = int(plot_size.get("height") or 360)

    if template == "scatter":
        core = {
            "mark": {"type": "point", "tooltip": True},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    elif template == "line":
        core = {
            "mark": {"type": "line", "point": True, "tooltip": True},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    elif template == "bar":
        core = {
            "mark": {"type": "bar", "tooltip": True, "opacity": 0.85},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    elif template == "histogram":
        core = {
            "mark": {"type": "bar", "tooltip": True, "opacity": 0.85},
            "encoding": {
                "x": enc("value", {"bin": True}),
                "y": {"aggregate": "count", "title": "Count"},
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    elif template == "boxplot":
        core = {
            "mark": {"type": "boxplot", "tooltip": True},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    elif template == "heatmap":
        core = {
            "mark": {"type": "rect", "tooltip": True},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                "color": enc("value", {"aggregate": "mean"}),
            },
        }
    elif template == "area":
        core = {
            "mark": {"type": "area", "line": True, "point": True, "tooltip": True, "opacity": 0.7},
            "encoding": {
                "x": enc("x"),
                "y": enc("y"),
                **({"color": enc("color")} if enc("color") else {}),
            },
        }
    else:
        return None

    axis_options = plot_state.get("axisOptions") or {}
    if axis_options.get("swapAxes") and isinstance(core.get("encoding"), dict):
        core = {**core, "encoding": _swap_xy_encoding(core["encoding"])}

    legend_options = plot_state.get("legendOptions") or {}
    placement = legend_options.get("placement", "right")
    direction = legend_options.get("direction", "vertical")
    if placement == "none":
        config["legend"] = {"disable": True}
    elif direction == "horizontal":
        config["legend"] = {"orient": placement, "direction": "horizontal", "disable": False}
    else:
        config["legend"] = {
            "orient": placement,
            "direction": "vertical",
            "disable": False,
            "columns": 1,
        }

    core = {
        **core,
        "width": width,
        "height": height,
        "autosize": {"type": "pad", "contains": "padding"},
        "config": config,
        "data": {"url": melt_data_url},
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    }

    facet_column = (slot_fields.get("facetColumn") or "").strip()
    facet_row = (slot_fields.get("facetRow") or "").strip()
    facet_layout = plot_state.get("facetLayout") or {"mode": "wrap"}

    if facet_column or facet_row:
        facet_spec: dict[str, Any] = {"spec": core}
        resolve = _facet_resolve((facet_layout or {}).get("independentAxes"))
        if facet_column and not facet_row:
            facet_spec["facet"] = enc("facetColumn") or _build_encoding(
                facet_column,
                field_meta.get(facet_column),
            )
            if facet_layout.get("mode") == "wrap" and facet_layout.get("columns"):
                facet_spec["columns"] = int(facet_layout["columns"])
        else:
            facet_enc: dict[str, Any] = {}
            if facet_row:
                facet_enc["row"] = enc("facetRow") or _build_encoding(
                    facet_row,
                    field_meta.get(facet_row),
                )
            if facet_column:
                facet_enc["column"] = enc("facetColumn") or _build_encoding(
                    facet_column,
                    field_meta.get(facet_column),
                )
            facet_spec["facet"] = facet_enc
        if resolve:
            facet_spec["resolve"] = resolve
        facet_spec["$schema"] = "https://vega.github.io/schema/vega-lite/v5.json"
        facet_spec["data"] = {"url": melt_data_url}
        return facet_spec

    return core


def build_pivot_spec_response(
    request_args,
    melt_path: str = "/api/pivot/melt",
    chart_fields: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], int]:
    plot_param = request_args.get("plot")
    if not plot_param:
        return {"error": "Missing required query parameter: plot"}, 400

    try:
        plot_state = decode_plot_param(plot_param)
    except Exception:
        return {"error": "Invalid plot parameter"}, 400

    melt_query = urlencode(
        {
            key: value
            for key, value in request_args.items()
            if key in {"rows", "cols", "values", "filters", "fieldLabels"}
        },
        doseq=True,
    )
    melt_data_url = f"{melt_path}?{melt_query}" if melt_query else melt_path

    fields = chart_fields or []
    spec = build_pivot_plot_spec(plot_state, melt_data_url, fields)
    if spec is None:
        return {"error": "Could not build Vega-Lite spec from plot configuration"}, 400

    return {
        "spec": spec,
        "dataUrl": melt_data_url,
        "plot": plot_state,
    }, 200
