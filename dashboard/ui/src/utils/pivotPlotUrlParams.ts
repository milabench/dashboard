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
    /** Swap X and Y encodings on plots that use both axes. */
    swapAxes?: boolean;
}

export const DEFAULT_PLOT_AXIS_OPTIONS: Required<PlotAxisOptions> = {
    xLabelPadding: 6,
    xTitlePadding: 10,
    yLabelPadding: 6,
    yTitlePadding: 10,
    swapAxes: false,
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
        swapAxes: raw?.swapAxes === true,
    };
}

function compactPlotAxisOptions(opts: Required<PlotAxisOptions>): PlotAxisOptions | undefined {
    const defaults = DEFAULT_PLOT_AXIS_OPTIONS;
    const compact: PlotAxisOptions = {};
    if (opts.xLabelPadding !== defaults.xLabelPadding) compact.xLabelPadding = opts.xLabelPadding;
    if (opts.xTitlePadding !== defaults.xTitlePadding) compact.xTitlePadding = opts.xTitlePadding;
    if (opts.yLabelPadding !== defaults.yLabelPadding) compact.yLabelPadding = opts.yLabelPadding;
    if (opts.yTitlePadding !== defaults.yTitlePadding) compact.yTitlePadding = opts.yTitlePadding;
    if (opts.swapAxes) compact.swapAxes = true;
    return Object.keys(compact).length > 0 ? compact : undefined;
}

/** Migrate legacy single `facet` slot to `facetColumn`. */
export function migratePlotFieldSlots(fields: Record<string, string>): Record<string, string> {
    const next = { ...fields };
    if (next.facet?.trim() && !next.facetColumn?.trim() && !next.facetRow?.trim()) {
        next.facetColumn = next.facet;
    }
    delete next.facet;
    return next;
}

export function hasPlotFacetFields(fields: Record<string, string>): boolean {
    return Boolean(fields.facetColumn?.trim() || fields.facetRow?.trim());
}

export interface PlotSizeOptions {
    /** Base plot width in pixels (each facet cell when faceting). */
    width?: number;
    /** Base plot height in pixels (each facet cell when faceting). */
    height?: number;
}

export const DEFAULT_PLOT_SIZE: Required<PlotSizeOptions> = {
    width: 480,
    height: 360,
};

export function normalizePlotSizeOptions(raw?: PlotSizeOptions): Required<PlotSizeOptions> {
    const defaults = DEFAULT_PLOT_SIZE;
    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, Math.round(parsed)));
    };

    return {
        width: clamp(raw?.width, 200, 1200, defaults.width),
        height: clamp(raw?.height, 50, 900, defaults.height),
    };
}

function compactPlotSizeOptions(opts: Required<PlotSizeOptions>): PlotSizeOptions | undefined {
    const defaults = DEFAULT_PLOT_SIZE;
    const compact: PlotSizeOptions = {};
    if (opts.width !== defaults.width) compact.width = opts.width;
    if (opts.height !== defaults.height) compact.height = opts.height;
    return Object.keys(compact).length > 0 ? compact : undefined;
}

export type PlotLegendPlacement = 'right' | 'left' | 'top' | 'bottom' | 'none';
export type PlotLegendDirection = 'vertical' | 'horizontal';

export interface PlotLegendOptions {
    placement?: PlotLegendPlacement;
    /** Stack legend entries in a column or flow them in a row. */
    direction?: PlotLegendDirection;
}

export const DEFAULT_PLOT_LEGEND_OPTIONS: Required<PlotLegendOptions> = {
    placement: 'right',
    direction: 'vertical',
};

export const PLOT_LEGEND_PLACEMENT_OPTIONS: {
    value: PlotLegendPlacement;
    label: string;
    description: string;
}[] = [
    { value: 'right', label: 'Right', description: 'Legend on the right side of the plot' },
    { value: 'left', label: 'Left', description: 'Legend on the left side of the plot' },
    { value: 'top', label: 'Top', description: 'Legend above the plot' },
    { value: 'bottom', label: 'Bottom', description: 'Legend below the plot' },
    { value: 'none', label: 'Hidden', description: 'Hide the legend entirely' },
];

export const PLOT_LEGEND_DIRECTION_OPTIONS: {
    value: PlotLegendDirection;
    label: string;
    description: string;
}[] = [
    { value: 'vertical', label: 'Column', description: 'Stack legend entries vertically' },
    { value: 'horizontal', label: 'Row', description: 'Place legend entries in a horizontal line' },
];

const VALID_LEGEND_PLACEMENTS = new Set<PlotLegendPlacement>(
    PLOT_LEGEND_PLACEMENT_OPTIONS.map((option) => option.value),
);
const VALID_LEGEND_DIRECTIONS = new Set<PlotLegendDirection>(
    PLOT_LEGEND_DIRECTION_OPTIONS.map((option) => option.value),
);

export function normalizePlotLegendOptions(raw?: PlotLegendOptions): Required<PlotLegendOptions> {
    const placement = raw?.placement;
    const direction = raw?.direction;
    return {
        placement: placement && VALID_LEGEND_PLACEMENTS.has(placement)
            ? placement
            : DEFAULT_PLOT_LEGEND_OPTIONS.placement,
        direction: direction && VALID_LEGEND_DIRECTIONS.has(direction)
            ? direction
            : DEFAULT_PLOT_LEGEND_OPTIONS.direction,
    };
}

function compactPlotLegendOptions(opts: Required<PlotLegendOptions>): PlotLegendOptions | undefined {
    const compact: PlotLegendOptions = {};
    if (opts.placement !== DEFAULT_PLOT_LEGEND_OPTIONS.placement) {
        compact.placement = opts.placement;
    }
    if (opts.direction !== DEFAULT_PLOT_LEGEND_OPTIONS.direction) {
        compact.direction = opts.direction;
    }
    return Object.keys(compact).length > 0 ? compact : undefined;
}

/** Map UI legend options to Vega-Lite legend config overrides. */
export function legendConfigFromOptions(opts: Required<PlotLegendOptions>): Record<string, unknown> {
    if (opts.placement === 'none') {
        return { disable: true };
    }

    if (opts.direction === 'horizontal') {
        return {
            orient: opts.placement,
            direction: 'horizontal',
            disable: false,
        };
    }

    return {
        orient: opts.placement,
        direction: 'vertical',
        disable: false,
        columns: 1,
    };
}

export interface PivotPlotUrlState {
    template: PlotTemplateId;
    fields: Record<string, string>;
    transforms?: PivotTransformStep[];
    hideNulls?: boolean;
    facetLayout?: FacetLayoutOptions;
    axisOptions?: PlotAxisOptions;
    plotSize?: PlotSizeOptions;
    legendOptions?: PlotLegendOptions;
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
    if (hasPlotFacetFields(state.fields) && state.facetLayout) {
        payload.facetLayout = state.facetLayout;
    }
    const axisOptions = state.axisOptions
        ? compactPlotAxisOptions(normalizePlotAxisOptions(state.axisOptions))
        : undefined;
    if (axisOptions) payload.axisOptions = axisOptions;
    const plotSize = state.plotSize
        ? compactPlotSizeOptions(normalizePlotSizeOptions(state.plotSize))
        : undefined;
    if (plotSize) payload.plotSize = plotSize;
    const legendOptions = state.legendOptions
        ? compactPlotLegendOptions(normalizePlotLegendOptions(state.legendOptions))
        : undefined;
    if (legendOptions) payload.legendOptions = legendOptions;

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
        return {
            ...raw,
            fields: migratePlotFieldSlots(raw.fields),
        };
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

export function encodeBase64Json(value: unknown): string {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Json<T = unknown>(encoded: string): T {
    let base64 = encoded.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
        return JSON.parse(atob(encoded.replace(/ /g, '+'))) as T;
    }
}

export function encodePivotPlotSpec(spec: Record<string, unknown>): string {
    return encodeBase64Json(spec);
}

export function parsePivotPlotSpecFromSearchParams(
    params: URLSearchParams,
): Record<string, unknown> | null {
    const specParam = params.get('spec')?.trim();
    if (!specParam) return null;

    try {
        const decoded = decodeBase64Json<Record<string, unknown>>(specParam);
        return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : null;
    } catch {
        return null;
    }
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
    const migrated = migratePlotFieldSlots(fields);
    const pick = (field?: string) => resolvePlotFieldName(field, chartFields, rowKeys);
    const next: Record<string, string> = {};

    for (const slot of template.slots) {
        next[slot.id] = pick(migrated[slot.id]);
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
