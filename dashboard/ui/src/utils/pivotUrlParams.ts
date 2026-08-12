import { encodePivotPlotSpec } from './pivotPlotUrlParams';

export interface PivotField {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    operator?: string;
    value?: string;
    aggregators?: string[];
    /** UI-only display name; does not change the underlying pivot field sent to the API. */
    label?: string;
}

export interface PivotFieldLabelEntry {
    type: PivotField['type'];
    field: string;
    aggregator?: string;
    label: string;
}

export function pivotFieldDisplayLabel(field: Pick<PivotField, 'field' | 'label'>): string {
    const custom = field.label?.trim();
    return custom || field.field;
}

export function pivotApiFieldKey(field: string): string {
    return field.replace(/:/g, '_');
}

function normalizePivotFieldName(name: string): string {
    return name.replace(/_/g, ':');
}

export function findPivotField(
    fields: PivotField[],
    type: PivotField['type'],
    apiKeyOrField: string,
    aggregator?: string,
): PivotField | undefined {
    const withColons = normalizePivotFieldName(apiKeyOrField);
    return fields.find((f) => {
        if (f.type !== type) return false;
        const matches = f.field === apiKeyOrField
            || f.field === withColons
            || pivotApiFieldKey(f.field) === apiKeyOrField
            || pivotApiFieldKey(f.field) === pivotApiFieldKey(withColons);
        if (!matches) return false;
        if (type === 'value' && aggregator !== undefined) {
            return (f.aggregators?.[0] ?? 'avg').toLowerCase() === aggregator.toLowerCase();
        }
        return true;
    });
}

/** Display label for pivot result table headers (rows, column fields, values). */
export function pivotResultHeaderLabel(
    fields: PivotField[],
    type: 'row' | 'column' | 'value',
    apiKeyOrField: string,
    fallback?: string,
    aggregator?: string,
): string {
    const match = findPivotField(fields, type, apiKeyOrField, aggregator);
    if (match?.label?.trim()) {
        return match.label.trim();
    }
    if (fallback !== undefined) {
        return fallback;
    }
    return normalizePivotFieldName(apiKeyOrField);
}

export function encodePivotFieldLabels(fields: PivotField[]): string | undefined {
    const entries: PivotFieldLabelEntry[] = [];
    for (const f of fields) {
        if (!f.label?.trim()) continue;
        entries.push({
            type: f.type,
            field: f.field,
            ...(f.type === 'value' ? { aggregator: f.aggregators?.[0] ?? 'avg' } : {}),
            label: f.label.trim(),
        });
    }
    if (entries.length === 0) return undefined;
    return btoa(JSON.stringify(entries));
}

export function mergePivotFieldLabels(fields: PivotField[], encoded: string | null | undefined): PivotField[] {
    if (!encoded) return fields;
    try {
        const entries = JSON.parse(atob(encoded)) as PivotFieldLabelEntry[];
        if (!Array.isArray(entries)) return fields;
        return fields.map((f) => {
            const match = entries.find((entry) =>
                entry.type === f.type
                && entry.field === f.field
                && (f.type !== 'value'
                    || (entry.aggregator ?? 'avg') === (f.aggregators?.[0] ?? 'avg')),
            );
            return match?.label ? { ...f, label: match.label } : f;
        });
    } catch {
        return fields;
    }
}

export function hasPivotUrlConfig(params: URLSearchParams): boolean {
    return Boolean(
        params.get('rows')
        || params.get('cols')
        || params.get('values')
        || params.get('filters'),
    );
}

/** API expects `{ "Metric:value": ["median"] }`, not `[{ field, aggregators }]`. */
export function pivotValuesToApiMap(decoded: unknown): Record<string, string[]> {
    if (Array.isArray(decoded)) {
        const map: Record<string, string[]> = {};
        decoded.forEach((item) => {
            if (!item || typeof item !== 'object' || !('field' in item)) return;
            const { field, aggregators } = item as { field?: string; aggregators?: string[] };
            if (!field) return;
            const aggs = aggregators?.length ? aggregators : ['avg'];
            if (!map[field]) map[field] = [];
            map[field].push(...aggs);
        });
        return map;
    }
    if (decoded && typeof decoded === 'object') {
        return decoded as Record<string, string[]>;
    }
    return {};
}

/** URL/saved-query format: one entry per value slot (preserves duplicate fields + aggregators). */
export function encodePivotValuesParam(fields: PivotField[]): string {
    const values = fields
        .filter((f) => f.type === 'value')
        .map((f) => ({
            field: f.field,
            aggregators: f.aggregators?.length ? f.aggregators : ['avg'],
            ...(f.label?.trim() ? { label: f.label.trim() } : {}),
        }));
    return btoa(JSON.stringify(values));
}

/** @deprecated Use encodePivotValuesParam; API map conversion happens in pivotApiSearchParams. */
export function encodePivotValuesForApi(fields: PivotField[]): string {
    return encodePivotValuesParam(fields);
}

export function hasPivotApiFilters(params: URLSearchParams): boolean {
    return Boolean(pivotApiSearchParams(params).get('filters'));
}

/** Query params sent to `/pivot` API (drops UI-only keys like `relative`). */
export function pivotApiSearchParams(params: URLSearchParams): URLSearchParams {
    const apiParams = new URLSearchParams();
    for (const key of ['rows', 'cols', 'filters'] as const) {
        const value = params.get(key);
        if (value) {
            apiParams.set(key, value);
        }
    }

    const valuesParam = params.get('values');
    if (valuesParam) {
        try {
            const decoded = JSON.parse(atob(valuesParam));
            apiParams.set('values', btoa(JSON.stringify(pivotValuesToApiMap(decoded))));
        } catch {
            apiParams.set('values', valuesParam);
        }
    }

    return apiParams;
}

/** Build API query params from pivot field config (matches PivotTableView fetch). */
export function buildPivotApiParamsFromFields(fields: PivotField[]): URLSearchParams {
    const params = new URLSearchParams();

    const rows = fields.filter((f) => f.type === 'row').map((f) => f.field);
    const cols = fields.filter((f) => f.type === 'column').map((f) => f.field);

    params.set('rows', rows.join(','));
    params.set('cols', cols.join(','));

    params.set('values', encodePivotValuesParam(fields));

    const filters = fields
        .filter((f) => f.type === 'filter')
        .map((f) => ({
            field: f.field,
            operator: f.operator,
            value: f.value,
        }));

    if (filters.length > 0) {
        params.set('filters', btoa(JSON.stringify(filters)));
    }

    const fieldLabels = encodePivotFieldLabels(fields);
    if (fieldLabels) {
        params.set('fieldLabels', fieldLabels);
    }

    return params;
}

/** React Query key for cached wide pivot table rows. */
export function pivotTableQueryKey(fields: PivotField[]): readonly ['pivotTable', string] {
    const apiParams = pivotApiSearchParams(buildPivotApiParamsFromFields(fields));
    return ['pivotTable', apiParams.toString()];
}

/** React Query key from URL search params (same cache as `pivotTableQueryKey`). */
export function pivotTableQueryKeyFromSearchParams(params: URLSearchParams): readonly ['pivotTable', string] {
    return ['pivotTable', pivotApiSearchParams(params).toString()];
}

/** Query params for `/api/pivot/melt` (includes field label overrides). */
export function pivotMeltApiSearchParams(params: URLSearchParams): URLSearchParams {
    const apiParams = pivotApiSearchParams(params);
    const fieldLabels = params.get('fieldLabels');
    if (fieldLabels) {
        apiParams.set('fieldLabels', fieldLabels);
    }
    return apiParams;
}

export function parsePivotFieldsFromSearchParams(params: URLSearchParams): PivotField[] | null {
    const rows = params.get('rows');
    const cols = params.get('cols');
    const values = params.get('values');
    const filters = params.get('filters');

    if (!hasPivotUrlConfig(params)) {
        return null;
    }

    const newFields: PivotField[] = [];

    if (rows) {
        rows.split(',').forEach((field) => {
            if (field.trim()) {
                newFields.push({ field: field.trim(), type: 'row' });
            }
        });
    }

    if (cols) {
        cols.split(',').forEach((field) => {
            if (field.trim()) {
                newFields.push({ field: field.trim(), type: 'column' });
            }
        });
    }

    if (values) {
        try {
            const decodedValues = JSON.parse(atob(values));
            if (Array.isArray(decodedValues)) {
                decodedValues.forEach((value: { field?: string; aggregators?: string[]; label?: string }) => {
                    if (value.field) {
                        newFields.push({
                            field: value.field,
                            type: 'value',
                            aggregators: [value.aggregators?.[0] || 'avg'],
                            label: value.label,
                        });
                    }
                });
            } else if (decodedValues && typeof decodedValues === 'object') {
                Object.entries(decodedValues as Record<string, string[]>).forEach(([field, aggregators]) => {
                    const aggs = aggregators?.length ? aggregators : ['avg'];
                    aggs.forEach((aggregator) => {
                        newFields.push({
                            field,
                            type: 'value',
                            aggregators: [aggregator],
                        });
                    });
                });
            }
        } catch {
            values.split(',').forEach((field) => {
                if (field.trim()) {
                    newFields.push({
                        field: field.trim(),
                        type: 'value',
                        aggregators: ['avg'],
                    });
                }
            });
        }
    }

    if (filters) {
        try {
            const decodedFilters = JSON.parse(atob(filters));
            decodedFilters.forEach((filter: { field: string; operator?: string; value?: string; label?: string }) => {
                newFields.push({
                    field: filter.field,
                    type: 'filter',
                    operator: filter.operator,
                    value: filter.value,
                    label: filter.label,
                });
            });
        } catch (error) {
            console.error('Error parsing filters from URL:', error);
        }
    }

    if (newFields.length === 0) return null;

    return mergePivotFieldLabels(newFields, params.get('fieldLabels'));
}

/** Serialize URL search params for saved-query storage. */
export function searchParamsToSavedQueryParameters(
    params: URLSearchParams,
): Record<string, string> {
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
        out[key] = value;
    });
    return out;
}

/** Restore URL search params from a saved query payload. */
export function savedQueryParametersToSearchParams(
    parameters: Record<string, unknown>,
): URLSearchParams {
    const params = new URLSearchParams();
    Object.entries(parameters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });
    return params;
}

export const PIVOT_SAVED_QUERY_URL = '/pivot';
export const PIVOT_PLOT_SAVED_QUERY_URL = '/pivot/plot';
export const PIVOT_TABLE_SHARE_URL = '/pivot/view/table';
export const PIVOT_PLOT_SHARE_URL = '/pivot/view/plot';
export const PIVOT_TABLE_API_URL = '/api/pivot/table';
export const PIVOT_MELT_API_URL = '/api/pivot/melt';
export const PIVOT_SPEC_API_URL = '/api/pivot/spec';

/** Build a shareable table-only view URL from current pivot search params. */
export function pivotTableShareUrl(
    searchParams: URLSearchParams,
    options?: { embed?: boolean },
): string {
    const params = new URLSearchParams(searchParams);
    params.delete('plot');
    if (options?.embed) {
        params.set('embed', '1');
    } else {
        params.delete('embed');
    }
    const query = params.toString();
    return query ? `${PIVOT_TABLE_SHARE_URL}?${query}` : PIVOT_TABLE_SHARE_URL;
}

/** Build a shareable plot-only view URL from a Vega-Lite spec (remote data URL embedded in spec). */
export function pivotPlotShareUrl(
    spec: Record<string, unknown>,
    options?: { embed?: boolean },
): string {
    const params = new URLSearchParams();
    params.set('spec', encodePivotPlotSpec(spec));
    if (options?.embed) {
        params.set('embed', '1');
    }
    const query = params.toString();
    return `${PIVOT_PLOT_SHARE_URL}?${query}`;
}

export function absolutePivotShareUrl(relativeShareUrl: string): string {
    if (typeof window === 'undefined') {
        return relativeShareUrl;
    }
    return `${window.location.origin}${relativeShareUrl}`;
}

/** HTML iframe snippet for embedding a plot-only pivot view. */
export function pivotPlotEmbedHtml(
    spec: Record<string, unknown>,
    options?: { width?: number; height?: number; title?: string },
): string {
    const width = options?.width ?? 960;
    const height = options?.height ?? 540;
    const title = options?.title ?? 'Pivot plot';
    const src = absolutePivotShareUrl(pivotPlotShareUrl(spec, { embed: true }));
    return `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" style="border:0;" loading="lazy" title="${title.replace(/"/g, '&quot;')}"></iframe>`;
}

export function isPivotEmbedMode(searchParams: URLSearchParams): boolean {
    const embed = searchParams.get('embed');
    return embed === '1' || embed === 'true';
}

/** Build melt API URL for the current pivot query (optionally with origin). */
export function pivotMeltApiUrl(searchParams: URLSearchParams, origin = ''): string {
    const params = pivotMeltApiSearchParams(searchParams);
    const query = params.toString();
    return query ? `${origin}${PIVOT_MELT_API_URL}?${query}` : `${origin}${PIVOT_MELT_API_URL}`;
}

/** Build Vega-Lite spec API URL for the current pivot + plot query. */
export function pivotSpecApiUrl(searchParams: URLSearchParams, origin = ''): string {
    const params = new URLSearchParams(searchParams);
    const query = params.toString();
    return query ? `${origin}${PIVOT_SPEC_API_URL}?${query}` : `${origin}${PIVOT_SPEC_API_URL}`;
}
