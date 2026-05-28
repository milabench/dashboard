import React, { useState, useCallback } from 'react';
import {
    Box,
    HStack,
    NativeSelect,
    Field,
    Text,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot from '../charts/VegaPlot';

const Scaling = () => {
    usePageTitle('Scaling');

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

    const specBuilder = useCallback((w: number, h: number) => {
        if (!scalingData || scalingData.length === 0) return null;

        const benchCount = new Set(scalingData.map((d: any) => d.bench)).size;
        const cols = Math.min(4, benchCount);
        const rows = Math.ceil(benchCount / cols);
        const cellPadding = 50;
        const cellWidth = Math.max(120, Math.floor(w / (cols + 1)) - cellPadding);
        const cellHeight = Math.max(cellWidth, Math.floor(h / rows) - cellPadding);

        return {
            data: { values: scalingData },
            facet: { field: 'bench', type: 'nominal', title: 'Benchmark' },
            columns: cols,
            spec: {
                width: cellWidth,
                height: cellHeight,
                mark: 'point',
                encoding: {
                    x: { field: xAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
                    y: { field: yAxis, type: 'quantitative', scale: { zero: false }, axis: { format: '~s' } },
                    shape: { field: 'gpu', type: 'nominal' },
                    color: { field: 'gpu', type: 'nominal' },
                    size: { field: 'perf', type: 'quantitative', legend: null },
                    tooltip: [
                        { field: 'bench', type: 'nominal', title: 'Benchmark' },
                        { field: 'gpu', type: 'nominal', title: 'GPU' },
                        { field: xAxis, type: 'quantitative', title: xAxis, format: '~s' },
                        { field: yAxis, type: 'quantitative', title: yAxis, format: '~s' },
                        { field: 'perf', type: 'quantitative', title: 'perf', format: '~s' },
                    ],
                },
            },
            resolve: { scale: { y: 'independent', x: 'independent', size: 'independent' } },
        } as Record<string, any>;
    }, [scalingData, xAxis, yAxis]);

    return (
        <Box p={4} h="100%" display="flex" flexDirection="column" overflowX="hidden" overflowY="auto" className='scaling-container' bg="var(--color-bg-page)">
            <HStack gap={4} mb={4} width="100%" flexShrink={0}>
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
            </HStack>

            <Box flex="1" minH={0}>
                {scalingData ? (
                    <VegaPlot
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
