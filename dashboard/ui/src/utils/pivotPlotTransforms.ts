/** UI-friendly Vega-Lite transform steps for the pivot plot builder. */

import type { ChartFieldMeta } from './pivotToChartData';
import { sanitizeVegaFieldName } from './pivotToChartData';

export type TransformStepType = 'aggregate' | 'filter' | 'calculate';

export interface AggregateTransformStep {
    id: string;
    type: 'aggregate';
    groupby: string[];
    op: string;
    field: string;
    as: string;
}

export interface FilterTransformStep {
    id: string;
    type: 'filter';
    field: string;
    op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'valid' | 'invalid';
    value: string;
}

export interface CalculateTransformStep {
    id: string;
    type: 'calculate';
    as: string;
    expr: string;
}

export type PivotTransformStep =
    | AggregateTransformStep
    | FilterTransformStep
    | CalculateTransformStep;

export const TRANSFORM_TYPE_OPTIONS: Array<{ value: TransformStepType; label: string }> = [
    { value: 'aggregate', label: 'Aggregate' },
    { value: 'filter', label: 'Filter' },
    { value: 'calculate', label: 'Calculate' },
];

export const AGGREGATE_OPS = [
    'count', 'distinct', 'sum', 'mean', 'median', 'min', 'max', 'stderr', 'stdev',
];

const AGGREGATE_OP_LABELS: Record<string, string> = {
    count: 'Count',
    distinct: 'Distinct',
    sum: 'Sum',
    mean: 'Mean',
    median: 'Median',
    min: 'Min',
    max: 'Max',
    stderr: 'Stderr',
    stdev: 'Stdev',
};

export function aggregateOpLabel(op: string): string {
    return AGGREGATE_OP_LABELS[op] ?? op.charAt(0).toUpperCase() + op.slice(1);
}

export const FILTER_OPS: Array<{ value: FilterTransformStep['op']; label: string }> = [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'valid', label: 'is valid' },
    { value: 'invalid', label: 'is null' },
];

let transformIdCounter = 0;

export function newTransformId(): string {
    transformIdCounter += 1;
    return `tf_${transformIdCounter}_${Date.now()}`;
}

export function createTransform(type: TransformStepType): PivotTransformStep {
    const id = newTransformId();
    switch (type) {
        case 'aggregate':
            return { id, type: 'aggregate', groupby: [], op: 'mean', field: '', as: '' };
        case 'filter':
            return { id, type: 'filter', field: '', op: 'eq', value: '' };
        case 'calculate':
            return { id, type: 'calculate', as: '', expr: '' };
    }
}

function filterPredicate(step: FilterTransformStep): string {
    const f = step.field;
    switch (step.op) {
        case 'valid':
            return `isValid(datum['${f}'])`;
        case 'invalid':
            return `!isValid(datum['${f}'])`;
        case 'eq':
            return `datum['${f}'] == ${JSON.stringify(parseFilterValue(step.value))}`;
        case 'ne':
            return `datum['${f}'] != ${JSON.stringify(parseFilterValue(step.value))}`;
        case 'lt':
            return `datum['${f}'] < ${step.value}`;
        case 'lte':
            return `datum['${f}'] <= ${step.value}`;
        case 'gt':
            return `datum['${f}'] > ${step.value}`;
        case 'gte':
            return `datum['${f}'] >= ${step.value}`;
    }
}

function parseFilterValue(raw: string): string | number | boolean {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return trimmed;
}

export function transformStepToVega(step: PivotTransformStep): Record<string, unknown> | null {
    switch (step.type) {
        case 'aggregate': {
            if (!step.as.trim()) return null;
            const entry: Record<string, unknown> = { op: step.op, as: step.as.trim() };
            if (step.op !== 'count') {
                if (!step.field.trim()) return null;
                entry.field = step.field.trim();
            }
            return {
                aggregate: [entry],
                groupby: step.groupby.filter(Boolean),
            };
        }
        case 'filter': {
            if (!step.field.trim()) return null;
            if (step.op !== 'valid' && step.op !== 'invalid' && !step.value.trim()) return null;
            return { filter: filterPredicate(step) };
        }
        case 'calculate': {
            const as = sanitizeVegaFieldName(step.as.trim());
            if (!as || !step.expr.trim()) return null;
            return { calculate: step.expr.trim(), as };
        }
    }
}

export function transformsToVega(steps: PivotTransformStep[]): Record<string, unknown>[] {
    return steps
        .map(transformStepToVega)
        .filter((t): t is Record<string, unknown> => t != null);
}

export function hasActiveTransforms(steps: PivotTransformStep[]): boolean {
    return transformsToVega(steps).length > 0;
}

function findField(fields: ChartFieldMeta[], name: string): ChartFieldMeta | undefined {
    return fields.find((f) => f.name === name);
}

/** Simple field copy/rename: datum.field or datum['field']. */
const DATUM_FIELD_COPY_RE = /^\s*datum(?:\.([a-zA-Z_][a-zA-Z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*$/;

function resolveFieldByDatumRef(
    fields: ChartFieldMeta[],
    ref: string,
): ChartFieldMeta | undefined {
    const trimmed = ref.trim();
    if (!trimmed) return undefined;
    const sanitized = sanitizeVegaFieldName(trimmed);
    return fields.find((f) => f.name === trimmed || f.name === sanitized)
        ?? fields.find((f) => f.sourceName === trimmed || sanitizeVegaFieldName(f.sourceName ?? '') === sanitized);
}

function inferCalculateFieldMeta(
    step: CalculateTransformStep,
    availableFields: ChartFieldMeta[],
): ChartFieldMeta {
    const as = sanitizeVegaFieldName(step.as.trim());
    const expr = step.expr.trim();
    const fallback: ChartFieldMeta = {
        name: as,
        label: step.as.trim() || as,
        kind: 'measure',
        vegaType: 'quantitative',
    };

    const match = expr.match(DATUM_FIELD_COPY_RE);
    if (!match) return fallback;

    const source = resolveFieldByDatumRef(availableFields, match[1] ?? match[2] ?? '');
    if (!source) return fallback;

    return {
        name: as,
        label: step.as.trim() || source.label || as,
        kind: source.kind,
        vegaType: source.vegaType,
        sourceName: source.sourceName,
    };
}

/** Fields available after applying a prefix of the transform pipeline. */
export function fieldsAfterTransforms(
    steps: PivotTransformStep[],
    baseFields: ChartFieldMeta[],
    throughIndex = steps.length,
): ChartFieldMeta[] {
    let current = [...baseFields];

    for (let i = 0; i < throughIndex; i++) {
        const step = steps[i]!;
        const byName = new Map(current.map((f) => [f.name, f]));

        if (step.type === 'aggregate') {
            const as = step.as.trim();
            if (!as || !transformStepToVega(step)) continue;

            const next: ChartFieldMeta[] = [];
            for (const gb of step.groupby.filter(Boolean)) {
                const field = byName.get(gb) ?? findField(baseFields, gb);
                if (field && !next.some((f) => f.name === field.name)) {
                    next.push(field);
                }
            }
            next.push({
                name: as,
                label: `${as} (${step.op})`,
                kind: 'measure',
                vegaType: 'quantitative',
            });
            current = next;
            continue;
        }

        if (step.type === 'calculate') {
            const as = sanitizeVegaFieldName(step.as.trim());
            if (!as) continue;

            const meta = inferCalculateFieldMeta(step, current);

            if (byName.has(as)) {
                current = current.map((f) => (f.name === as ? meta : f));
            } else {
                current = [...current, meta];
            }
        }
    }

    return current;
}

/** Output / derived fields introduced by transforms (for labeling in dropdowns). */
export function derivedTransformFields(
    steps: PivotTransformStep[],
    baseFields: ChartFieldMeta[],
): ChartFieldMeta[] {
    const baseNames = new Set(baseFields.map((f) => f.name));
    return fieldsAfterTransforms(steps, baseFields).filter((f) => !baseNames.has(f.name));
}

/** All fields shown in plot dropdowns — pivot columns plus transform outputs. */
export function plotSelectableFields(
    steps: PivotTransformStep[],
    baseFields: ChartFieldMeta[],
): ChartFieldMeta[] {
    const byName = new Map<string, ChartFieldMeta>();
    for (const f of baseFields) byName.set(f.name, f);
    for (const f of fieldsAfterTransforms(steps, baseFields)) {
        byName.set(f.name, f);
    }
    return [...byName.values()];
}

/** If a plot field is not in the post-transform schema, add it to the last aggregate groupby. */
export function ensureGroupbyForPlotField(
    transforms: PivotTransformStep[],
    fieldName: string,
    baseFields: ChartFieldMeta[],
): PivotTransformStep[] {
    const trimmed = fieldName.trim();
    if (!trimmed) return transforms;

    const after = fieldsAfterTransforms(transforms, baseFields);
    if (after.some((f) => f.name === trimmed)) return transforms;
    if (!baseFields.some((f) => f.name === trimmed)) return transforms;

    let lastAggIndex = -1;
    for (let i = transforms.length - 1; i >= 0; i--) {
        if (transforms[i]?.type === 'aggregate') {
            lastAggIndex = i;
            break;
        }
    }
    if (lastAggIndex < 0) return transforms;

    const step = transforms[lastAggIndex] as AggregateTransformStep;
    if (step.groupby.includes(trimmed)) return transforms;

    return transforms.map((t, i) => (
        i === lastAggIndex && t.type === 'aggregate'
            ? { ...t, groupby: [...t.groupby.filter(Boolean), trimmed] }
            : t
    ));
}

export function dimensionFields(fields: ChartFieldMeta[]): ChartFieldMeta[] {
    return fields.filter((f) => f.kind !== 'measure');
}
