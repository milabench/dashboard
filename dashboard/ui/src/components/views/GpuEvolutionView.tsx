import React, { useState, useCallback } from 'react';
import {
    Box,
    Button,
    Heading,
    HStack,
    NativeSelect,
    Field,
    Text,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot from '../charts/VegaPlot';

interface GpuEvolutionRecord {
    name: string;
    vendor: string;
    architecture: string;
    release: string;
    fp4: number | null;
    fp8: number | null;
    fp16: number | null;
    fp32: number | null;
    fp64: number | null;
    tf32: number | null;
    memgb: number | null;
    membw: number | null;
    tdp: number | null;
    fp4_per_watt: number | null;
    fp8_per_watt: number | null;
    fp16_per_watt: number | null;
    fp32_per_watt: number | null;
    fp64_per_watt: number | null;
    tf32_per_watt: number | null;
    membw_per_watt: number | null;
}

type MetricKey = 'fp64' | 'fp32' | 'tf32' | 'fp16' | 'fp8' | 'fp4' | 'membw' | 'memgb';

const METRICS: { key: MetricKey; label: string; unit: string }[] = [
    { key: 'fp64',  label: 'FP64',        unit: 'TFLOPS' },
    { key: 'fp32',  label: 'FP32',        unit: 'TFLOPS' },
    { key: 'tf32',  label: 'TF32',        unit: 'TFLOPS' },
    { key: 'fp16',  label: 'FP16 Tensor', unit: 'TFLOPS' },
    { key: 'fp8',   label: 'FP8',         unit: 'TFLOPS' },
    { key: 'fp4',   label: 'FP4',         unit: 'TFLOPS' },
    { key: 'membw', label: 'Mem BW',      unit: 'GB/s' },
    { key: 'memgb', label: 'Memory',      unit: 'GB' },
];

function exportCsv(data: GpuEvolutionRecord[]) {
    const cols: (keyof GpuEvolutionRecord)[] = [
        'name', 'vendor', 'architecture', 'release',
        'fp4', 'fp8', 'fp16', 'fp32', 'fp64', 'tf32',
        'memgb', 'membw', 'tdp',
        'fp4_per_watt', 'fp8_per_watt', 'fp16_per_watt',
        'fp32_per_watt', 'fp64_per_watt', 'tf32_per_watt',
        'membw_per_watt',
    ];
    const header = cols.join(',');
    const rows = data.map(r =>
        cols.map(c => {
            const v = r[c];
            if (v == null) return '';
            if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
            return String(v);
        }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gpu_specs.csv';
    a.click();
    URL.revokeObjectURL(url);
}

export const GpuComparisonView: React.FC = () => {
    usePageTitle('Theoretical FLOPS Spec Comparison');

    const [vendor, setVendor] = useState<string>('');
    const [metric, setMetric] = useState<MetricKey>('fp16');
    const [showPerWatt, setShowPerWatt] = useState<string>('absolute');

    const { data: gpuData } = useQuery<GpuEvolutionRecord[]>({
        queryKey: ['gpuEvolution', vendor],
        queryFn: async () => {
            const params = vendor ? { vendor } : {};
            const response = await api.get('/gpu/specs/evolution', { params });
            return response.data;
        },
    });

    const specBuilder = useCallback((w: number, h: number) => {
        if (!gpuData || gpuData.length === 0) return null;

        const isPerWatt = showPerWatt === 'per_watt';
        const field = isPerWatt ? `${metric}_per_watt` : metric;
        const metaInfo = METRICS.find(m => m.key === metric);
        const yTitle = isPerWatt ? `${metaInfo?.unit}/W` : (metaInfo?.unit || '');

        const filtered = gpuData.filter((d: any) => d[field] != null);
        if (filtered.length === 0) return null;

        const chartWidth = Math.max(300, w - 200);
        const chartHeight = Math.max(250, h - 200);

        return {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values: filtered },
            title: `${metaInfo?.label || metric} ${isPerWatt ? '/ Watt' : ''} — GPU Compute Progression`,
            width: chartWidth,
            height: chartHeight,
            layer: [
                {
                    mark: { type: 'point', size: 120, filled: true },
                    encoding: {
                        x: {
                            field: 'release',
                            type: 'temporal',
                            title: 'Release Date',
                        },
                        y: {
                            field: field,
                            type: 'quantitative',
                            title: yTitle,
                            scale: { zero: false, type: 'log' },
                            axis: { format: '~s', titlePadding: 20 },
                        },
                        color: {
                            field: 'vendor',
                            type: 'nominal',
                            title: 'Vendor',
                            legend: { orient: 'bottom', direction: 'horizontal' },
                        },
                        shape: {
                            field: 'architecture',
                            type: 'nominal',
                            title: 'Architecture',
                            legend: {
                                orient: 'bottom',
                                direction: 'horizontal',
                                columns: 5,
                                symbolFillColor: '#888',
                                symbolStrokeColor: '#888',
                                labelColor: '#aaa',
                            },
                        },
                        tooltip: [
                            { field: 'name', type: 'nominal', title: 'GPU' },
                            { field: 'architecture', type: 'nominal', title: 'Arch' },
                            { field: field, type: 'quantitative', title: yTitle, format: '.3f' },
                            { field: 'tdp', type: 'quantitative', title: 'TDP (W)' },
                            { field: 'memgb', type: 'quantitative', title: 'Mem (GB)' },
                            { field: 'membw', type: 'quantitative', title: 'Mem BW (GB/s)' },
                            { field: 'release', type: 'temporal', title: 'Release' },
                        ],
                    },
                },
                {
                    mark: {
                        type: 'text',
                        align: 'left',
                        baseline: 'middle',
                        dx: 8,
                        dy: -8,
                        fontSize: 10,
                        angle: -25,
                    },
                    encoding: {
                        x: { field: 'release', type: 'temporal' },
                        y: {
                            field: field,
                            type: 'quantitative',
                            scale: { zero: false, type: 'log' },
                        },
                        text: { field: 'name', type: 'nominal' },
                        color: { field: 'vendor', type: 'nominal', legend: null },
                    },
                },
            ],
        } as Record<string, any>;
    }, [gpuData, metric, showPerWatt]);

    const hasData = gpuData && gpuData.length > 0;
    const isPerWatt = showPerWatt === 'per_watt';
    const activeField = isPerWatt ? `${metric}_per_watt` : metric;
    const hasMatchingData = hasData && gpuData.some((d: any) => d[activeField] != null);

    return (
        <Box p={4} h="100%" display="flex" flexDirection="column" overflowX="hidden" overflowY="auto" bg="var(--color-bg-page)">
            <Heading as="h1" size="lg" mb={4} color="var(--color-text)" flexShrink={0}>
                Theoretical FLOPS Spec Comparison
            </Heading>
            <HStack gap={4} mb={4} width="100%" flexShrink={0} flexWrap="nowrap" alignItems="flex-end">
                <Field.Root flex="1" minW="140px">
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
                                <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>
                            ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="1" minW="140px">
                    <Field.Label color="var(--color-text)">Mode</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={showPerWatt}
                            onChange={(e) => setShowPerWatt(e.target.value)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        >
                            <option value="absolute">Absolute</option>
                            <option value="per_watt">Per Watt</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="1" minW="140px">
                    <Field.Label color="var(--color-text)">Vendor</Field.Label>
                    <NativeSelect.Root>
                        <NativeSelect.Field
                            value={vendor}
                            onChange={(e) => setVendor(e.target.value)}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        >
                            <option value="">All</option>
                            <option value="nvidia">NVIDIA</option>
                            <option value="amd">AMD</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Field.Root>

                <Field.Root flex="0 0 auto" minW="auto">
                    <Field.Label color="var(--color-text)">&nbsp;</Field.Label>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => gpuData && exportCsv(gpuData)}
                        disabled={!gpuData || gpuData.length === 0}
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        whiteSpace="nowrap"
                    >
                        Export CSV
                    </Button>
                </Field.Root>
            </HStack>

            <Box flex="1" minH={0}>
                {!gpuData ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%">
                        <Text color="var(--color-text-muted)">Loading GPU data…</Text>
                    </Box>
                ) : !hasMatchingData ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%" flexDirection="column" gap={2}>
                        <Text color="var(--color-text-muted)" fontSize="lg">No data available</Text>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            No GPUs have {METRICS.find(m => m.key === metric)?.label || metric}{isPerWatt ? ' / Watt' : ''} data for the current selection.
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
    );
};

export default GpuComparisonView;
