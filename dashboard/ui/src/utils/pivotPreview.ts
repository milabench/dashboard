export interface PivotPreviewField {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    aggregators?: string[];
    label?: string;
}

export interface PivotPreviewColumnField {
    field: string;
    value: string;
    originalField: string;
}

export interface PivotPreviewValueStructure {
    columnName: string;
    columnFields: PivotPreviewColumnField[];
    valueField: string;
    aggregator: string;
}

export interface PivotPreviewModel {
    rowColumns: string[];
    rowColumnLabels: string[];
    valueStructures: PivotPreviewValueStructure[];
    fieldRows: Array<{
        displayName: string;
        sourceField?: string;
        values: string[];
        isAggregator?: boolean;
        isValueField?: boolean;
    }>;
    rows: Array<Record<string, string | number>>;
}

const MAX_PREVIEW_ROWS = 4;
const MAX_PREVIEW_COL_GROUPS = 4;

/** Realistic sample values keyed by common pivot fields. */
const SAMPLE_BY_FIELD: Record<string, string[]> = {
    'Exec:name': ['run_a', 'run_b'],
    'Pack:name': ['llama', 'resnet50'],
    'Metric:name': ['rate', 'memory'],
};

function fieldKey(field: string): string {
    return field.replace(/:/g, '_');
}

function shortFieldLabel(field: string): string {
    const parts = field.split(':');
    return parts[parts.length - 1] || field;
}

function sampleValuesForField(field: string): string[] {
    if (SAMPLE_BY_FIELD[field]) {
        return SAMPLE_BY_FIELD[field];
    }
    const label = shortFieldLabel(field);
    return [`${label}_a`, `${label}_b`];
}

function previewFieldLabel(field: Pick<PivotPreviewField, 'field' | 'label'>): string {
    return field.label?.trim() || field.field;
}

function cartesian<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    return arrays.reduce<T[][]>(
        (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
        [[]],
    );
}

/** Build a structural preview mirroring the SQL pivot table layout (no API call). */
export function buildPivotPreview(fields: PivotPreviewField[]): PivotPreviewModel | null {
    const rowFields = fields.filter((f) => f.type === 'row');
    const colFields = fields.filter((f) => f.type === 'column');
    const valueFields = fields.filter((f) => f.type === 'value');

    if (rowFields.length === 0) {
        return null;
    }

    const rowColumns = rowFields.map((f) => fieldKey(f.field));
    const rowColumnLabels = rowFields.map((f) => previewFieldLabel(f));

    const rowSamples = cartesian(
        rowFields.map((f) => sampleValuesForField(f.field)),
    ).slice(0, MAX_PREVIEW_ROWS);

    const colSamples = colFields.length > 0
        ? cartesian(colFields.map((f) => sampleValuesForField(f.field))).slice(0, MAX_PREVIEW_COL_GROUPS)
        : [[]];

    const valueStructures: PivotPreviewValueStructure[] = [];

    for (const colSample of colSamples) {
        const columnFields: PivotPreviewColumnField[] = colFields.map((f, i) => ({
            field: f.field,
            value: colSample[i] ?? '…',
            originalField: fieldKey(f.field),
        }));

        if (valueFields.length === 0) {
            const colParts = columnFields.map(
                (cf) => `${cf.originalField}=${cf.value}`,
            );
            valueStructures.push({
                columnName: colParts.join('/') || '__preview__',
                columnFields,
                valueField: '…',
                aggregator: 'avg',
            });
            continue;
        }

        for (const vf of valueFields) {
            for (const agg of vf.aggregators || ['avg']) {
                const colParts = columnFields.map(
                    (cf) => `${cf.originalField}=${cf.value}`,
                );
                const columnName = [...colParts, fieldKey(vf.field), agg].join('/');
                valueStructures.push({
                    columnName,
                    columnFields,
                    valueField: vf.field,
                    aggregator: agg,
                });
            }
        }
    }

    if (valueStructures.length === 0) {
        valueStructures.push({
            columnName: '__preview__',
            columnFields: [],
            valueField: valueFields[0]?.field ?? 'Metric:value',
            aggregator: valueFields[0]?.aggregators?.[0] ?? 'avg',
        });
    }

    const fieldRows: PivotPreviewModel['fieldRows'] = [];

    if (valueStructures[0]?.columnFields.length) {
        valueStructures[0].columnFields.forEach((_cf, index) => {
            const colField = colFields[index];
            if (!colField) return;
            fieldRows.push({
                displayName: previewFieldLabel(colField),
                sourceField: colField.field,
                values: valueStructures.map(
                    (vs) => vs.columnFields[index]?.value ?? '',
                ),
            });
        });
    }

    const valueFieldNames = [...new Set(valueStructures.map((vs) => vs.valueField))];
    const showValueRow = colFields.length === 0
        || valueFields.some((vf) => Boolean(vf.label?.trim()));
    if (showValueRow && valueFieldNames.length > 0 && valueFieldNames[0] !== '…') {
        const matchingValueField = valueFields.find((vf) => vf.field === valueFieldNames[0]) ?? valueFields[0];
        const valueRowTitle = valueFieldNames.length === 1 && matchingValueField
            ? previewFieldLabel(matchingValueField)
            : 'Value';
        fieldRows.push({
            displayName: valueRowTitle,
            sourceField: matchingValueField?.field,
            isValueField: true,
            values: valueFieldNames.length === 1
                ? valueStructures.map(() => '')
                : valueStructures.map((vs) => {
                    const vf = valueFields.find((field) => field.field === vs.valueField);
                    return vf ? previewFieldLabel(vf) : vs.valueField;
                }),
        });
    }

    fieldRows.push({
        displayName: 'Aggregator',
        isAggregator: true,
        values: valueStructures.map((vs) => vs.aggregator.toUpperCase()),
    });

    const rows = rowSamples.map((sample) => {
        const row: Record<string, string | number> = {};
        rowFields.forEach((f, i) => {
            row[fieldKey(f.field)] = sample[i] ?? '…';
        });
        valueStructures.forEach((vs) => {
            row[vs.columnName] = 0;
        });
        return row;
    });

    return {
        rowColumns,
        rowColumnLabels,
        valueStructures,
        fieldRows,
        rows,
    };
}
