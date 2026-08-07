export interface PivotField {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    operator?: string;
    value?: string;
    aggregators?: string[];
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

export function encodePivotValuesForApi(fields: PivotField[]): string {
    const map: Record<string, string[]> = {};
    fields.filter((f) => f.type === 'value').forEach((field) => {
        const aggregators = field.aggregators?.length ? field.aggregators : ['avg'];
        if (!map[field.field]) {
            map[field.field] = [];
        }
        map[field.field].push(...aggregators);
    });
    return btoa(JSON.stringify(map));
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
                decodedValues.forEach((value: { field?: string; aggregators?: string[] }) => {
                    if (value.field) {
                        newFields.push({
                            field: value.field,
                            type: 'value',
                            aggregators: [value.aggregators?.[0] || 'avg'],
                        });
                    }
                });
            } else if (decodedValues && typeof decodedValues === 'object') {
                Object.entries(decodedValues as Record<string, string[]>).forEach(([field, aggregators]) => {
                    newFields.push({
                        field,
                        type: 'value',
                        aggregators: aggregators?.length ? aggregators : ['avg'],
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
            decodedFilters.forEach((filter: { field: string; operator?: string; value?: string }) => {
                newFields.push({
                    field: filter.field,
                    type: 'filter',
                    operator: filter.operator,
                    value: filter.value,
                });
            });
        } catch (error) {
            console.error('Error parsing filters from URL:', error);
        }
    }

    return newFields.length > 0 ? newFields : null;
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

export const PIVOT_PLOT_SAVED_QUERY_URL = '/pivot/plot';
