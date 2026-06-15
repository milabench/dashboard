import React, { useCallback, useMemo } from 'react';
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
    Checkbox,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot from '../charts/VegaPlot';

type MetricKey = 'rate' | 'memory' | 'gpu' | 'cpu' | 'perf';
type TimeWindow = 'all' | '1m' | '6m' | '1y' | '5y' | '10y';

const TIME_WINDOWS: { key: TimeWindow; label: string; months: number | null }[] = [
    { key: '1m',  label: '1 Month',  months: 1 },
    { key: '6m',  label: '6 Months', months: 6 },
    { key: '1y',  label: '1 Year',   months: 12 },
    { key: '5y',  label: '5 Years',  months: 60 },
    { key: '10y', label: '10 Years', months: 120 },
    { key: 'all', label: 'All Time', months: null },
];

const METRICS: { key: MetricKey; label: string }[] = [
    { key: 'rate', label: 'Rate (items/s)' },
    { key: 'perf', label: 'Perf' },
    { key: 'memory', label: 'Memory' },
    { key: 'gpu', label: 'GPU Utilization' },
    { key: 'cpu', label: 'CPU Utilization' },
];

interface HistoryRecord {
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

export const BenchmarkHistoryView: React.FC = () => {
    usePageTitle('Benchmark History');

    const [searchParams, setSearchParams] = useSearchParams();

    const selectedBench = searchParams.get('bench') || '';
    const metric = (searchParams.get('metric') || 'rate') as MetricKey;
    const gpuFilter = searchParams.get('gpu') || '';
    const benchSearch = searchParams.get('q') || '';
    const timeWindow = (searchParams.get('tw') || 'all') as TimeWindow;
    const trimMinMax = searchParams.get('trim') === '1';
    const hideMinMax = searchParams.get('hidewhiskers') === '1';

    const setParam = useCallback((key: string, value: string) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (value) next.set(key, value);
            else next.delete(key);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    const setSelectedBench = (v: string) => setParam('bench', v);
    const setMetric = (v: MetricKey) => setParam('metric', v === 'rate' ? '' : v);
    const setGpuFilter = (v: string) => setParam('gpu', v);
    const setBenchSearch = (v: string) => setParam('q', v);
    const setTimeWindow = (v: TimeWindow) => setParam('tw', v === 'all' ? '' : v);
    const setTrimMinMax = (v: boolean) => setParam('trim', v ? '1' : '');
    const setHideMinMax = (v: boolean) => setParam('hidewhiskers', v ? '1' : '');

    const { data: benchList } = useQuery<string[]>({
        queryKey: ['benchList'],
        queryFn: async () => {
            const response = await api.get('/bench/list');
            return response.data;
        },
    });

    const { data: historyData, isLoading: isLoadingHistory } = useQuery<HistoryRecord[]>({
        queryKey: ['benchHistory', selectedBench, metric, gpuFilter, trimMinMax],
        queryFn: async () => {
            const params: Record<string, string> = {
                bench: selectedBench,
                metric,
            };
            if (gpuFilter) params.gpu = gpuFilter;
            if (trimMinMax) params.trim = '1';
            const response = await api.get('/bench/history', { params });
            return response.data;
        },
        enabled: !!selectedBench,
    });

    const filteredHistoryData = useMemo(() => {
        if (!historyData) return undefined;
        const tw = TIME_WINDOWS.find(t => t.key === timeWindow);
        if (!tw || tw.months === null) return historyData;

        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - tw.months);
        return historyData.filter(d => new Date(d.created_time) >= cutoff);
    }, [historyData, timeWindow]);

    const gpuList = useMemo(() => {
        if (!filteredHistoryData) return [];
        const gpus = new Set(filteredHistoryData.map(d => d.gpu));
        return [...gpus].filter(Boolean).sort();
    }, [filteredHistoryData]);

    const filteredBenchList = useMemo(() => {
        if (!benchList) return [];
        if (!benchSearch) return benchList;
        const lower = benchSearch.toLowerCase();
        return benchList.filter(b => b.toLowerCase().includes(lower));
    }, [benchList, benchSearch]);

    const specBuilder = useCallback((w: number, h: number) => {
        if (!filteredHistoryData || filteredHistoryData.length === 0) return null;

        const chartWidth = Math.max(400, w - 350);
        const chartHeight = Math.max(300, h - 200);

        // Spread overlapping points: when multiple executions fall on the
        // same calendar day for the same GPU, shift them onto consecutive
        // days so candlesticks don't overlap.
        const DAY_MS = 24 * 3600_000;
        const buckets = new Map<string, HistoryRecord[]>();
        for (const d of filteredHistoryData) {
            const day = d.created_time.slice(0, 10);
            const key = `${day}__${d.gpu}`;
            let arr = buckets.get(key);
            if (!arr) { arr = []; buckets.set(key, arr); }
            arr.push(d);
        }

        const values = filteredHistoryData.map(d => {
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
            return { ...d, date, exec_label: `#${d.exec_id}` };
        });

        return {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values },
            title: `${selectedBench} — ${METRICS.find(m => m.key === metric)?.label || metric} over time`,
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
                    title: METRICS.find(m => m.key === metric)?.label || metric,
                },
                color: {
                    field: 'gpu',
                    type: 'nominal',
                    title: 'GPU',
                    legend: { orient: 'right', direction: 'vertical', labelLimit: 400, titleLimit: 200, columns: 1, padding: 20, labelFontSize: 12, symbolSize: 120 },
                },
            },
            layer: [
                ...(!hideMinMax ? [{
                    mark: {
                        type: 'rule' as const,
                        strokeWidth: 1,
                    },
                    encoding: {
                        y: { field: 'min' },
                        y2: { field: 'max' },
                        tooltip: [
                            { field: 'gpu', type: 'nominal' as const, title: 'GPU' },
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
                        opacity: 0.7,
                    },
                    encoding: {
                        y: { field: 'q25' },
                        y2: { field: 'q75' },
                        tooltip: [
                            { field: 'gpu', type: 'nominal', title: 'GPU' },
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
                        color: 'white',
                    },
                    encoding: {
                        y: { field: 'median' },
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
                        size: 30,
                        filled: true,
                        shape: 'diamond',
                    },
                    encoding: {
                        y: { field: 'mean' },
                        tooltip: [
                            { field: 'gpu', type: 'nominal', title: 'GPU' },
                            { field: 'exec_label', type: 'nominal', title: 'Exec ID' },
                            { field: 'mean', type: 'quantitative', title: 'Mean', format: '.2f' },
                        ],
                    },
                },
            ],
        } as Record<string, any>;
    }, [filteredHistoryData, selectedBench, metric, hideMinMax]);

    const hasData = filteredHistoryData && filteredHistoryData.length > 0;

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
                        onChange={(e) => setBenchSearch(e.target.value)}
                        bg="var(--color-input-bg)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                    />
                </Box>
                <VStack
                    gap={0}
                    align="stretch"
                    overflowY="auto"
                    flex={1}
                >
                    {filteredBenchList.map((bench) => (
                        <Box
                            key={bench}
                            px={3}
                            py={1.5}
                            cursor="pointer"
                            bg={bench === selectedBench ? 'var(--color-sidebar-active)' : 'transparent'}
                            _hover={{ bg: bench === selectedBench ? 'var(--color-sidebar-active)' : 'var(--color-bg-hover)' }}
                            onClick={() => setSelectedBench(bench)}
                            transition="background 0.15s"
                        >
                            <Text
                                fontSize="sm"
                                color="var(--color-text)"
                                fontWeight={bench === selectedBench ? 'bold' : 'normal'}
                            >
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

            {/* Right side — controls + chart */}
            <Box flex={1} display="flex" flexDirection="column" h="100%" minW={0} p={4} overflow="hidden">
                {/* Header + controls */}
                <HStack gap={4} mb={3} flexShrink={0} flexWrap="wrap" alignItems="flex-end">
                    <Heading as="h1" size="lg" color="var(--color-text)">
                        Benchmark History
                    </Heading>

                    <Field.Root flex="0 1 180px" minW="140px">
                        <Field.Label color="var(--color-text)">Metric</Field.Label>
                        <NativeSelect.Root>
                            <NativeSelect.Field
                                value={metric}
                                onChange={(e) => setMetric(e.target.value as MetricKey)}
                                bg="var(--color-bg-card)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            >
                                {METRICS.map(m => (
                                    <option key={m.key} value={m.key}>{m.label}</option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                    </Field.Root>

                    <Field.Root flex="0 1 180px" minW="140px">
                        <Field.Label color="var(--color-text)">GPU Filter</Field.Label>
                        <NativeSelect.Root>
                            <NativeSelect.Field
                                value={gpuFilter}
                                onChange={(e) => setGpuFilter(e.target.value)}
                                bg="var(--color-bg-card)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            >
                                <option value="">All GPUs</option>
                                {gpuList.map(gpu => (
                                    <option key={gpu} value={gpu}>{gpu}</option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                    </Field.Root>

                    <Field.Root flex="0 1 150px" minW="120px">
                        <Field.Label color="var(--color-text)">Time Window</Field.Label>
                        <NativeSelect.Root>
                            <NativeSelect.Field
                                value={timeWindow}
                                onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
                                bg="var(--color-bg-card)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            >
                                {TIME_WINDOWS.map(tw => (
                                    <option key={tw.key} value={tw.key}>{tw.label}</option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                    </Field.Root>

                    <Checkbox.Root
                        checked={trimMinMax}
                        onCheckedChange={(e) => setTrimMinMax(!!e.checked)}
                        alignSelf="flex-end"
                        mb={1}
                    >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                        <Checkbox.Label color="var(--color-text)" fontSize="sm" whiteSpace="nowrap">Trim Outliers</Checkbox.Label>
                    </Checkbox.Root>

                    <Checkbox.Root
                        checked={hideMinMax}
                        onCheckedChange={(e) => setHideMinMax(!!e.checked)}
                        alignSelf="flex-end"
                        mb={1}
                    >
                        <Checkbox.HiddenInput />
                        <Checkbox.Control />
                        <Checkbox.Label color="var(--color-text)" fontSize="sm" whiteSpace="nowrap">Hide Whiskers</Checkbox.Label>
                    </Checkbox.Root>

                    {selectedBench && (
                        <HStack gap={2} flexWrap="wrap">
                            <Badge colorPalette="blue" fontSize="sm">{selectedBench}</Badge>
                            {hasData && (
                                <Badge colorPalette="green" fontSize="sm">
                                    {filteredHistoryData.length} run{filteredHistoryData.length !== 1 ? 's' : ''}
                                </Badge>
                            )}
                            {hasData && (
                                <Badge colorPalette="purple" fontSize="sm">
                                    {new Set(filteredHistoryData.map(d => d.gpu)).size} GPU type{new Set(filteredHistoryData.map(d => d.gpu)).size !== 1 ? 's' : ''}
                                </Badge>
                            )}
                        </HStack>
                    )}
                </HStack>

                <Text fontSize="xs" color="var(--color-text-muted)" mb={2} flexShrink={0}>
                    Each candle shows: whiskers = min/max, box = Q25/Q75, line = median, diamond = mean
                </Text>

                {/* Chart area — fills remaining space */}
                <Box flex="1" minH={0}>
                    {!selectedBench ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                            <Text color="var(--color-text-muted)" fontSize="lg">
                                Select a benchmark from the list to view its performance history
                            </Text>
                        </Box>
                    ) : isLoadingHistory ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                            <Text color="var(--color-text-muted)">Loading history data...</Text>
                        </Box>
                    ) : !hasData ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%" flexDirection="column" gap={2}>
                            <Text color="var(--color-text-muted)" fontSize="lg">No data available</Text>
                            <Text color="var(--color-text-muted)" fontSize="sm">
                                No {METRICS.find(m => m.key === metric)?.label || metric} data found for "{selectedBench}"
                                {gpuFilter ? ` on ${gpuFilter}` : ''}
                            </Text>
                        </Box>
                    ) : (
                        <VegaPlot
                            spec={specBuilder}
                            height="100%"
                        />
                    )}
                </Box>
            </Box>
        </HStack>
    );
};

export default BenchmarkHistoryView;
