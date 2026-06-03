import { useCallback } from 'react';
import { Box, Heading, Center, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { Pack } from '../../services/types';
import VegaPlot from '../charts/VegaPlot';

interface MetricsViewProps {
    selectedPack: Pack;
    executionId: number;
}

export const MetricsView = ({ selectedPack, executionId }: MetricsViewProps) => {
    const packIdentifier = selectedPack
        ? (selectedPack._id === 0 ? selectedPack.name : selectedPack._id)
        : null;

    const { data: metricsData } = useQuery({
        queryKey: ['packMetrics', executionId, packIdentifier],
        queryFn: async () => {
            const response = await api.get(`/exec/${executionId}/packs/${packIdentifier}/metrics`);
            return response.data;
        },
        enabled: !!packIdentifier,
    });

    const HIDDEN_METRICS = new Set([
        '__iter__', 'iter_create', 'iter_start',
        'return_code', 'status', 'walltime',
    ]);
    const HIDDEN_PREFIXES = ['process.'];

    const specBuilder = useCallback((w: number, h: number) => {
        if (!metricsData || metricsData.length === 0) return null;

        const filtered = metricsData.filter((d: any) =>
            !HIDDEN_METRICS.has(d.name) &&
            !HIDDEN_PREFIXES.some((p) => d.name.startsWith(p))
        );
        if (filtered.length === 0) return null;

        const metricCount = new Set(filtered.map((d: any) => d.name)).size;
        const cols = Math.min(2, metricCount);
        const rows = Math.ceil(metricCount / cols);
        const cellPadding = 50;
        const cellWidth = Math.max(500, Math.floor((w - 150) / (cols)) - cellPadding);
        const cellHeight = Math.max(500/2, Math.floor(h / rows) - cellPadding);

        return {
            data: { values: filtered },
            facet: { field: 'name', type: 'nominal', title: 'Metric' },
            columns: cols,
            spec: {
                width: cellWidth,
                height: cellHeight,
                transform: [
                    { joinaggregate: [{ op: 'min', field: 'order', as: 'min_order' }], groupby: ['name'] },
                    { calculate: 'datum.order - datum.min_order', as: 'elapsed' },
                ],
                mark: 'line',
                encoding: {
                    x: { field: 'elapsed', type: 'quantitative', scale: { zero: true }, title: 'Elapsed (s)' },
                    y: { field: 'value', type: 'quantitative', scale: { zero: false } },
                    color: { field: 'gpu_id', type: 'ordinal' },
                    tooltip: [
                        { field: 'name', type: 'nominal', title: 'Metric' },
                        { field: 'gpu_id', type: 'ordinal', title: 'GPU' },
                        { field: 'value', type: 'quantitative', title: 'Value' },
                        { field: 'elapsed', type: 'quantitative', title: 'Elapsed (s)', format: '.1f' },
                        { field: 'unit', type: 'nominal', title: 'Unit' },
                    ],
                },
            },
            resolve: { scale: { y: 'independent', x: 'independent' } },
        } as Record<string, any>;
    }, [metricsData]);

    return (
        <Box
            p={3}
            width="100%"
            height="100vh"
            display="flex"
            flexDirection="column"
            className='metric-view'
        >
            <Heading as='h2' size='lg'>Metrics</Heading>
            {selectedPack ? (
                <Box flex="1" minH={0}>
                    {metricsData ? (
                        <VegaPlot
                            spec={specBuilder}
                            height="100%"
                            configOverrides={{ legend: { orient: 'right', direction: 'vertical' } }}
                        />
                    ) : (
                        <Center h="100%" p={4}>
                            <Text color="var(--color-text-muted)">Loading metrics data…</Text>
                        </Center>
                    )}
                </Box>
            ) : (
                <Center h="100%" p={4}>
                    <Text color="var(--color-text-muted)">Select a pack to view metrics</Text>
                </Center>
            )}
        </Box>
    );
};
