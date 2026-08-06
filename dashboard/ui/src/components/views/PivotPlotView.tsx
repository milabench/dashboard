import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box,
    Badge,
    Button,
    Checkbox,
    Grid,
    HStack,
    Input,
    NativeSelect,
    Text,
    VStack,
} from '@chakra-ui/react';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { toaster } from '../ui/toaster';
import { cssColor } from '../../utils/gpuColors';
import { copyTextToClipboard, safeFilename } from '../../utils/download';
import {
    convertPivotToChartData,
    filterPlotRows,
    quantitativeAxisFormat,
    suggestEncodings,
    type ChartFieldMeta,
    type PivotFieldConfig,
} from '../../utils/pivotToChartData';
import {
    encodePivotPlotState,
    isPlotStateShareable,
    parsePivotPlotFromSearchParams,
    validatePlotEncodings,
    type PivotPlotEncodings,
    type PivotPlotUrlState,
} from '../../utils/pivotPlotUrlParams';

type EncodingChannel = 'x' | 'y' | 'color' | 'shape' | 'opacity' | 'size' | 'facet';

type Encodings = PivotPlotEncodings;

const MARK_OPTIONS = [
    { value: 'point', label: 'Point' },
    { value: 'line', label: 'Line' },
    { value: 'bar', label: 'Bar' },
    { value: 'area', label: 'Area' },
    { value: 'tick', label: 'Tick' },
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
    { value: 'rule', label: 'Rule' },
];

const ZONE_CONFIG: Array<{
    channel: EncodingChannel | 'mark';
    label: string;
    hint: string;
    bg: string;
    border: string;
    text: string;
}> = [
    { channel: 'mark', label: 'Mark', hint: 'Geometry', bg: 'var(--color-pivot-value-bg)', border: 'var(--color-pivot-value-border)', text: 'var(--color-pivot-value-heading)' },
    { channel: 'x', label: 'X', hint: 'Horizontal', bg: 'var(--color-pivot-row-bg)', border: 'var(--color-pivot-row-border)', text: 'var(--color-pivot-row-heading)' },
    { channel: 'y', label: 'Y', hint: 'Vertical', bg: 'var(--color-pivot-col-bg)', border: 'var(--color-pivot-col-border)', text: 'var(--color-pivot-col-heading)' },
    { channel: 'color', label: 'Color', hint: 'Fill / stroke', bg: 'var(--color-pivot-filter-bg)', border: 'var(--color-pivot-filter-border)', text: 'var(--color-pivot-filter-heading)' },
    { channel: 'shape', label: 'Shape', hint: 'Point shape', bg: 'var(--color-pivot-value-bg)', border: 'var(--color-pivot-value-border)', text: 'var(--color-pivot-value-heading)' },
    { channel: 'opacity', label: 'Opacity', hint: 'Transparency', bg: 'var(--color-pivot-row-bg)', border: 'var(--color-pivot-row-border)', text: 'var(--color-pivot-row-heading)' },
    { channel: 'size', label: 'Size', hint: 'Mark size', bg: 'var(--color-pivot-col-bg)', border: 'var(--color-pivot-col-border)', text: 'var(--color-pivot-col-heading)' },
    { channel: 'facet', label: 'Facet', hint: 'Small multiples', bg: 'var(--color-pivot-filter-bg)', border: 'var(--color-pivot-filter-border)', text: 'var(--color-pivot-filter-heading)' },
];

export interface PivotPlotViewProps {
    pivotData: Record<string, unknown>[];
    pivotFields: PivotFieldConfig[];
    /** Changes when pivot query URL params change (not plot spec). */
    pivotConfigKey: string;
}

const EMPTY_ENCODINGS: Encodings = {
    mark: 'point',
    x: '',
    y: '',
    color: '',
    shape: '',
    opacity: '',
    size: '',
    facet: '',
};

function clampCellDimension(
    value: number,
    min: number,
    max: number,
    fallback: number,
): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function commitCellDimensionInput(
    raw: string,
    min: number,
    max: number,
    fallback: number,
): { value: number; text: string } {
    const value = clampCellDimension(Number(raw), min, max, fallback);
    return { value, text: String(value) };
}

function buildFieldEncoding(
    field: string,
    meta: ChartFieldMeta | undefined,
    sampleValues: unknown[] = [],
) {
    const type = meta?.vegaType ?? 'nominal';
    const base: Record<string, unknown> = {
        field,
        type,
        title: meta?.label ?? field,
    };
    if (type === 'quantitative') {
        base.scale = { zero: false, nice: true };
        base.axis = {
            format: quantitativeAxisFormat(sampleValues),
            tickCount: 6,
        };
    }
    if (type === 'temporal') {
        base.axis = { labelAngle: -35 };
    }
    return base;
}

const DEFAULT_MAX_CELL_WIDTH = 480;
const DEFAULT_MAX_CELL_HEIGHT = 400;
const MIN_CELL_WIDTH = 140;
const MIN_CELL_HEIGHT = 120;

function uniqueFieldCount(rows: Record<string, unknown>[], field: string): number {
    if (!field) return 0;
    return new Set(rows.map((r) => r[field]).filter((v) => v != null && v !== '')).size;
}

function computePivotPlotLayout(
    encodings: Encodings,
    rows: Record<string, unknown>[],
    cellWidth: number,
    cellHeight: number,
) {
    let facetCols = 1;
    if (encodings.facet) {
        const facetCount = uniqueFieldCount(rows, encodings.facet);
        facetCols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(facetCount))));
    }

    return {
        cellWidth: Math.max(MIN_CELL_WIDTH, cellWidth),
        cellHeight: Math.max(MIN_CELL_HEIGHT, cellHeight),
        facetCols,
    };
}

function buildScaleResolve(independentX: boolean, independentY: boolean) {
    const scale: Record<string, 'independent'> = {};
    if (independentX) scale.x = 'independent';
    if (independentY) scale.y = 'independent';
    if (Object.keys(scale).length === 0) return undefined;
    return { scale };
}

const PLOT_CONFIG_OVERRIDES = {
    padding: { left: 8, top: 8, right: 8, bottom: 8 },
    legend: {
        orient: 'right' as const,
        direction: 'vertical' as const,
        labelLimit: 260,
        titleLimit: 180,
        columns: 1,
        padding: 8,
        labelFontSize: 11,
    },
    axis: {
        labelFontSize: 11,
        titleFontSize: 12,
        labelPadding: 6,
        titlePadding: 10,
    },
};

export function PivotPlotView({ pivotData, pivotFields, pivotConfigKey }: PivotPlotViewProps) {
    const plotRef = useRef<VegaPlotHandle>(null);
    const [exportingPng, setExportingPng] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const plotFromUrl = useMemo(
        () => parsePivotPlotFromSearchParams(searchParams),
        [searchParams],
    );
    const lastSyncedPlotParamRef = useRef<string | null>(searchParams.get('plot'));
    const prevPivotConfigKeyRef = useRef(pivotConfigKey);

    const chartData = useMemo(
        () => convertPivotToChartData(pivotData, pivotFields),
        [pivotData, pivotFields],
    );

    const [encodings, setEncodings] = useState<Encodings>(() => ({
        ...EMPTY_ENCODINGS,
        ...(plotFromUrl?.encodings ?? {}),
    }));
    const [activeZone, setActiveZone] = useState<EncodingChannel | 'mark' | null>(null);
    const [initialized, setInitialized] = useState(false);
    const [independentX, setIndependentX] = useState(plotFromUrl?.independentX ?? false);
    const [independentY, setIndependentY] = useState(plotFromUrl?.independentY ?? false);
    const [hideNulls, setHideNulls] = useState(plotFromUrl?.hideNulls ?? true);
    const [cellWidth, setCellWidth] = useState(
        plotFromUrl?.cellWidth ?? DEFAULT_MAX_CELL_WIDTH,
    );
    const [cellHeight, setCellHeight] = useState(
        plotFromUrl?.cellHeight ?? DEFAULT_MAX_CELL_HEIGHT,
    );
    const [cellWidthInput, setCellWidthInput] = useState(
        String(plotFromUrl?.cellWidth ?? DEFAULT_MAX_CELL_WIDTH),
    );
    const [cellHeightInput, setCellHeightInput] = useState(
        String(plotFromUrl?.cellHeight ?? DEFAULT_MAX_CELL_HEIGHT),
    );

    const commitCellWidth = useCallback(() => {
        const { value, text } = commitCellDimensionInput(
            cellWidthInput,
            MIN_CELL_WIDTH,
            1600,
            DEFAULT_MAX_CELL_WIDTH,
        );
        setCellWidth(value);
        setCellWidthInput(text);
    }, [cellWidthInput]);

    const commitCellHeight = useCallback(() => {
        const { value, text } = commitCellDimensionInput(
            cellHeightInput,
            MIN_CELL_HEIGHT,
            1200,
            DEFAULT_MAX_CELL_HEIGHT,
        );
        setCellHeight(value);
        setCellHeightInput(text);
    }, [cellHeightInput]);

    const syncPlotToUrl = useCallback((state: PivotPlotUrlState) => {
        if (!isPlotStateShareable(state)) return;

        const plotParam = encodePivotPlotState(state);
        lastSyncedPlotParamRef.current = plotParam;
        setSearchParams(
            (prev) => {
                if (prev.get('plot') === plotParam) return prev;
                const next = new URLSearchParams(prev);
                next.set('plot', plotParam);
                return next;
            },
            { replace: true },
        );
    }, [setSearchParams]);

    useEffect(() => {
        if (!chartData || initialized) return;

        const rowKeys = Object.keys(chartData.long[0] ?? {});
        let nextState: PivotPlotUrlState;

        if (plotFromUrl?.encodings) {
            const validated = validatePlotEncodings(
                plotFromUrl.encodings,
                chartData.fields,
                rowKeys,
                'point',
            );
            const suggested = suggestEncodings(chartData, pivotFields);
            nextState = {
                encodings: {
                    mark: validated.mark || suggested.mark,
                    x: validated.x || suggested.x,
                    y: validated.y || suggested.y,
                    color: validated.color || suggested.color,
                    shape: validated.shape || suggested.shape,
                    opacity: validated.opacity ?? '',
                    size: validated.size ?? '',
                    facet: validated.facet ?? '',
                },
                independentX: plotFromUrl.independentX ?? false,
                independentY: plotFromUrl.independentY ?? false,
                hideNulls: plotFromUrl.hideNulls ?? true,
                cellWidth: plotFromUrl.cellWidth,
                cellHeight: plotFromUrl.cellHeight,
            };
            lastSyncedPlotParamRef.current = searchParams.get('plot');
        } else {
            const suggested = suggestEncodings(chartData, pivotFields);
            nextState = {
                encodings: {
                    mark: suggested.mark,
                    x: suggested.x,
                    y: suggested.y,
                    color: suggested.color,
                    shape: suggested.shape,
                    opacity: '',
                    size: '',
                    facet: '',
                },
                independentX: false,
                independentY: false,
                hideNulls: true,
            };
        }

        setEncodings(nextState.encodings);
        setIndependentX(nextState.independentX ?? false);
        setIndependentY(nextState.independentY ?? false);
        setHideNulls(nextState.hideNulls ?? true);
        if (nextState.cellWidth != null) {
            setCellWidth(nextState.cellWidth);
            setCellWidthInput(String(nextState.cellWidth));
        }
        if (nextState.cellHeight != null) {
            setCellHeight(nextState.cellHeight);
            setCellHeightInput(String(nextState.cellHeight));
        }
        setInitialized(true);
        if (isPlotStateShareable(nextState)) {
            syncPlotToUrl(nextState);
        }
    }, [chartData, pivotFields, plotFromUrl, initialized, syncPlotToUrl, searchParams]);

    useEffect(() => {
        if (prevPivotConfigKeyRef.current === pivotConfigKey) return;
        prevPivotConfigKeyRef.current = pivotConfigKey;
        setInitialized(false);
    }, [pivotConfigKey]);

    const plotUrlState = useMemo(
        () => ({
            encodings,
            independentX,
            independentY,
            hideNulls,
            cellWidth,
            cellHeight,
        }),
        [encodings, independentX, independentY, hideNulls, cellWidth, cellHeight],
    );

    useEffect(() => {
        if (!initialized) return;

        const timer = window.setTimeout(() => {
            syncPlotToUrl(plotUrlState);
        }, 400);

        return () => window.clearTimeout(timer);
    }, [plotUrlState, initialized, syncPlotToUrl]);

    useEffect(() => {
        if (!initialized || !chartData) return;

        const plotParam = searchParams.get('plot');
        if (!plotParam || plotParam === lastSyncedPlotParamRef.current) return;

        const fromUrl = parsePivotPlotFromSearchParams(searchParams);
        if (!fromUrl?.encodings) return;

        const rowKeys = Object.keys(chartData.long[0] ?? {});
        const validated = validatePlotEncodings(
            fromUrl.encodings,
            chartData.fields,
            rowKeys,
            'point',
        );
        setEncodings(validated);
        setIndependentX(fromUrl.independentX ?? false);
        setIndependentY(fromUrl.independentY ?? false);
        setHideNulls(fromUrl.hideNulls ?? true);
        if (fromUrl.cellWidth != null) {
            setCellWidth(fromUrl.cellWidth);
            setCellWidthInput(String(fromUrl.cellWidth));
        }
        if (fromUrl.cellHeight != null) {
            setCellHeight(fromUrl.cellHeight);
            setCellHeightInput(String(fromUrl.cellHeight));
        }
        lastSyncedPlotParamRef.current = plotParam;
    }, [searchParams, initialized, chartData]);

    const rows = chartData?.long ?? [];

    const plotRows = useMemo(() => {
        if (!hideNulls) return rows;
        const encodedFields = (
            ['x', 'y', 'color', 'shape', 'opacity', 'size', 'facet'] as EncodingChannel[]
        ).map((ch) => encodings[ch]).filter(Boolean);
        return filterPlotRows(rows, encodedFields);
    }, [rows, encodings, hideNulls]);

    const hiddenNullCount = rows.length - plotRows.length;

    const fieldMeta = useMemo(() => {
        const map = new Map<string, ChartFieldMeta>();
        chartData?.fields.forEach((f) => map.set(f.name, f));
        return map;
    }, [chartData]);

    const assignField = useCallback((channel: EncodingChannel | 'mark', fieldName: string) => {
        if (channel === 'mark') return;
        setEncodings((prev) => ({ ...prev, [channel]: prev[channel] === fieldName ? '' : fieldName }));
    }, []);

    const specBuilder = useCallback((_w: number, _h: number) => {
        if (!chartData || plotRows.length === 0 || !encodings.x || !encodings.y) return null;

        const encoding: Record<string, unknown> = {};
        (['x', 'y', 'color', 'shape', 'opacity', 'size'] as EncodingChannel[]).forEach((ch) => {
            const field = encodings[ch];
            if (!field) return;
            encoding[ch] = buildFieldEncoding(
                field,
                fieldMeta.get(field),
                plotRows.map((row) => row[field]),
            );
        });

        const layout = computePivotPlotLayout(
            encodings,
            plotRows,
            cellWidth,
            cellHeight,
        );
        const textColor = cssColor('--color-text', '#1a202c');

        const innerSpec = {
            width: layout.cellWidth,
            height: layout.cellHeight,
            autosize: { type: 'pad', contains: 'padding' },
            mark: {
                type: encodings.mark,
                tooltip: true,
                ...(encodings.mark === 'line' ? { point: true } : {}),
                ...(encodings.mark === 'bar' ? { opacity: 0.85 } : {}),
            },
            encoding,
            config: {
                axis: { labelColor: textColor },
                legend: { labelColor: textColor },
            },
        };

        if (encodings.facet) {
            const resolve = buildScaleResolve(independentX, independentY);
            return {
                data: { values: plotRows },
                facet: {
                    field: encodings.facet,
                    type: fieldMeta.get(encodings.facet)?.vegaType ?? 'nominal',
                    title: fieldMeta.get(encodings.facet)?.label ?? encodings.facet,
                },
                columns: layout.facetCols,
                ...(resolve ? { resolve } : {}),
                spec: innerSpec,
            };
        }

        return {
            data: { values: plotRows },
            ...innerSpec,
        };
    }, [chartData, plotRows, encodings, fieldMeta, independentX, independentY, cellWidth, cellHeight]);

    const canRenderPlot = Boolean(chartData && plotRows.length > 0 && encodings.x && encodings.y);

    const handleExportPng = async () => {
        if (!plotRef.current?.isReady()) {
            toaster.create({
                title: 'Plot not ready',
                description: 'Assign X and Y encodings and wait for the chart to render',
                type: 'warning',
                duration: 3000,
            });
            return;
        }
        setExportingPng(true);
        try {
            await plotRef.current.exportPng(
                safeFilename(['pivot-plot', encodings.x, encodings.y], 'png'),
            );
            toaster.create({
                title: 'PNG saved',
                description: 'Plot downloaded',
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            toaster.create({
                title: 'PNG export failed',
                description: err instanceof Error ? err.message : 'Could not save PNG',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setExportingPng(false);
        }
    };

    const handleCopyLink = async () => {
        try {
            await copyTextToClipboard(window.location.href);
            toaster.create({
                title: 'Link copied',
                description: 'Share this URL to restore the pivot query and plot',
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                description: err instanceof Error ? err.message : 'Could not copy link',
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleCopySpec = async () => {
        const spec = specBuilder(800, 500);
        if (!spec) return;
        try {
            await copyTextToClipboard(JSON.stringify(spec, null, 2));
            toaster.create({
                title: 'Spec copied',
                description: 'Vega-Lite spec copied to clipboard',
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                description: err instanceof Error ? err.message : 'Could not copy spec',
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleCopyData = async () => {
        if (rows.length === 0) return;
        try {
            await copyTextToClipboard(JSON.stringify(rows, null, 2));
            toaster.create({
                title: 'Data copied',
                description: `${rows.length} converted observations copied as JSON`,
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                description: err instanceof Error ? err.message : 'Could not copy data',
                type: 'error',
                duration: 5000,
            });
        }
    };

    if (!chartData) {
        return (
            <Box p={8} textAlign="center">
                <Text color="var(--color-text-muted)">No pivot data to plot. Run a query first.</Text>
            </Box>
        );
    }

    const renderZone = (channel: EncodingChannel | 'mark') => {
        const cfg = ZONE_CONFIG.find((z) => z.channel === channel)!;
        const value = channel === 'mark' ? encodings.mark : encodings[channel as EncodingChannel];
        const isActive = activeZone === channel;

        return (
            <Box
                key={channel}
                borderWidth="2px"
                borderStyle="dashed"
                borderColor={isActive ? 'var(--color-primary)' : cfg.border}
                borderRadius="md"
                bg={cfg.bg}
                p={3}
                minH="88px"
                cursor="pointer"
                onClick={() => setActiveZone(channel)}
                transition="border-color 0.15s"
            >
                <Text fontSize="xs" fontWeight="bold" color={cfg.text} textTransform="uppercase" letterSpacing="wide">
                    {cfg.label}
                </Text>
                <Text fontSize="2xs" color="var(--color-text-muted)" mb={2}>{cfg.hint}</Text>
                {channel === 'mark' ? (
                    <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                            value={encodings.mark}
                            onChange={(e) => setEncodings((prev) => ({ ...prev, mark: e.target.value }))}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {MARK_OPTIONS.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </NativeSelect.Field>
                    </NativeSelect.Root>
                ) : value ? (
                    <Badge
                        bg="var(--color-bg-card)"
                        color="var(--color-text)"
                        fontFamily="mono"
                        fontSize="xs"
                        px={2}
                        py={1}
                        borderRadius="full"
                        cursor="pointer"
                        onClick={(e) => {
                            e.stopPropagation();
                            assignField(channel, value);
                        }}
                    >
                        {value} ×
                    </Badge>
                ) : (
                    <Text fontSize="xs" color="var(--color-text-muted)" fontStyle="italic">
                        Click a field below
                    </Text>
                )}
            </Box>
        );
    };

    const availableFields = chartData.fields;

    return (
        <VStack align="stretch" gap={3} h="100%" minH={0}>
            <HStack justify="space-between" flexWrap="wrap" gap={2} flexShrink={0}>
                <HStack gap={2} flexWrap="wrap">
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        {plotRows.length.toLocaleString()} plotted
                        {hiddenNullCount > 0 ? ` · ${hiddenNullCount.toLocaleString()} null rows hidden` : ''}
                        {' · '}
                        {chartData.fields.filter((f) => f.kind === 'measure').length} metrics
                    </Text>
                </HStack>
                <HStack gap={2}>
                    <Button
                        size="xs"
                        variant="outline"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        onClick={handleCopyLink}
                    >
                        Copy link
                    </Button>
                    <Button
                        size="xs"
                        variant="outline"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        onClick={handleExportPng}
                        disabled={!canRenderPlot || exportingPng}
                    >
                        {exportingPng ? 'Saving…' : 'Save PNG'}
                    </Button>
                    <Button
                        size="xs"
                        variant="outline"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        onClick={handleCopyData}
                        disabled={rows.length === 0}
                    >
                        Copy data
                    </Button>
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopySpec}>
                        Copy Vega spec
                    </Button>
                    <Button
                        size="xs"
                        variant="outline"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        onClick={() => {
                            if (!chartData) return;
                            const s = suggestEncodings(chartData, pivotFields);
                            setEncodings((prev) => ({
                                ...prev,
                                mark: s.mark,
                                x: s.x,
                                y: s.y,
                                color: s.color,
                            }));
                        }}
                    >
                        Auto-map
                    </Button>
                </HStack>
            </HStack>

            <Grid templateColumns="repeat(4, 1fr)" gap={3} flexShrink={0}>
                {ZONE_CONFIG.map((z) => renderZone(z.channel))}
            </Grid>

            <HStack gap={4} flexWrap="wrap" alignItems="center" flexShrink={0}>
                <Checkbox.Root
                    size="sm"
                    checked={hideNulls}
                    onCheckedChange={(e) => setHideNulls(Boolean(e.checked))}
                    title="Omit rows where any encoded field (X, Y, color, etc.) is null"
                >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label color="var(--color-text)" fontSize="sm">Hide nulls</Checkbox.Label>
                </Checkbox.Root>
                <Box w="1px" h="20px" bg="var(--color-border)" />
                <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)">
                    Facet scales
                </Text>
                <Checkbox.Root
                    size="sm"
                    checked={independentX}
                    disabled={!encodings.facet}
                    onCheckedChange={(e) => setIndependentX(Boolean(e.checked))}
                    title={encodings.facet ? 'Each facet panel uses its own X scale' : 'Assign a facet field first'}
                >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label color="var(--color-text)" fontSize="sm">Independent X</Checkbox.Label>
                </Checkbox.Root>
                <Checkbox.Root
                    size="sm"
                    checked={independentY}
                    disabled={!encodings.facet}
                    onCheckedChange={(e) => setIndependentY(Boolean(e.checked))}
                    title={encodings.facet ? 'Each facet panel uses its own Y scale' : 'Assign a facet field first'}
                >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label color="var(--color-text)" fontSize="sm">Independent Y</Checkbox.Label>
                </Checkbox.Root>
                {!encodings.facet && (
                    <Text fontSize="xs" color="var(--color-text-muted)">
                        Requires a facet encoding
                    </Text>
                )}
                <Box w="1px" h="20px" bg="var(--color-border)" />
                <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)">
                    Cell size (px)
                </Text>
                <HStack gap={1}>
                    <Text fontSize="xs" color="var(--color-text-muted)">W</Text>
                    <Input
                        type="number"
                        size="xs"
                        w="72px"
                        min={MIN_CELL_WIDTH}
                        max={1600}
                        value={cellWidthInput}
                        onChange={(e) => setCellWidthInput(e.target.value)}
                        onBlur={commitCellWidth}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCellWidth();
                        }}
                        bg="var(--color-bg-card)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                    />
                </HStack>
                <HStack gap={1}>
                    <Text fontSize="xs" color="var(--color-text-muted)">H</Text>
                    <Input
                        type="number"
                        size="xs"
                        w="72px"
                        min={MIN_CELL_HEIGHT}
                        max={1200}
                        value={cellHeightInput}
                        onChange={(e) => setCellHeightInput(e.target.value)}
                        onBlur={commitCellHeight}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCellHeight();
                        }}
                        bg="var(--color-bg-card)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                    />
                </HStack>
            </HStack>

            <Box
                borderWidth="1px"
                borderColor="var(--color-border)"
                borderRadius="md"
                p={3}
                bg="var(--color-bg-card)"
                maxH="120px"
                overflowY="auto"
                flexShrink={0}
            >
                <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" mb={2}>
                    {activeZone
                        ? `Assign to ${activeZone.toUpperCase()} — click a field`
                        : 'Select an encoding zone above, then pick a field'}
                </Text>
                <HStack flexWrap="wrap" gap={1}>
                    {availableFields.map((f) => (
                        <Badge
                            key={f.name}
                            fontFamily="mono"
                            fontSize="xs"
                            px={2}
                            py={0.5}
                            borderRadius="full"
                            bg="var(--color-bg-hover)"
                            color="var(--color-text)"
                            title={f.sourceName ?? f.name}
                            cursor={activeZone && activeZone !== 'mark' ? 'pointer' : 'default'}
                            opacity={activeZone && activeZone !== 'mark' ? 1 : 0.85}
                            _hover={activeZone && activeZone !== 'mark' ? { bg: 'var(--color-primary)', color: 'var(--color-primary-text)' } : undefined}
                            onClick={() => {
                                if (activeZone && activeZone !== 'mark') {
                                    assignField(activeZone, f.name);
                                }
                            }}
                        >
                            {f.name}
                            <Text as="span" ml={1} opacity={0.6}>({f.vegaType[0]})</Text>
                        </Badge>
                    ))}
                </HStack>
            </Box>

            <Box
                flex="1"
                minH={0}
                borderWidth="1px"
                borderColor="var(--color-border)"
                borderRadius="md"
                overflow="auto"
                bg="var(--color-bg-card)"
                p={2}
            >
                {!canRenderPlot && encodings.x && encodings.y && rows.length > 0 ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%" minH="200px" p={4}>
                        <Text color="var(--color-text-muted)" textAlign="center">
                            All rows are null for the current encodings.
                            {hideNulls ? ' Turn off Hide nulls to inspect them.' : ''}
                        </Text>
                    </Box>
                ) : !encodings.x || !encodings.y ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%" minH="200px">
                        <Text color="var(--color-text-muted)">Assign both X and Y encodings to render the chart</Text>
                    </Box>
                ) : (
                    <VegaPlot
                        ref={plotRef}
                        spec={specBuilder}
                        height="100%"
                        configOverrides={PLOT_CONFIG_OVERRIDES}
                    />
                )}
            </Box>
        </VStack>
    );
}

export default PivotPlotView;
