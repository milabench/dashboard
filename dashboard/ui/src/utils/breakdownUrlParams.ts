export type BreakdownPerfAgg = 'median' | 'mean' | 'mean_drop_min_max';

export const DEFAULT_BREAKDOWN_PERF_AGG: BreakdownPerfAgg = 'median';

export const BREAKDOWN_PERF_AGG_OPTIONS: {
    id: BreakdownPerfAgg;
    label: string;
    description: string;
}[] = [
    {
        id: 'median',
        label: 'Median',
        description: 'Median rate sample per benchmark (default). Overall score stays a weighted geomean.',
    },
    {
        id: 'mean',
        label: 'Mean',
        description: 'Average rate sample per benchmark. Overall score stays a weighted geomean.',
    },
    {
        id: 'mean_drop_min_max',
        label: 'Mean (drop min/max)',
        description: 'Average after dropping the fastest and slowest samples. Same as execution reports.',
    },
];

export interface BreakdownSelection {
    g1: string[];
    g2: string[];
    g3: string[];
    g4: string[];
    benches: string[];
    perfAgg: BreakdownPerfAgg;
}

const SELECTION_KEYS = ['g1', 'g2', 'g3', 'g4', 'benches'] as const;

export function parseBreakdownPerfAgg(raw: string | null): BreakdownPerfAgg {
    const method = raw?.trim().toLowerCase();
    if (BREAKDOWN_PERF_AGG_OPTIONS.some((entry) => entry.id === method)) {
        return method as BreakdownPerfAgg;
    }
    return DEFAULT_BREAKDOWN_PERF_AGG;
}

export function hasBreakdownUrlConfig(params: URLSearchParams): boolean {
    return SELECTION_KEYS.some((key) => params.has(key)) || params.has('perfAgg');
}

export function parseBreakdownFromSearchParams(params: URLSearchParams): BreakdownSelection {
    return {
        g1: params.getAll('g1'),
        g2: params.getAll('g2'),
        g3: params.getAll('g3'),
        g4: params.getAll('g4'),
        benches: params.getAll('benches'),
        perfAgg: parseBreakdownPerfAgg(params.get('perfAgg')),
    };
}

export function buildBreakdownSearchParams(selection: BreakdownSelection): URLSearchParams {
    const params = new URLSearchParams();
    for (const value of selection.g1) {
        params.append('g1', value);
    }
    for (const value of selection.g2) {
        params.append('g2', value);
    }
    for (const value of selection.g3) {
        params.append('g3', value);
    }
    for (const value of selection.g4) {
        params.append('g4', value);
    }
    for (const value of selection.benches) {
        params.append('benches', value);
    }
    if (selection.perfAgg !== DEFAULT_BREAKDOWN_PERF_AGG) {
        params.set('perfAgg', selection.perfAgg);
    }
    return params;
}

export function breakdownSelectionUrlKey(selection: BreakdownSelection): string {
    return buildBreakdownSearchParams(selection).toString();
}

export function breakdownPerfAggLabel(method: BreakdownPerfAgg): string {
    return BREAKDOWN_PERF_AGG_OPTIONS.find((entry) => entry.id === method)?.label ?? method;
}
