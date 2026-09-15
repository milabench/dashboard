import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Field,
    Badge,
    NativeSelect,
    Dialog,
    useDisclosure,
    Table,
    Checkbox,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { toaster } from '../ui/toaster';
import { Loading } from '../common/Loading';
import VegaPlot from '../charts/VegaPlot';
import {
    checkTimelineDb,
    getTimelineRuns,
    streamTimelineRun,
    type TimelineRun,
    type TimelineGanttJob,
    type TimelineRequest,
    type TimelineBucketsResponse,
    type TimelineReportResponse,
    type TimelineParams,
    type TimelineGpuReport,
} from '../../services/api';
import { formatVllmReport, formatBucketAggregateReport } from '../../utils/timelineReport';

// Mirrors benchmate.timeline.plot_timeline's Gantt (x/x2 bars, one row per
// worker), colored by how many jobs its worker had already processed
// (batch_id) so throughput progression within a worker is visible; failed
// requests always render red regardless of that gradient.
// `autosize: fit` (rather than manually guessing a margin to reserve for
// legend/axis space) tells Vega-Lite to scale the WHOLE rendered view —
// axes, legend, title included — down to actually fit inside the given
// width/height, so it can't overflow its box.
const AUTOSIZE_FIT = { type: 'fit' as const, contains: 'padding' as const };

// These charts are separate Vega views (each free to size itself), but they
// all plot the same "Time (s)" x-axis, so an explicit shared domain — the
// full run's own [start, end] — keeps a given moment at the same x position
// across all of them instead of each one auto-scaling to only what it was
// handed (buckets vs. full_buckets vs. gantt jobs can have very slightly
// different extents otherwise).
type XDomain = [number, number] | undefined;

function ganttSpec(
    data: TimelineGanttJob[],
    trimWindow: [number, number] | null | undefined,
    bucketEdges: number[] | null | undefined,
    width: number,
    height: number,
    xDomain: XDomain,
): Record<string, any> {
    const layers: Record<string, any>[] = [];
    const xScale = xDomain ? { domain: xDomain } : undefined;

    // Shade the ramp-trimmed regions first (background, drawn under the
    // bars — that's fine, it's just context).
    if (trimWindow) {
        const [windowStart, windowEnd] = trimWindow;
        const maxEnd = Math.max(windowEnd, ...data.map((d) => d.end));
        const shaded: { x1: number; x2: number }[] = [];
        if (windowStart > 0) shaded.push({ x1: 0, x2: windowStart });
        if (windowEnd < maxEnd) shaded.push({ x1: windowEnd, x2: maxEnd });
        if (shaded.length) {
            layers.push({
                data: { values: shaded },
                mark: { type: 'rect', color: '#6b7280', opacity: 0.25 },
                encoding: {
                    x: { field: 'x1', type: 'quantitative', scale: xScale },
                    x2: { field: 'x2' },
                },
            });
        }
    }

    layers.push({
        data: { values: data },
        // stroke: null overrides any border the active vega-theme (the
        // dark theme in particular) applies to bar marks by default — the
        // outline wasn't something we set explicitly, but a theme default.
        mark: { type: 'bar', stroke: null },
        encoding: {
            y: { field: 'worker', type: 'ordinal', sort: 'descending', title: 'Worker' },
            // grid: false — the explicit bucket-start/trim-cutoff rule
            // layers below already mark every meaningful moment on this
            // axis; Vega's own default gridlines (at its own "nice" round
            // intervals, unrelated to bucket boundaries) just added a
            // second, uncorrelated set of vertical lines on top of them.
            x: { field: 'start', type: 'quantitative', title: 'Time (s)', scale: xScale, axis: { grid: false } },
            x2: { field: 'end' },
            color: {
                condition: { test: '!datum.success', value: '#ef5a6f' },
                field: 'batch_id',
                type: 'quantitative',
                scale: { scheme: 'viridis' },
                legend: { title: 'Job # in worker' },
            },
            tooltip: [
                { field: 'request_id', title: 'request' },
                { field: 'start', title: 'start (s)', format: '.3f' },
                { field: 'end', title: 'end (s)', format: '.3f' },
                { field: 'worker', title: 'worker' },
                { field: 'batch_id', title: 'job # in worker' },
                { field: 'prompt_len', title: 'prompt_len' },
                { field: 'output_tokens', title: 'output_tokens' },
                { field: 'success', title: 'success' },
            ],
        },
    });

    // One solid vertical line at the start of each bucket, drawn on top of
    // the bars (same reasoning as the trim rules below: a line drawn under
    // the bars gets covered wherever a request happens to span that exact
    // moment, which is most of the time with many workers).
    if (bucketEdges && bucketEdges.length > 1) {
        const starts = bucketEdges.slice(0, -1);
        layers.push({
            data: { values: starts.map((x) => ({ x })) },
            mark: { type: 'rule', color: '#9ca3af', strokeWidth: 1, opacity: 0.6 },
            encoding: {
                x: { field: 'x', type: 'quantitative', scale: xScale },
                tooltip: [{ field: 'x', title: 'bucket start (s)', format: '.3f' }],
            },
        });
    }

    // Trim boundary rules go LAST — Vega-Lite draws later layers on top, so
    // this keeps the cutoff lines visible even where a request bar happens
    // to cross that exact point in time, instead of being drawn under (and
    // fully hidden by) the bars.
    if (trimWindow) {
        const [windowStart, windowEnd] = trimWindow;
        layers.push({
            data: { values: [{ x: windowStart, label: 'trim start' }, { x: windowEnd, label: 'trim end' }] },
            mark: { type: 'rule', color: '#ef5a6f', strokeDash: [4, 2], strokeWidth: 1.5 },
            encoding: {
                x: { field: 'x', type: 'quantitative', scale: xScale },
                tooltip: [{ field: 'label' }, { field: 'x', title: 'time (s)', format: '.3f' }],
            },
        });
    }

    return {
        width,
        height,
        autosize: AUTOSIZE_FIT,
        layer: layers,
        // No interactive pan/zoom here: a bound/interactive scale fights
        // with `autosize: fit`'s fit-to-content sizing and can push the
        // rendered width past its container, which is what was causing the
        // page-level horizontal scrollbar.
    };
}

// "50K" / "1.2M"-style tick labels instead of raw numbers on both axes.
const K_FORMAT_AXIS = { labelExpr: "upper(format(datum.value, '.3~s'))" };

// Positions each bucket's plotted point for the line charts below, instead
// of always using its `time` (end):
//  - Official buckets: a bucket's rate is an average over [start, time], so
//    plotting it at the END makes consecutive points look like a staircase
//    anchored to bucket boundaries. The midpoint is the more representative
//    spot for that average, and reads as a proper linear interpolation of
//    the underlying rate across buckets instead.
//  - "Fake" context buckets outside the trim window (in_window: false) can
//    span a much wider range than the official buckets. A single point —
//    whether at the edge or the midpoint — still collapses that whole span
//    to one spot, leaving the rest of it with no plotted point at all
//    (rendering as a gap). Two points, one at each true edge (same values,
//    since a lump is one aggregate rate for its entire span), draws a flat
//    segment across the whole thing instead.
function bucketsToLinePoints(data: Record<string, any>[]): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const b of data) {
        if (b.in_window === false) {
            out.push({ ...b, time: b.start });
            out.push(b);
        } else {
            out.push({ ...b, time: (b.start + b.time) / 2 });
        }
    }
    return out;
}

function throughputSpec(
    data: Record<string, any>[],
    width: number,
    height: number,
    trimWindow: [number, number] | null | undefined,
    xDomain: XDomain,
): Record<string, any> {
    data = bucketsToLinePoints(data);
    const xScale = xDomain ? { domain: xDomain } : undefined;
    const layers: Record<string, any>[] = [
        {
            transform: [
                { fold: ['rate', 'output_rate'], as: ['series', 'value'] },
                {
                    calculate: "datum.series === 'rate' ? 'weighted' : 'output'",
                    as: 'series_label',
                },
            ],
            mark: 'line',
            encoding: {
                x: { field: 'time', type: 'quantitative', title: 'Time (s)', scale: xScale },
                y: { field: 'value', type: 'quantitative', title: 'tok/s', axis: K_FORMAT_AXIS },
                color: {
                    field: 'series_label',
                    type: 'nominal',
                    title: 'Series',
                    scale: { domain: ['weighted', 'output'], range: ['#4da3ff', '#a855f7'] },
                },
            },
        },
        {
            mark: { type: 'line', color: '#2dd4bf' },
            encoding: {
                x: { field: 'time', type: 'quantitative', scale: xScale },
                y: {
                    field: 'input_rate', type: 'quantitative', title: 'system prefill tok/s',
                    axis: { orient: 'right', ...K_FORMAT_AXIS },
                },
            },
        },
    ];

    // `data` includes "fake" context buckets outside the trim window (drawn
    // by the lines above like everything else, for continuity) — these two
    // rules mark exactly where the official, milabench-sampled N buckets
    // start/end, same convention as the Gantt's trim cutoff lines.
    if (trimWindow) {
        const [windowStart, windowEnd] = trimWindow;
        layers.push({
            data: { values: [{ x: windowStart }, { x: windowEnd }] },
            mark: { type: 'rule', color: '#ef5a6f', strokeDash: [4, 2], strokeWidth: 1.5 },
            encoding: { x: { field: 'x', type: 'quantitative', scale: xScale } },
        });
    }

    return {
        data: { values: data },
        width,
        height,
        autosize: AUTOSIZE_FIT,
        // Two y-scales: weighted/output share one (same unit, comparable
        // magnitude) on the left, and prefill gets its own axis on the
        // right since it's typically an order of magnitude larger (prompt
        // tokens land in one short prefill window instead of being spread
        // across the whole request). Folding weighted+output into one
        // `color`-encoded mark (rather than hardcoded-color layers) is what
        // makes Vega-Lite actually generate a legend for them.
        resolve: { scale: { y: 'independent' } },
        layer: layers,
    };
}

function latencySpec(
    data: Record<string, any>[],
    metric: 'ttft' | 'itl',
    width: number,
    height: number,
    xDomain: XDomain,
): Record<string, any> {
    data = bucketsToLinePoints(data);
    const fields = [`${metric}_p50`, `${metric}_p90`, `${metric}_p95`, `${metric}_p99`];
    return {
        data: { values: data },
        width,
        height,
        autosize: AUTOSIZE_FIT,
        transform: [{ fold: fields, as: ['percentile', 'value'] }],
        mark: 'line',
        encoding: {
            x: { field: 'time', type: 'quantitative', title: 'Time (s)', scale: xDomain ? { domain: xDomain } : undefined },
            y: { field: 'value', type: 'quantitative', title: `${metric} (s)` },
            color: { field: 'percentile', type: 'nominal', title: 'Percentile' },
        },
    };
}

// Per-bucket average GPU power (matched from a sibling .data log — see
// dashboard/server/timeline_gpu.py) alongside tokens/joule, the standard
// performance-per-watt efficiency figure (tok/s divided by W is
// dimensionally tok/(s*W) == tok/J). No color-fold/legend here, same
// convention as throughputSpec's prefill line: each series gets its own
// axis with a descriptive title instead. Buckets with no gpu samples in
// their window carry power_w/tokens_per_joule: null, which Vega-Lite
// renders as a gap in the line rather than a false zero.
function gpuSpec(data: Record<string, any>[], width: number, height: number, xDomain: XDomain): Record<string, any> {
    data = bucketsToLinePoints(data);
    const xScale = xDomain ? { domain: xDomain } : undefined;
    return {
        data: { values: data },
        width,
        height,
        autosize: AUTOSIZE_FIT,
        resolve: { scale: { y: 'independent' } },
        layer: [
            {
                mark: { type: 'line', color: '#f59e0b' },
                encoding: {
                    x: { field: 'time', type: 'quantitative', title: 'Time (s)', scale: xScale },
                    y: { field: 'power_w', type: 'quantitative', title: 'GPU power (W)' },
                    tooltip: [
                        { field: 'time', title: 'time (s)', format: '.3f' },
                        { field: 'power_w', title: 'power (W)', format: '.1f' },
                    ],
                },
            },
            {
                mark: { type: 'line', color: '#34d399' },
                encoding: {
                    x: { field: 'time', type: 'quantitative', scale: xScale },
                    y: {
                        field: 'tokens_per_joule', type: 'quantitative', title: 'tok/J (perf per watt)',
                        axis: { orient: 'right' },
                    },
                    tooltip: [
                        { field: 'time', title: 'time (s)', format: '.3f' },
                        { field: 'tokens_per_joule', title: 'tok/J', format: '.2f' },
                    ],
                },
            },
        ],
    };
}

// Shows every bucket across the FULL (untrimmed) range, so it's visible at
// a glance which buckets the ramp trim actually dropped (grey, at the two
// ends) versus kept (blue) — the dashed line marks the concurrency
// threshold that decided the cut.
function trimOverviewSpec(
    fullBuckets: Record<string, any>[],
    trimmedStart: number,
    trimmedEnd: number,
    concurrency: number | null,
    width: number,
    height: number,
    xDomain: XDomain,
): Record<string, any> {
    const n = fullBuckets.length;
    const xScale = xDomain ? { domain: xDomain } : undefined;
    const data = fullBuckets.map((b, i) => ({
        ...b,
        status: i < trimmedStart || i >= n - trimmedEnd ? 'trimmed' : 'kept',
    }));
    const layers: Record<string, any>[] = [
        {
            data: { values: data },
            mark: { type: 'bar' },
            encoding: {
                x: { field: 'time', type: 'quantitative', title: 'Time (s)', scale: xScale },
                y: { field: 'active_jobs', type: 'quantitative', title: 'active jobs' },
                color: {
                    field: 'status',
                    type: 'nominal',
                    title: 'Bucket',
                    scale: { domain: ['kept', 'trimmed'], range: ['#4da3ff', '#6b7280'] },
                },
                tooltip: [
                    { field: 'time', title: 'bucket end (s)', format: '.3f' },
                    { field: 'active_jobs', title: 'active jobs' },
                    { field: 'status', title: 'status' },
                ],
            },
        },
    ];
    if (concurrency != null) {
        layers.push({
            data: { values: [{ concurrency }] },
            mark: { type: 'rule', color: '#ef5a6f', strokeDash: [4, 2] },
            encoding: { y: { field: 'concurrency', type: 'quantitative' } },
        });
    }
    return { width, height, autosize: AUTOSIZE_FIT, layer: layers };
}

// Without this, every keystroke in a number input immediately fires new
// /buckets and /report requests — typing "128" fires 6 requests (2
// endpoints x 3 digits) in well under a second, most of them superseded
// before they even return.
function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}

interface TimelineStreamState {
    requests: TimelineRequest[] | null;
    bucketsData: TimelineBucketsResponse | null;
    gantt: TimelineGanttJob[] | null;
    report: TimelineReportResponse | null;
    gpu: TimelineGpuReport | null;
    isLoadingRequests: boolean;
    isLoadingBuckets: boolean;
    isLoadingGantt: boolean;
    isLoadingReport: boolean;
    isLoadingGpu: boolean;
    error: string | null;
}

const EMPTY_STREAM_STATE: TimelineStreamState = {
    requests: null, bucketsData: null, gantt: null, report: null, gpu: null,
    isLoadingRequests: false, isLoadingBuckets: false, isLoadingGantt: false, isLoadingReport: false, isLoadingGpu: false,
    error: null,
};

// One fetch does all the work (db load -> trim -> gantt -> report) and
// streams each stage in as it completes, instead of four separate queries
// each re-loading the run and — for buckets/report — separately
// recomputing the same trim window (which is also how buckets and report
// could disagree in the first place). Changing dbPath/runId/params aborts
// whatever stream was in flight and starts one fresh one, so there's never
// more than one of these running, or duplicated work across them.
function useTimelineStream(dbPath: string, runId: number | null, params: TimelineParams): TimelineStreamState {
    const [state, setState] = useState<TimelineStreamState>(EMPTY_STREAM_STATE);
    const paramsKey = JSON.stringify(params);

    useEffect(() => {
        if (runId === null || !dbPath) {
            setState(EMPTY_STREAM_STATE);
            return;
        }

        const controller = new AbortController();
        setState({
            requests: null, bucketsData: null, gantt: null, report: null, gpu: null,
            isLoadingRequests: true, isLoadingBuckets: true, isLoadingGantt: true, isLoadingReport: true, isLoadingGpu: true,
            error: null,
        });

        streamTimelineRun(runId, dbPath, JSON.parse(paramsKey), (event, data) => {
            if (event === 'requests') setState((s) => ({ ...s, requests: data, isLoadingRequests: false }));
            else if (event === 'buckets') setState((s) => ({ ...s, bucketsData: data, isLoadingBuckets: false }));
            else if (event === 'gantt') setState((s) => ({ ...s, gantt: data, isLoadingGantt: false }));
            else if (event === 'report') setState((s) => ({ ...s, report: data, isLoadingReport: false }));
            else if (event === 'gpu') setState((s) => ({ ...s, gpu: data, isLoadingGpu: false }));
            else if (event === 'error') {
                setState((s) => ({
                    ...s,
                    error: data?.error || 'Timeline stream failed',
                    isLoadingRequests: false, isLoadingBuckets: false, isLoadingGantt: false, isLoadingReport: false, isLoadingGpu: false,
                }));
            }
        }, controller.signal).catch((err) => {
            if (controller.signal.aborted) return; // superseded by a newer stream, not a real failure
            setState((s) => ({
                ...s,
                error: err?.message || 'Timeline stream failed',
                isLoadingRequests: false, isLoadingBuckets: false, isLoadingGantt: false, isLoadingReport: false, isLoadingGpu: false,
            }));
        });

        return () => controller.abort();
    }, [dbPath, runId, paramsKey]);

    return state;
}

type SortKey = keyof TimelineRequest;

const REQUEST_COLUMNS: { key: SortKey; label: string }[] = [
    { key: 'request_id', label: 'request' },
    { key: 'start_time', label: 'start' },
    { key: 'latency', label: 'latency' },
    { key: 'prompt_len', label: 'prompt_len' },
    { key: 'output_tokens', label: 'out_tok' },
    { key: 'ttft', label: 'ttft' },
    { key: 'tpot', label: 'tpot' },
    { key: 'success', label: 'ok' },
    { key: 'error', label: 'error' },
];

export const TimelineDevView: React.FC = () => {
    usePageTitle('Timeline');

    const { open: isDialogOpen, onOpen: onDialogOpen, onClose: onDialogClose } = useDisclosure();

    // Form inputs — including the db path itself — live in the URL (not
    // useState/cookies) so a reload, or sharing the link, reproduces the
    // exact same view instead of resetting to defaults.
    const [searchParams, setSearchParams] = useSearchParams();
    // Multiple setParam() calls in the same handler don't reliably compose:
    // each is a separate setSearchParams() call, and react-router doesn't
    // chain successive functional updates against each other's result the
    // way React's own useState setter does — the second call's `prev` can
    // still be the pre-first-call value, so it silently clobbers the first
    // change. setParams() applies a whole batch of key changes in one
    // setSearchParams() call so they can't race each other.
    const setParams = useCallback((updates: Record<string, string>) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            for (const [key, value] of Object.entries(updates)) {
                if (value) next.set(key, value);
                else next.delete(key);
            }
            return next;
        }, { replace: true });
    }, [setSearchParams]);
    const setParam = useCallback((key: string, value: string) => setParams({ [key]: value }), [setParams]);

    const dbPath = searchParams.get('db') || '';

    // Free-typed draft for the "set db path" dialog input — kept separate
    // from the committed `dbPath` above so typing doesn't rewrite the URL
    // (and refire every query) on every keystroke; it only commits when
    // "Set Path" is clicked. Reset to the current committed value whenever
    // the dialog opens.
    const [dbPathDraft, setDbPathDraft] = useState(dbPath);
    useEffect(() => {
        if (isDialogOpen) setDbPathDraft(dbPath);
    }, [isDialogOpen, dbPath]);

    const runId = searchParams.get('run') !== null ? Number(searchParams.get('run')) : null;
    const setRunId = (id: number | null) => setParam('run', id != null ? String(id) : '');

    const numBuckets = searchParams.get('buckets') !== null ? Number(searchParams.get('buckets')) : 30;
    const setNumBuckets = (v: number) => setParam('buckets', v === 30 ? '' : String(v));

    const inputWeight = searchParams.get('iw') !== null ? Number(searchParams.get('iw')) : 1.0;
    const setInputWeight = (v: number) => setParam('iw', v === 1.0 ? '' : String(v));

    const outputWeight = searchParams.get('ow') !== null ? Number(searchParams.get('ow')) : 5.0;
    const setOutputWeight = (v: number) => setParam('ow', v === 5.0 ? '' : String(v));

    const latencyMetric = (searchParams.get('latency') === 'itl' ? 'itl' : 'ttft') as 'ttft' | 'itl';
    const setLatencyMetric = (v: 'ttft' | 'itl') => setParam('latency', v === 'ttft' ? '' : v);

    const trimEnabled = searchParams.get('trim') === '1';
    const setTrimEnabled = (v: boolean) => setParam('trim', v ? '1' : '');

    const trimMode = (searchParams.get('trim_mode') === 'launch' ? 'launch' : 'concurrency') as 'concurrency' | 'launch';
    const setTrimMode = (v: 'concurrency' | 'launch') => setParam('trim_mode', v === 'concurrency' ? '' : v);

    const concurrency = searchParams.get('concurrency') !== null ? Number(searchParams.get('concurrency')) : 1;
    const setConcurrency = (v: number) => setParam('concurrency', v === 1 ? '' : String(v));

    const [sortKey, setSortKey] = useState<SortKey>('start_time');
    const [sortDir, setSortDir] = useState<1 | -1>(1);
    const [filterSuccess, setFilterSuccess] = useState<'all' | 'ok' | 'fail'>('all');
    const [searchError, setSearchError] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 50;

    const { data: check } = useQuery({
        queryKey: ['timelineCheck', dbPath],
        queryFn: () => checkTimelineDb(dbPath),
        enabled: !!dbPath,
    });

    const { data: runs, isLoading: isLoadingRuns } = useQuery<TimelineRun[]>({
        queryKey: ['timelineRuns', dbPath],
        queryFn: () => getTimelineRuns(dbPath),
        enabled: !!dbPath && !!check?.ok,
    });

    useEffect(() => {
        if (runs && runs.length && runId === null) {
            setRunId(runs[runs.length - 1].run_id);
        }
    }, [runs, runId]);

    // Inputs update immediately (so typing feels responsive); the values
    // actually used for queries lag by 400ms, so a fetch only fires once
    // you pause instead of on every keystroke.
    const debouncedNumBuckets = useDebouncedValue(numBuckets, 400);
    const debouncedInputWeight = useDebouncedValue(inputWeight, 400);
    const debouncedOutputWeight = useDebouncedValue(outputWeight, 400);
    const debouncedConcurrency = useDebouncedValue(concurrency, 400);

    const timelineParams: TimelineParams = {
        num_buckets: debouncedNumBuckets,
        input_weight: debouncedInputWeight,
        output_weight: debouncedOutputWeight,
        trim: trimEnabled,
        trim_mode: trimMode,
        concurrency: debouncedConcurrency,
    };

    const {
        requests, bucketsData: bucketsResp, gantt, report, gpu,
        isLoadingRequests, isLoadingBuckets, isLoadingGantt, isLoadingReport, isLoadingGpu,
        error: streamError,
    } = useTimelineStream(dbPath, runId, timelineParams);

    const summary = useMemo(() => {
        if (!requests || !requests.length) return null;
        const n = requests.length;
        const ok = requests.filter((r) => r.success).length;
        const fail = n - ok;
        const duration = Math.max(...requests.map((r) => r.start_time + (r.latency || 0))) - Math.min(...requests.map((r) => r.start_time));
        const latencies = requests.map((r) => r.latency).filter((v) => v != null);
        const ttfts = requests.map((r) => r.ttft).filter((v) => v);
        const promptLens = requests.map((r) => r.prompt_len).filter((v) => v != null);
        const outputLens = requests.map((r) => r.output_tokens).filter((v) => v != null);
        const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
        const totalTokens = requests.reduce((a, r) => a + (r.output_tokens || 0) + (r.prompt_len || 0), 0);
        return { n, ok, fail, duration, avgLatency: avg(latencies), avgTtft: avg(ttfts), avgPrompt: avg(promptLens), avgOutput: avg(outputLens), tokPerSec: duration ? totalTokens / duration : 0 };
    }, [requests]);

    const filteredRequests = useMemo(() => {
        if (!requests) return [];
        return requests.filter((r) => {
            if (filterSuccess === 'ok' && !r.success) return false;
            if (filterSuccess === 'fail' && r.success) return false;
            if (searchError && !(r.error || '').toLowerCase().includes(searchError.toLowerCase())) return false;
            return true;
        });
    }, [requests, filterSuccess, searchError]);

    const sortedRequests = useMemo(() => {
        const copy = [...filteredRequests];
        copy.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'string' || typeof bv === 'string') {
                return sortDir * String(av ?? '').localeCompare(String(bv ?? ''));
            }
            return sortDir * (((av as number) ?? 0) - ((bv as number) ?? 0));
        });
        return copy;
    }, [filteredRequests, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sortedRequests.length / pageSize));
    const pageRows = sortedRequests.slice(page * pageSize, (page + 1) * pageSize);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
        else { setSortKey(key); setSortDir(1); }
    };

    const handleSetDbPath = () => {
        if (!dbPathDraft.trim()) {
            toaster.create({ title: 'Path required', description: 'Enter a benchmark_results.db path', type: 'warning', duration: 3000 });
            return;
        }
        // One batched update — see setParams()'s note on why setDbPath()
        // followed by setRunId() here couldn't reliably apply both.
        setParams({ db: dbPathDraft.trim(), run: '' });
        onDialogClose();
    };

    const trim = bucketsResp?.trim || report?.trim;

    // `buckets` (display_buckets) always spans the whole run — the "fake"
    // context lumps extend it to the run's own start/end regardless of
    // whether a trim window is active — so it's the one dataset guaranteed
    // to cover the full range every other time-based chart here also plots.
    const xDomain: XDomain = bucketsResp?.buckets?.length
        ? [bucketsResp.buckets[0].start, bucketsResp.buckets[bucketsResp.buckets.length - 1].time]
        : undefined;

    return (
        <Box p={4} marginRight="10px">
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg">Timeline</Heading>
                    <HStack gap={2}>
                        {dbPath ? (
                            <>
                                <Badge fontSize="sm" px={3} py={1}>DB: {dbPath}</Badge>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                    _hover={{ bg: 'var(--color-bg-hover)' }}
                                    onClick={onDialogOpen}
                                >
                                    Change
                                </Button>
                            </>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _hover={{ bg: 'var(--color-bg-hover)' }}
                                onClick={onDialogOpen}
                            >
                                Set DB Path
                            </Button>
                        )}
                    </HStack>
                </HStack>

                {!dbPath ? (
                    <Box textAlign="center" py={8} borderRadius="md" borderWidth={1} p={4} >
                        <Text fontSize="lg" mb={4}>Set a benchmark_results.db path to get started</Text>
                        <Button
                            bg="var(--color-btn-load-bg)"
                            color="var(--color-btn-load-text)"
                            _hover={{ bg: 'var(--color-btn-load-hover)' }}
                            onClick={onDialogOpen}
                        >
                            Set DB Path
                        </Button>
                    </Box>
                ) : check && !check.ok ? (
                    <Box p={4} bg="var(--color-btn-danger-subtle)" borderRadius="md">
                        <Text color="var(--color-text-danger)">{check.error}</Text>
                    </Box>
                ) : (
                    <VStack align="stretch" gap={4}>
                        <HStack gap={4} p={4} borderWidth={1} borderRadius="md" wrap="wrap" align="flex-end">
                            <Field.Root maxW="420px">
                                <Field.Label>Run</Field.Label>
                                <NativeSelect.Root>
                                    <NativeSelect.Field
                                        value={runId ?? ''}
                                        onChange={(e) => setRunId(Number(e.target.value))}
                                    >
                                        {(runs || []).map((r) => (
                                            <option key={r.run_id} value={r.run_id}>
                                                run {r.run_id} · {r.created_at} · {r.num_requests} requests
                                                {r.description ? ` — ${r.description}` : ''}
                                            </option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </Field.Root>
                            <Field.Root maxW="100px">
                                <Field.Label>Buckets</Field.Label>
                                <Input type="number" value={numBuckets} onChange={(e) => setNumBuckets(Number(e.target.value) || 30)} />
                            </Field.Root>
                            <Field.Root maxW="100px">
                                <Field.Label>Input weight</Field.Label>
                                <Input type="number" step={0.1} value={inputWeight} onChange={(e) => setInputWeight(Number(e.target.value) || 0)} />
                            </Field.Root>
                            <Field.Root maxW="100px">
                                <Field.Label>Output weight</Field.Label>
                                <Input type="number" step={0.1} value={outputWeight} onChange={(e) => setOutputWeight(Number(e.target.value) || 0)} />
                            </Field.Root>
                            <Field.Root maxW="130px">
                                <Field.Label>Latency metric</Field.Label>
                                <NativeSelect.Root>
                                    <NativeSelect.Field value={latencyMetric} onChange={(e) => setLatencyMetric(e.target.value as 'ttft' | 'itl')}>
                                        <option value="ttft">TTFT</option>
                                        <option value="itl">ITL</option>
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </Field.Root>
                            <Field.Root maxW="100px">
                                <Field.Label>Concurrency</Field.Label>
                                <Input type="number" min={0} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value) || 0)} />
                            </Field.Root>
                            <Field.Root maxW="200px">
                                <Field.Label>Trim strategy</Field.Label>
                                <NativeSelect.Root>
                                    <NativeSelect.Field value={trimMode} onChange={(e) => setTrimMode(e.target.value as 'concurrency' | 'launch')}>
                                        <option value="concurrency">Active jobs ≤ concurrency</option>
                                        <option value="launch">Launch-order window</option>
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </Field.Root>
                            <Checkbox.Root checked={trimEnabled} onCheckedChange={(d) => setTrimEnabled(!!d.checked)} pb={2}>
                                <Checkbox.HiddenInput />
                                <Checkbox.Control />
                                <Checkbox.Label>Trim ramp-up/down</Checkbox.Label>
                            </Checkbox.Root>
                        </HStack>

                        {trim && (
                            <Text fontSize="sm" color="var(--color-text-muted)">
                                {trim.enabled
                                    ? (trim.mode === 'launch'
                                        ? `Ramp trim ON (launch-order window, concurrency=${trim.concurrency}) — window starts at the first wave's earliest finisher and ends at the last request's own dispatch (nothing launches after it)`
                                        : `Ramp trim ON (active jobs ≤ ${trim.concurrency})`) +
                                      ` — dropped ${trim.trimmed_start} bucket(s) from the start and ${trim.trimmed_end} from the end; ${trim.kept_buckets}/${trim.total_buckets} buckets kept` +
                                      (trim.window ? `, window ${trim.window[0].toFixed(2)}s–${trim.window[1].toFixed(2)}s` : '') +
                                      (trim.requests_used != null ? `, ${trim.requests_used}/${trim.requests_total} requests used for the Bucket Aggregate report (vLLM report always uses all ${trim.requests_total}).` : '.')
                                    : 'Ramp trim OFF — showing the full run.'}
                            </Text>
                        )}

                        {streamError && (
                            <Box p={3} bg="var(--color-btn-danger-subtle)" borderRadius="md">
                                <Text color="var(--color-text-danger)" fontSize="sm">{streamError}</Text>
                            </Box>
                        )}

                        {bucketsResp && bucketsResp.full_buckets.length > 0 && (
                            <Box borderWidth={1} borderRadius="md" p={4}>
                                <Heading size="sm" mb={3}>Active jobs per bucket (trim overview)</Heading>
                                <Box w="100%" maxW="100%" overflow="hidden">
                                    <VegaPlot
                                        spec={(w, h) => trimOverviewSpec(
                                            bucketsResp.full_buckets,
                                            trim?.enabled ? trim.trimmed_start : 0,
                                            trim?.enabled ? trim.trimmed_end : 0,
                                            concurrency,
                                            w,
                                            h,
                                            xDomain,
                                        )}
                                        height="180px"
                                    />
                                </Box>
                            </Box>
                        )}

                        {isLoadingRuns ? (
                            <Loading />
                        ) : !runs || !runs.length ? (
                            <Text>No runs found in this database.</Text>
                        ) : (
                            <>
                                {summary && (
                                    <Box borderWidth={1} borderRadius="md" p={4}>
                                        <Heading size="sm" mb={3}>Summary</Heading>
                                        <HStack wrap="wrap" gap={4}>
                                            {[
                                                { l: 'Requests', v: summary.n },
                                                { l: 'Success', v: summary.ok },
                                                { l: 'Errors', v: summary.fail },
                                                { l: 'Duration', v: `${summary.duration.toFixed(1)}s` },
                                                { l: 'Avg latency', v: `${summary.avgLatency.toFixed(3)}s` },
                                                { l: 'Avg TTFT', v: `${summary.avgTtft.toFixed(3)}s` },
                                                { l: 'Avg prompt_len', v: summary.avgPrompt.toFixed(1) },
                                                { l: 'Avg output_tokens', v: summary.avgOutput.toFixed(1) },
                                                { l: 'Overall tok/s', v: summary.tokPerSec.toFixed(1) },
                                            ].map((s) => (
                                                <Box key={s.l} minW="120px">
                                                    <Text fontSize="xl" fontWeight="bold">{s.v}</Text>
                                                    <Text fontSize="xs" color="var(--color-text-muted)" textTransform="uppercase">{s.l}</Text>
                                                </Box>
                                            ))}
                                        </HStack>
                                    </Box>
                                )}

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>Report Comparison</Heading>
                                    <HStack align="start" gap={4} wrap="wrap">
                                        <Box flex="1 1 380px" minW={0}>
                                            <Text fontSize="sm" fontWeight="bold" mb={1}>vLLM serve.py-style report</Text>
                                            <Text fontSize="xs" color="var(--color-text-muted)" mb={2}>Always uses every request — no ramp trim, matching vLLM's own script.</Text>
                                            {isLoadingReport || !report ? <Loading /> : (
                                                <Box as="pre" fontSize="xs" fontFamily="mono" p={3} borderRadius="md" bg="var(--color-bg-card)" overflowX="auto" whiteSpace="pre" maxH="600px" overflowY="auto">
                                                    {formatVllmReport(report.vllm)}
                                                </Box>
                                            )}
                                        </Box>
                                        <Box flex="1 1 380px" minW={0}>
                                            <Text fontSize="sm" fontWeight="bold" mb={1}>Bucket aggregate (rolled up from buckets)</Text>
                                            <Text fontSize="xs" color="var(--color-text-muted)" mb={2}>
                                                {trimEnabled ? 'Uses the ramp-trimmed requests (steady state only).' : 'Ramp trim is off — currently uses every request too.'}
                                            </Text>
                                            {isLoadingReport || !report ? <Loading /> : (
                                                <Box as="pre" fontSize="xs" fontFamily="mono" p={3} borderRadius="md" bg="var(--color-bg-card)" overflowX="auto" whiteSpace="pre" maxH="600px" overflowY="auto">
                                                    {formatBucketAggregateReport(report.bucket_aggregate)}
                                                </Box>
                                            )}
                                        </Box>
                                    </HStack>
                                </Box>

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>Request Timeline (Gantt)</Heading>
                                    {isLoadingGantt ? (
                                        <Loading />
                                    ) : gantt && gantt.length ? (
                                        <Box w="100%" maxW="100%" overflow="hidden">
                                            <VegaPlot
                                                spec={(w, h) => ganttSpec(
                                                    gantt,
                                                    trim?.window,
                                                    // bucketsResp.buckets is the official (trim-window-aligned)
                                                    // grid plus the "fake" context lump(s) outside it — using
                                                    // that instead of full_buckets keeps these start markers
                                                    // consistent with where the official N buckets actually are
                                                    // when a trim window is active. Each bucket's own `start`
                                                    // is used directly rather than assuming a uniform step: the
                                                    // outside lumps are deliberately a different (often much
                                                    // larger) width than the official buckets.
                                                    bucketsResp?.buckets?.length
                                                        ? [
                                                            ...bucketsResp.buckets.map((b) => b.start),
                                                            bucketsResp.buckets[bucketsResp.buckets.length - 1].time,
                                                        ]
                                                        : null,
                                                    w,
                                                    h,
                                                    xDomain,
                                                )}
                                                height="420px"
                                            />
                                        </Box>
                                    ) : (
                                        <Text fontSize="sm">No data</Text>
                                    )}
                                </Box>

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>Throughput per bucket (weighted / system prefill / output tok/s)</Heading>
                                    {isLoadingBuckets ? (
                                        <Loading />
                                    ) : bucketsResp && bucketsResp.buckets.length ? (
                                        <Box w="100%" maxW="100%" overflow="hidden">
                                            <VegaPlot
                                                spec={(w, h) => throughputSpec(bucketsResp.buckets, w, h, trim?.window, xDomain)}
                                                height="280px"
                                            />
                                        </Box>
                                    ) : (
                                        <Text fontSize="sm">No data</Text>
                                    )}
                                </Box>

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>Latency percentiles per bucket</Heading>
                                    {isLoadingBuckets ? (
                                        <Loading />
                                    ) : bucketsResp && bucketsResp.buckets.length ? (
                                        <Box w="100%" maxW="100%" overflow="hidden">
                                            <VegaPlot
                                                spec={(w, h) => latencySpec(bucketsResp.buckets, latencyMetric, w, h, xDomain)}
                                                height="280px"
                                            />
                                        </Box>
                                    ) : (
                                        <Text fontSize="sm">No data</Text>
                                    )}
                                </Box>

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>GPU power / efficiency (tok/J)</Heading>
                                    {isLoadingGpu ? (
                                        <Loading />
                                    ) : gpu && gpu.available && gpu.buckets && gpu.buckets.length ? (
                                        <>
                                            <Text fontSize="xs" color="var(--color-text-muted)" mb={2}>
                                                Matched {gpu.data_file} — power is summed across all GPUs, averaged per bucket; buckets with no GPU sample in their window show a gap.
                                            </Text>
                                            <Box w="100%" maxW="100%" overflow="hidden">
                                                <VegaPlot
                                                    spec={(w, h) => gpuSpec(gpu.buckets!, w, h, xDomain)}
                                                    height="280px"
                                                />
                                            </Box>
                                        </>
                                    ) : (
                                        <Text fontSize="sm" color="var(--color-text-muted)">
                                            No matching GPU data found — looked for a .data log with gpudata samples near this run's own timestamp under the database's directory.
                                        </Text>
                                    )}
                                </Box>

                                <Box borderWidth={1} borderRadius="md" p={4}>
                                    <Heading size="sm" mb={3}>Requests</Heading>
                                    <HStack gap={4} mb={3}>
                                        <Field.Root maxW="160px">
                                            <Field.Label>Filter</Field.Label>
                                            <NativeSelect.Root>
                                                <NativeSelect.Field value={filterSuccess} onChange={(e) => { setFilterSuccess(e.target.value as any); setPage(0); }}>
                                                    <option value="all">All</option>
                                                    <option value="ok">Success only</option>
                                                    <option value="fail">Errors only</option>
                                                </NativeSelect.Field>
                                            </NativeSelect.Root>
                                        </Field.Root>
                                        <Field.Root maxW="240px">
                                            <Field.Label>Search error</Field.Label>
                                            <Input value={searchError} onChange={(e) => { setSearchError(e.target.value); setPage(0); }} placeholder="substring..." />
                                        </Field.Root>
                                    </HStack>
                                    {isLoadingRequests ? (
                                        <Loading />
                                    ) : (
                                        <>
                                            <Table.ScrollArea maxH="420px">
                                                <Table.Root size="sm">
                                                    <Table.Header>
                                                        <Table.Row>
                                                            {REQUEST_COLUMNS.map((c) => (
                                                                <Table.ColumnHeader key={c.key} cursor="pointer" onClick={() => handleSort(c.key)}>
                                                                    {c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                                                                </Table.ColumnHeader>
                                                            ))}
                                                        </Table.Row>
                                                    </Table.Header>
                                                    <Table.Body>
                                                        {pageRows.map((r, idx) => (
                                                            <Table.Row key={idx}>
                                                                <Table.Cell>{r.request_id}</Table.Cell>
                                                                <Table.Cell>{r.start_time?.toFixed(3)}</Table.Cell>
                                                                <Table.Cell>{r.latency?.toFixed(3)}</Table.Cell>
                                                                <Table.Cell>{r.prompt_len}</Table.Cell>
                                                                <Table.Cell>{r.output_tokens}</Table.Cell>
                                                                <Table.Cell>{r.ttft?.toFixed(3)}</Table.Cell>
                                                                <Table.Cell>{r.tpot?.toFixed(3)}</Table.Cell>
                                                                <Table.Cell>{r.success ? '✓' : '✗'}</Table.Cell>
                                                                <Table.Cell maxW="240px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={r.error}>{r.error}</Table.Cell>
                                                            </Table.Row>
                                                        ))}
                                                    </Table.Body>
                                                </Table.Root>
                                            </Table.ScrollArea>
                                            <HStack mt={3} gap={3}>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    borderColor="var(--color-border)"
                                                    color="var(--color-text)"
                                                    _hover={{ bg: 'var(--color-bg-hover)' }}
                                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                                    disabled={page === 0}
                                                >
                                                    Prev
                                                </Button>
                                                <Text fontSize="sm">Page {page + 1} / {totalPages} · {sortedRequests.length} rows</Text>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    borderColor="var(--color-border)"
                                                    color="var(--color-text)"
                                                    _hover={{ bg: 'var(--color-bg-hover)' }}
                                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                                    disabled={page >= totalPages - 1}
                                                >
                                                    Next
                                                </Button>
                                            </HStack>
                                        </>
                                    )}
                                </Box>
                            </>
                        )}
                    </VStack>
                )}
            </VStack>

            <Dialog.Root
                open={isDialogOpen}
                onOpenChange={(details) => {
                    if (!details.open) onDialogClose();
                }}
            >
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Set benchmark_results.db Path</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack gap={4} align="stretch">
                                <Field.Root>
                                    <Field.Label>Database Path</Field.Label>
                                    <Input
                                        value={dbPathDraft}
                                        onChange={(e) => setDbPathDraft(e.target.value)}
                                        placeholder="/path/to/benchmark_results.db"
                                    />
                                    <Field.HelperText>
                                        Read directly by the dashboard server — must be a path it can see on disk.
                                    </Field.HelperText>
                                </Field.Root>
                                <HStack gap={2} justify="flex-end">
                                    <Button
                                        variant="outline"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        onClick={onDialogClose}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        bg="var(--color-btn-load-bg)"
                                        color="var(--color-btn-load-text)"
                                        _hover={{ bg: 'var(--color-btn-load-hover)' }}
                                        onClick={handleSetDbPath}
                                    >
                                        Set Path
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};

export default TimelineDevView;
