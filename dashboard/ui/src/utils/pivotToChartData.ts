/**
 * Convert SQL pivot API rows (wide, slash-separated measure columns)
 * into chart-ready long/tidy datasets for Vega-Lite.
 *
 * Input row (wide):
 *   { Pack_name, Weight_priority, "Exec_...product=\"H100\"/Metric_name=rate/Metric_value/median": 42 }
 *
 * Output (long) — metrics keyed by name + aggregator, dimensions merged per row:
 *   { Pack_name, Weight_priority, "Exec_...product": "H100", rate_median: 42 }
 */

const METRIC_NAME_RE = /(^|:|\.)metric[._]name$/i;
const METRIC_VALUE_RE = /(^|:|\.)metric[._]value$/i;

export function isMetricNameField(field: string): boolean {
    const normalized = field.replace(/_/g, '.');
    return METRIC_NAME_RE.test(normalized) || field.replace(/:/g, '_').toLowerCase() === 'metric_name';
}

export function isMetricValueField(field: string): boolean {
    const normalized = field.replace(/_/g, '.');
    return METRIC_VALUE_RE.test(normalized) || field.replace(/:/g, '_').toLowerCase() === 'metric_value';
}

export function metricNameFromColumnParts(
    columnParts: Array<{ field: string; value: string }>,
): string | null {
    const part = columnParts.find((p) => isMetricNameField(p.field));
    return part?.value?.trim() || null;
}

export function dimensionColumnParts(
    columnParts: Array<{ field: string; value: string }>,
): Array<{ field: string; value: string }> {
    return columnParts.filter(
        (p) => !isMetricNameField(p.field) && !isMetricValueField(p.field),
    );
}

/** Composite metric column key: Metric_name + Metric_value + aggregator. */
export function buildMetricValueKey(mc: ParsedMeasureColumn): string {
    const metricName = metricNameFromColumnParts(mc.columnParts);
    const valueField = shortLabel(mc.valueField);
    const name = metricName ?? valueField ?? 'value';
    const agg = mc.aggregator?.trim();
    if (!agg || agg === 'value') {
        return name;
    }
    return `${name}_${agg}`;
}

export function metricFieldLabel(metricKey: string): string {
    const sep = metricKey.lastIndexOf('_');
    if (sep <= 0) return shortLabel(metricKey);
    const name = metricKey.slice(0, sep);
    const agg = metricKey.slice(sep + 1);
    return `${shortLabel(name)} (${agg})`;
}

function dimensionSignature(
    row: Record<string, unknown>,
    rowColumns: string[],
    columnParts: Array<{ field: string; value: string }>,
): string {
    const parts: Array<[string, unknown]> = [
        ...rowColumns.map((col) => [col, row[col]] as [string, unknown]),
        ...columnParts.map((part) => [part.field, part.value] as [string, unknown]),
    ];
    return JSON.stringify(parts);
}

export interface PivotFieldConfig {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    aggregators?: string[];
}

export interface ParsedMeasureColumn {
    originalName: string;
    wideName: string;
    label: string;
    /** Dimensions parsed from the column key (pivot column fields) */
    columnParts: Array<{ field: string; value: string }>;
    valueField: string;
    aggregator: string;
}

export type ChartFieldKind = 'row' | 'column' | 'measure' | 'meta';

export interface ChartFieldMeta {
    name: string;
    label: string;
    /** Original pivot/data key before Vega-safe renaming. */
    sourceName?: string;
    kind: ChartFieldKind;
    vegaType: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
}

export interface PivotChartData {
    /** Tidy rows — dimensions merged; metric values keyed by name + aggregator */
    long: Record<string, unknown>[];
    /** Same as long (wide input is always melted for plotting) */
    wide: Record<string, unknown>[];
    fields: ChartFieldMeta[];
    measureColumns: ParsedMeasureColumn[];
    rowColumns: string[];
}

function fieldKey(field: string): string {
    return field.replace(/:/g, '_');
}

function shortLabel(field: string): string {
    const normalized = field.replace(/_/g, '.');
    const parts = normalized.split('.');
    return parts[parts.length - 1] || field;
}

function unquote(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

/** Safe flat field name for Vega-Lite (dots imply nested access). */
export function sanitizeVegaFieldName(name: string): string {
    const cleaned = name
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return cleaned.slice(0, 96) || 'field';
}

function createVegaFieldMapper() {
    const sourceToVega = new Map<string, string>();
    const used = new Set<string>();

    const toVegaName = (sourceName: string): string => {
        const cached = sourceToVega.get(sourceName);
        if (cached) return cached;

        let base = sanitizeVegaFieldName(sourceName);
        let candidate = base;
        let suffix = 2;
        while (used.has(candidate)) {
            candidate = `${base}_${suffix}`;
            suffix += 1;
        }

        used.add(candidate);
        sourceToVega.set(sourceName, candidate);
        return candidate;
    };

    return {
        toVegaName,
        sourceNames: () => new Map(sourceToVega),
    };
}

/** True when a key is a pivoted measure column (contains `/` path segments). */
export function isMeasureColumnKey(key: string): boolean {
    return key.includes('/');
}

/** Safe Vega field name from a pivot measure column key. */
export function sanitizeMeasureName(name: string): string {
    const cleaned = name
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return cleaned.slice(0, 96) || 'measure';
}

/** Parse one `field=value` segment from a slash-separated column key. */
export function parseFieldAssignment(part: string): { field: string; value: string } {
    const eq = part.indexOf('=');
    if (eq > 0) {
        return {
            field: part.substring(0, eq),
            value: unquote(part.substring(eq + 1)),
        };
    }
    return { field: part, value: '' };
}

/**
 * Parse a pivot measure column name like:
 *   Exec_meta.accelerators.gpus.0.product="NVIDIA GB10"/Metric_name=rate/Metric_value/median
 */
export function parseMeasureColumn(colName: string): ParsedMeasureColumn {
    const parts = colName.split('/').filter(Boolean);

    if (parts.length < 2) {
        return {
            originalName: colName,
            wideName: sanitizeMeasureName(colName),
            label: colName,
            columnParts: [],
            valueField: colName,
            aggregator: 'value',
        };
    }

    const aggregator = parts[parts.length - 1];
    const valueFieldPart = parts[parts.length - 2];
    const dimensionParts = parts.slice(0, -2);

    const columnParts = dimensionParts.map(parseFieldAssignment);
    const valueField = valueFieldPart.includes('=')
        ? parseFieldAssignment(valueFieldPart).field
        : valueFieldPart;

    const label = [
        ...columnParts.map((p) => p.value || shortLabel(p.field)),
        shortLabel(valueField),
        aggregator,
    ].filter(Boolean).join(' · ');

    return {
        originalName: colName,
        wideName: sanitizeMeasureName(colName),
        label,
        columnParts,
        valueField,
        aggregator,
    };
}

function isNumericString(value: string): boolean {
    const trimmed = value.trim();
    return trimmed !== '' && !Number.isNaN(Number(trimmed));
}

/** Coerce API string numbers so Vega treats metrics as quantitative. */
export function coerceNumeric(value: unknown): unknown {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && isNumericString(value)) return Number(value);
    return value;
}

function inferColumnVegaType(
    fieldName: string,
    rows: Record<string, unknown>[],
): ChartFieldMeta['vegaType'] {
    const values = rows
        .map((row) => row[fieldName])
        .filter((value) => !isNullish(value));

    if (values.length === 0) return 'nominal';

    const coerced = values.map(coerceNumeric);
    if (coerced.every((value) => typeof value === 'number' && !Number.isNaN(value))) {
        return 'quantitative';
    }

    if (values.every((value) => typeof value === 'string')) {
        const asDates = values.filter(
            (value) => typeof value === 'string'
                && (/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isNaN(Date.parse(value))),
        );
        if (asDates.length === values.length) return 'temporal';
    }

    return 'nominal';
}

/** Pick a readable d3 axis format from the data range (avoids ugly ~s ticks). */
export function quantitativeAxisFormat(values: unknown[]): string {
    const nums = values
        .map(coerceNumeric)
        .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));

    if (nums.length === 0) return ',.2f';

    const abs = nums.map((n) => Math.abs(n));
    const max = Math.max(...abs);
    const minNonZero = Math.min(...abs.filter((n) => n > 0), max);

    if (max >= 1e9) return '.2~s';
    if (max >= 1e6) return ',.0f';
    if (max >= 10000) return ',.0f';
    if (max >= 1000) return ',.1f';
    if (max >= 10) return ',.2f';
    if (max >= 1) return '.2f';
    if (minNonZero < 0.01) return '.2e';
    return '.3f';
}

/** Infer encodable fields from converted chart row keys. */
export function chartFieldsFromRows(
    rows: Record<string, unknown>[],
    sourceNamesByVegaName?: Map<string, string>,
): ChartFieldMeta[] {
    if (rows.length === 0) return [];

    const keyOrder: string[] = [];
    const seen = new Set<string>();

    const addKey = (key: string) => {
        if (key.startsWith('_') || seen.has(key)) return;
        seen.add(key);
        keyOrder.push(key);
    };

    Object.keys(rows[0]).forEach(addKey);
    for (const row of rows) {
        Object.keys(row).forEach(addKey);
    }

    return keyOrder.map((name) => {
        const sourceName = sourceNamesByVegaName?.get(name) ?? name;
        const vegaType = inferColumnVegaType(name, rows);
        const isMeasure = vegaType === 'quantitative';
        return {
            name,
            label: isMeasure ? metricFieldLabel(sourceName) : shortLabel(sourceName),
            sourceName: sourceName !== name ? sourceName : undefined,
            kind: isMeasure ? 'measure' : 'row',
            vegaType,
        };
    });
}

function resolveRowColumns(
    pivotRows: Record<string, unknown>[],
    pivotFields: PivotFieldConfig[],
): string[] {
    if (pivotRows.length === 0) return [];

    const keys = Object.keys(pivotRows[0]);
    const configured = pivotFields
        .filter((f) => f.type === 'row')
        .map((f) => fieldKey(f.field));

    const ordered: string[] = [];
    for (const key of configured) {
        const match = keys.find(
            (k) => !isMeasureColumnKey(k) && (k === key || k.replace(/:/g, '_') === key),
        );
        if (match && !ordered.includes(match)) {
            ordered.push(match);
        }
    }

    keys.forEach((k) => {
        if (!isMeasureColumnKey(k) && !ordered.includes(k)) {
            ordered.push(k);
        }
    });

    return ordered;
}

/** Chart rows suitable for export — same keys as the plot dataset. */
export function getExportableChartRows(
    chartData: PivotChartData,
): Record<string, unknown>[] {
    return chartData.long;
}

export function isNullish(value: unknown): boolean {
    return value == null
        || value === ''
        || (typeof value === 'number' && Number.isNaN(value));
}

/** Drop rows with nulls on any encoded plot field (keeps scales/mark clean). */
export function filterPlotRows(
    rows: Record<string, unknown>[],
    encodedFields: string[],
): Record<string, unknown>[] {
    const fields = [...new Set(encodedFields.filter(Boolean))];
    if (fields.length === 0) return rows;
    return rows.filter((row) => fields.every((field) => !isNullish(row[field])));
}

/**
 * Pivot API output → long/tidy chart rows.
 * Measure columns sharing the same row/column dimensions merge into one observation;
 * each metric value is stored under `{metric_name}_{aggregator}`.
 */
export function convertPivotToChartData(
    pivotRows: Record<string, unknown>[],
    pivotFields: PivotFieldConfig[] = [],
): PivotChartData | null {
    if (!Array.isArray(pivotRows) || pivotRows.length === 0) return null;

    const allKeys = Object.keys(pivotRows[0]);
    const rowColumns = resolveRowColumns(pivotRows, pivotFields);
    const measureKeys = allKeys.filter(isMeasureColumnKey);
    const measureColumns = measureKeys.map(parseMeasureColumn);

    const fieldMapper = createVegaFieldMapper();
    const long: Record<string, unknown>[] = [];

    for (const row of pivotRows) {
        const merged = new Map<string, Record<string, unknown>>();

        for (const mc of measureColumns) {
            const metricKey = buildMetricValueKey(mc);
            const dimensionParts = dimensionColumnParts(mc.columnParts);
            const signature = dimensionSignature(row, rowColumns, dimensionParts);

            let entry = merged.get(signature);
            if (!entry) {
                entry = {};
                rowColumns.forEach((col) => {
                    entry![fieldMapper.toVegaName(col)] = row[col];
                });
                dimensionParts.forEach((part) => {
                    entry![fieldMapper.toVegaName(part.field)] = part.value;
                });
                merged.set(signature, entry);
            }

            entry[fieldMapper.toVegaName(metricKey)] = coerceNumeric(row[mc.originalName]);
        }

        merged.forEach((entry) => long.push(entry));
    }

    const sourceNames = fieldMapper.sourceNames();
    const vegaToSource = new Map<string, string>();
    sourceNames.forEach((vegaName, sourceName) => {
        vegaToSource.set(vegaName, sourceName);
    });

    const fields = chartFieldsFromRows(long, vegaToSource);

    return {
        long,
        wide: long,
        fields,
        measureColumns,
        rowColumns,
    };
}

/** Resolve an encoding field name from URL/plot state onto a converted chart field key. */
export function resolvePlotFieldName(
    field: string | undefined,
    fields: ChartFieldMeta[],
    rowKeys?: Iterable<string>,
): string {
    if (!field?.trim()) return '';

    const trimmed = field.trim();
    const names = new Set(fields.map((f) => f.name));
    if (names.has(trimmed)) return trimmed;

    const keys = rowKeys ? new Set(rowKeys) : null;
    if (keys?.has(trimmed)) return trimmed;

    const sanitized = sanitizeVegaFieldName(trimmed);
    if (names.has(sanitized)) return sanitized;
    if (keys?.has(sanitized)) return sanitized;

    const bySource = fields.find(
        (f) => f.sourceName === trimmed
            || f.sourceName === sanitized
            || sanitizeVegaFieldName(f.sourceName ?? '') === trimmed
            || sanitizeVegaFieldName(f.sourceName ?? '') === sanitized,
    );
    if (bySource) return bySource.name;

    const short = shortLabel(trimmed);
    const byLabel = fields.find(
        (f) => f.label === short
            || f.name === short
            || shortLabel(f.name) === short,
    );
    if (byLabel) return byLabel.name;

    if (!trimmed.includes('_')) {
        const byMetricPrefix = fields.find(
            (f) => f.kind === 'measure' && f.name.startsWith(`${trimmed}_`),
        );
        if (byMetricPrefix) return byMetricPrefix.name;
    }

    return '';
}

/** Suggest initial encodings from converted chart data keys. */
export function suggestEncodings(
    chartData: PivotChartData,
    pivotFields: PivotFieldConfig[],
): {
    mark: string;
    x: string;
    y: string;
    color: string;
    shape: string;
    useLong: boolean;
} {
    const names = chartData.fields.map((f) => f.name);
    const resolveField = (...candidates: string[]) => {
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (names.includes(candidate)) return candidate;
            const bySource = chartData.fields.find(
                (f) => f.sourceName === candidate
                    || sanitizeVegaFieldName(candidate) === f.name,
            );
            if (bySource) return bySource.name;
            const short = shortLabel(candidate);
            const byLabel = chartData.fields.find(
                (f) => f.label === short || f.name.includes(short),
            );
            if (byLabel) return byLabel.name;
        }
        return '';
    };

    const rowFields = pivotFields.filter((f) => f.type === 'row');
    const colFields = pivotFields.filter((f) => f.type === 'column');
    const measureNames = names.filter(
        (n) => chartData.fields.find((f) => f.name === n)?.kind === 'measure',
    );

    const xCandidate = rowFields[0] ? fieldKey(rowFields[0].field) : chartData.rowColumns[0] ?? '';
    const x = resolveField(
        xCandidate,
        ...chartData.rowColumns,
        ...names.filter((n) => !measureNames.includes(n)),
    );

    const colorCandidate = colFields[0] ? fieldKey(colFields[0].field) : '';
    const color = resolveField(
        colorCandidate,
        ...names.filter((n) => n !== x && !measureNames.includes(n)),
    );

    const y = resolveField(
        ...measureNames,
        ...names.filter(
            (n) => chartData.fields.find((f) => f.name === n)?.vegaType === 'quantitative',
        ),
    );

    return {
        mark: 'bar',
        x,
        y,
        color,
        shape: '',
        useLong: true,
    };
}
