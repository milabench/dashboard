import type { ChartFieldMeta, PivotChartData, PivotFieldConfig } from './pivotToChartData';
import {
    quantitativeAxisFormat,
    resolvePlotFieldName,
    suggestEncodings,
} from './pivotToChartData';
import type { PivotTransformStep } from './pivotPlotTransforms';
import { transformsToVega } from './pivotPlotTransforms';

export type FacetLayoutMode = 'horizontal' | 'vertical' | 'wrap';

export interface FacetIndependentAxes {
    x?: boolean;
    y?: boolean;
}

export interface FacetLayoutOptions {
    mode: FacetLayoutMode;
    /** Column count when mode is `wrap`; omitted means auto. */
    columns?: number;
    /** Per-axis independence when faceting (shared by default). */
    independentAxes?: FacetIndependentAxes;
}

export const FACET_LAYOUT_OPTIONS: { value: FacetLayoutMode; label: string; description: string }[] = [
    { value: 'horizontal', label: 'Horizontal', description: 'Single row, left to right' },
    { value: 'vertical', label: 'Vertical', description: 'Single column, top to bottom' },
    { value: 'wrap', label: 'Wrap', description: 'Grid that wraps to new rows' },
];

export const FACET_WRAP_COLUMN_OPTIONS = [
    { value: '', label: 'Auto' },
    { value: '2', label: '2 columns' },
    { value: '3', label: '3 columns' },
    { value: '4', label: '4 columns' },
    { value: '5', label: '5 columns' },
    { value: '6', label: '6 columns' },
];

function normalizeIndependentAxes(raw: unknown): FacetIndependentAxes | undefined {
    if (raw === true) return { x: true, y: true };
    if (!raw || typeof raw !== 'object') return undefined;
    const obj = raw as FacetIndependentAxes;
    const next: FacetIndependentAxes = {};
    if (obj.x) next.x = true;
    if (obj.y) next.y = true;
    return next.x || next.y ? next : undefined;
}

function buildFacetResolve(independentAxes?: FacetIndependentAxes): Record<string, unknown> | undefined {
    if (!independentAxes?.x && !independentAxes?.y) return undefined;
    const scale: Record<string, string> = {};
    const axis: Record<string, string> = {};
    if (independentAxes.x) {
        scale.x = 'independent';
        axis.x = 'independent';
    }
    if (independentAxes.y) {
        scale.y = 'independent';
        axis.y = 'independent';
    }
    return { scale, axis };
}

export function normalizeFacetLayout(raw?: FacetLayoutOptions & { independentAxes?: unknown }): FacetLayoutOptions {
    if (!raw?.mode || !FACET_LAYOUT_OPTIONS.some((o) => o.value === raw.mode)) {
        return DEFAULT_FACET_LAYOUT;
    }
    const next: FacetLayoutOptions = { mode: raw.mode };
    if (raw.mode === 'wrap' && raw.columns && raw.columns > 0) {
        next.columns = raw.columns;
    }
    const independentAxes = normalizeIndependentAxes(raw.independentAxes);
    if (independentAxes) {
        next.independentAxes = independentAxes;
    }
    return next;
}

const DEFAULT_FACET_LAYOUT: FacetLayoutOptions = { mode: 'wrap' };

function resolveFacetColumns(
    mode: FacetLayoutMode,
    facetCount: number,
    columns?: number,
): number | undefined {
    switch (mode) {
        case 'horizontal':
            return undefined;
        case 'vertical':
            return 1;
        case 'wrap':
            if (columns && columns > 0) return columns;
            return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(facetCount))));
        default:
            return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(facetCount))));
    }
}

export type PlotTemplateId =
    | 'scatter'
    | 'line'
    | 'bar'
    | 'histogram'
    | 'boxplot'
    | 'heatmap'
    | 'area';

export type FieldSlotKind = 'any' | 'quantitative' | 'nominal' | 'dimension';

export interface PlotFieldSlot {
    id: string;
    label: string;
    required?: boolean;
    kind: FieldSlotKind;
}

export interface PlotTemplate {
    id: PlotTemplateId;
    label: string;
    description: string;
    slots: PlotFieldSlot[];
}

export const PLOT_TEMPLATES: PlotTemplate[] = [
    {
        id: 'scatter',
        label: 'Scatter',
        description: 'Compare two variables as points',
        slots: [
            { id: 'x', label: 'X', required: true, kind: 'any' },
            { id: 'y', label: 'Y', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Color', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'line',
        label: 'Line',
        description: 'Trend over a dimension',
        slots: [
            { id: 'x', label: 'X', required: true, kind: 'any' },
            { id: 'y', label: 'Y', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Series', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'bar',
        label: 'Bar',
        description: 'Compare values across categories',
        slots: [
            { id: 'x', label: 'Category', required: true, kind: 'dimension' },
            { id: 'y', label: 'Value', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Color', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'histogram',
        label: 'Histogram',
        description: 'Distribution of a numeric field',
        slots: [
            { id: 'value', label: 'Value', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Color', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'boxplot',
        label: 'Box plot',
        description: 'Spread and outliers by category',
        slots: [
            { id: 'x', label: 'Category', required: true, kind: 'dimension' },
            { id: 'y', label: 'Value', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Color', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'heatmap',
        label: 'Heatmap',
        description: 'Grid of values with color intensity',
        slots: [
            { id: 'x', label: 'Columns', required: true, kind: 'dimension' },
            { id: 'y', label: 'Rows', required: true, kind: 'dimension' },
            { id: 'value', label: 'Value', required: true, kind: 'quantitative' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
    {
        id: 'area',
        label: 'Area',
        description: 'Filled trend over a dimension',
        slots: [
            { id: 'x', label: 'X', required: true, kind: 'any' },
            { id: 'y', label: 'Y', required: true, kind: 'quantitative' },
            { id: 'color', label: 'Series', kind: 'dimension' },
            { id: 'facetColumn', label: 'Facet col', kind: 'dimension' },
            { id: 'facetRow', label: 'Facet row', kind: 'dimension' },
        ],
    },
];

export function getPlotTemplate(id: PlotTemplateId): PlotTemplate {
    return PLOT_TEMPLATES.find((t) => t.id === id) ?? PLOT_TEMPLATES[0]!;
}

function fieldMatchesSlot(meta: ChartFieldMeta | undefined, kind: FieldSlotKind): boolean {
    if (!meta) return kind === 'any';
    if (kind === 'any') return true;
    if (kind === 'quantitative') return meta.vegaType === 'quantitative';
    if (kind === 'nominal') return meta.vegaType === 'nominal' || meta.vegaType === 'ordinal';
    if (kind === 'dimension') {
        return meta.kind !== 'measure';
    }
    return true;
}

export function fieldsForSlot(
    allFields: ChartFieldMeta[],
    kind: FieldSlotKind,
): ChartFieldMeta[] {
    return allFields.filter((f) => fieldMatchesSlot(f, kind));
}

function buildEncoding(
    field: string,
    meta: ChartFieldMeta | undefined,
    sampleValues: unknown[] = [],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    const type = meta?.vegaType ?? 'nominal';
    const enc: Record<string, unknown> = {
        field,
        type,
        title: meta?.label ?? field,
        ...extra,
    };
    if (type === 'quantitative') {
        enc.scale = { zero: false, nice: true };
        enc.axis = {
            format: quantitativeAxisFormat(sampleValues),
            tickCount: 6,
        };
    }
    if (type === 'temporal') {
        enc.axis = { labelAngle: -35 };
    }
    return enc;
}

function uniqueFieldCount(rows: Record<string, unknown>[], field: string): number {
    if (!field) return 0;
    return new Set(rows.map((r) => r[field]).filter((v) => v != null && v !== '')).size;
}

export interface BuildTemplateSpecOptions {
    templateId: PlotTemplateId;
    fields: Record<string, string>;
    fieldMeta: Map<string, ChartFieldMeta>;
    transforms: PivotTransformStep[];
    rows: Record<string, unknown>[];
    textColor: string;
    width?: number;
    height?: number;
    facetLayout?: FacetLayoutOptions;
    swapAxes?: boolean;
}

function swapXYEncoding(encoding: Record<string, unknown>): Record<string, unknown> {
    if (!encoding.x || !encoding.y) return encoding;
    return { ...encoding, x: encoding.y, y: encoding.x };
}

export function templateRequiredFieldsFilled(
    templateId: PlotTemplateId,
    fields: Record<string, string>,
): boolean {
    const template = getPlotTemplate(templateId);
    return template.slots
        .filter((s) => s.required)
        .every((s) => Boolean(fields[s.id]?.trim()));
}

export function buildTemplateSpec(options: BuildTemplateSpecOptions): Record<string, unknown> | null {
    const {
        templateId,
        fields,
        fieldMeta,
        transforms,
        rows,
        textColor,
        width = 480,
        height = 360,
        facetLayout,
        swapAxes = false,
    } = options;

    if (!templateRequiredFieldsFilled(templateId, fields)) return null;

    const sample = (field: string) => rows.map((r) => r[field]);
    const enc = (slotId: string, extra?: Record<string, unknown>) => {
        const field = fields[slotId]?.trim();
        if (!field) return undefined;
        return buildEncoding(field, fieldMeta.get(field), sample(field), extra);
    };

    const facetColumnField = fields.facetColumn?.trim();
    const facetRowField = fields.facetRow?.trim();
    const transform = transformsToVega(transforms);
    const config = {
        axis: { labelColor: textColor },
        legend: { labelColor: textColor },
    };

    let core: Record<string, unknown>;

    switch (templateId) {
        case 'scatter':
            core = {
                mark: { type: 'point', tooltip: true },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        case 'line':
            core = {
                mark: { type: 'line', point: true, tooltip: true },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        case 'bar':
            core = {
                mark: { type: 'bar', tooltip: true, opacity: 0.85 },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        case 'histogram':
            core = {
                mark: { type: 'bar', tooltip: true, opacity: 0.85 },
                encoding: {
                    x: enc('value', { bin: true }),
                    y: { aggregate: 'count', title: 'Count' },
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        case 'boxplot':
            core = {
                mark: { type: 'boxplot', tooltip: true },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        case 'heatmap':
            core = {
                mark: { type: 'rect', tooltip: true },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    color: enc('value', { aggregate: 'mean' }),
                },
            };
            break;
        case 'area':
            core = {
                mark: { type: 'area', line: true, point: true, tooltip: true, opacity: 0.7 },
                encoding: {
                    x: enc('x'),
                    y: enc('y'),
                    ...(enc('color') ? { color: enc('color') } : {}),
                },
            };
            break;
        default:
            return null;
    }

    if (swapAxes && core.encoding && typeof core.encoding === 'object') {
        core = {
            ...core,
            encoding: swapXYEncoding(core.encoding as Record<string, unknown>),
        };
    }

    if (transform.length > 0) {
        core = { ...core, transform };
    }

    core = {
        ...core,
        width,
        height,
        autosize: { type: 'pad', contains: 'padding' },
        config,
    };

    if (facetColumnField || facetRowField) {
        const layout = facetLayout ?? { mode: 'wrap' as FacetLayoutMode };
        const resolve = buildFacetResolve(layout.independentAxes);
        const facetSpec: Record<string, unknown> = { spec: core };

        if (facetColumnField && !facetRowField) {
            const facetCount = uniqueFieldCount(rows, facetColumnField);
            const columns = resolveFacetColumns(layout.mode, facetCount, layout.columns);
            facetSpec.facet = buildEncoding(facetColumnField, fieldMeta.get(facetColumnField));
            if (columns !== undefined) {
                facetSpec.columns = columns;
            }
        } else {
            const facetEnc: Record<string, unknown> = {};
            if (facetRowField) {
                facetEnc.row = buildEncoding(facetRowField, fieldMeta.get(facetRowField));
            }
            if (facetColumnField) {
                facetEnc.column = buildEncoding(facetColumnField, fieldMeta.get(facetColumnField));
            }
            facetSpec.facet = facetEnc;
        }

        if (resolve) {
            facetSpec.resolve = resolve;
        }
        return facetSpec;
    }

    return core;
}

export function suggestTemplateFields(
    templateId: PlotTemplateId,
    chartData: PivotChartData,
    pivotFields: PivotFieldConfig[],
    rowKeys?: Iterable<string>,
    availableFields?: ChartFieldMeta[],
): Record<string, string> {
    const template = getPlotTemplate(templateId);
    const fields = availableFields ?? chartData.fields;
    const suggested = suggestEncodings(chartData, pivotFields);
    const names = fields.map((f) => f.name);
    const measures = fields.filter((f) => f.kind === 'measure' || f.vegaType === 'quantitative');
    const dimensions = fields.filter((f) => f.kind !== 'measure' && f.vegaType !== 'quantitative');
    const pick = (field?: string) => resolvePlotFieldName(field, fields, rowKeys);

    const firstOfKind = (kind: FieldSlotKind) => {
        const candidates = fieldsForSlot(fields, kind);
        return candidates[0]?.name ?? '';
    };

    const result: Record<string, string> = {};

    for (const slot of template.slots) {
        switch (slot.id) {
            case 'x':
                result.x = pick(suggested.x) || firstOfKind(slot.kind);
                break;
            case 'y':
                result.y = pick(suggested.y) || measures[0]?.name || firstOfKind('quantitative');
                break;
            case 'value':
                result.value = measures[0]?.name || firstOfKind('quantitative');
                break;
            case 'color':
                result.color = pick(suggested.color) || dimensions.find((d) => d.name !== result.x)?.name || '';
                break;
            case 'facetColumn':
                result.facetColumn = names.includes('facet') ? 'facet' : '';
                break;
            case 'facetRow':
                result.facetRow = '';
                break;
            default:
                if (!result[slot.id]) {
                    result[slot.id] = firstOfKind(slot.kind);
                }
        }
    }

    return result;
}

export function isRemoteDataSource(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const d = data as Record<string, unknown>;
    return Boolean(d.url || d.name);
}

export function stripInlinePlotData(spec: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...spec };

    if ('data' in next && !isRemoteDataSource(next.data)) {
        delete next.data;
    }

    if (next.spec && typeof next.spec === 'object' && !Array.isArray(next.spec)) {
        next.spec = stripInlinePlotData(next.spec as Record<string, unknown>);
    }

    for (const key of ['layer', 'hconcat', 'vconcat', 'concat'] as const) {
        const items = next[key];
        if (Array.isArray(items)) {
            next[key] = items.map((item) =>
                item && typeof item === 'object' && !Array.isArray(item)
                    ? stripInlinePlotData(item as Record<string, unknown>)
                    : item,
            );
        }
    }

    return next;
}

export function injectPlotData(
    spec: Record<string, unknown>,
    rows: Record<string, unknown>[],
): Record<string, unknown> {
    const cleaned = stripInlinePlotData(spec);
    if (isRemoteDataSource(cleaned.data)) return cleaned;
    return { ...cleaned, data: { values: rows } };
}

export function injectPlotDataUrl(
    spec: Record<string, unknown>,
    url: string,
): Record<string, unknown> {
    const cleaned = stripInlinePlotData(spec);
    if (isRemoteDataSource(cleaned.data)) return cleaned;
    return { ...cleaned, data: { url } };
}

export function legacyMarkToTemplate(mark: string): PlotTemplateId {
    switch (mark) {
        case 'line':
            return 'line';
        case 'bar':
            return 'bar';
        case 'area':
            return 'area';
        default:
            return 'scatter';
    }
}

export function migrateLegacyEncodings(
    encodings: { mark: string; x: string; y: string; color?: string; facet?: string },
): { template: PlotTemplateId; fields: Record<string, string> } {
    return {
        template: legacyMarkToTemplate(encodings.mark),
        fields: {
            x: encodings.x,
            y: encodings.y,
            color: encodings.color ?? '',
            facetColumn: encodings.facet ?? '',
            facetRow: '',
        },
    };
}
