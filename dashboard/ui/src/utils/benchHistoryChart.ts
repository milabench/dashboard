import { buildVendorColorScale, cssColor, guessVendor } from './gpuColors';


export interface HistoryRecord {
    exec_id: number;
    created_time: string;
    gpu: string;
    min: number;
    max: number;
    mean: number;
    n: number;
    q25: number;
    median: number;
    q75: number;
}

export interface BenchHistorySpecOptions {
    title: string;
    yLabel: string;
    hideMinMax: boolean;
}

// Shared right-side vendor/GPU legend styling — used by both
// BenchmarkHistoryView's candlestick chart and BenchmarkDocView's
// "Bs → Scaling" chart, so switching between them feels like one page
// rather than two differently-themed widgets.
export function buildVendorGpuLegends() {
    const labelColor = cssColor('--color-text', '#1a202c');
    const mutedColor = cssColor('--color-text-muted', '#718096');
    const legendRight = {
        orient: 'right' as const,
        direction: 'vertical' as const,
        labelLimit: 400,
        titleLimit: 200,
        columns: 1,
        padding: 20,
        labelFontSize: 12,
        labelColor,
        symbolSize: 120,
    };
    return {
        colorLegend: { ...legendRight, symbolOpacity: 1 },
        shapeLegend: {
            ...legendRight,
            symbolOpacity: 1,
            symbolFillColor: mutedColor,
            symbolStrokeColor: mutedColor,
        },
    };
}

// Candlestick-per-run chart shared by BenchmarkHistoryView and
// BenchmarkDocView's "Performance History" tab: whiskers = min/max,
// box = Q25/Q75, tick = median, point = mean.
export function buildBenchHistorySpec(
    historyData: HistoryRecord[] | undefined,
    { title, yLabel, hideMinMax }: BenchHistorySpecOptions,
    w: number,
    h: number,
): Record<string, unknown> | null {
    if (!historyData || historyData.length === 0) return null;

    const chartWidth = Math.max(400, w - 350);
    const chartHeight = Math.max(300, h - 200);

    // Spread overlapping points: when multiple executions fall on the same
    // calendar day for the same GPU, shift them onto consecutive days so
    // candlesticks don't overlap.
    const DAY_MS = 24 * 3600_000;
    const buckets = new Map<string, HistoryRecord[]>();
    for (const d of historyData) {
        const day = d.created_time.slice(0, 10);
        const key = `${day}__${d.gpu}`;
        let arr = buckets.get(key);
        if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push(d);
    }

    const values = historyData.map(d => {
        const day = d.created_time.slice(0, 10);
        const key = `${day}__${d.gpu}`;
        const group = buckets.get(key)!;
        let date = d.created_time;
        if (group.length > 1) {
            const idx = group.indexOf(d);
            const offset = idx - Math.floor((group.length - 1) / 2);
            const t = new Date(d.created_time);
            t.setTime(t.getTime() + offset * DAY_MS);
            date = t.toISOString();
        }
        return {
            ...d,
            date,
            exec_label: `#${d.exec_id}`,
            vendor: guessVendor(d.gpu),
        };
    });

    const vendorScale = buildVendorColorScale(values.map(d => d.vendor));
    const medianTick = cssColor('--color-plot-median-tick', '#1a202c');
    const { colorLegend, shapeLegend } = buildVendorGpuLegends();
    const hoverParams = [
        {
            name: 'gpuHover',
            select: { type: 'point', fields: ['gpu'], on: 'pointerover', clear: 'pointerout' },
            bind: { legend: 'mouseover' },
        },
        {
            name: 'vendorHover',
            select: { type: 'point', fields: ['vendor'], on: 'pointerover', clear: 'pointerout' },
            bind: { legend: 'mouseover' },
        },
    ];
    const highlightOpacity = {
        condition: [
            { param: 'gpuHover', value: 1 },
            { param: 'vendorHover', value: 1 },
        ],
        value: 0.5,
    };

    return {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        data: { values },
        title,
        width: chartWidth,
        height: chartHeight,
        encoding: {
            x: {
                field: 'date',
                type: 'temporal',
                title: 'Run Date',
                axis: { labelAngle: -45 },
            },
            y: {
                type: 'quantitative',
                scale: { zero: false },
                title: yLabel,
            },
            color: {
                field: 'vendor',
                type: 'nominal',
                title: 'Vendor',
                scale: vendorScale,
                legend: colorLegend,
            },
            shape: {
                field: 'gpu',
                type: 'nominal',
                title: 'GPU',
                legend: shapeLegend,
            },
        },
        layer: [
            {
                description: 'Transparent layer to make series easier to hover',
                params: hoverParams,
                mark: { type: 'point', filled: true, opacity: 0, size: 400, tooltip: null },
                encoding: {
                    y: { field: 'mean' },
                },
            },
            ...(!hideMinMax ? [{
                mark: {
                    type: 'rule' as const,
                    strokeWidth: 1,
                },
                encoding: {
                    y: { field: 'min' },
                    y2: { field: 'max' },
                    opacity: highlightOpacity,
                    tooltip: [
                        { field: 'gpu', type: 'nominal' as const, title: 'GPU' },
                        { field: 'vendor', type: 'nominal' as const, title: 'Vendor' },
                        { field: 'exec_label', type: 'nominal' as const, title: 'Exec ID' },
                        { field: 'date', type: 'temporal' as const, title: 'Date' },
                        { field: 'min', type: 'quantitative' as const, title: 'Min', format: '.2f' },
                        { field: 'max', type: 'quantitative' as const, title: 'Max', format: '.2f' },
                        { field: 'n', type: 'quantitative' as const, title: 'Samples' },
                    ],
                },
            }] : []),
            {
                mark: {
                    type: 'bar',
                    width: 8,
                    opacity: 0.8,
                    stroke: medianTick,
                    strokeWidth: 0.75,
                    strokeOpacity: 0.55,
                },
                encoding: {
                    y: { field: 'q25' },
                    y2: { field: 'q75' },
                    opacity: highlightOpacity,
                    tooltip: [
                        { field: 'gpu', type: 'nominal', title: 'GPU' },
                        { field: 'vendor', type: 'nominal', title: 'Vendor' },
                        { field: 'exec_label', type: 'nominal', title: 'Exec ID' },
                        { field: 'date', type: 'temporal', title: 'Date' },
                        { field: 'q25', type: 'quantitative', title: 'Q25', format: '.2f' },
                        { field: 'median', type: 'quantitative', title: 'Median', format: '.2f' },
                        { field: 'q75', type: 'quantitative', title: 'Q75', format: '.2f' },
                        { field: 'mean', type: 'quantitative', title: 'Mean', format: '.2f' },
                        { field: 'n', type: 'quantitative', title: 'Samples' },
                    ],
                },
            },
            {
                mark: {
                    type: 'tick',
                    size: 14,
                    thickness: 2,
                    color: medianTick,
                },
                encoding: {
                    y: { field: 'median' },
                    opacity: highlightOpacity,
                    tooltip: [
                        { field: 'gpu', type: 'nominal', title: 'GPU' },
                        { field: 'median', type: 'quantitative', title: 'Median', format: '.2f' },
                        { field: 'mean', type: 'quantitative', title: 'Mean', format: '.2f' },
                    ],
                },
            },
            {
                mark: {
                    type: 'point',
                    size: 70,
                    filled: true,
                },
                encoding: {
                    y: { field: 'mean' },
                    stroke: {
                        condition: [
                            { param: 'gpuHover', empty: false, value: cssColor('--color-text', '#1a202c') },
                        ],
                        value: cssColor('--color-bg-page', '#ffffff'),
                    },
                    strokeWidth: [
                        { condition: { param: 'gpuHover', empty: false }, value: 2 },
                        { value: 0.75 },
                    ],
                    opacity: highlightOpacity,
                    tooltip: [
                        { field: 'gpu', type: 'nominal', title: 'GPU' },
                        { field: 'vendor', type: 'nominal', title: 'Vendor' },
                        { field: 'exec_label', type: 'nominal', title: 'Exec ID' },
                        { field: 'mean', type: 'quantitative', title: 'Mean', format: '.2f' },
                    ],
                },
            },
        ],
    };
}
