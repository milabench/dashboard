import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Box,
    Heading,
    HStack,
    NativeSelect,
    Field,
    Text,
    VStack,
    Badge,
    Input,
    Button,
    Code,
    Separator,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, getBenchDoc, getRunGroups, getScalingLive, refreshScalingLive, type LiveScalingPoint } from '../../services/api';
import type { RunGroup } from '../../services/types';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { buildVendorColorScale, guessVendor } from '../../utils/gpuColors';
import { buildBenchHistorySpec, buildVendorGpuLegends, type HistoryRecord } from '../../utils/benchHistoryChart';

type MetricKey = 'rate' | 'memory' | 'gpu' | 'cpu' | 'perf';

const METRICS: { key: MetricKey; label: string }[] = [
    { key: 'rate', label: 'Rate (items/s)' },
    { key: 'perf', label: 'Perf' },
    { key: 'memory', label: 'Memory' },
    { key: 'gpu', label: 'GPU Utilization' },
    { key: 'cpu', label: 'CPU Utilization' },
];

function formatMib(mib: number | null | undefined): string {
    if (mib == null) return '—';
    if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
    return `${mib.toFixed(0)} MiB`;
}

function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null) return '—';
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
}

// Experimental (DEV only): turns the "pick a benchmark" concept from
// BenchmarkHistoryView into a per-benchmark reference page — sample command
// + VRAM estimate up top, then batch-size scaling and performance-over-time
// stacked underneath. Built on the scaling_observations_live cache, so it
// inherits that feature's coverage limits (see scaling_live_compute.py).
const BenchmarkDocView: React.FC = () => {
    usePageTitle('Benchmark Docs');
    const queryClient = useQueryClient();
    const historyPlotRef = useRef<VegaPlotHandle>(null);
    const scalingPlotRef = useRef<VegaPlotHandle>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

    const [searchParams, setSearchParams] = useSearchParams();
    const selectedBench = searchParams.get('bench') || '';
    const benchSearch = searchParams.get('q') || '';
    const metric = (searchParams.get('metric') || 'rate') as MetricKey;
    const gpuFilter = searchParams.get('gpu') || '';
    const scalingY = searchParams.get('sy') || 'perf';

    const setParam = useCallback((key: string, value: string) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (value) next.set(key, value);
            else next.delete(key);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    const { data: benchList } = useQuery<string[]>({
        queryKey: ['benchList'],
        queryFn: async () => {
            const response = await api.get('/bench/list');
            return response.data;
        },
    });

    const filteredBenchList = useMemo(() => {
        if (!benchList) return [];
        if (!benchSearch) return benchList;
        const lower = benchSearch.toLowerCase();
        return benchList.filter(b => b.toLowerCase().includes(lower));
    }, [benchList, benchSearch]);

    const { data: doc, isLoading: isLoadingDoc } = useQuery({
        queryKey: ['benchDoc', selectedBench],
        queryFn: () => getBenchDoc(selectedBench),
        enabled: !!selectedBench,
    });

    // Config-strategy run groups (baseline, resized (batch_size=X), ...) —
    // used to keep the performance-history chart from mixing runs with
    // different batch sizes/overrides into one misleading time series.
    const { data: configGroups } = useQuery<RunGroup[]>({
        queryKey: ['configGroups'],
        queryFn: () => getRunGroups('config'),
    });

    const baselineGroup = useMemo(
        () => configGroups?.find(g => g.label === 'baseline'),
        [configGroups],
    );

    const configGroupParam = searchParams.get('cg') || '';

    // undefined = not resolved yet (still waiting on configGroups to know
    // the baseline default); null = "All runs" (no group filter).
    const selectedGroupId: number | null | undefined = useMemo(() => {
        if (configGroupParam === 'all') return null;
        if (configGroupParam) return Number(configGroupParam);
        if (configGroups === undefined) return undefined;
        return baselineGroup ? baselineGroup._id : null;
    }, [configGroupParam, configGroups, baselineGroup]);

    const { data: historyData, isLoading: isLoadingHistory } = useQuery<HistoryRecord[]>({
        queryKey: ['benchHistory', selectedBench, metric, gpuFilter, selectedGroupId],
        queryFn: async () => {
            const params: Record<string, string> = { bench: selectedBench, metric };
            if (gpuFilter) params.gpu = gpuFilter;
            if (selectedGroupId != null) params.group_id = String(selectedGroupId);
            const response = await api.get('/bench/history', { params });
            return response.data;
        },
        enabled: !!selectedBench && selectedGroupId !== undefined,
    });

    const gpuList = useMemo(() => {
        if (!historyData) return [];
        return [...new Set(historyData.map(d => d.gpu))].filter(Boolean).sort();
    }, [historyData]);

    const { data: scalingData, isLoading: isLoadingScaling } = useQuery<LiveScalingPoint[]>({
        queryKey: ['benchDocScaling', selectedBench],
        queryFn: () => getScalingLive(undefined, [selectedBench]),
        enabled: !!selectedBench,
    });

    const scalingPoints = useMemo(() => scalingData ?? [], [scalingData]);
    const hasScalingData = scalingPoints.length > 0;

    const handleRefreshScaling = async () => {
        if (!selectedBench) return;
        setRefreshing(true);
        setRefreshMsg(null);
        try {
            const result = await refreshScalingLive([selectedBench]);
            setRefreshMsg(result.status === 'OK'
                ? `Wrote ${result.written} point(s) for ${selectedBench}`
                : `Error: ${result.message ?? 'refresh failed'}`);
            await queryClient.invalidateQueries({ queryKey: ['benchDocScaling', selectedBench] });
            await queryClient.invalidateQueries({ queryKey: ['benchDoc', selectedBench] });
        } catch (err) {
            setRefreshMsg(`Error: ${err}`);
        } finally {
            setRefreshing(false);
        }
    };

    const historySpecBuilder = useCallback((w: number, h: number) => buildBenchHistorySpec(
        historyData,
        {
            title: `${selectedBench} — ${METRICS.find(m => m.key === metric)?.label || metric} over time`,
            yLabel: METRICS.find(m => m.key === metric)?.label || metric,
            hideMinMax: true,
        },
        w,
        h,
    ), [historyData, selectedBench, metric]);

    const scalingSpecBuilder = useCallback((w: number, h: number) => {
        if (scalingPoints.length === 0) return null;
        const values = scalingPoints.map(d => ({ ...d, vendor: guessVendor(String(d.gpu ?? '')) }));
        const vendorScale = buildVendorColorScale(values.map(d => d.vendor));
        const { colorLegend, shapeLegend } = buildVendorGpuLegends();

        return {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            title: `${selectedBench} — batch size vs ${scalingY}`,
            // autosize "fit" treats width/height as the TOTAL chart size
            // (including axes/legend/title) and shrinks the plot area to
            // stay within it, instead of adding chrome on top of a
            // hand-guessed plot size — the previous fixed subtraction kept
            // rendering wider than the measured container.
            autosize: { type: 'fit', contains: 'padding' },
            width: Math.max(300, w - 16),
            height: Math.max(240, h - 16),
            data: { values },
            layer: [
                {
                    mark: { type: 'line', point: true, strokeWidth: 2 },
                    encoding: {
                        x: { field: 'batch_size', type: 'quantitative', title: 'Batch Size' },
                        y: { field: scalingY, type: 'quantitative', title: scalingY, scale: { zero: false } },
                        color: {
                            field: 'vendor', type: 'nominal', title: 'Vendor', scale: vendorScale,
                            legend: colorLegend,
                        },
                        detail: { field: 'gpu' },
                        shape: {
                            field: 'gpu', type: 'nominal', title: 'GPU',
                            legend: shapeLegend,
                        },
                        tooltip: [
                            { field: 'gpu', type: 'nominal', title: 'GPU' },
                            { field: 'batch_size', type: 'quantitative', title: 'Batch Size' },
                            { field: 'memory', type: 'quantitative', title: 'Memory (MiB)', format: '.0f' },
                            { field: 'perf', type: 'quantitative', title: 'Perf', format: '~s' },
                            { field: 'n_samples', type: 'quantitative', title: 'Samples' },
                        ],
                    },
                },
            ],
        } as Record<string, unknown>;
    }, [scalingPoints, selectedBench, scalingY]);

    return (
        <HStack h="100%" gap={0} align="stretch" bg="var(--color-bg-page)" overflow="hidden">
            {/* Benchmark list — full-height left panel */}
            <Box
                w="260px"
                minW="200px"
                flexShrink={0}
                borderRightWidth={1}
                borderColor="var(--color-border)"
                bg="var(--color-bg-card)"
                display="flex"
                flexDirection="column"
                h="100%"
            >
                <Box p={3} borderBottomWidth={1} borderColor="var(--color-border)" flexShrink={0}>
                    <Text fontSize="sm" fontWeight="semibold" mb={2} color="var(--color-text)">
                        Benchmarks ({filteredBenchList.length})
                    </Text>
                    <Input
                        size="sm"
                        placeholder="Filter..."
                        value={benchSearch}
                        onChange={(e) => setParam('q', e.target.value)}
                        bg="var(--color-input-bg)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                    />
                </Box>
                <VStack gap={0} align="stretch" overflowY="auto" flex={1}>
                    {filteredBenchList.map((bench) => (
                        <Box
                            key={bench}
                            px={3}
                            py={1.5}
                            cursor="pointer"
                            bg={bench === selectedBench ? 'var(--color-sidebar-active)' : 'transparent'}
                            _hover={{ bg: bench === selectedBench ? 'var(--color-sidebar-active)' : 'var(--color-bg-hover)' }}
                            onClick={() => setParam('bench', bench)}
                            transition="background 0.15s"
                        >
                            <Text fontSize="sm" color="var(--color-text)" fontWeight={bench === selectedBench ? 'bold' : 'normal'}>
                                {bench}
                            </Text>
                        </Box>
                    ))}
                    {filteredBenchList.length === 0 && (
                        <Box p={3}>
                            <Text fontSize="sm" color="var(--color-text-muted)">
                                {benchList ? 'No benchmarks match filter' : 'Loading...'}
                            </Text>
                        </Box>
                    )}
                </VStack>
            </Box>

            {/* Right side — doc header + tabs */}
            <Box flex={1} display="flex" flexDirection="column" h="100%" minW={0} p={4} overflowY="auto" overflowX="hidden">
                {!selectedBench ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                        <Text color="var(--color-text-muted)" fontSize="lg">
                            Select a benchmark from the list to view its documentation
                        </Text>
                    </Box>
                ) : (
                    <>
                        <HStack gap={2} mb={1} flexWrap="wrap" alignItems="center">
                            <Heading as="h1" size="lg" color="var(--color-text)">{selectedBench}</Heading>
                            <Badge colorPalette="purple">Experimental</Badge>
                        </HStack>
                        <Text fontSize="xs" color="var(--color-text-muted)" mb={4}>
                            Reference data computed from pushed run data — VRAM/scaling numbers come from the
                            scaling_observations_live cache, not the static sizing.yaml snapshots.
                        </Text>

                        {/* Doc card */}
                        <Box
                            borderWidth={1}
                            borderColor="var(--color-border)"
                            borderRadius="md"
                            bg="var(--color-bg-card)"
                            p={4}
                            mb={4}
                            flexShrink={0}
                        >
                            {isLoadingDoc ? (
                                <Text color="var(--color-text-muted)" fontSize="sm">Loading…</Text>
                            ) : (
                                <VStack align="stretch" gap={3}>
                                    <HStack gap={8} flexWrap="wrap" align="flex-start">
                                        <Box>
                                            <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" textTransform="uppercase">
                                                Disk Size Requirements
                                            </Text>
                                            <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">
                                                Not tracked yet
                                            </Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" textTransform="uppercase">
                                                VRAM (Minimum, bs≈10)
                                            </Text>
                                            {doc?.vram_min ? (
                                                <Text fontSize="sm" color="var(--color-text)">
                                                    {formatMib(doc.vram_min.memory)} on {doc.vram_min.gpu} (bs={doc.vram_min.batch_size})
                                                </Text>
                                            ) : (
                                                <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">
                                                    No cached memory data — try "Refresh from DB" below
                                                </Text>
                                            )}
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" textTransform="uppercase">
                                                Runtime (baseline, median)
                                            </Text>
                                            {doc?.runtime_median_seconds != null ? (
                                                <Text fontSize="sm" color="var(--color-text)">
                                                    {formatDuration(doc.runtime_median_seconds)}
                                                    {doc.runtime_samples > 0 && (
                                                        <Text as="span" color="var(--color-text-muted)"> ({doc.runtime_samples} samples)</Text>
                                                    )}
                                                </Text>
                                            ) : (
                                                <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">
                                                    No baseline runtime data
                                                </Text>
                                            )}
                                        </Box>
                                    </HStack>

                                    {doc && doc.vram.length > 1 && (
                                        <Box>
                                            <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" textTransform="uppercase" mb={1}>
                                                VRAM by GPU (closest cached point to bs=10)
                                            </Text>
                                            <HStack gap={2} flexWrap="wrap">
                                                {doc.vram.map(v => (
                                                    <Badge key={v.gpu} variant="outline" colorPalette="gray">
                                                        {v.gpu}: {formatMib(v.memory)} (bs={v.batch_size})
                                                    </Badge>
                                                ))}
                                            </HStack>
                                        </Box>
                                    )}

                                    <Separator borderColor="var(--color-border)" />

                                    <Box>
                                        <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" textTransform="uppercase" mb={1}>
                                            Sample Command
                                            {doc?.sample_gpu && (
                                                <Text as="span" fontWeight="normal" textTransform="none"> — from a run on {doc.sample_gpu}</Text>
                                            )}
                                        </Text>
                                        {doc?.sample_command ? (
                                            <Code
                                                display="block"
                                                whiteSpace="pre-wrap"
                                                wordBreak="break-all"
                                                p={2}
                                                fontSize="xs"
                                                bg="var(--color-bg-page)"
                                                color="var(--color-text)"
                                            >
                                                {doc.sample_command.join(' ')}
                                            </Code>
                                        ) : (
                                            <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">
                                                No recorded command found for this benchmark
                                            </Text>
                                        )}
                                    </Box>
                                </VStack>
                            )}
                        </Box>

                        {/* Bs → Scaling — on top */}
                        <Box flexShrink={0} height="440px" display="flex" flexDirection="column" mb={4}>
                            <HStack gap={2} mb={1} flexShrink={0}>
                                <Heading as="h2" size="sm" color="var(--color-text)">Bs → Scaling</Heading>
                            </HStack>
                            <HStack gap={4} mb={2} flexShrink={0} flexWrap="wrap" alignItems="flex-end">
                                <Field.Root flex="0 1 150px" minW="120px">
                                    <Field.Label color="var(--color-text)">Y Axis</Field.Label>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={scalingY}
                                            onChange={(e) => setParam('sy', e.target.value === 'perf' ? '' : e.target.value)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            <option value="perf">perf</option>
                                            <option value="memory">memory</option>
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                </Field.Root>
                                <Button
                                    size="sm"
                                    colorPalette="purple"
                                    onClick={handleRefreshScaling}
                                    disabled={refreshing}
                                    whiteSpace="nowrap"
                                >
                                    {refreshing ? 'Refreshing…' : 'Refresh from DB'}
                                </Button>
                                {refreshMsg && <Text fontSize="sm" color="var(--color-text-muted)">{refreshMsg}</Text>}
                            </HStack>

                            <Box flex="1" minH={0} borderWidth={1} borderColor="var(--color-border)" borderRadius="md">
                                {isLoadingScaling ? (
                                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                                        <Text color="var(--color-text-muted)">Loading scaling data...</Text>
                                    </Box>
                                ) : !hasScalingData ? (
                                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                                        <Text color="var(--color-text-muted)">
                                            No cached batch-size scaling data — click "Refresh from DB"
                                        </Text>
                                    </Box>
                                ) : (
                                    <VegaPlot ref={scalingPlotRef} spec={scalingSpecBuilder} height="100%" overflow="hidden" />
                                )}
                            </Box>
                        </Box>

                        <Separator borderColor="var(--color-border)" mb={4} />

                        {/* Performance History — on the bottom */}
                        <Box flexShrink={0} height="500px" display="flex" flexDirection="column">
                            <HStack gap={2} mb={1} flexShrink={0}>
                                <Heading as="h2" size="sm" color="var(--color-text)">Performance History</Heading>
                            </HStack>
                            <HStack gap={4} mb={2} flexShrink={0} flexWrap="wrap" alignItems="flex-end">
                                <Field.Root flex="0 1 200px" minW="160px">
                                    <Field.Label color="var(--color-text)">Run Group</Field.Label>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={configGroupParam || (selectedGroupId != null ? String(selectedGroupId) : 'all')}
                                            onChange={(e) => setParam('cg', e.target.value)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            <option value="all">All runs (mixed configs)</option>
                                            {configGroups?.map(g => (
                                                <option key={g._id} value={g._id}>
                                                    {g.label}{g.member_count != null ? ` (${g.member_count})` : ''}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                </Field.Root>

                                <Field.Root flex="0 1 180px" minW="140px">
                                    <Field.Label color="var(--color-text)">Metric</Field.Label>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={metric}
                                            onChange={(e) => setParam('metric', e.target.value === 'rate' ? '' : e.target.value)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                </Field.Root>

                                <Field.Root flex="0 1 180px" minW="140px">
                                    <Field.Label color="var(--color-text)">GPU Filter</Field.Label>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={gpuFilter}
                                            onChange={(e) => setParam('gpu', e.target.value)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            <option value="">All GPUs</option>
                                            {gpuList.map(gpu => <option key={gpu} value={gpu}>{gpu}</option>)}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                </Field.Root>
                            </HStack>
                            {configGroups !== undefined && !baselineGroup && !configGroupParam && (
                                <Text fontSize="xs" color="var(--color-text-muted)" mb={2} mt={-1}>
                                    No "baseline" run group found — showing all runs, which may mix different batch sizes.
                                </Text>
                            )}

                            <Box flex="1" minH={0} borderWidth={1} borderColor="var(--color-border)" borderRadius="md">
                                {isLoadingHistory ? (
                                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                                        <Text color="var(--color-text-muted)">Loading history data...</Text>
                                    </Box>
                                ) : !historyData || historyData.length === 0 ? (
                                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                                        <Text color="var(--color-text-muted)">No performance history found</Text>
                                    </Box>
                                ) : (
                                    <VegaPlot ref={historyPlotRef} spec={historySpecBuilder} height="100%" overflow="hidden" />
                                )}
                            </Box>
                        </Box>
                    </>
                )}
            </Box>
        </HStack>
    );
};

export default BenchmarkDocView;
