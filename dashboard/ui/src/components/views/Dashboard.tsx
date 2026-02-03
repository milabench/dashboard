import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Badge,
    Table,
    Dialog,
    Card,
    Spinner,
    Alert,
    IconButton,
    useToken,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import { Tooltip } from '../ui/tooltip';
import {
    LuPlus,
    LuEye,
    LuTrash2,
    LuRefreshCw,
    LuInfo,
    LuCircleCheck,
    LuTriangleAlert,
    LuClock,
} from 'react-icons/lu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { JobSubmissionForm } from './JobSubmit';
import {
    getSlurmJobs,
    getSlurmPersistedJobs,
    cancelSlurmJob,
    rerunSlurmJob,
    getSlurmTemplates,
    getSlurmProfiles,
    getSlurmClusterStatus,
} from '../../services/api';
import type { SlurmJob, PersitedJobInfo } from '../../services/types';
import { usePageTitle } from '../../hooks/usePageTitle';
import { NO_JOB_ID, NO_JOB_STATE, NO_JR_JOB_ID } from '../../Constant';

interface DashboardViewProps {
    // Add props as needed
}

const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'r':
            return 'green';
        case 'pending':
        case 'pd':
            return 'yellow';
        case 'completed':
        case 'cd':
            return 'blue';
        case 'failed':
        case 'f':
            return 'red';
        case 'cancelled':
        case 'ca':
            return 'gray';
        default:
            return 'gray';
    }
};

const getStatusIcon = (status: string, runningColor: string, pendingColor: string, completedColor: string, failedColor: string, defaultColor: string) => {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'r':
            return <LuCircleCheck color={runningColor} />;
        case 'pending':
        case 'pd':
            return <LuClock color={pendingColor} />;
        case 'completed':
        case 'cd':
            return <LuCircleCheck color={completedColor} />;
        case 'failed':
        case 'f':
            return <LuTriangleAlert color={failedColor} />;
        default:
            return <LuInfo color={defaultColor} />;
    }
};

export const DashboardView: React.FC<DashboardViewProps> = () => {
    usePageTitle('Dashboard');

    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const onOpen = () => setIsOpen(true);
    const onClose = () => setIsOpen(false);

    // Theme-friendly colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const headerBg = useColorModeValue('gray.50', 'gray.750');
    const textColor = useColorModeValue('gray.700', 'gray.300');
    const mutedTextColor = useColorModeValue('gray.500', 'gray.400');
    const shadow = useColorModeValue('sm', 'dark-lg');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.750');
    const rowStripeBg = useColorModeValue('gray.25', 'gray.750');

    // Status icon colors - theme-aware
    const [green500, green400] = useToken('colors', ['green.500', 'green.400']);
    const [yellow500, yellow400] = useToken('colors', ['yellow.500', 'yellow.400']);
    const [blue500, blue400] = useToken('colors', ['blue.500', 'blue.400']);
    const [red500, red400] = useToken('colors', ['red.500', 'red.400']);
    const [gray500, gray400] = useToken('colors', ['gray.500', 'gray.400']);
    const [freshnessGreenLight, freshnessBrown] = useToken('colors', ['green.500', 'orange.800']);
    const freshnessGreen = useColorModeValue(freshnessGreenLight, green400);
    const runningIconColor = useColorModeValue(green500, green400);
    const pendingIconColor = useColorModeValue(yellow500, yellow400);
    const completedIconColor = useColorModeValue(blue500, blue400);
    const failedIconColor = useColorModeValue(red500, red400);
    const defaultIconColor = useColorModeValue(gray500, gray400);

    // Helper function to convert hex to RGB
    const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
            : [34, 197, 94]; // fallback to green
    };

    // Button colors - theme-aware
    const submitButtonBg = useColorModeValue('blue.500', 'blue.400');
    const submitButtonHoverBg = useColorModeValue('blue.600', 'blue.300');
    const submitButtonColor = useColorModeValue('white', 'gray.900');


    // Queries
    const { data: activeJobsData, isLoading: activeJobsLoading, error: activeJobsError } = useQuery({
        queryKey: ['slurm-jobs'],
        queryFn: getSlurmJobs,
        refetchOnWindowFocus: false,
        staleTime: 30000, // Consider data fresh for 30 seconds
    });

    const { data: persistedJobsData, isLoading: persistedJobsLoading, error: persistedJobsError } = useQuery<PersitedJobInfo[]>({
        queryKey: ['slurm-persisted-jobs'],
        queryFn: getSlurmPersistedJobs,
        refetchOnWindowFocus: false,
        staleTime: 30000, // Consider data fresh for 30 seconds
    });

    // Cached template names - kept fresh for 10 minutes
    const { data: templateNames } = useQuery<string[]>({
        queryKey: ['slurm-templates'],
        queryFn: getSlurmTemplates,
        refetchOnWindowFocus: false,
        staleTime: 600000, // Consider data fresh for 10 minutes
    });

    const { data: profiles } = useQuery({
        queryKey: ['slurm-profiles'],
        queryFn: getSlurmProfiles,
        refetchOnWindowFocus: false,
        staleTime: 300000, // Consider data fresh for 5 minutes
    });

    const { data: clusterStatus, isLoading: clusterStatusLoading } = useQuery({
        queryKey: ['slurm-cluster-status'],
        queryFn: getSlurmClusterStatus,
        refetchOnWindowFocus: false,
        staleTime: 30000, // Consider data fresh for 30 seconds
        refetchInterval: 60000, // Refetch every minute
        retry: false, // Don't retry on error to avoid excessive requests when cluster is down
    });

    // Separate active jobs and persisted jobs
    const activeJobs = activeJobsData || [];
    const persistedJobs = persistedJobsData || [];



    const cancelJobMutation = useMutation({
        mutationFn: cancelSlurmJob,
        onSuccess: (data) => {
            toaster.create({
                title: 'Job Cancelled',
                description: data.message || 'Job cancelled successfully',
                type: 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Cancellation Failed',
                description: error.message || 'Failed to cancel job',
                type: 'error',
                duration: 5000,
            });
        },
    });

    const rerunJobMutation = useMutation({
        mutationFn: rerunSlurmJob,
        onSuccess: (data) => {
            toaster.create({
                title: 'Job Rerun',
                description: data.message || 'Job rerun successfully',
                type: 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Error Rerunning Job',
                description: error?.response?.data?.error || 'Failed to rerun job',
                type: 'error',
                duration: 5000,
            });
        },
    });



    const handleCancelJob = (jobId: string) => {
        if (window.confirm(`Are you sure you want to cancel job ${jobId}?`)) {
            cancelJobMutation.mutate(jobId);
        }
    };

    const handleRerunJob = (jrJobId: string) => {
        if (window.confirm(`Are you sure you want to rerun job ${jrJobId}?`)) {
            rerunJobMutation.mutate(jrJobId);
        }
    };



    return (
        <Box p={6} h="100%" bg={pageBg}>
            <VStack align="stretch" gap={6} h="100%">

                {/* Header Section */}
                <Box>
                    <HStack justify="space-between" align="center" mb={4}>
                        <HStack gap={3} align="center">
                            <Heading size="xl" fontWeight="bold" color={textColor}>
                                Jobs Dashboard
                            </Heading>
                            {clusterStatusLoading ? (
                                <Tooltip
                                    positioning={{ placement: 'bottom', offset: { mainAxis: 8 } }}
                                    content="Checking cluster status..."
                                >
                                    <Spinner size="sm" />
                                </Tooltip>
                            ) : clusterStatus ? (
                                <Tooltip
                                    positioning={{ placement: 'bottom', offset: { mainAxis: 8 } }}
                                    content={
                                        clusterStatus.status === 'offline' && clusterStatus.reason
                                            ? `${clusterStatus.reason}`
                                            : clusterStatus.status === 'online'
                                                ? 'Cluster is online and ready to accept jobs'
                                                : 'Cluster status'
                                    }
                                >
                                    <Badge
                                        colorScheme={clusterStatus.status === 'online' ? 'green' : 'red'}
                                        variant="solid"
                                        fontSize="sm"
                                        px={4}
                                        py={1.5}
                                        borderRadius="full"
                                        cursor="help"
                                        fontWeight="medium"
                                    >
                                        {clusterStatus.status === 'online' ? '✓ Online' : '✗ Offline'}
                                    </Badge>
                                </Tooltip>
                            ) : (
                                <Tooltip
                                    positioning={{ placement: 'bottom', offset: { mainAxis: 8 } }}
                                    content="Unable to determine cluster status"
                                >
                                    <Badge
                                        colorScheme="gray"
                                        variant="solid"
                                        fontSize="sm"
                                        px={4}
                                        py={1.5}
                                        borderRadius="full"
                                        cursor="help"
                                        fontWeight="medium"
                                    >
                                        Status Unknown
                                    </Badge>
                                </Tooltip>
                            )}
                        </HStack>

                        <HStack gap={2}>
                            <Button
                                onClick={onOpen}
                                size="sm"
                                fontWeight="medium"
                                bg={submitButtonBg}
                                color={submitButtonColor}
                                _hover={{ bg: submitButtonHoverBg }}
                            >
                                <LuPlus style={{ marginRight: '4px', fontSize: '16px' }} />
                                Submit New Job
                            </Button>

                            <Button
                                variant="outline"
                                onClick={() => {
                                    queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
                                    queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
                                    queryClient.invalidateQueries({ queryKey: ['slurm-cluster-status'] });
                                }}
                                loading={activeJobsLoading || persistedJobsLoading || clusterStatusLoading}
                                size="sm"
                                fontWeight="medium"
                            >
                                <LuRefreshCw style={{ marginRight: '4px', fontSize: '16px' }} />
                                Refresh
                            </Button>
                        </HStack>
                    </HStack>
                </Box>

                {/* Active Jobs Table */}
                <Card.Root
                    bg={cardBg}
                    borderWidth="1px"
                    borderColor={borderColor}
                    borderRadius="lg"
                    boxShadow={shadow}
                    overflow="hidden"
                    padding="10px"
                >
                    <Card.Header
                        bg={headerBg}
                        borderBottomWidth="1px"
                        borderBottomColor={borderColor}
                        py={4}
                        px={6}
                    >
                        <HStack justify="space-between" align="center">
                            <Heading size="md" fontWeight="semibold" color={textColor}>
                                Active Jobs
                            </Heading>
                            <Badge
                                colorScheme="blue"
                                variant="subtle"
                                fontSize="xs"
                                px={2}
                                py={1}
                            >
                                {activeJobs.length} {activeJobs.length === 1 ? 'job' : 'jobs'}
                            </Badge>
                        </HStack>
                    </Card.Header>
                    <Card.Body p={0}>
                        {(activeJobsError) ? (
                            <Alert.Root status="error">
                                <Alert.Indicator />
                                <Alert.Content>
                                    <Alert.Title>Error loading active jobs!</Alert.Title>
                                    <Alert.Description>
                                        {(activeJobsError as any)?.message || 'Failed to load active jobs'}
                                    </Alert.Description>
                                </Alert.Content>
                            </Alert.Root>
                        ) : (activeJobsLoading) ? (
                            <Box textAlign="center" py={12}>
                                <Spinner size="lg" color="blue.500" />
                                <Text mt={4} color={mutedTextColor} fontSize="sm">
                                    Loading active jobs...
                                </Text>
                            </Box>
                        ) : (
                            <Box overflowX="auto">
                                {activeJobs.length === 0 ? (
                                    <Box textAlign="center" py={12}>
                                        <Text color={mutedTextColor} fontSize="md">
                                            No active jobs found
                                        </Text>
                                        <Text color={mutedTextColor} fontSize="sm" mt={2}>
                                            Submit a new job to get started
                                        </Text>
                                    </Box>
                                ) : (
                                    <Table.ScrollArea>
                                        <Table.Root variant="line" size="md">
                                            <Table.Header bg={headerBg}>
                                                <Table.Row>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} pl={6} pr={4} fontSize="sm">Job ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">JR Job ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Name</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Status</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">State Reason</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Partition</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">User</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Time</Table.ColumnHeader>
                                                    <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Actions</Table.ColumnHeader>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {activeJobs.map((job: SlurmJob, index: number) => (
                                                    <Table.Row
                                                        key={job.job_id}
                                                        _hover={{ bg: rowHoverBg }}
                                                        bg={index % 2 === 0 ? 'transparent' : rowStripeBg}
                                                    >
                                                        <Table.Cell pl={6} pr={4}>
                                                            <Text fontWeight="semibold" color={textColor}>
                                                                {job.job_id}
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text fontFamily="mono" fontSize="sm" color={mutedTextColor}>
                                                                {job.jr_job_id}
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{job.name || 'N/A'}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <HStack gap={2}>
                                                                {getStatusIcon(job.job_state?.[0] || '', runningIconColor, pendingIconColor, completedIconColor, failedIconColor, defaultIconColor)}
                                                                <Badge colorScheme={getStatusColor(job.job_state?.[0] || '')}>
                                                                    {job.job_state?.[0] || NO_JOB_STATE}
                                                                </Badge>
                                                            </HStack>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            {job.state_reason ? (
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content={job.state_description || 'No description available'}
                                                                >
                                                                    <Text cursor="help" maxW="150px" truncate>
                                                                        {job.state_reason}
                                                                    </Text>
                                                                </Tooltip>
                                                            ) : (
                                                                <Text color={mutedTextColor}>N/A</Text>
                                                            )}
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{job.partition || 'N/A'}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{job.user_name || 'N/A'}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>
                                                                {typeof job.time_limit === 'string'
                                                                    ? job.time_limit
                                                                    : job.time_limit?.number
                                                                        ? `${job.time_limit.number}min`
                                                                        : 'N/A'
                                                                }
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <HStack gap={2}>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content="View Details"
                                                                >
                                                                    <Link
                                                                        to={`/jobrunner/${job.job_id || NO_JOB_ID}/${typeof job.jr_job_id === 'string' ? job.jr_job_id : NO_JR_JOB_ID}`}
                                                                    >
                                                                        <IconButton
                                                                            aria-label="View job details"
                                                                            size="md"
                                                                            variant="ghost"
                                                                        >
                                                                            <LuInfo />
                                                                        </IconButton>
                                                                    </Link>
                                                                </Tooltip>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content="View Logs"
                                                                >
                                                                    <Link
                                                                        to={`/joblogs/${job.job_id}/${job.jr_job_id}`}
                                                                    >
                                                                        <IconButton
                                                                            aria-label="View job logs"
                                                                            size="md"
                                                                            variant="ghost"
                                                                        >
                                                                            <LuEye />
                                                                        </IconButton>
                                                                    </Link>
                                                                </Tooltip>
                                                                {(job.job_state?.[0]?.toLowerCase() === 'running' ||
                                                                    job.job_state?.[0]?.toLowerCase() === 'pending') && (
                                                                        <Tooltip
                                                                            positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                            content="Cancel Job"
                                                                        >
                                                                            <IconButton
                                                                                aria-label="Cancel job"
                                                                                size="md"
                                                                                variant="ghost"
                                                                                colorScheme="red"
                                                                                onClick={() => job.job_id && handleCancelJob(job.job_id)}
                                                                            >
                                                                                <LuTrash2 />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                            </HStack>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}
                                            </Table.Body>
                                        </Table.Root>
                                    </Table.ScrollArea>
                                )}
                            </Box>
                        )}
                    </Card.Body>
                </Card.Root>

                {/* Persisted Jobs Table */}
                <Card.Root
                    bg={cardBg}
                    borderWidth="1px"
                    borderColor={borderColor}
                    borderRadius="lg"
                    boxShadow={shadow}
                    overflow="hidden"
                    flex="1"
                    display="flex"
                    flexDirection="column"
                    padding="10px"
                >
                    <Card.Header
                        bg={headerBg}
                        borderBottomWidth="1px"
                        borderBottomColor={borderColor}
                        py={4}
                        px={6}
                    >
                        <HStack justify="space-between" align="center">
                            <Heading size="md" fontWeight="semibold" color={textColor}>
                                Persisted Jobs
                            </Heading>
                            <Badge
                                colorScheme="purple"
                                variant="subtle"
                                fontSize="xs"
                                px={2}
                                py={1}
                            >
                                {persistedJobs.length} {persistedJobs.length === 1 ? 'job' : 'jobs'}
                            </Badge>
                        </HStack>
                    </Card.Header>
                    <Card.Body overflowY="auto" p={0} flex="1">
                        {(persistedJobsError) ? (
                            <Alert.Root status="error">
                                <Alert.Indicator />
                                <Alert.Content>
                                    <Alert.Title>Error loading persisted jobs!</Alert.Title>
                                    <Alert.Description>
                                        {(persistedJobsError as any)?.message || 'Failed to load persisted jobs'}
                                    </Alert.Description>
                                </Alert.Content>
                            </Alert.Root>
                        ) : (persistedJobsLoading) ? (
                            <Box textAlign="center" py={12}>
                                <Spinner size="lg" color="blue.500" />
                                <Text mt={4} color={mutedTextColor} fontSize="sm">
                                    Loading persisted jobs...
                                </Text>
                            </Box>
                        ) : (
                            <>
                                {persistedJobs.length === 0 ? (
                                    <Box textAlign="center" py={12}>
                                        <Text color={mutedTextColor} fontSize="md">
                                            No persisted jobs found
                                        </Text>
                                        <Text color={mutedTextColor} fontSize="sm" mt={2}>
                                            Completed jobs will appear here
                                        </Text>
                                    </Box>
                                ) : (
                                    <Table.Root variant="line" size="md">
                                        <Table.Header bg={headerBg}>
                                            <Table.Row>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} pl={6} pr={4} fontSize="sm">Job ID</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">JR Job ID</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Name</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Status</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Partition</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">User</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Time</Table.ColumnHeader>
                                                <Table.ColumnHeader fontWeight="semibold" color={textColor} py={2} px={4} fontSize="sm">Actions</Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {persistedJobs.map((persistedJobInfo: PersitedJobInfo, index: number) => {
                                                const job = persistedJobInfo.info;
                                                const acc = persistedJobInfo.acc;
                                                const jrJobId = persistedJobInfo.name;

                                                // Use accounting data when available, fallback to info object
                                                const jobId = acc?.job_id?.toString() || job.job_id || '-';
                                                const jobName = acc?.name || job.name || job.job_name || 'Persisted Job';
                                                const jobStatus = acc?.state?.current?.[0] || job.job_state?.[0] || 'PENDING';
                                                const partition = acc?.partition || job.partition || 'N/A';
                                                const user = acc?.user || job.user_name || job.user || 'N/A';

                                                // Calculate freshness - 2 weeks = 14 * 24 * 60 * 60 = 1209600 seconds
                                                const maxAge = 14 * 24 * 60 * 60; // 2 weeks in seconds
                                                const freshnessRatio = Math.min(persistedJobInfo.freshness / maxAge, 1);

                                                // Calculate color from green (0) to brown (1)
                                                const getFreshnessColor = (ratio: number) => {
                                                    if (ratio <= 0) return freshnessGreen;
                                                    if (ratio >= 1) return freshnessBrown;

                                                    // Interpolate between green and brown
                                                    const green = hexToRgb(freshnessGreen);
                                                    const brown = hexToRgb(freshnessBrown);

                                                    const r = Math.round(green[0] + (brown[0] - green[0]) * ratio);
                                                    const g = Math.round(green[1] + (brown[1] - green[1]) * ratio);
                                                    const b = Math.round(green[2] + (brown[2] - green[2]) * ratio);

                                                    return `rgb(${r}, ${g}, ${b})`;
                                                };

                                                // Format duration for tooltip
                                                const formatDuration = (seconds: number) => {
                                                    const days = Math.floor(seconds / (24 * 60 * 60));
                                                    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
                                                    const minutes = Math.floor((seconds % (60 * 60)) / 60);

                                                    if (days > 0) {
                                                        return `${days}d ${hours}h ${minutes}m ago`;
                                                    } else if (hours > 0) {
                                                        return `${hours}h ${minutes}m ago`;
                                                    } else {
                                                        return `${minutes}m ago`;
                                                    }
                                                };

                                                // Format time limit - prefer accounting data
                                                let timeLimit = 'N/A';
                                                if (acc?.time?.limit?.number) {
                                                    timeLimit = `${acc.time.limit.number}min`;
                                                } else if (typeof job.time_limit === 'string') {
                                                    timeLimit = job.time_limit;
                                                } else if (job.time_limit?.number) {
                                                    timeLimit = `${job.time_limit.number}min`;
                                                }

                                                return (
                                                    <Table.Row
                                                        key={`persisted-${jrJobId}`}
                                                        _hover={{ bg: rowHoverBg }}
                                                        bg={index % 2 === 0 ? 'transparent' : rowStripeBg}
                                                    >
                                                        <Table.Cell pl={6} pr={4}>
                                                            <HStack gap={2}>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content={formatDuration(persistedJobInfo.freshness)}
                                                                >
                                                                    <Box
                                                                        width="12px"
                                                                        height="12px"
                                                                        backgroundColor={getFreshnessColor(freshnessRatio)}
                                                                        borderRadius="2px"
                                                                        cursor="pointer"
                                                                        border="1px solid"
                                                                        borderColor={borderColor}
                                                                    />
                                                                </Tooltip>
                                                                <Text fontWeight="semibold" color={textColor}>{jobId}</Text>
                                                            </HStack>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text fontFamily="mono" fontSize="sm" color={mutedTextColor}>
                                                                {jrJobId}
                                                            </Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{jobName}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <HStack gap={2}>
                                                                {getStatusIcon(jobStatus, runningIconColor, pendingIconColor, completedIconColor, failedIconColor, defaultIconColor)}
                                                                <Badge colorScheme={getStatusColor(jobStatus)}>
                                                                    {jobStatus}
                                                                </Badge>
                                                            </HStack>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{partition}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{user}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <Text color={textColor}>{timeLimit}</Text>
                                                        </Table.Cell>
                                                        <Table.Cell>
                                                            <HStack gap={2}>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content="View Details"
                                                                >
                                                                    <Link
                                                                        to={`/jobrunner/${jobId}/${jrJobId}`}
                                                                    >
                                                                        <IconButton
                                                                            aria-label="View job details"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                        >
                                                                            <LuInfo />
                                                                        </IconButton>
                                                                    </Link>
                                                                </Tooltip>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content="View Logs"
                                                                >
                                                                    <Link
                                                                        to={`/joblogs/${jobId}/${jrJobId}`}
                                                                    >
                                                                        <IconButton
                                                                            aria-label="View job logs"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                        >
                                                                            <LuEye />
                                                                        </IconButton>
                                                                    </Link>
                                                                </Tooltip>
                                                                <Tooltip
                                                                    positioning={{ placement: 'top', offset: { mainAxis: 8 } }}
                                                                    content="Rerun Job"
                                                                >
                                                                    <IconButton
                                                                        aria-label="Rerun job"
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        colorScheme="blue"
                                                                        onClick={() => handleRerunJob(jrJobId)}
                                                                    >
                                                                        <LuRefreshCw />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            </HStack>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                );
                                            })}
                                        </Table.Body>
                                    </Table.Root>
                                )}
                            </>
                        )}
                    </Card.Body>
                </Card.Root>


                {/* Job Submission Modal */}
                <Dialog.Root open={isOpen} onOpenChange={(details) => setIsOpen(details.open)}>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW="80vw" w="80vw" style={{ margin: "5px" }}>
                            <Dialog.Header>
                                <Dialog.Title>Submit New Job</Dialog.Title>
                                <Dialog.CloseTrigger />
                            </Dialog.Header>
                            <Dialog.Body>
                                <JobSubmissionForm
                                    templates={templateNames}
                                    profiles={profiles || []}
                                    activeJobs={activeJobs}
                                    onClose={onClose}
                                />
                            </Dialog.Body>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Dialog.Root>
            </VStack>
        </Box>
    );
};



