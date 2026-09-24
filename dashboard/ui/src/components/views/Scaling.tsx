import { useState, useCallback, useRef, useMemo } from 'react';
import {
    Box,
    HStack,
    NativeSelect,
    Field,
    Text,
    Button,
    Checkbox,
    Popover,
    VStack,
    Badge,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { buildVendorColorScale, cssColor, guessVendor } from '../../utils/gpuColors';
import { downloadJson, exportVegaViewPng, safeFilename } from '../../utils/download';
import { useVega } from '../../hooks/useVega';
import { useColorMode } from '../../hooks/useColorMode';
import type { ScalingObservation } from '../../services/types';

const PARAM_X = 'x';
const PARAM_Y = 'y';
const PARAM_BENCHES = 'benches';
const PARAM_DISPLAY = 'display';

type DisplayMode = 'points' | 'smooth' | 'both';

const Scaling = () => {
    usePageTitle('Scaling');
    const plotRef = useRef<VegaPlotHandle>(null);
    const { embed: vegaEmbed } = useVega();
    const { colorMode } = useColorMode();
    const [exporting, setExporting] = useState(false);
    const [exportingPerBench, setExportingPerBench] = useState(false);
    const [exportProgress, setExportProgress] = useState('');

    const [urlParams, setUrlParams] = useSearchParams();

    const xAxis = urlParams.get(PARAM_X) ?? 'memory';
    const yAxis = urlParams.get(PARAM_Y) ?? 'perf';
    const display = (urlParams.get(PARAM_DISPLAY) ?? 'points') as DisplayMode;

    // null = all selected (no filter applied)
    const selectedBenches: string[] | null = useMemo(() => {
        const raw = urlParams.get(PARAM_BENCHES);
        if (!raw) return null;
        const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
        return parsed.length > 0 ? parsed : null;
    }, [urlParams]);

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

    const { data: scalingData } = useQuery({
        queryKey: ['scalingData'],
        queryFn: async () => {
            const response = await api.get('/scaling');
            return response.data as ScalingObservation[];
        },
    });

    const allBenches: string[] = useMemo(() => {
        if (!Array.isArray(scalingData)) return [];
        return Array.from(new Set(scalingData.map((d) => String(d.bench ?? '')))).sort();
    }, [scalingData]);

    const effectiveSelected = selectedBenches ?? allBenches;
    const allSelected = selectedBenches === null || selectedBenches.length === allBenches.length;

    const toggleBench = (bench: string) => {
        const current = new Set(effectiveSelected);
        if (current.has(bench)) {
            current.delete(bench);
        } else {
            current.add(bench);
        }
        const next = allBenches.filter(b => current.has(b));
        if (next.length === allBenches.length) {
            setParam(PARAM_BENCHES, null);
        } else {
            setParam(PARAM_BENCHES, next.join(','));
        }
    };

    const selectAll = () => setParam(PARAM_BENCHES, null);
    const clearAll = () => setParam(PARAM_BENCHES, '');

    const filteredData = useMemo(() => {
        if (!Array.isArray(scalingData)) return scalingData;
        if (allSelected) return scalingData;
        const set = new Set(effectiveSelected);
        return scalingData.filter((d) => set.has(String(d.bench ?? '')));
    }, [scalingData, effectiveSelected, allSelected]);

    const hasData = Array.isArray(filteredData) && filteredData.length > 0;

    const CELL_HEIGHT = 280;
    const CELL_PADDING = 50;
    // 100px per row covers axis labels, facet headers, and row spacing that Vega-Lite adds on top of CELL_HEIGHT
    const ROW_OVERHEAD = 100;

    const plotHeight = useMemo(() => {
        if (!Array.isArray(filteredData) || filteredData.length === 0) return 400;
        const benchCount = new Set(filteredData.map((d) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const rows = Math.ceil(benchCount / cols);
        return rows * (CELL_HEIGHT + CELL_PADDING + ROW_OVERHEAD) + 120;
    }, [filteredData]);

    const specBuilder = useCallback((w: number) => {
        if (!filteredData || filteredData.length === 0) return null;

        const values = filteredData.map((d) => ({
            ...d,
            vendor: guessVendor(String(d.gpu ?? '')),
        }));

        const benchCount = new Set(values.map((d) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const cellWidth = Math.max(120, Math.floor(w / (cols + 1)) - CELL_PADDING);
        const cellHeight = CELL_HEIGHT;
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
        const hoverParams = [
            {
                name: 'gpuHover',
                select: {
                    type: 'point',
                    fields: ['gpu'],
                    on: 'pointerover',
                    clear: 'pointerout',
                },
                bind: { legend: 'mouseover' },
            },
            {
                name: 'vendorHover',
                select: {
                    type: 'point',
                    fields: ['vendor'],
                    on: 'pointerover',
                    clear: 'pointerout',
                },
                bind: { legend: 'mouseover' },
            },
        ];
        const highlightOpacity = {
            condition: [{ param: 'vendorHover', value: 1 }],
            value: 0.5,
        };
        const strokeColor = {
            condition: [{ param: 'gpuHover', value: cssColor('--color-bg-page', '#718096') }],
            value: cssColor('--color-bg-page', '#718096'),
        };
        const strokeWidthEmphasis = {
            condition: [{ param: 'gpuHover', value: 1 }],
            value: 2,
        };

        const pointTooltip = [
            { field: 'bench', type: 'nominal', title: 'Benchmark' },
            { field: 'gpu', type: 'nominal', title: 'GPU' },
            { field: 'vendor', type: 'nominal', title: 'Vendor' },
            { field: xAxis, type: 'quantitative', title: xAxis, format: '~s' },
            { field: yAxis, type: 'quantitative', title: yAxis, format: '~s' },
            { field: 'perf', type: 'quantitative', title: 'perf', format: '~s' },
        ];

        // In smooth mode the shape legend is meaningless (no points), so suppress it
        // and replace it with a strokeDash legend on the smooth layer.
        const hitEncoding = display === 'smooth'
            ? { ...axisEncoding, color: seriesEncoding.color }
            : { ...axisEncoding, ...seriesEncoding };

        // Invisible hit-target layer (always present for hover/legend interaction)
        const hitLayer = {
            description: 'Transparent hit target for hover',
            params: hoverParams,
            mark: { type: 'point', filled: true, opacity: 0, size: 400, tooltip: null },
            encoding: hitEncoding,
        };

        // Raw scatter points
        const pointLayer = {
            mark: { type: 'point', filled: true, size: 120 },
            encoding: {
                ...axisEncoding,
                ...seriesEncoding,
                stroke: strokeColor,
                strokeWidth: strokeWidthEmphasis,
                opacity: highlightOpacity,
                tooltip: pointTooltip,
            },
        };

        // LOESS smoothed line per GPU (bandwidth 0.5 = moderate smoothing)
        const smoothLayer = {
            transform: [{ loess: yAxis, on: xAxis, groupby: ['gpu', 'vendor'], bandwidth: 0.5 }],
            mark: { type: 'line', strokeWidth: 2, interpolate: 'monotone' },
            encoding: {
                x: axisEncoding.x,
                y: axisEncoding.y,
                color: seriesEncoding.color,
                strokeDash: {
                    field: 'gpu',
                    type: 'nominal',
                    title: 'GPU',
                    // Show dash legend only in smooth mode; in 'both' the shape legend covers it
                    legend: display === 'smooth' ? {
                        ...legendStyle,
                        symbolType: 'stroke',
                        symbolStrokeWidth: 2,
                    } : null,
                },
                opacity: highlightOpacity,
            },
        };

        const layers: Record<string, unknown>[] = [hitLayer];
        if (display === 'points' || display === 'both') {
            layers.push({
                ...pointLayer,
                encoding: {
                    ...pointLayer.encoding,
                    opacity: display === 'both'
                        ? { condition: [{ param: 'vendorHover', value: 0.4 }], value: 0.2 }
                        : highlightOpacity,
                },
            });
        }
        if (display === 'smooth' || display === 'both') {
            layers.push(smoothLayer);
        }

        return {
            data: { values },
            facet: { field: 'bench', type: 'nominal', title: 'Benchmark' },
            columns: cols,
            spec: {
                width: cellWidth,
                height: cellHeight,
                layer: layers,
            },
            resolve: { scale: { y: 'independent', x: 'independent', size: 'independent' } },
        } as Record<string, unknown>;
    }, [filteredData, xAxis, yAxis, display]);

    const handleExportJson = () => {
        if (!hasData) return;
        downloadJson(
            { x: xAxis, y: yAxis, observations: filteredData },
            safeFilename(['scaling', xAxis, yAxis], 'json'),
        );
    };

    const handleExportPng = async () => {
        if (!plotRef.current?.isReady()) return;
        setExporting(true);
        try {
            await plotRef.current.exportPng(
                safeFilename(['scaling', xAxis, yAxis], 'png'),
            );
        } catch (err) {
            console.error('PNG export failed:', err);
        } finally {
            setExporting(false);
        }
    };

    const handleExportPerBenchmark = async () => {
        if (!hasData || !vegaEmbed) return;
        setExportingPerBench(true);

        const benches = Array.from(new Set(filteredData.map((d) => d.bench))).sort() as string[];
        const bgColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-bg-page').trim() || '#ffffff';

        const vegaConfig: Record<string, unknown> = {
            background: bgColor,
            padding: 20,
            legend: { orient: 'right', direction: 'vertical' },
        };
        if (colorMode === 'dark') {
            try {
                const themes = await import('vega-themes');
                Object.assign(vegaConfig, (themes.dark as Record<string, unknown>) ?? {}, { background: bgColor });
            } catch { /* ignore */ }
        }

        for (let i = 0; i < benches.length; i++) {
            const bench = benches[i];
            setExportProgress(`${i + 1} / ${benches.length}`);

            const benchValues = filteredData
                .filter((d) => d.bench === bench)
                .map((d) => ({ ...d, vendor: guessVendor(String(d.gpu ?? '')) }));

            const vendorScale = buildVendorColorScale(benchValues.map((d) => d.vendor));
            const axisEnc = {
                x: { field: xAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
                y: { field: yAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
            };
            const colorEnc = { field: 'vendor', type: 'nominal', title: 'Vendor', scale: vendorScale };
            const mutedColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--color-text-muted').trim() || '#718096';
            const shapeEnc = {
                field: 'gpu',
                type: 'nominal',
                title: 'GPU',
                legend: {
                    symbolOpacity: 1,
                    symbolFillColor: mutedColor,
                    symbolStrokeColor: mutedColor,
                },
            };

            const layers: Record<string, unknown>[] = [];
            if (display === 'points' || display === 'both') {
                layers.push({
                    mark: { type: 'point', filled: true, size: 120 },
                    encoding: {
                        ...axisEnc,
                        color: colorEnc,
                        shape: shapeEnc,
                        opacity: { value: display === 'both' ? 0.3 : 0.9 },
                    },
                });
            }
            if (display === 'smooth' || display === 'both') {
                layers.push({
                    transform: [{ loess: yAxis, on: xAxis, groupby: ['gpu', 'vendor'], bandwidth: 0.5 }],
                    mark: { type: 'line', strokeWidth: 2, interpolate: 'monotone' },
                    encoding: {
                        ...axisEnc,
                        color: colorEnc,
                        strokeDash: { field: 'gpu', type: 'nominal', title: 'GPU' },
                    },
                });
            }

            const spec: Record<string, unknown> = {
                $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
                title: bench,
                width: 640,
                height: 400,
                data: { values: benchValues },
                layer: layers,
            };

            const container = document.createElement('div');
            container.style.cssText = 'position:absolute;left:-9999px;top:0;width:640px;height:400px';
            document.body.appendChild(container);
            try {
                const result = await vegaEmbed(container, spec, {
                    renderer: 'canvas',
                    actions: false,
                    config: vegaConfig,
                });
                await exportVegaViewPng(result.view, safeFilename(['scaling', bench, xAxis, yAxis], 'png'));
                result.finalize();
            } catch (err) {
                console.error(`PNG export failed for ${bench}:`, err);
            } finally {
                document.body.removeChild(container);
            }

            // brief pause so the browser doesn't block rapid-fire downloads
            if (i < benches.length - 1) await new Promise(r => setTimeout(r, 400));
        }

        setExportingPerBench(false);
        setExportProgress('');
    };

    const benchLabel = allSelected
        ? 'All benchmarks'
        : `${effectiveSelected.length} / ${allBenches.length} benchmarks`;

    return (
        <Box p={4} h="100%" display="flex" flexDirection="column" overflowX="hidden" overflowY="auto" className='scaling-container' bg="var(--color-bg-page)">
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
                            <option value="gpu">gpu</option>
                            <option value="cpu">cpu</option>
                            <option value="perf">perf</option>
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
                            <option value="gpu">gpu</option>
                            <option value="cpu">cpu</option>
                            <option value="perf">perf</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="1">
                    <Field.Label color="var(--color-text)">Display</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={display}
                            onChange={e => setParam(PARAM_DISPLAY, e.target.value === 'points' ? null : e.target.value)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            _focusVisible={{ borderColor: 'var(--color-primary)' }}
                        >
                            <option value="points">Points</option>
                            <option value="smooth">Smooth</option>
                            <option value="both">Both</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="2">
                    <Field.Label color="var(--color-text)">Benchmarks</Field.Label>
                    <Popover.Root positioning={{ placement: 'bottom-start' }}>
                        <Popover.Trigger asChild>
                            <Button
                                size="sm"
                                variant="outline"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                bg="var(--color-bg-card)"
                                width="100%"
                                justifyContent="space-between"
                                fontWeight="normal"
                            >
                                <Text fontSize="sm">{benchLabel}</Text>
                                {!allSelected && (
                                    <Badge size="sm" colorPalette="blue" ml={2}>
                                        {effectiveSelected.length}
                                    </Badge>
                                )}
                            </Button>
                        </Popover.Trigger>
                        <Popover.Positioner>
                            <Popover.Content
                                bg="var(--color-bg-card)"
                                borderColor="var(--color-border)"
                                boxShadow="lg"
                                minW="260px"
                                maxW="340px"
                            >
                                <Popover.Body p={0}>
                                    <HStack px={3} py={2} borderBottom="1px solid var(--color-border)" gap={2}>
                                        <Button size="xs" variant="ghost" color="var(--color-primary)" onClick={selectAll} flex="1">
                                            Select all
                                        </Button>
                                        <Box w="1px" h="16px" bg="var(--color-border)" />
                                        <Button size="xs" variant="ghost" color="var(--color-text-muted)" onClick={clearAll} flex="1">
                                            Clear
                                        </Button>
                                    </HStack>
                                    <VStack
                                        align="stretch"
                                        gap={0}
                                        maxH="340px"
                                        overflowY="auto"
                                        px={1}
                                        py={1}
                                    >
                                        {allBenches.map(bench => (
                                            <Box
                                                key={bench}
                                                display="flex"
                                                alignItems="center"
                                                gap={2}
                                                px={2}
                                                py={1.5}
                                                borderRadius="sm"
                                                _hover={{ bg: 'var(--color-bg-page)' }}
                                                cursor="pointer"
                                                userSelect="none"
                                                onClick={() => toggleBench(bench)}
                                            >
                                                <Checkbox.Root
                                                    checked={effectiveSelected.includes(bench)}
                                                    pointerEvents="none"
                                                    tabIndex={-1}
                                                >
                                                    <Checkbox.HiddenInput />
                                                    <Checkbox.Control borderColor="var(--color-border)" flexShrink={0} />
                                                </Checkbox.Root>
                                                <Text color="var(--color-text)" fontSize="sm" fontFamily="mono">
                                                    {bench}
                                                </Text>
                                            </Box>
                                        ))}
                                        {allBenches.length === 0 && (
                                            <Text px={3} py={2} color="var(--color-text-muted)" fontSize="sm">
                                                No data loaded yet.
                                            </Text>
                                        )}
                                    </VStack>
                                </Popover.Body>
                            </Popover.Content>
                        </Popover.Positioner>
                    </Popover.Root>
                </Field.Root>

                <HStack gap={2} flexShrink={0} pb={0.5}>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportPng}
                        disabled={!hasData || exporting}
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        whiteSpace="nowrap"
                    >
                        {exporting ? 'Saving…' : 'Save PNG'}
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
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportPerBenchmark}
                        disabled={!hasData || exportingPerBench || !vegaEmbed}
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        whiteSpace="nowrap"
                    >
                        {exportingPerBench ? `Saving ${exportProgress}…` : 'Save per benchmark'}
                    </Button>
                </HStack>
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
                    ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                            <Text color="var(--color-text-muted)">No benchmarks selected.</Text>
                        </Box>
                    )
                ) : (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                        <Text color="var(--color-text-muted)">Loading scaling data…</Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default Scaling;
