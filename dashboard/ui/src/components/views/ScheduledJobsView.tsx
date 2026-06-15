import React, { useState, useCallback } from 'react';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Badge,
    Table,
    Spinner,
    Card,
    Grid,
    Code,
    Link,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { LuPlay, LuTrash2, LuPower, LuChevronDown, LuChevronRight, LuCircleAlert } from 'react-icons/lu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toaster } from '../ui/toaster';
import { Tooltip } from '../ui/tooltip';
import {
    getScheduledJobs,
    deleteScheduledJob,
    toggleScheduledJob,
    runScheduledJobNow,
    getScheduledJobRuns,
} from '../../services/api';
import type { ScheduledJob, ScheduledJobRun } from '../../services/types';

const CRON_PRESETS: { label: string; cron: string }[] = [
    { label: 'Daily at midnight',      cron: '0 0 * * *' },
    { label: 'Weekly on Sunday at 2am', cron: '0 2 * * 0' },
    { label: 'Monthly on the 1st',     cron: '0 0 1 * *' },
    { label: 'Weekdays at midnight',   cron: '0 0 * * 1-5' },
];

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso + 'Z').toLocaleString();
}

function cronHumanLabel(cron: string): string {
    const match = CRON_PRESETS.find(p => p.cron === cron);
    return match ? match.label : cron;
}

// ─── Run history sub-component ──────────────────────────────────────

const RunHistory: React.FC<{ jobId: number }> = ({ jobId }) => {
    const { data: runs, isLoading } = useQuery<ScheduledJobRun[]>({
        queryKey: ['scheduled-runs', jobId],
        queryFn: () => getScheduledJobRuns(jobId),
        refetchInterval: 30_000,
    });

    if (isLoading) return <Spinner size="sm" />;
    if (!runs || runs.length === 0)
        return <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">No runs yet.</Text>;

    return (
        <Table.Root size="sm" variant="outline">
            <Table.Header>
                <Table.Row>
                    <Table.ColumnHeader>Submitted</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Job Runner ID</Table.ColumnHeader>
                    <Table.ColumnHeader>Error</Table.ColumnHeader>
                </Table.Row>
            </Table.Header>
            <Table.Body>
                {runs.map((r) => (
                    <Table.Row key={r._id}>
                        <Table.Cell>{formatDate(r.submitted_at)}</Table.Cell>
                        <Table.Cell>
                            <Badge colorPalette={r.status === 'submitted' ? 'green' : 'red'} variant="subtle">
                                {r.status}
                            </Badge>
                        </Table.Cell>
                        <Table.Cell fontSize="xs" fontFamily="mono">
                            {r.jr_job_id && r.slurm_job_id ? (
                                <Link asChild colorPalette="blue">
                                    <RouterLink to={`/joblogs/${r.slurm_job_id}/${r.jr_job_id}`}>
                                        {r.jr_job_id}
                                    </RouterLink>
                                </Link>
                            ) : (
                                r.jr_job_id || '—'
                            )}
                        </Table.Cell>
                        <Table.Cell>
                            {r.error ? (
                                <Tooltip
                                    content={
                                        <Box
                                            as="pre"
                                            fontSize="xs"
                                            fontFamily="mono"
                                            whiteSpace="pre-wrap"
                                            wordBreak="break-all"
                                            maxW="500px"
                                            maxH="300px"
                                            overflowY="auto"
                                        >
                                            {r.error}
                                        </Box>
                                    }
                                    showArrow
                                    openDelay={200}
                                >
                                    <Button variant="ghost" size="xs" colorPalette="red">
                                        <LuCircleAlert />
                                        Error
                                    </Button>
                                </Tooltip>
                            ) : '—'}
                        </Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table.Root>
    );
};

// ─── Main View ──────────────────────────────────────────────────────

export const ScheduledJobsView: React.FC = () => {
    const queryClient = useQueryClient();
    const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

    const { data: jobs, isLoading } = useQuery<ScheduledJob[]>({
        queryKey: ['scheduled-jobs'],
        queryFn: getScheduledJobs,
        refetchInterval: 30_000,
    });

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
    }, [queryClient]);

    const deleteMut = useMutation({
        mutationFn: deleteScheduledJob,
        onSuccess: invalidate,
    });

    const toggleMut = useMutation({
        mutationFn: toggleScheduledJob,
        onSuccess: invalidate,
    });

    const runNowMut = useMutation({
        mutationFn: runScheduledJobNow,
        onSuccess: (data) => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ['scheduled-runs'] });
            toaster.create({
                title: data.status === 'submitted' ? 'Job submitted' : 'Submission failed',
                type: data.status === 'submitted' ? 'success' : 'error',
                duration: 4000,
            });
        },
    });

    const toggleExpand = (id: number) => setExpandedJobId(prev => prev === id ? null : id);

    return (
        <Box p={6} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={5} maxW="1400px" mx="auto">
                <HStack justify="space-between" align="center">
                    <Heading size="lg" fontWeight="bold" color="var(--color-text)">Scheduled Slurm Jobs</Heading>
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        Create new schedules from the <b>Submit Job</b> page.
                    </Text>
                </HStack>

                {isLoading && <Spinner />}

                {jobs && jobs.length === 0 && (
                    <Text color="var(--color-text-muted)" fontStyle="italic">
                        No scheduled jobs yet. Go to Submit Job and use "Save as Scheduled Job" to create one.
                    </Text>
                )}

                {jobs && jobs.length > 0 && (
                    <Table.Root variant="outline" size="md">
                        <Table.Header>
                            <Table.Row>
                                <Table.ColumnHeader w="30px"></Table.ColumnHeader>
                                <Table.ColumnHeader>Name</Table.ColumnHeader>
                                <Table.ColumnHeader>Schedule</Table.ColumnHeader>
                                <Table.ColumnHeader>Cluster</Table.ColumnHeader>
                                <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                                <Table.ColumnHeader>Last Run</Table.ColumnHeader>
                                <Table.ColumnHeader>Next Run</Table.ColumnHeader>
                                <Table.ColumnHeader textAlign="right">Actions</Table.ColumnHeader>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {jobs.map((job) => (
                                <React.Fragment key={job._id}>
                                    <Table.Row
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        cursor="pointer"
                                        onClick={() => toggleExpand(job._id)}
                                    >
                                        <Table.Cell>
                                            {expandedJobId === job._id ? <LuChevronDown /> : <LuChevronRight />}
                                        </Table.Cell>
                                        <Table.Cell fontWeight="medium">{job.name}</Table.Cell>
                                        <Table.Cell>
                                            <VStack align="start" gap={0}>
                                                <Text fontSize="sm">{cronHumanLabel(job.cron_expression)}</Text>
                                                <Text fontSize="xs" color="var(--color-text-muted)" fontFamily="mono">{job.cron_expression}</Text>
                                            </VStack>
                                        </Table.Cell>
                                        <Table.Cell><Badge variant="outline">{job.cluster}</Badge></Table.Cell>
                                        <Table.Cell>
                                            <Badge colorPalette={job.enabled ? 'green' : 'gray'} variant="subtle">
                                                {job.enabled ? 'Enabled' : 'Disabled'}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell fontSize="sm">{formatDate(job.last_run_time)}</Table.Cell>
                                        <Table.Cell fontSize="sm">{job.enabled ? formatDate(job.next_run_time) : '—'}</Table.Cell>
                                        <Table.Cell textAlign="right">
                                            <HStack gap={1} justify="flex-end" onClick={e => e.stopPropagation()}>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    title={job.enabled ? 'Disable' : 'Enable'}
                                                    onClick={() => toggleMut.mutate(job._id)}
                                                    loading={toggleMut.isPending}
                                                >
                                                    <LuPower />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    title="Run now"
                                                    onClick={() => runNowMut.mutate(job._id)}
                                                    loading={runNowMut.isPending}
                                                >
                                                    <LuPlay />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    colorPalette="red"
                                                    title="Delete"
                                                    onClick={() => { if (window.confirm(`Delete "${job.name}"?`)) deleteMut.mutate(job._id); }}
                                                    loading={deleteMut.isPending}
                                                >
                                                    <LuTrash2 />
                                                </Button>
                                            </HStack>
                                        </Table.Cell>
                                    </Table.Row>
                                    {expandedJobId === job._id && (
                                        <Table.Row>
                                            <Table.Cell colSpan={8} p={4} bg="var(--color-bg-header)">
                                                <Grid templateColumns="1fr 1fr" gap={4}>
                                                    {/* Left: Job Config */}
                                                    <Card.Root variant="outline" p={3} bg="var(--color-bg-card)">
                                                        <VStack align="stretch" gap={3}>
                                                            <Heading size="sm">Configuration</Heading>
                                                            <HStack gap={6} flexWrap="wrap">
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Cluster</Text>
                                                                    <Text fontSize="sm" fontWeight="medium">{job.cluster}</Text>
                                                                </VStack>
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Cron</Text>
                                                                    <Code fontSize="sm">{job.cron_expression}</Code>
                                                                </VStack>
                                                                {job.job_name_prefix && (
                                                                    <VStack align="start" gap={0}>
                                                                        <Text fontSize="xs" color="var(--color-text-muted)">Job Name Prefix</Text>
                                                                        <Text fontSize="sm" fontWeight="medium">{job.job_name_prefix}</Text>
                                                                    </VStack>
                                                                )}
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Created</Text>
                                                                    <Text fontSize="sm">{formatDate(job.created_time)}</Text>
                                                                </VStack>
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Modified</Text>
                                                                    <Text fontSize="sm">{formatDate(job.modified_time)}</Text>
                                                                </VStack>
                                                            </HStack>
                                                            {job.sbatch_args && job.sbatch_args.length > 0 && (
                                                                <VStack align="start" gap={1}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Sbatch Arguments</Text>
                                                                    <HStack gap={1} flexWrap="wrap">
                                                                        {job.sbatch_args.map((arg, i) => (
                                                                            <Badge key={i} variant="outline" fontFamily="mono" fontSize="xs">{arg}</Badge>
                                                                        ))}
                                                                    </HStack>
                                                                </VStack>
                                                            )}
                                                            <VStack align="start" gap={1}>
                                                                <Text fontSize="xs" color="var(--color-text-muted)">Script</Text>
                                                                <Box
                                                                    as="pre"
                                                                    fontSize="xs"
                                                                    fontFamily="mono"
                                                                    bg="var(--color-bg-page)"
                                                                    p={3}
                                                                    borderRadius="md"
                                                                    borderWidth="1px"
                                                                    borderColor="var(--color-border)"
                                                                    w="100%"
                                                                    maxH="300px"
                                                                    overflowY="auto"
                                                                    whiteSpace="pre-wrap"
                                                                    wordBreak="break-all"
                                                                >
                                                                    {job.script}
                                                                </Box>
                                                            </VStack>
                                                        </VStack>
                                                    </Card.Root>

                                                    {/* Right: Run History */}
                                                    <Card.Root variant="outline" p={3} bg="var(--color-bg-card)">
                                                        <VStack align="stretch" gap={3}>
                                                            <Heading size="sm">Run History</Heading>
                                                            <RunHistory jobId={job._id} />
                                                        </VStack>
                                                    </Card.Root>
                                                </Grid>
                                            </Table.Cell>
                                        </Table.Row>
                                    )}
                                </React.Fragment>
                            ))}
                        </Table.Body>
                    </Table.Root>
                )}
            </VStack>
        </Box>
    );
};
