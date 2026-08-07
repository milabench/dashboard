import type { ChartFieldMeta } from './pivotToChartData';
import { resolvePlotFieldName } from './pivotToChartData';
import type { PlotTemplateId, FacetLayoutOptions } from './pivotPlotTemplates';
import { getPlotTemplate, migrateLegacyEncodings } from './pivotPlotTemplates';
import type { PivotTransformStep } from './pivotPlotTransforms';

/** @deprecated Legacy encoding-based plot state. */
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

export interface PlotAxisOptions {
    /** Padding between the X axis line and tick value labels (px). */
    xLabelPadding?: number;
    /** Padding between X tick labels and the axis title (px). */
    xTitlePadding?: number;
    /** Padding between the Y axis line and tick value labels (px). */
    yLabelPadding?: number;
    /** Padding between Y tick labels and the axis title (px). */
    yTitlePadding?: number;
}

export const DEFAULT_PLOT_AXIS_OPTIONS: Required<PlotAxisOptions> = {
    xLabelPadding: 6,
    xTitlePadding: 10,
    yLabelPadding: 6,
    yTitlePadding: 10,
};

export function normalizePlotAxisOptions(raw?: PlotAxisOptions): Required<PlotAxisOptions> {
    const defaults = DEFAULT_PLOT_AXIS_OPTIONS;
    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, Math.round(parsed)));
    };

    return {
        xLabelPadding: clamp(raw?.xLabelPadding, 0, 32, defaults.xLabelPadding),
        xTitlePadding: clamp(raw?.xTitlePadding, 0, 48, defaults.xTitlePadding),
        yLabelPadding: clamp(raw?.yLabelPadding, 0, 32, defaults.yLabelPadding),
        yTitlePadding: clamp(raw?.yTitlePadding, 0, 48, defaults.yTitlePadding),
    };
}

function compactPlotAxisOptions(opts: Required<PlotAxisOptions>): PlotAxisOptions | undefined {
    const defaults = DEFAULT_PLOT_AXIS_OPTIONS;
    const compact: PlotAxisOptions = {};
    if (opts.xLabelPadding !== defaults.xLabelPadding) compact.xLabelPadding = opts.xLabelPadding;
    if (opts.xTitlePadding !== defaults.xTitlePadding) compact.xTitlePadding = opts.xTitlePadding;
    if (opts.yLabelPadding !== defaults.yLabelPadding) compact.yLabelPadding = opts.yLabelPadding;
    if (opts.yTitlePadding !== defaults.yTitlePadding) compact.yTitlePadding = opts.yTitlePadding;
    return Object.keys(compact).length > 0 ? compact : undefined;
}

export interface PivotPlotUrlState {
    template: PlotTemplateId;
    fields: Record<string, string>;
    transforms?: PivotTransformStep[];
    hideNulls?: boolean;
    facetLayout?: FacetLayoutOptions;
    axisOptions?: PlotAxisOptions;
    /** @deprecated Present in older shared URLs. */
    encodings?: PivotPlotEncodings;
}

function buildPlotPayload(state: PivotPlotUrlState): PivotPlotUrlState {
    const payload: PivotPlotUrlState = {
        template: state.template,
        fields: { ...state.fields },
    };

    const cleanedFields = Object.fromEntries(
        Object.entries(payload.fields).filter(([, v]) => Boolean(v?.trim())),
    );
    payload.fields = cleanedFields;

    if (state.transforms && state.transforms.length > 0) {
        payload.transforms = state.transforms;
    }
    if (state.hideNulls === false) payload.hideNulls = false;
    if (state.fields.facet?.trim() && state.facetLayout) {
        payload.facetLayout = state.facetLayout;
    }
    const axisOptions = state.axisOptions
        ? compactPlotAxisOptions(normalizePlotAxisOptions(state.axisOptions))
        : undefined;
    if (axisOptions) payload.axisOptions = axisOptions;

    return payload;
}

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
        return JSON.parse(atob(plot.replace(/ /g, '+'))) as PivotPlotUrlState;
    }
}

function normalizePlotState(raw: PivotPlotUrlState): PivotPlotUrlState {
    if (raw.template && raw.fields) {
        return raw;
    }
    if (raw.encodings) {
        const migrated = migrateLegacyEncodings(raw.encodings);
        return {
            template: migrated.template,
            fields: migrated.fields,
            hideNulls: raw.hideNulls,
        };
    }
    return { template: 'scatter', fields: {} };
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
        const decoded = normalizePlotState(decodePlotParam(plot));
        if (!decoded?.template) return null;
        return decoded;
    } catch {
        return null;
    }
}

export function validatePlotFields(
    templateId: PlotTemplateId,
    fields: Record<string, string>,
    chartFields: ChartFieldMeta[],
    rowKeys?: Iterable<string>,
): Record<string, string> {
    const template = getPlotTemplate(templateId);
    const pick = (field?: string) => resolvePlotFieldName(field, chartFields, rowKeys);
    const next: Record<string, string> = {};

    for (const slot of template.slots) {
        next[slot.id] = pick(fields[slot.id]);
    }

    return next;
}

export function isPlotStateShareable(state: PivotPlotUrlState): boolean {
    const template = getPlotTemplate(state.template);
    return template.slots
        .filter((s) => s.required)
        .every((s) => Boolean(state.fields[s.id]?.trim()));
}

/** @deprecated Use validatePlotFields. Kept for any remaining imports. */
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
