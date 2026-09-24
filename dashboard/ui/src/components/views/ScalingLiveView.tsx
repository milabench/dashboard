import { useState, useCallback, useRef, useMemo } from 'react';
import {
    Box,
    HStack,
    VStack,
    NativeSelect,
    Field,
    Input,
    Text,
    Button,
    Badge,
    Checkbox,
    Code,
    Heading,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
    getScalingLive,
    getScalingLiveStatus,
    getScalingLiveSuggestions,
    refreshScalingLive,
    type LiveScalingPoint,
} from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { buildVendorColorScale, cssColor, guessVendor } from '../../utils/gpuColors';
import { downloadJson, safeFilename } from '../../utils/download';

const PARAM_X = 'x';
const PARAM_Y = 'y';
const PARAM_HIDE_FIXED = 'hidefixed';
const PARAM_SUGGEST_GPU = 'sgpu';
const PARAM_SUGGEST_Q = 'sq';

// Experimental: pulls scaling points from the scaling_observations_live
// cache table (computed from real pushed Exec/Pack/Metric rows) instead of
// the static sizing.yaml snapshots the public /scaling page reads. See
// scaling_live_compute.py for the batch-size/GPU-name heuristics and their
// known coverage limits — this page stays dev-only until that's proven out.
const ScalingLiveView = () => {
    usePageTitle('Scaling Live');
    const plotRef = useRef<VegaPlotHandle>(null);
    const queryClient = useQueryClient();
    const [refreshing, setRefreshing] = useState(false);
    const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [copiedRow, setCopiedRow] = useState<string | null>(null);

    const [urlParams, setUrlParams] = useSearchParams();
    const xAxis = urlParams.get(PARAM_X) ?? 'batch_size';
    const yAxis = urlParams.get(PARAM_Y) ?? 'perf';
    const suggestGpuFilter = urlParams.get(PARAM_SUGGEST_GPU) ?? '';
    const suggestSearch = urlParams.get(PARAM_SUGGEST_Q) ?? '';
    // On by default: benchmarks where every cached point shares the same
    // batch_size carry no scaling signal (nothing to plot against), so they
    // just clutter the facet grid.
    const hideFixedBatchSize = urlParams.get(PARAM_HIDE_FIXED) !== '0';

    const setParam = (key: string, value: string | null) => {
        setUrlParams(prev => {
            const next = new URLSearchParams(prev);
            if (value === null) {
                next.delete(key);
            } else {
                next.set(key, value);
            }
            return next;
        }, { replace: true });
    };

    const { data: status } = useQuery({
        queryKey: ['scalingLiveStatus'],
        queryFn: getScalingLiveStatus,
    });

    const { data: scalingData } = useQuery({
        queryKey: ['scalingLiveData'],
        queryFn: () => getScalingLive(),
    });

    const allPoints: LiveScalingPoint[] = useMemo(
        () => (Array.isArray(scalingData) ? scalingData : []),
        [scalingData],
    );

    const points = useMemo(() => {
        if (!hideFixedBatchSize) return allPoints;
        const batchSizesByBench = new Map<string, Set<number>>();
        for (const p of allPoints) {
            let set = batchSizesByBench.get(p.bench);
            if (!set) { set = new Set(); batchSizesByBench.set(p.bench, set); }
            set.add(p.batch_size);
        }
        return allPoints.filter((p) => (batchSizesByBench.get(p.bench)?.size ?? 0) > 1);
    }, [allPoints, hideFixedBatchSize]);

    const hiddenBenchCount = useMemo(() => {
        if (!hideFixedBatchSize) return 0;
        return new Set(allPoints.map((p) => p.bench)).size - new Set(points.map((p) => p.bench)).size;
    }, [allPoints, points, hideFixedBatchSize]);

    const hasData = points.length > 0;

    const handleRefresh = async () => {
        setRefreshing(true);
        setRefreshMsg(null);
        try {
            const result = await refreshScalingLive();
            if (result.status === 'OK') {
                setRefreshMsg(
                    `Wrote ${result.written} points ` +
                    `(${result.packs_considered} packs considered, ` +
                    `${result.skipped_no_batch_size} skipped: no batch size, ` +
                    `${result.skipped_no_gpu} skipped: no GPU)`
                );
            } else {
                setRefreshMsg(`Error: ${result.message ?? 'refresh failed'}`);
            }
            await queryClient.invalidateQueries({ queryKey: ['scalingLiveData'] });
            await queryClient.invalidateQueries({ queryKey: ['scalingLiveStatus'] });
            await queryClient.invalidateQueries({ queryKey: ['scalingLiveSuggest'] });
        } catch (err) {
            setRefreshMsg(`Error: ${err}`);
        } finally {
            setRefreshing(false);
        }
    };

    const { data: suggestData, isLoading: isLoadingSuggest } = useQuery({
        queryKey: ['scalingLiveSuggest', suggestGpuFilter],
        queryFn: () => getScalingLiveSuggestions(suggestGpuFilter ? { gpu: suggestGpuFilter } : {}),
    });

    const filteredSuggestions = useMemo(() => {
        const rows = suggestData?.suggestions ?? [];
        if (!suggestSearch) return rows;
        const lower = suggestSearch.toLowerCase();
        return rows.filter(r => r.bench.toLowerCase().includes(lower));
    }, [suggestData, suggestSearch]);

    const rowKey = (gpu: string, bench: string) => `${gpu}::${bench}`;

    const toggleExpanded = (key: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const copyCommands = async (key: string, commands: string[]) => {
        try {
            await navigator.clipboard.writeText(commands.join('\n'));
            setCopiedRow(key);
            setTimeout(() => setCopiedRow(prev => (prev === key ? null : prev)), 1500);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    };

    const CELL_HEIGHT = 280;
    const CELL_PADDING = 50;
    const ROW_OVERHEAD = 100;

    const plotHeight = useMemo(() => {
        if (points.length === 0) return 400;
        const benchCount = new Set(points.map((d) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const rows = Math.ceil(benchCount / cols);
        return rows * (CELL_HEIGHT + CELL_PADDING + ROW_OVERHEAD) + 120;
    }, [points]);

    const specBuilder = useCallback((w: number) => {
        if (points.length === 0) return null;

        const values = points.map((d) => ({
            ...d,
            vendor: guessVendor(String(d.gpu ?? '')),
        }));

        const benchCount = new Set(values.map((d) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const cellWidth = Math.max(120, Math.floor(w / (cols + 1)) - CELL_PADDING);
        const vendorScale = buildVendorColorScale(values.map((d) => d.vendor));
        const legendStyle = {
            labelColor: cssColor('--color-text', '#1a202c'),
            symbolSize: 120,
        };

        const axisEncoding = {
            x: { field: xAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
            y: { field: yAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
        };
        const seriesEncoding = {
            shape: {
                field: 'gpu',
                type: 'nominal',
                title: 'GPU',
                legend: {
                    ...legendStyle,
                    symbolOpacity: 1,
                    symbolFillColor: cssColor('--color-text-muted', '#718096'),
                    symbolStrokeColor: cssColor('--color-text-muted', '#718096'),
                },
            },
            color: {
                field: 'vendor',
                type: 'nominal',
                title: 'Vendor',
                scale: vendorScale,
                legend: {
                    ...legendStyle,
                    symbolOpacity: 1,
                },
            },
        };

        const pointTooltip = [
            { field: 'bench', type: 'nominal', title: 'Benchmark' },
            { field: 'gpu', type: 'nominal', title: 'GPU' },
            { field: 'vendor', type: 'nominal', title: 'Vendor' },
            { field: 'batch_size', type: 'quantitative', title: 'batch_size' },
            { field: 'memory', type: 'quantitative', title: 'memory', format: '~s' },
            { field: 'perf', type: 'quantitative', title: 'perf', format: '~s' },
            { field: 'n_samples', type: 'quantitative', title: 'n_samples' },
            { field: 'torch', type: 'nominal', title: 'torch' },
            { field: 'backend', type: 'nominal', title: 'backend' },
        ];

        const pointLayer = {
            mark: { type: 'point', filled: true, size: 120 },
            encoding: {
                ...axisEncoding,
                ...seriesEncoding,
                tooltip: pointTooltip,
            },
        };

        return {
            data: { values },
            facet: { field: 'bench', type: 'nominal', title: 'Benchmark' },
            columns: cols,
            spec: {
                width: cellWidth,
                height: CELL_HEIGHT,
                layer: [pointLayer],
            },
            resolve: { scale: { y: 'independent', x: 'independent', size: 'independent' } },
        } as Record<string, unknown>;
    }, [points, xAxis, yAxis]);

    const handleExportJson = () => {
        if (!hasData) return;
        downloadJson(
            { x: xAxis, y: yAxis, observations: points },
            safeFilename(['scaling-live', xAxis, yAxis], 'json'),
        );
    };

    const handleExportPng = async () => {
        if (!plotRef.current?.isReady()) return;
        try {
            await plotRef.current.exportPng(
                safeFilename(['scaling-live', xAxis, yAxis], 'png'),
            );
        } catch (err) {
            console.error('PNG export failed:', err);
        }
    };

    return (
        <Box p={4} h="100%" display="flex" flexDirection="column" overflowX="hidden" overflowY="auto" bg="var(--color-bg-page)">
            <HStack mb={2} gap={2} flexShrink={0}>
                <Badge colorPalette="purple">Experimental</Badge>
                <Text fontSize="sm" color="var(--color-text-muted)">
                    Computed from pushed run data (Exec/Pack/Metric), not the static sizing.yaml snapshots.
                </Text>
            </HStack>

            <HStack gap={4} mb={4} width="100%" flexShrink={0} alignItems="flex-end">
                <Field.Root flex="1">
                    <Field.Label color="var(--color-text)">X Axis</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={xAxis}
                            onChange={e => setParam(PARAM_X, e.target.value)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            _focusVisible={{ borderColor: 'var(--color-primary)' }}
                        >
                            <option value="batch_size">batch_size</option>
                            <option value="memory">memory</option>
                            <option value="perf">perf</option>
                            <option value="n_samples">n_samples</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="1">
                    <Field.Label color="var(--color-text)">Y Axis</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={yAxis}
                            onChange={e => setParam(PARAM_Y, e.target.value)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            _focusVisible={{ borderColor: 'var(--color-primary)' }}
                        >
                            <option value="batch_size">batch_size</option>
                            <option value="memory">memory</option>
                            <option value="perf">perf</option>
                            <option value="n_samples">n_samples</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Checkbox.Root
                    checked={hideFixedBatchSize}
                    onCheckedChange={(e) => setParam(PARAM_HIDE_FIXED, e.checked ? null : '0')}
                    alignSelf="flex-end"
                    mb={1.5}
                >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label color="var(--color-text)" fontSize="sm" whiteSpace="nowrap">
                        Hide benches without batch-size scaling
                    </Checkbox.Label>
                </Checkbox.Root>

                <HStack gap={2} flexShrink={0} pb={0.5}>
                    <Button
                        size="sm"
                        colorPalette="purple"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        whiteSpace="nowrap"
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh from DB'}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportPng}
                        disabled={!hasData}
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        whiteSpace="nowrap"
                    >
                        Save PNG
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportJson}
                        disabled={!hasData}
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        whiteSpace="nowrap"
                    >
                        Export JSON
                    </Button>
                </HStack>
            </HStack>

            <HStack mb={4} gap={4} flexShrink={0} fontSize="sm" color="var(--color-text-muted)">
                {status && (
                    <Text>
                        {status.n_points} points · {status.gpus.length} GPUs · {status.benches.length} benchmarks
                        {status.last_computed && ` · last computed ${new Date(status.last_computed).toLocaleString()}`}
                    </Text>
                )}
                {hiddenBenchCount > 0 && (
                    <Text>{hiddenBenchCount} bench{hiddenBenchCount !== 1 ? 'es' : ''} hidden (fixed batch size)</Text>
                )}
                {refreshMsg && <Text color="var(--color-text)">{refreshMsg}</Text>}
            </HStack>

            <Box flex="1">
                {scalingData ? (
                    hasData ? (
                        <VegaPlot
                            ref={plotRef}
                            spec={specBuilder}
                            height={`${plotHeight}px`}
                            overflow="visible"
                            configOverrides={{ legend: { orient: 'right', direction: 'vertical' } }}
                        />
                    ) : allPoints.length > 0 ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                            <Text color="var(--color-text-muted)">
                                All benchmarks were hidden by the batch-size scaling filter — uncheck it to see them.
                            </Text>
                        </Box>
                    ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                            <Text color="var(--color-text-muted)">
                                No cached scaling data yet — click "Refresh from DB" to compute it.
                            </Text>
                        </Box>
                    )
                ) : (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                        <Text color="var(--color-text-muted)">Loading scaling data…</Text>
                    </Box>
                )}
            </Box>

            {/* Fill Missing Data — compares cached coverage against the
                literal fixed_bs sweep from milabench/config/sizing.yaml and
                suggests a runnable command per missing (gpu, bench, batch_size). */}
            <Box flexShrink={0} mt={6} pt={4} borderTopWidth={1} borderColor="var(--color-border)">
                <Heading as="h2" size="sm" color="var(--color-text)" mb={1}>
                    Fill Missing Data
                </Heading>
                <Text fontSize="xs" color="var(--color-text-muted)" mb={3}>
                    Compares cached coverage against sizing.yaml's fixed batch-size sweep
                    {suggestData && ` (${suggestData.target_batch_sizes.join(', ')})`}.
                    Only covers that literal sweep — the mult/add/auto sweeps are relative to a
                    runtime-measured baseline and can't be checked from cached data alone.
                </Text>

                <HStack gap={4} mb={3} flexWrap="wrap" alignItems="flex-end">
                    <Field.Root flex="0 1 160px" minW="120px">
                        <Field.Label color="var(--color-text)">GPU</Field.Label>
                        <NativeSelect.Root>
                            <NativeSelect.Field
                                value={suggestGpuFilter}
                                onChange={e => setParam(PARAM_SUGGEST_GPU, e.target.value || null)}
                                bg="var(--color-bg-card)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            >
                                <option value="">All GPUs</option>
                                {status?.gpus.map(gpu => <option key={gpu} value={gpu}>{gpu}</option>)}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                    </Field.Root>
                    <Field.Root flex="0 1 220px" minW="160px">
                        <Field.Label color="var(--color-text)">Benchmark</Field.Label>
                        <Input
                            size="sm"
                            placeholder="Filter..."
                            value={suggestSearch}
                            onChange={e => setParam(PARAM_SUGGEST_Q, e.target.value || null)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        />
                    </Field.Root>
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        {filteredSuggestions.length} of {suggestData?.suggestions.length ?? 0} incomplete
                    </Text>
                </HStack>

                {isLoadingSuggest ? (
                    <Text color="var(--color-text-muted)" fontSize="sm">Checking coverage…</Text>
                ) : filteredSuggestions.length === 0 ? (
                    <Text color="var(--color-text-muted)" fontSize="sm">
                        {suggestData ? 'No gaps found in the fixed_bs sweep for the current filter.' : ''}
                    </Text>
                ) : (
                    <VStack align="stretch" gap={2} maxH="360px" overflowY="auto" pr={1}>
                        {filteredSuggestions.map(row => {
                            const key = rowKey(row.gpu, row.bench);
                            const expanded = expandedRows.has(key);
                            const commands = row.commands.map(c => c.command);
                            return (
                                <Box
                                    key={key}
                                    borderWidth={1}
                                    borderColor="var(--color-border)"
                                    borderRadius="md"
                                    bg="var(--color-bg-card)"
                                    p={2}
                                >
                                    <HStack gap={3} flexWrap="wrap" justify="space-between">
                                        <HStack gap={2} flexWrap="wrap">
                                            <Badge colorPalette="gray">{row.gpu}</Badge>
                                            <Text fontSize="sm" fontFamily="mono" color="var(--color-text)">{row.bench}</Text>
                                            <Text fontSize="xs" color="var(--color-text-muted)">
                                                missing bs=
                                            </Text>
                                            {row.missing_batch_sizes.map(bs => (
                                                <Badge key={bs} variant="outline" colorPalette="orange">{bs}</Badge>
                                            ))}
                                        </HStack>
                                        <HStack gap={2} flexShrink={0}>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                onClick={() => toggleExpanded(key)}
                                            >
                                                {expanded ? 'Hide' : 'Show'} commands
                                            </Button>
                                            <Button
                                                size="xs"
                                                colorPalette="purple"
                                                onClick={() => copyCommands(key, commands)}
                                            >
                                                {copiedRow === key ? 'Copied!' : `Copy ${commands.length} command${commands.length !== 1 ? 's' : ''}`}
                                            </Button>
                                        </HStack>
                                    </HStack>
                                    {expanded && (
                                        <Code
                                            display="block"
                                            whiteSpace="pre-wrap"
                                            wordBreak="break-all"
                                            mt={2}
                                            p={2}
                                            fontSize="xs"
                                            bg="var(--color-bg-page)"
                                            color="var(--color-text)"
                                        >
                                            {commands.join('\n')}
                                        </Code>
                                    )}
                                </Box>
                            );
                        })}
                    </VStack>
                )}
            </Box>
        </Box>
    );
};

export default ScalingLiveView;
