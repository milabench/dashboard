import type { ChartFieldMeta } from './pivotToChartData';
import { resolvePlotFieldName } from './pivotToChartData';

/** Plot builder state serialized in the `plot` URL search param. */

export interface PivotPlotEncodings {
    mark: string;
    x: string;
    y: string;
    color?: string;
    shape?: string;
    opacity?: string;
    size?: string;
    facet?: string;
}

export interface PivotPlotUrlState {
    encodings: PivotPlotEncodings;
    independentX?: boolean;
    independentY?: boolean;
    hideNulls?: boolean;
    cellWidth?: number;
    cellHeight?: number;
}

function buildPlotPayload(state: PivotPlotUrlState): PivotPlotUrlState {
    const payload: PivotPlotUrlState = {
        encodings: {
            mark: state.encodings.mark,
            x: state.encodings.x,
            y: state.encodings.y,
        },
    };

    if (state.encodings.color) payload.encodings.color = state.encodings.color;
    if (state.encodings.shape) payload.encodings.shape = state.encodings.shape;
    if (state.encodings.opacity) payload.encodings.opacity = state.encodings.opacity;
    if (state.encodings.size) payload.encodings.size = state.encodings.size;
    if (state.encodings.facet) payload.encodings.facet = state.encodings.facet;

    if (state.independentX) payload.independentX = true;
    if (state.independentY) payload.independentY = true;
    if (state.hideNulls === false) payload.hideNulls = false;
    if (state.cellWidth != null) payload.cellWidth = state.cellWidth;
    if (state.cellHeight != null) payload.cellHeight = state.cellHeight;

    return payload;
}

/** URL-safe base64 (UTF-8 safe). */
function encodePlotParam(payload: PivotPlotUrlState): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePlotParam(plot: string): PivotPlotUrlState {
    // Spaces often appear when base64 `+` is not URL-encoded in copied links.
    let base64 = plot.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return JSON.parse(new TextDecoder().decode(bytes)) as PivotPlotUrlState;
    } catch {
        // Legacy standard base64
        return JSON.parse(atob(plot.replace(/ /g, '+'))) as PivotPlotUrlState;
    }
}

export function encodePivotPlotState(state: PivotPlotUrlState): string {
    return encodePlotParam(buildPlotPayload(state));
}

export function parsePivotPlotFromSearchParams(
    params: URLSearchParams,
): PivotPlotUrlState | null {
    const plot = params.get('plot')?.trim();
    if (!plot) return null;

    try {
        const decoded = decodePlotParam(plot);
        if (!decoded?.encodings) return null;
        return decoded;
    } catch {
        return null;
    }
}

export function validatePlotEncodings(
    encodings: PivotPlotEncodings,
    fields: ChartFieldMeta[],
    rowKeys?: Iterable<string>,
    fallbackMark = 'point',
): PivotPlotEncodings {
    const pick = (field?: string) => resolvePlotFieldName(field, fields, rowKeys);

    return {
        mark: encodings.mark || fallbackMark,
        x: pick(encodings.x),
        y: pick(encodings.y),
        color: pick(encodings.color),
        shape: pick(encodings.shape),
        opacity: pick(encodings.opacity),
        size: pick(encodings.size),
        facet: pick(encodings.facet),
    };
}

/** True when plot state has the minimum encodings needed to render. */
export function isPlotStateShareable(state: PivotPlotUrlState): boolean {
    return Boolean(state.encodings.x && state.encodings.y);
}
