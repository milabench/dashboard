import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Spinner, VStack, Text } from '@chakra-ui/react';
import { JobSubmissionForm } from './JobSubmit';
import {
    getSlurmTemplates,
    getSlurmProfiles,
    getSlurmJobs,
    getSlurmClusters,
} from '../../services/api';

export const JobSubmitView: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const { data: templateNames } = useQuery<string[]>({
        queryKey: ['slurm-templates'],
        queryFn: getSlurmTemplates,
        refetchOnWindowFocus: false,
        staleTime: 600000,
    });

    const { data: profiles } = useQuery({
        queryKey: ['slurm-profiles'],
        queryFn: getSlurmProfiles,
        refetchOnWindowFocus: false,
        staleTime: 300000,
    });

    const { data: activeJobs } = useQuery({
        queryKey: ['slurm-jobs'],
        queryFn: getSlurmJobs,
        refetchOnWindowFocus: false,
        staleTime: 30000,
    });

    const { data: clusters } = useQuery({
        queryKey: ['slurm-clusters'],
        queryFn: getSlurmClusters,
        refetchOnWindowFocus: false,
        staleTime: 600000,
    });

    const initialData = useMemo(() => {
        const template = searchParams.get('template');
        const jobName = searchParams.get('job_name');

        if (template || jobName) {
            return {
                job_name: jobName || '',
                script: '',
            };
        }
        return undefined;
    }, [searchParams]);

    if (!profiles) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="80vh">
                <VStack gap={4}>
                    <Spinner size="xl" />
                    <Text color="var(--color-text-muted)">Loading...</Text>
                </VStack>
            </Box>
        );
    }

    return (
        <JobSubmissionForm
            templates={templateNames || []}
            profiles={profiles || []}
            clusters={clusters || []}
            activeJobs={activeJobs || []}
            onClose={() => navigate('/jobs')}
            initialData={initialData}
        />
    );
};
