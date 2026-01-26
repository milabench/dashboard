import { useEffect } from 'react';
import { Box, Heading, Text, Badge } from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getExecutions } from '../../services/api';
import type { Execution } from '../../services/types';
import { DataTable } from '../common/Table';
import { Loading } from '../common/Loading';
import type { Column } from '../common/Table';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useColorModeValue } from '../ui/color-mode';

const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
};

export const Executions = () => {
    usePageTitle('Latest Executions');

    const navigate = useNavigate();
    const { data: executions, isLoading, error } = useQuery<Execution[]>({
        queryKey: ['executions'],
        queryFn: getExecutions,
        retry: 1,
        refetchInterval: 30000, // Refetch every 30 seconds
    });

    // Theme-aware colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');

    const columns: Column<Execution>[] = [
        {
            header: 'ID',
            accessor: '_id',
            width: '80px',
        },
        {
            header: 'Name',
            accessor: (exec: Execution) => exec.name || 'N/A',
            width: '200px',
        },
        {
            header: 'GPU',
            accessor: (exec: Execution) => {
                const gpus = exec.meta?.accelerators?.gpus;
                if (!gpus) return 'N/A';
                // Get the first GPU from the object
                const firstGpu = Object.values(gpus)[0];
                return firstGpu?.product || 'N/A';
            },
            width: '200px',
        },
        {
            header: 'PyTorch',
            accessor: (exec: Execution) => exec.meta?.pytorch?.torch || 'N/A',
            width: '120px',
        },
        {
            header: 'Milabench',
            accessor: (exec: Execution) => exec.meta?.milabench?.tag || 'N/A',
            width: '120px',
        },
        {
            header: 'Status',
            accessor: (exec: Execution) => (
                <Badge
                    colorScheme={exec.status === 'completed' ? 'green' : exec.status === 'failed' ? 'red' : 'yellow'}
                >
                    {exec.status}
                </Badge>
            ),
            width: '100px',
        },
        // {
        //     header: 'Duration',
        //     accessor: (exec: Execution) => formatDuration(exec.walltime),
        //     width: '100px',
        // },
        {
            header: 'Timestamp',
            accessor: (exec: Execution) => formatDate(exec.meta?.timestamp || new Date().toISOString()),
            width: '180px',
        },
    ];

    useEffect(() => {
        if (error) {
            toaster.create({
                title: 'Error loading executions',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        }
    }, [error]);

    if (isLoading) {
        return <Loading message="Loading executions..." />;
    }

    return (
        <Box p={4} bg={pageBg} minH="100vh">
            <Heading mb={6} color={textColor}>Executions</Heading>
            {executions && executions.length > 0 ? (
                <DataTable
                    data={executions}
                    columns={columns}
                    onRowClick={(execution) => {
                        navigate(`/executions/${execution._id}`);
                    }}
                />
            ) : (
                <Text color={mutedTextColor}>No executions found</Text>
            )}
        </Box>
    );
};