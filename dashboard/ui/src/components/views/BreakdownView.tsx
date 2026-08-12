import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Box,
    Text,
    HStack,
    Spinner,
    Badge,
    SimpleGrid,
    Table,
    Button,
    Dialog,
    Field,
    NativeSelect,
    VStack,
    chakra,
    useDisclosure,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Cookies from 'js-cookie';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot from '../charts/VegaPlot';
import { useColorMode } from '../ui/color-mode';
import { buildGpuColorScale, cssColor, guessVendor } from '../../utils/gpuColors';
import {
    buildBreakdownSearchParams,
    breakdownSelectionUrlKey,
    breakdownPerfAggLabel,
    BREAKDOWN_PERF_AGG_OPTIONS,
    DEFAULT_BREAKDOWN_PERF_AGG,
    hasBreakdownUrlConfig,
    parseBreakdownFromSearchParams,
    type BreakdownPerfAgg,
    type BreakdownSelection,
} from '../../utils/breakdownUrlParams';
import {
    getBreakdownMatrix,
    getBreakdownScores,
    getBreakdownWorkloads,
    type BreakdownGpuScore,
    type BreakdownWorkload,
} from '../../services/api';

type GroupKey = 'group1' | 'group2' | 'group3' | 'group4';

/** Non-empty group label, or null when unset (excluded from dropdowns). */
function groupLabel(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function stripQuotes(value: string | null | undefined): string {
    if (!value || value === 'null') return '';
    return value.replace(/^"|"$/g, '');
}

function formatScore(score: number): string {
    return score.toFixed(2);
}

const REPORT_COL_MIN = '360px';

const numericCellStyle = {
    fontVariantNumeric: 'tabular-nums',
} as const;

function uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/** Benchmarks shown in the drawer (scoring profile, non-zero weight). */
function drawerWorkloads(workloads: BreakdownWorkload[]): BreakdownWorkload[] {
    return workloads.filter((w) => w.enabled && w.weight > 0);
}

function filterWorkloads(
    workloads: BreakdownWorkload[],
    g1: string[],
    g2: string[],
    g3: string[],
    g4: string[],
): BreakdownWorkload[] {
    return workloads.filter((w) => {
        if (g1.length) {
            const v = groupLabel(w.group1);
            if (!v || !g1.includes(v)) return false;
        }
        if (g2.length) {
            const v = groupLabel(w.group2);
            if (!v || !g2.includes(v)) return false;
        }
        if (g3.length) {
            const v = groupLabel(w.group3);
            if (!v || !g3.includes(v)) return false;
        }
        if (g4.length) {
            const v = groupLabel(w.group4);
            if (!v || !g4.includes(v)) return false;
        }
        return true;
    });
}

function effectivePacks(
    workloads: BreakdownWorkload[],
    g1: string[],
    g2: string[],
    g3: string[],
    g4: string[],
): string[] {
    return filterWorkloads(workloads, g1, g2, g3, g4).map((w) => w.pack);
}

function groupOptions(workloads: BreakdownWorkload[], key: GroupKey): string[] {
    const values = workloads
        .map((w) => groupLabel(w[key]))
        .filter((v): v is string => v !== null);
    return uniqueSorted(values);
}

function cascadeChildSelections(
    items: BreakdownWorkload[],
    g1: string[],
): { g2: string[]; g3: string[]; g4: string[] } {
    const g2 = groupOptions(filterWorkloads(items, g1, [], [], []), 'group2');
    const g3 = groupOptions(filterWorkloads(items, g1, g2, [], []), 'group3');
    const g4 = groupOptions(filterWorkloads(items, g1, g2, g3, []), 'group4');
    return { g2, g3, g4 };
}

function pruneToAllowed(selected: string[], allowed: Set<string>): string[] {
    return selected.filter((v) => allowed.has(v));
}

function validateBreakdownSelection(
    items: BreakdownWorkload[],
    selection: BreakdownSelection,
): BreakdownSelection {
    const g1 = pruneToAllowed(selection.g1, new Set(groupOptions(items, 'group1')));
    const g2 = pruneToAllowed(
        selection.g2,
        new Set(groupOptions(filterWorkloads(items, g1, [], [], []), 'group2')),
    );
    const g3 = pruneToAllowed(
        selection.g3,
        new Set(groupOptions(filterWorkloads(items, g1, g2, [], []), 'group3')),
    );
    const g4 = pruneToAllowed(
        selection.g4,
        new Set(groupOptions(filterWorkloads(items, g1, g2, g3, []), 'group4')),
    );
    const packAllow = new Set(items.map((w) => w.pack));
    const benches = selection.benches.length
        ? pruneToAllowed(selection.benches, packAllow)
        : effectivePacks(items, g1, g2, g3, g4);
    return {
        g1,
        g2,
        g3,
        g4,
        benches,
        perfAgg: selection.perfAgg,
    };
}

function defaultBreakdownSelection(items: BreakdownWorkload[]): BreakdownSelection {
    const g1 = groupOptions(items, 'group1');
    const { g2, g3, g4 } = cascadeChildSelections(items, g1);
    return {
        g1,
        g2,
        g3,
        g4,
        benches: effectivePacks(items, g1, g2, g3, g4),
        perfAgg: DEFAULT_BREAKDOWN_PERF_AGG,
    };
}

function applyBreakdownSelection(
    selection: BreakdownSelection,
    setters: {
        setG1: (v: string[]) => void;
        setG2: (v: string[]) => void;
        setG3: (v: string[]) => void;
        setG4: (v: string[]) => void;
        setPacks: (v: string[]) => void;
        setPerfAgg: (v: BreakdownPerfAgg) => void;
    },
): void {
    setters.setG1(selection.g1);
    setters.setG2(selection.g2);
    setters.setG3(selection.g3);
    setters.setG4(selection.g4);
    setters.setPacks(selection.benches);
    setters.setPerfAgg(selection.perfAgg);
}

interface CascadeSelectProps {
    label: string;
    options: string[];
    value: string[];
    onChange: (next: string[]) => void;
    size?: number;
    hint?: string;
}

const CascadeSelect: React.FC<CascadeSelectProps> = ({
    label,
    options,
    value,
    onChange,
    size = 10,
    hint,
}) => (
    <Box flex={1} minW={0}>
        <HStack justify="space-between" mb={1}>
            <Text fontSize="sm" fontWeight="semibold">
                {label}
            </Text>
            {value.length > 0 && (
                <Badge size="sm" colorPalette="blue">
                    {value.length}
                </Badge>
            )}
        </HStack>
        {hint && (
            <Text fontSize="xs" color="fg.muted" mb={1}>
                {hint}
            </Text>
        )}
        <chakra.select
            multiple
            size={size}
            w="100%"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const next = Array.from(e.target.selectedOptions).map((o) => o.value);
                onChange(next);
            }}
            borderWidth="1px"
            borderColor="var(--color-border)"
            borderRadius="md"
            bg="var(--color-bg-card)"
            color="var(--color-text)"
            fontSize="sm"
            p={1}
            _focusVisible={{
                outline: '2px solid',
                outlineColor: 'var(--color-primary)',
                outlineOffset: '1px',
            }}
        >
            {options.map((opt) => (
                <option key={opt} value={opt}>
                    {opt}
                </option>
            ))}
        </chakra.select>
        <Text fontSize="xs" color="fg.muted" mt={1}>
            Ctrl/Cmd+click to multi-select
        </Text>
    </Box>
);

const SelectedBenchmarksPanel: React.FC<{
    options: string[];
    value: string[];
    onChange: (next: string[]) => void;
    size?: number;
}> = ({ options, value, onChange, size = 10 }) => (
    <CascadeSelect
        label="Benchmarks"
        options={options}
        value={value}
        onChange={onChange}
        size={size}
        hint="Group filters update this list; edit directly anytime"
    />
);

export const BreakdownView: React.FC = () => {
    usePageTitle('Breakdown');
    const { colorMode } = useColorMode();
    const profile = Cookies.get('scoreProfile') || 'default';
    const [searchParams, setSearchParams] = useSearchParams();
    const lastUrlKeyRef = useRef('');

    const { data: workloads, isLoading: loadingWorkloads } = useQuery({
        queryKey: ['breakdownWorkloads', profile],
        queryFn: getBreakdownWorkloads,
    });

    const items = drawerWorkloads(workloads ?? []);

    const [selectedG1, setSelectedG1] = useState<string[]>([]);
    const [selectedG2, setSelectedG2] = useState<string[]>([]);
    const [selectedG3, setSelectedG3] = useState<string[]>([]);
    const [selectedG4, setSelectedG4] = useState<string[]>([]);
    const [selectedPacks, setSelectedPacks] = useState<string[]>([]);
    const [perfAgg, setPerfAgg] = useState<BreakdownPerfAgg>(DEFAULT_BREAKDOWN_PERF_AGG);
    const [draftPerfAgg, setDraftPerfAgg] = useState<BreakdownPerfAgg>(DEFAULT_BREAKDOWN_PERF_AGG);
    const [initialized, setInitialized] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const { open: advancedOpen, onOpen: onAdvancedOpen, onClose: onAdvancedClose, setOpen: setAdvancedOpen } =
        useDisclosure();

    const selectionSetters = useMemo(
        () => ({
            setG1: setSelectedG1,
            setG2: setSelectedG2,
            setG3: setSelectedG3,
            setG4: setSelectedG4,
            setPacks: setSelectedPacks,
            setPerfAgg,
        }),
        [],
    );

    const packsFromGroups = useCallback(
        (g1: string[], g2: string[], g3: string[], g4: string[]) =>
            effectivePacks(items, g1, g2, g3, g4),
        [items],
    );

    const syncSelectionToUrl = useCallback(
        (selection: BreakdownSelection) => {
            const urlKey = breakdownSelectionUrlKey(selection);
            if (urlKey === lastUrlKeyRef.current) return;
            lastUrlKeyRef.current = urlKey;
            setSearchParams(buildBreakdownSearchParams(selection), { replace: true });
        },
        [setSearchParams],
    );

    React.useEffect(() => {
        if (!items.length || initialized) return;
        const fromUrl = hasBreakdownUrlConfig(searchParams)
            ? validateBreakdownSelection(items, parseBreakdownFromSearchParams(searchParams))
            : defaultBreakdownSelection(items);
        applyBreakdownSelection(fromUrl, selectionSetters);
        lastUrlKeyRef.current = breakdownSelectionUrlKey(fromUrl);
        setInitialized(true);
    }, [items, initialized, searchParams, selectionSetters]);

    React.useEffect(() => {
        if (!initialized) return;
        syncSelectionToUrl({
            g1: selectedG1,
            g2: selectedG2,
            g3: selectedG3,
            g4: selectedG4,
            benches: selectedPacks,
            perfAgg,
        });
    }, [
        initialized,
        selectedG1,
        selectedG2,
        selectedG3,
        selectedG4,
        selectedPacks,
        perfAgg,
        syncSelectionToUrl,
    ]);

    React.useEffect(() => {
        if (!items.length || !initialized) return;
        const fromUrl = validateBreakdownSelection(items, parseBreakdownFromSearchParams(searchParams));
        const urlKey = breakdownSelectionUrlKey(fromUrl);
        if (urlKey === lastUrlKeyRef.current) return;
        lastUrlKeyRef.current = urlKey;
        applyBreakdownSelection(fromUrl, selectionSetters);
    }, [searchParams, items, initialized, selectionSetters]);

    const g1Options = useMemo(() => groupOptions(items, 'group1'), [items]);

    const g2Options = useMemo(() => {
        const pool = filterWorkloads(items, selectedG1, [], [], []);
        return groupOptions(pool, 'group2');
    }, [items, selectedG1]);

    const g3Options = useMemo(() => {
        const pool = filterWorkloads(items, selectedG1, selectedG2, [], []);
        return groupOptions(pool, 'group3');
    }, [items, selectedG1, selectedG2]);

    const g4Options = useMemo(() => {
        const pool = filterWorkloads(items, selectedG1, selectedG2, selectedG3, []);
        return groupOptions(pool, 'group4');
    }, [items, selectedG1, selectedG2, selectedG3]);

    const benchOptions = useMemo(
        () => items.map((w) => w.pack).sort((a, b) => a.localeCompare(b)),
        [items],
    );

    const onG1Change = useCallback(
        (g1: string[]) => {
            setSelectedG1(g1);
            if (!g1.length) {
                setSelectedG2([]);
                setSelectedG3([]);
                setSelectedG4([]);
                setSelectedPacks([]);
                return;
            }
            const { g2, g3, g4 } = cascadeChildSelections(items, g1);
            setSelectedG2(g2);
            setSelectedG3(g3);
            setSelectedG4(g4);
            setSelectedPacks(packsFromGroups(g1, g2, g3, g4));
        },
        [items, packsFromGroups],
    );

    const onG2Change = useCallback(
        (g2: string[]) => {
            setSelectedG2(g2);
            if (!g2.length) {
                setSelectedG3([]);
                setSelectedG4([]);
                setSelectedPacks([]);
                return;
            }
            const g3 = groupOptions(filterWorkloads(items, selectedG1, g2, [], []), 'group3');
            const g4 = groupOptions(filterWorkloads(items, selectedG1, g2, g3, []), 'group4');
            setSelectedG3(g3);
            setSelectedG4(g4);
            setSelectedPacks(packsFromGroups(selectedG1, g2, g3, g4));
        },
        [items, selectedG1, packsFromGroups],
    );

    const onG3Change = useCallback(
        (g3: string[]) => {
            setSelectedG3(g3);
            if (!g3.length) {
                setSelectedG4([]);
                setSelectedPacks([]);
                return;
            }
            const g4 = groupOptions(filterWorkloads(items, selectedG1, selectedG2, g3, []), 'group4');
            setSelectedG4(g4);
            setSelectedPacks(packsFromGroups(selectedG1, selectedG2, g3, g4));
        },
        [items, selectedG1, selectedG2, packsFromGroups],
    );

    const onG4Change = useCallback(
        (g4: string[]) => {
            setSelectedG4(g4);
            setSelectedPacks(packsFromGroups(selectedG1, selectedG2, selectedG3, g4));
        },
        [selectedG1, selectedG2, selectedG3, packsFromGroups],
    );

    const packsParam = useMemo(
        () => (selectedPacks.length ? [...selectedPacks].sort() : []),
        [selectedPacks],
    );

    const { data: scores, isLoading: loadingScores, isFetching: fetchingScores } = useQuery({
        queryKey: ['breakdownScores', profile, packsParam.join(','), perfAgg],
        queryFn: () => getBreakdownScores(packsParam, perfAgg),
        enabled: initialized && packsParam.length > 0,
    });

    const {
        data: matrix,
        isLoading: loadingMatrix,
        isFetching: fetchingMatrix,
    } = useQuery({
        queryKey: ['breakdownMatrix', profile, packsParam.join(','), perfAgg],
        queryFn: () => getBreakdownMatrix(packsParam, perfAgg),
        enabled: initialized && showReport && packsParam.length > 0,
    });

    const openAdvancedModal = useCallback(() => {
        setDraftPerfAgg(perfAgg);
        onAdvancedOpen();
    }, [onAdvancedOpen, perfAgg]);

    const applyAdvancedOptions = useCallback(() => {
        setPerfAgg(draftPerfAgg);
        onAdvancedClose();
    }, [draftPerfAgg, onAdvancedClose]);

    const plotData = useMemo(() => {
        return (scores ?? []).map((row: BreakdownGpuScore) => {
            const gpu = stripQuotes(row.gpu);
            return {
                ...row,
                gpu,
                pytorch: stripQuotes(row.pytorch),
                accel_version: stripQuotes(row.accel_version),
                vendor: guessVendor(gpu),
            };
        });
    }, [scores]);

    const gpuColorScale = useMemo(
        () => buildGpuColorScale(plotData.map((d) => d.gpu)),
        [plotData],
    );

    const chartPlotHeightPx = useMemo(() => {
        if (!selectedPacks.length || !plotData.length) return 120;
        return Math.max(120, plotData.length * 30 + 56);
    }, [plotData.length, selectedPacks.length]);

    // Spec padding (top 20 + bottom 44) plus a little room for axis labels.
    const chartHeightPx = chartPlotHeightPx + 64;

    const specBuilder = useCallback(
        (width: number) => {
            if (!plotData.length) return null;
            return {
                $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
                padding: { left: 46, top: 20, right: 12, bottom: 44 },
                width: Math.max(width - 48, 200),
                height: chartPlotHeightPx,
                data: { values: plotData },
                mark: { type: 'bar', tooltip: true, cornerRadiusEnd: 3 },
                encoding: {
                    y: {
                        field: 'gpu',
                        type: 'nominal',
                        sort: { field: 'score', order: 'descending' },
                        title: 'GPU',
                        scale: { paddingInner: 0.2, paddingOuter: 0.35 },
                        axis: {
                            labelLimit: 0,
                            labelAlign: 'right',
                            labelPadding: 4,
                        },
                    },
                    x: {
                        field: 'score',
                        type: 'quantitative',
                        title: 'Weighted score',
                        scale: { zero: true },
                        axis: { 
                            format: '~s',
                            tickCount: 10
                        },
                    },
                    color: {
                        field: 'gpu',
                        type: 'nominal',
                        scale: gpuColorScale,
                        legend: null,
                    },
                    tooltip: [
                        { field: 'gpu', title: 'GPU' },
                        { field: 'score', title: 'Score', format: '.3s' },
                        { field: 'bench_count', title: 'Benchmarks' },
                        { field: 'pytorch', title: 'PyTorch' },
                        { field: 'accel_version', title: 'CUDA / ROCm' },
                        { field: 'run_name', title: 'Run' },
                    ],
                },
                config: {
                    view: { stroke: 'transparent' },
                    axis: {
                        gridColor: cssColor('--color-border', colorMode),
                        domainColor: cssColor('--color-border', colorMode),
                        labelColor: cssColor('--color-text-muted', colorMode),
                        titleColor: cssColor('--color-text', colorMode),
                    },
                },
            };
        },
        [plotData, gpuColorScale, colorMode, chartPlotHeightPx],
    );

    if (loadingWorkloads) {
        return (
            <Box p={8} textAlign="center">
                <Spinner size="xl" />
            </Box>
        );
    }

    return (
        <Box
            p={6}
            h="100%"
            minH="0"
            display="flex"
            flexDirection="column"
            overflowY="auto"
        >
            <Box flexShrink={0}>
                <HStack justify="space-between" align="start" mb={1}>
                    <Text fontSize="2xl" fontWeight="bold">
                        Breakdown
                    </Text>
                    <HStack gap={2}>
                        <Button
                            size="sm"
                            variant={showReport ? 'solid' : 'outline'}
                            colorPalette={showReport ? 'blue' : undefined}
                            onClick={() => setShowReport((open) => !open)}
                            disabled={!selectedPacks.length}
                        >
                            Report
                        </Button>
                        <Button size="sm" variant="outline" onClick={openAdvancedModal}>
                            Advanced
                        </Button>
                    </HStack>
                </HStack>
                <Text color="fg.muted" mb={4}>
                    Score per GPU (latest run) — weighted geomean — profile{' '}
                    <Badge colorPalette="blue">{profile}</Badge>
                    {' · '}
                    <Badge colorPalette="gray">{breakdownPerfAggLabel(perfAgg)} perf</Badge>
                    {' · '}
                    <Text as="span" fontSize="sm">
                        {selectedPacks.length} benchmark{selectedPacks.length === 1 ? '' : 's'} selected
                    </Text>
                </Text>
            </Box>

            <Box
                flexShrink={0}
                borderWidth="1px"
                borderRadius="md"
                borderColor="var(--color-border)"
                bg="var(--color-bg-stripe)"
                p={4}
                mb={4}
            >
                {loadingScores || fetchingScores ? (
                    <HStack justify="center" minH="200px">
                        <Spinner />
                        <Text color="fg.muted">Computing scores…</Text>
                    </HStack>
                ) : !selectedPacks.length ? (
                    <Text color="fg.muted" textAlign="center" minH="200px" pt={16}>
                        Select at least one benchmark below.
                    </Text>
                ) : !plotData.length ? (
                    <Text color="fg.muted" textAlign="center" minH="200px" pt={16}>
                        No GPU scores for this selection.
                    </Text>
                ) : (
                    <Box
                        display="grid"
                        gridTemplateColumns={{
                            base: '1fr',
                            xl: showReport ? `minmax(0, 1fr) minmax(${REPORT_COL_MIN}, 1fr)` : '1fr',
                        }}
                        gap={4}
                        alignItems="start"
                        w="100%"
                    >
                        <Box minW={0}>
                            <VegaPlot spec={specBuilder} height={`${chartHeightPx}px`} />
                        </Box>
                        {showReport ? (
                            <Box
                                w="100%"
                                minW={0}
                                flexShrink={0}
                                borderLeftWidth={{ base: 0, xl: '1px' }}
                                borderColor="var(--color-border)"
                                pl={{ base: 0, xl: 4 }}
                                pt={{ base: 4, xl: 0 }}
                                borderTopWidth={{ base: '1px', xl: 0 }}
                            >
                                <Text fontSize="xs" color="fg.muted" mb={2}>
                                    Per-benchmark scores · total = weighted geomean (
                                    {breakdownPerfAggLabel(perfAgg)} perf)
                                </Text>
                                {loadingMatrix || fetchingMatrix ? (
                                    <HStack justify="center" minH={`${chartHeightPx}px`}>
                                        <Spinner size="sm" />
                                        <Text color="fg.muted" fontSize="sm">
                                            Loading report…
                                        </Text>
                                    </HStack>
                                ) : !matrix?.gpus.length ? (
                                    <Text color="fg.muted" fontSize="sm" minH={`${chartHeightPx}px`} pt={8}>
                                        No GPU scores for this selection.
                                    </Text>
                                ) : (
                                    <Box overflowX="auto" w="100%">
                                        <Table.Root
                                            variant="line"
                                            size="sm"
                                            css={{
                                                backgroundColor: 'transparent',
                                                '& thead, & tbody, & tr, & th, & td': {
                                                    backgroundColor: 'transparent',
                                                },
                                                '& thead th': {
                                                    fontWeight: 'bold',
                                                },
                                                '& tbody td:first-of-type': {
                                                    fontWeight: 'bold',
                                                },
                                                '& tbody tr:hover td': {
                                                    backgroundColor: 'var(--color-bg-hover)',
                                                },
                                            }}
                                        >
                                            <Table.Header>
                                                <Table.Row>
                                                    <Table.ColumnHeader
                                                        fontSize="xs"
                                                        px={2}
                                                        py={2}
                                                        minW="10rem"
                                                    >
                                                        Benchmark
                                                    </Table.ColumnHeader>
                                                    <Table.ColumnHeader
                                                        fontSize="xs"
                                                        px={2}
                                                        py={2}
                                                        textAlign="right"
                                                        w="4.5rem"
                                                    >
                                                        Weight
                                                    </Table.ColumnHeader>
                                                    {matrix.gpus.map((gpuCol) => (
                                                        <Table.ColumnHeader
                                                            key={gpuCol.key}
                                                            fontSize="xs"
                                                            px={2}
                                                            py={2}
                                                            textAlign="right"
                                                            minW="5rem"
                                                            title={`exec ${gpuCol.exec_id}`}
                                                        >
                                                            {gpuCol.gpu}
                                                        </Table.ColumnHeader>
                                                    ))}
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {matrix.benches.map((benchRow) => (
                                                    <Table.Row key={benchRow.bench}>
                                                        <Table.Cell
                                                            fontSize="xs"
                                                            px={2}
                                                            py={2}
                                                            title={benchRow.bench}
                                                            maxW="16rem"
                                                            truncate
                                                        >
                                                            {benchRow.bench}
                                                        </Table.Cell>
                                                        <Table.Cell
                                                            fontSize="xs"
                                                            px={2}
                                                            py={2}
                                                            textAlign="right"
                                                            fontFamily="mono"
                                                            color="fg.muted"
                                                            css={numericCellStyle}
                                                        >
                                                            {benchRow.weight}
                                                        </Table.Cell>
                                                        {matrix.gpus.map((gpuCol) => {
                                                            const score = benchRow.scores[gpuCol.key];
                                                            return (
                                                                <Table.Cell
                                                                    key={gpuCol.key}
                                                                    fontSize="xs"
                                                                    px={2}
                                                                    py={2}
                                                                    textAlign="right"
                                                                    fontFamily="mono"
                                                                    css={numericCellStyle}
                                                                >
                                                                    {score != null ? formatScore(score) : '—'}
                                                                </Table.Cell>
                                                            );
                                                        })}
                                                    </Table.Row>
                                                ))}
                                                <Table.Row css={{ borderTop: '2px solid var(--color-border)' }}>
                                                    <Table.Cell fontSize="xs" px={2} py={2}>
                                                        Total
                                                    </Table.Cell>
                                                    <Table.Cell fontSize="xs" px={2} py={2} />
                                                    {matrix.gpus.map((gpuCol) => (
                                                        <Table.Cell
                                                            key={gpuCol.key}
                                                            fontSize="xs"
                                                            px={2}
                                                            py={2}
                                                            textAlign="right"
                                                            fontFamily="mono"
                                                            css={numericCellStyle}
                                                        >
                                                            {formatScore(gpuCol.total_score)}
                                                        </Table.Cell>
                                                    ))}
                                                </Table.Row>
                                            </Table.Body>
                                        </Table.Root>
                                    </Box>
                                )}
                            </Box>
                        ) : null}
                    </Box>
                )}
            </Box>

            <Box flex="1" minH={4} />

            <Box flexShrink={0}>
                <Text fontWeight="semibold" mb={2}>
                    Workloads
                </Text>
                <Box
                    borderWidth="1px"
                    borderRadius="md"
                    borderColor="var(--color-border)"
                    bg="var(--color-bg-card)"
                    p={4}
                >
                    <SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} gap={4}>
                        <CascadeSelect
                            label="Group 1"
                            options={g1Options}
                            value={selectedG1}
                            onChange={onG1Change}
                        />
                        <CascadeSelect
                            label="Group 2"
                            options={g2Options}
                            value={selectedG2}
                            onChange={onG2Change}
                            hint={
                                selectedG1.length
                                    ? `Filtered by ${selectedG1.length} Group 1 value(s)`
                                    : undefined
                            }
                        />
                        <CascadeSelect
                            label="Group 3"
                            options={g3Options}
                            value={selectedG3}
                            onChange={onG3Change}
                            hint={
                                selectedG2.length
                                    ? `Filtered by ${selectedG2.length} Group 2 value(s)`
                                    : undefined
                            }
                        />
                        <CascadeSelect
                            label="Group 4"
                            options={g4Options}
                            value={selectedG4}
                            onChange={onG4Change}
                            hint={
                                selectedG3.length
                                    ? `Filtered by ${selectedG3.length} Group 3 value(s)`
                                    : undefined
                            }
                        />
                        <SelectedBenchmarksPanel
                            options={benchOptions}
                            value={selectedPacks}
                            onChange={setSelectedPacks}
                        />
                    </SimpleGrid>
                </Box>
            </Box>

            <Dialog.Root open={advancedOpen} onOpenChange={(details) => setAdvancedOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Advanced options</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack align="stretch" gap={4}>
                                <Field.Root>
                                    <Field.Label>Benchmark perf</Field.Label>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={draftPerfAgg}
                                            onChange={(e) =>
                                                setDraftPerfAgg(e.currentTarget.value as BreakdownPerfAgg)
                                            }
                                        >
                                            {BREAKDOWN_PERF_AGG_OPTIONS.map((entry) => (
                                                <option key={entry.id} value={entry.id}>
                                                    {entry.label}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                    <Field.HelperText>
                                        {BREAKDOWN_PERF_AGG_OPTIONS.find((entry) => entry.id === draftPerfAgg)
                                            ?.description}
                                    </Field.HelperText>
                                </Field.Root>
                                <HStack justify="flex-end" gap={2}>
                                    <Button variant="outline" onClick={onAdvancedClose}>
                                        Cancel
                                    </Button>
                                    <Button colorPalette="blue" onClick={applyAdvancedOptions}>
                                        Apply
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

export default BreakdownView;
