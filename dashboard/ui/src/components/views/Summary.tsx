import { useState } from 'react';
import { Box, Heading, Select } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { getSummary } from '../../services/api';
import { Loading } from '../common/Loading';
import { DataTable } from '../common/Table';
import type { Column } from '../common/Table';

interface SummaryData {
    name: string;
    value: string | number;
}

export const Summary = () => {
    const [selectedRun, setSelectedRun] = useState<string>('');

    const { data: summary, isLoading } = useQuery({
        queryKey: ['summary', selectedRun],
        queryFn: () => getSummary(selectedRun),
        enabled: !!selectedRun,
    });

    const columns: Column<SummaryData>[] = [
        { header: 'Metric', accessor: 'name' },
        { header: 'Value', accessor: 'value' },
    ];

    if (isLoading) {
        return <Loading message="Loading summary..." />;
    }

    const summaryData: SummaryData[] = summary
        ? Object.entries(summary).map(([name, value]) => ({
            name,
            value: String(value),
        }))
        : [];

    return (
        <Box>
            <Heading mb={6}>Summary</Heading>
            <Box mb={4}>
                <Select
                    placeholder="Select run"
                    value={selectedRun}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedRun(e.target.value)}
                >
                    {/* We'll populate this with actual runs later */}
                    <option value="run1">Run 1</option>
                    <option value="run2">Run 2</option>
                </Select>
            </Box>
            {summary && (
                <DataTable
                    data={summaryData}
                    columns={columns}
                />
            )}
        </Box>
    );
};