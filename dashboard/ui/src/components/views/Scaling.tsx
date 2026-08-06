import React, { useState, useCallback, useRef } from 'react';
import {
    Box,
    HStack,
    NativeSelect,
    Field,
    Text,
    Button,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { buildVendorColorScale, cssColor, guessVendor } from '../../utils/gpuColors';
import { downloadJson, safeFilename } from '../../utils/download';

const Scaling = () => {
    usePageTitle('Scaling');
    const plotRef = useRef<VegaPlotHandle>(null);
    const [exporting, setExporting] = useState(false);

    const [searchParams, setSearchParams] = useState({ x: 'memory', y: 'perf' });

    const xAxis = searchParams.x;
    const yAxis = searchParams.y;

    const handleXAxisChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSearchParams({ ...searchParams, x: event.target.value });
    };

    const handleYAxisChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSearchParams({ ...searchParams, y: event.target.value });
    };

    const { data: scalingData } = useQuery({
        queryKey: ['scalingData'],
        queryFn: async () => {
            const response = await api.get('/scaling');
            return response.data;
        },
    });

    const hasData = Array.isArray(scalingData) && scalingData.length > 0;

    const specBuilder = useCallback((w: number, h: number) => {
        if (!scalingData || scalingData.length === 0) return null;

        const values = scalingData.map((d: any) => ({
            ...d,
            vendor: guessVendor(String(d.gpu ?? '')),
        }));

        const benchCount = new Set(values.map((d: any) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const rows = Math.ceil(benchCount / cols);
        const cellPadding = 50;
        const cellWidth = Math.max(120, Math.floor(w / (cols + 1)) - cellPadding);
        const cellHeight = Math.max(cellWidth, Math.floor(h / rows) - cellPadding);
        const vendorScale = buildVendorColorScale(values.map((d: any) => d.vendor));
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
            condition: [
                // { param: 'gpuHover', value: 1 },
                { param: 'vendorHover', value: 1 },
            ],
            value: 0.5,
        };

        const strokeColor = {
            condition: [
                { param: 'gpuHover', value: cssColor('--color-bg-page', '#718096') },
                // { param: 'vendorHover', value: cssColor('--color-bg-page', '#718096') },
            ],
            value: cssColor('--color-bg-page', '#718096'),
        };
        const strokeWidthEmphasis = {
            condition: [
                { param: 'gpuHover', value: 1 },
                // { param: 'vendorHover', value: 1 },
            ],
            value: 2,
        };



        return {
            data: { values },
            facet: { field: 'bench', type: 'nominal', title: 'Benchmark' },
            columns: cols,
            spec: {
                width: cellWidth,
                height: cellHeight,
                layer: [
                    {
                        description: 'Transparent layer to make points easier to hover',
                        params: hoverParams,
                        mark: { type: 'point', filled: true, opacity: 0, size: 400, tooltip: null },
                        encoding: {
                            ...axisEncoding,
                            ...seriesEncoding,
                        },
                    },
                    {
                        mark: { type: 'point', filled: true, size: 120 },
                        encoding: {
                            ...axisEncoding,
                            ...seriesEncoding,

                            stroke: strokeColor,
                            strokeWidth: strokeWidthEmphasis,
                            opacity: highlightOpacity,

                            // size: { field: 'perf', type: 'quantitative', legend: null },
                            tooltip: [
                                { field: 'bench', type: 'nominal', title: 'Benchmark' },
                                { field: 'gpu', type: 'nominal', title: 'GPU' },
                                { field: 'vendor', type: 'nominal', title: 'Vendor' },
                                { field: xAxis, type: 'quantitative', title: xAxis, format: '~s' },
                                { field: yAxis, type: 'quantitative', title: yAxis, format: '~s' },
                                { field: 'perf', type: 'quantitative', title: 'perf', format: '~s' },
                            ],
                        },
                    },
                ],
            },
            resolve: { scale: { y: 'independent', x: 'independent', size: 'independent' } },
        } as Record<string, any>;
    }, [scalingData, xAxis, yAxis]);

    const handleExportJson = () => {
        if (!hasData) return;
        downloadJson(
            {
                x: xAxis,
                y: yAxis,
                observations: scalingData,
            },
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

    return (
        <Box p={4} h="100%" display="flex" flexDirection="column" overflowX="hidden" overflowY="auto" className='scaling-container' bg="var(--color-bg-page)">
            <HStack gap={4} mb={4} width="100%" flexShrink={0} alignItems="flex-end">
                <Field.Root flex="1">
                    <Field.Label color="var(--color-text)">X Axis</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={xAxis}
                            onChange={handleXAxisChange}
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
                            onChange={handleYAxisChange}
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
                </HStack>
            </HStack>

            <Box flex="1" minH={0}>
                {scalingData ? (
                    <VegaPlot
                        ref={plotRef}
                        spec={specBuilder}
                        height="100%"
                        configOverrides={{ legend: { orient: 'right', direction: 'vertical' } }}
                    />
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
