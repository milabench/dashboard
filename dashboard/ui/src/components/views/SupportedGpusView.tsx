import {
    Box,
    Text,
    HStack,
    Badge,
    Table,
    Spinner,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getGpuSummary, type GpuSummary } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { vendorBadgePalette } from '../../utils/gpuColors';
import { MilabenchVersion } from '../shared/MilabenchVersion';

function PassBar({ passed, total }: { passed: number; total: number }) {
    const pct = total > 0 ? (passed / total) * 100 : 0;

    let color: string;
    if (pct === 100) color = 'green';
    else if (pct >= 80) color = 'orange';
    else color = 'red';

    return (
        <HStack gap={2} w="220px" pr={4}>
            <Box w="100px" flexShrink={0} h="8px" bg="red.100" borderRadius="full" overflow="hidden">
                <Box h="100%" w={`${pct}%`} bg={`${color}.500`} borderRadius="full" transition="width 0.3s" />
            </Box>
            <HStack gap={1} flexShrink={0}>
                <Text fontSize="xs" fontWeight="semibold" color={`${color}.600`}>
                    {Number.isInteger(passed) ? passed : passed.toFixed(2)}/{total}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                    ({pct.toFixed(0)}%)
                </Text>
            </HStack>
        </HStack>
    );
}

function formatDate(iso: string | null): string {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function stripQuotes(s: string | null): string {
    if (!s || s === 'null') return '-';
    return s.replace(/^"|"$/g, '');
}

export const SupportedGpusView: React.FC = () => {
    usePageTitle('Milabench');

    const { data, isLoading, error } = useQuery<GpuSummary[]>({
        queryKey: ['gpuSummary'],
        queryFn: getGpuSummary,
    });

    if (isLoading) {
        return (
            <Box p={8} textAlign="center">
                <Spinner size="xl" />
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={8}>
                <Text color="red.500">Failed to load GPU summary.</Text>
            </Box>
        );
    }

    const rows = data ?? [];

    return (
        <Box p={6}>
            <Text fontSize="2xl" fontWeight="bold" mb={2}>
                Latest GPU runs
            </Text>
            <Text color="fg.muted" mb={6}>
                GPUs milabench has been ran on, with the latest run results.
            </Text>

            {rows.length === 0 ? (
                <Text color="fg.muted">No GPU data available.</Text>
            ) : (
                <Table.Root size="md" variant="outline">
                    <Table.Header>
                        <Table.Row>
                            <Table.ColumnHeader>GPU</Table.ColumnHeader>
                            <Table.ColumnHeader>GPUs</Table.ColumnHeader>
                            <Table.ColumnHeader>CPU</Table.ColumnHeader>
                            <Table.ColumnHeader>Arch</Table.ColumnHeader>
                            <Table.ColumnHeader>PyTorch</Table.ColumnHeader>
                            <Table.ColumnHeader>CUDA / ROCm</Table.ColumnHeader>
                            <Table.ColumnHeader>Milabench</Table.ColumnHeader>
                            <Table.ColumnHeader>Contributor</Table.ColumnHeader>
                            <Table.ColumnHeader>Benchmarks Passed</Table.ColumnHeader>
                            <Table.ColumnHeader>Last Tested</Table.ColumnHeader>
                            <Table.ColumnHeader>Run</Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {rows.map((row) => (
                            <Table.Row key={`${row.gpu}-${row.cpu_arch}-${row.gpu_count}-${row.gpu_memory}`}>
                                <Table.Cell>
                                    <Text fontWeight="semibold">{stripQuotes(row.gpu)}</Text>
                                </Table.Cell>
                                <Table.Cell>
                                    <Text fontWeight="semibold">
                                        {row.gpu_count}x
                                        {row.gpu_memory ? ` (${Math.round(row.gpu_memory / 1024)} GB)` : ''}
                                    </Text>
                                </Table.Cell>
                                <Table.Cell>
                                    <Badge colorPalette={row.cpu_arch === 'aarch64' ? 'orange' : 'blue'} variant="subtle">
                                        {row.cpu_arch}
                                    </Badge>
                                </Table.Cell>
                                <Table.Cell>
                                    <Badge colorPalette={vendorBadgePalette(stripQuotes(row.arch))} variant="subtle">
                                        {stripQuotes(row.arch).toUpperCase()}
                                    </Badge>
                                </Table.Cell>
                                <Table.Cell>{stripQuotes(row.pytorch)}</Table.Cell>
                                <Table.Cell>{stripQuotes(row.accel_version)}</Table.Cell>
                                <Table.Cell>
                                    <MilabenchVersion
                                        tag={row.milabench_tag ? stripQuotes(row.milabench_tag) : null}
                                        commit={row.milabench_commit ? stripQuotes(row.milabench_commit) : null}
                                        fallback="-"
                                    />
                                </Table.Cell>
                                <Table.Cell>{stripQuotes(row.contributor)}</Table.Cell>
                                <Table.Cell>
                                    <PassBar passed={row.passed} total={row.total} />
                                </Table.Cell>
                                <Table.Cell>{formatDate(row.latest_date)}</Table.Cell>
                                <Table.Cell>
                                    <Link to={`/executions/${row.exec_id}`}>
                                        <Text color="blue.500" _hover={{ textDecoration: 'underline' }} cursor="pointer">
                                            {row.run_name ?? `#${row.exec_id}`}
                                        </Text>
                                    </Link>
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table.Root>
            )}
        </Box>
    );
};

export default SupportedGpusView;
