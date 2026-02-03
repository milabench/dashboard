import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useColorModeValue } from '../ui/color-mode';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Badge,
    Tabs,
    Card,
    Accordion,
    Code,
    Spinner,
    Alert,
    Grid,
} from '@chakra-ui/react';
import {
    LuArrowLeft,
    LuEye,
    LuCircleCheck,
    LuTriangleAlert,
    LuClock,
    LuInfo,
} from 'react-icons/lu';
import { useQuery } from '@tanstack/react-query';
import {
    getSlurmJobs,
    getSlurmJobInfo,
    getSlurmJobStdout,
    getSlurmJobStderr,
} from '../../services/api';
import type { SlurmJob } from '../../services/types';

import { NO_JOB_ID, NO_JOB_STATE } from '../../Constant';

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

const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'r':
            return <LuCircleCheck color="green" />;
        case 'pending':
        case 'pd':
            return <LuClock color="yellow" />;
        case 'completed':
        case 'cd':
            return <LuCircleCheck color="blue" />;
        case 'failed':
        case 'f':
            return <LuTriangleAlert color="red" />;
        default:
            return <LuInfo color="gray" />;
    }
};

const formatTimeLimit = (timeLimit: string | { number: number; set: boolean; infinite: boolean } | undefined): string => {
    if (!timeLimit) return 'N/A';
    if (typeof timeLimit === 'string') return timeLimit;
    if (timeLimit.infinite) return 'Infinite';
    if (timeLimit.number) return `${timeLimit.number} minutes`;
    return 'N/A';
};

export const JobDetailsView: React.FC = () => {
    const { slurmJobId, jrJobId } = useParams<{ slurmJobId: string; jrJobId: string }>();

    const navigate = useNavigate();
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Get all jobs to find the specific job
    const { data: jobsData, isLoading: jobsLoading, error: jobsError } = useQuery({
        queryKey: ['slurm-jobs'],
        queryFn: getSlurmJobs,
        refetchOnWindowFocus: false,
        staleTime: 30000,
    });

    // Find the specific job by slurm job id
    const job = jobsData?.find((j: SlurmJob) => j.job_id === slurmJobId);

    // Get job info (automatically handles cache for persisted jobs)
    const { data: jobInfo, isLoading: infoLoading, error: infoError } = useQuery({
        queryKey: ['slurm-job-info', jrJobId, slurmJobId],
        queryFn: () => getSlurmJobInfo(jrJobId!, slurmJobId),
        enabled: !!jrJobId,
    });

    // Get job stdout
    const { data: stdout, isLoading: stdoutLoading, error: stdoutError } = useQuery({
        queryKey: ['slurm-job-stdout', jrJobId],
        queryFn: () => getSlurmJobStdout(jrJobId!),
        enabled: !!jrJobId,
    });

    // Get job stderr
    const { data: stderr, isLoading: stderrLoading, error: stderrError } = useQuery({
        queryKey: ['slurm-job-stderr', jrJobId],
        queryFn: () => getSlurmJobStderr(jrJobId!),
        enabled: !!jrJobId,
    });

    const handleBack = () => {
        navigate('/');
    };

    // Set page title with the best available job ID
    const displayJobId = jobInfo?.job_id || job?.job_id || slurmJobId || NO_JOB_ID;
    usePageTitle(`Job Details - ${displayJobId}`);

    // Show loading if we're still loading initial jobs data or job info
    const isLoading = jobsLoading || (!!jrJobId && infoLoading);

    if (isLoading) {
        return (
            <Box p={6} textAlign="center">
                <Spinner size="lg" />
                <Text mt={4}>Loading job information...</Text>
            </Box>
        );
    }

    // Check if we have any displayable information
    const canDisplayJob = job || jobInfo;
    const hasParameters = slurmJobId || jrJobId; // Fixed: should work if we have either parameter

    // Only show "Job Not Found" if we have no information AND we've tried all possible sources
    if (!canDisplayJob && !hasParameters) {
        return (
            <Box p={6}>
                <VStack align="stretch" gap={6}>
                    <HStack>
                        <Button onClick={handleBack} variant="ghost">
                            <LuArrowLeft />
                            Back to Dashboard
                        </Button>
                    </HStack>
                    <Alert.Root status="warning">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Title>Job Not Found</Alert.Title>
                            <Alert.Description>
                                Job with ID {slurmJobId} was not found and no additional parameters are available to retrieve detailed information.
                            </Alert.Description>
                        </Alert.Content>
                    </Alert.Root>
                </VStack>
            </Box>
        );
    }

    return (
        <Box p={6}>
            <VStack align="stretch" gap={6}>
                <HStack>
                    <Button onClick={handleBack} variant="ghost">
                        <LuArrowLeft />
                        Back to Dashboard
                    </Button>
                    {jrJobId && (
                        <Button
                            asChild
                            variant="outline"
                            colorScheme="blue"
                        >
                            <Link to={`/joblogs/${slurmJobId}/${jrJobId}`}>
                                <HStack gap={2} as="span">
                                    <LuEye />
                                    <Text>View Logs</Text>
                                </HStack>
                            </Link>
                        </Button>
                    )}
                </HStack>

                <Box>
                    <Heading size="lg" mb={2}>Job Details</Heading>
                    <Text color="gray.600">
                        Slurm Job ID: {slurmJobId} | JR Job ID: {jrJobId}
                    </Text>
                </Box>

                {/* Show informational message for persisted jobs */}
                {!job && jobInfo && (
                    <Alert.Root status="info">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Title>Persisted Job</Alert.Title>
                            <Alert.Description>
                                This job is no longer active but stored information is being displayed.
                            </Alert.Description>
                        </Alert.Content>
                    </Alert.Root>
                )}

                {/* Show warnings for failed API calls */}
                {(jobsError || infoError) && (
                    <Alert.Root status="warning">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Title>Partial Information Available</Alert.Title>
                            <Alert.Description>
                                Some job information could not be loaded, but available data will be displayed.
                            </Alert.Description>
                        </Alert.Content>
                    </Alert.Root>
                )}

                {/* Job Summary Card */}
                <Card.Root bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <Card.Header>
                        <HStack justify="space-between">
                            <Heading size="md">Job Summary</Heading>
                            <HStack>
                                {getStatusIcon(jobInfo?.job_state?.[0] || job?.job_state?.[0] || '')}
                                <Badge colorScheme={getStatusColor(jobInfo?.job_state?.[0] || job?.job_state?.[0] || '')}>
                                    {jobInfo?.job_state?.[0] || job?.job_state?.[0] || NO_JOB_ID}
                                </Badge>
                            </HStack>
                        </HStack>
                    </Card.Header>
                    <Card.Body>
                        <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                            <Box>
                                <Text fontWeight="bold">Slurm Job ID</Text>
                                <Text fontFamily="mono">{jobInfo?.job_id || job?.job_id || slurmJobId}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">JR Job ID</Text>
                                <Text fontFamily="mono" fontSize="sm">
                                    {typeof job?.jr_job_id === 'string' ? job.jr_job_id : jrJobId || 'N/A'}
                                </Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Name</Text>
                                <Text>{jobInfo?.name || job?.name || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Partition</Text>
                                <Text>{jobInfo?.partition || job?.partition || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">User</Text>
                                <Text>{jobInfo?.user_name || job?.user_name || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Account</Text>
                                <Text>{jobInfo?.account || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Time Limit</Text>
                                <Text>{formatTimeLimit(jobInfo?.time_limit || job?.time_limit)}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Nodes</Text>
                                <Text>{jobInfo?.node_count?.number || job?.nodes || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Tasks</Text>
                                <Text>{jobInfo?.tasks?.number || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">CPUs</Text>
                                <Text>{jobInfo?.cpus?.number || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Exit Code</Text>
                                <Text>{jobInfo?.exit_code?.return_code?.number || 'N/A'}</Text>
                            </Box>
                        </Grid>
                    </Card.Body>
                </Card.Root>

                {/* Job Details Tabs */}
                <Card.Root bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <Card.Body>
                        <JobDetailsTabs
                            jobInfo={jobInfo}
                            infoLoading={infoLoading}
                            infoError={infoError}
                            stdout={stdout}
                            stdoutLoading={stdoutLoading}
                            stdoutError={stdoutError}
                            stderr={stderr}
                            stderrLoading={stderrLoading}
                            stderrError={stderrError}
                        />
                    </Card.Body>
                </Card.Root>
            </VStack>
        </Box>
    );
};

// Job Details Tabs Component
const JobDetailsTabs: React.FC<{
    jobInfo?: any;
    infoLoading: boolean;
    infoError?: any;
    stdout?: string;
    stdoutLoading: boolean;
    stdoutError?: any;
    stderr?: string;
    stderrLoading: boolean;
    stderrError?: any;
}> = ({ jobInfo, infoLoading, infoError, stdout, stdoutLoading, stdoutError, stderr, stderrLoading, stderrError }) => {
    const [activeTab, setActiveTab] = useState("job-info");

    return (
        <Tabs.Root value={activeTab} onValueChange={(details) => setActiveTab(details.value)}>
            <Tabs.List>
                <Tabs.Trigger value="job-info">Job Info</Tabs.Trigger>
                <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
                <Tabs.Trigger value="data">Data</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="job-info">
                <VStack align="stretch" gap={4}>
                    {infoLoading ? (
                        <Box textAlign="center" py={8}>
                            <Spinner size="lg" />
                            <Text mt={4}>Loading job information...</Text>
                        </Box>
                    ) : jobInfo ? (
                        <Accordion.Root multiple>
                            <Accordion.Item value="basic-info">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Basic Information</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                                        <Box>
                                            <Text fontWeight="bold">Job ID</Text>
                                            <Text fontFamily="mono">{jobInfo.job_id}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Name</Text>
                                            <Text>{jobInfo.name || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Status</Text>
                                            <Badge colorScheme={getStatusColor(jobInfo.job_state?.[0] || '')}>
                                                {jobInfo.job_state?.[0] || NO_JOB_STATE}
                                            </Badge>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Partition</Text>
                                            <Text>{jobInfo.partition || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">User</Text>
                                            <Text>{jobInfo.user_name || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Account</Text>
                                            <Text>{jobInfo.account || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">QoS</Text>
                                            <Text>{jobInfo.qos || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Priority</Text>
                                            <Text>{jobInfo.priority?.number || 'N/A'}</Text>
                                        </Box>
                                    </Grid>
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="resource-allocation">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Resource Allocation</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                                        <Box>
                                            <Text fontWeight="bold">Nodes</Text>
                                            <Text>{jobInfo.node_count?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Node List</Text>
                                            <Text fontFamily="mono">{jobInfo.nodes || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Tasks</Text>
                                            <Text>{jobInfo.tasks?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">CPUs</Text>
                                            <Text>{jobInfo.cpus?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">CPUs per Task</Text>
                                            <Text>{jobInfo.cpus_per_task?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Tasks per Node</Text>
                                            <Text>{jobInfo.tasks_per_node?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Memory per Node</Text>
                                            <Text>{jobInfo.memory_per_node?.number ? `${jobInfo.memory_per_node.number}MB` : 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">TRES Allocated</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.tres_alloc_str || 'N/A'}</Text>
                                        </Box>
                                    </Grid>
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="timing-info">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Timing Information</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                                        <Box>
                                            <Text fontWeight="bold">Submit Time</Text>
                                            <Text>{jobInfo.submit_time?.number ? new Date(jobInfo.submit_time.number * 1000).toLocaleString() : 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Start Time</Text>
                                            <Text>{jobInfo.start_time?.number ? new Date(jobInfo.start_time.number * 1000).toLocaleString() : 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">End Time</Text>
                                            <Text>{jobInfo.end_time?.number ? new Date(jobInfo.end_time.number * 1000).toLocaleString() : 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Time Limit</Text>
                                            <Text>{formatTimeLimit(jobInfo.time_limit)}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Eligible Time</Text>
                                            <Text>{jobInfo.eligible_time?.number ? new Date(jobInfo.eligible_time.number * 1000).toLocaleString() : 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Accrue Time</Text>
                                            <Text>{jobInfo.accrue_time?.number ? new Date(jobInfo.accrue_time.number * 1000).toLocaleString() : 'N/A'}</Text>
                                        </Box>
                                    </Grid>
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="job-details">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Job Details</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                                        <Box>
                                            <Text fontWeight="bold">Command</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.command || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Working Directory</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.current_working_directory || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Standard Output</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.standard_output || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Standard Error</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.standard_error || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Comment</Text>
                                            <Text fontFamily="mono" fontSize="sm">{jobInfo.comment || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Exit Code</Text>
                                            <Text>{jobInfo.exit_code?.return_code?.number || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">Restart Count</Text>
                                            <Text>{jobInfo.restart_cnt || 'N/A'}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontWeight="bold">State Reason</Text>
                                            <Text>{jobInfo.state_reason || 'N/A'}</Text>
                                        </Box>
                                    </Grid>
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="raw-job-info">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Raw Job Information</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    <Code display="block" whiteSpace="pre-wrap" p={4}>
                                        {JSON.stringify(jobInfo, null, 2)}
                                    </Code>
                                </Accordion.ItemContent>
                            </Accordion.Item>
                        </Accordion.Root>
                    ) : (
                        <Text color="gray.500">No job information available</Text>
                    )}
                </VStack>
            </Tabs.Content>

            <Tabs.Content value="logs">
                {(stdoutLoading || stderrLoading) ? (
                    <Box textAlign="center" py={8}>
                        <Spinner size="lg" />
                        <Text mt={4}>Loading logs...</Text>
                    </Box>
                ) : (
                    <VStack align="stretch" gap={4}>
                        {/* Show errors if any */}
                        {(stdoutError || stderrError) && (
                            <Alert.Root status="warning">
                                <Alert.Indicator />
                                <Alert.Content>
                                    <Alert.Title>Some logs could not be loaded</Alert.Title>
                                    <Alert.Description>
                                        Some log files may not be available or accessible.
                                    </Alert.Description>
                                </Alert.Content>
                            </Alert.Root>
                        )}

                        <Accordion.Root multiple>
                            <Accordion.Item value="log-job-info">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Job Information</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    {infoError ? (
                                        <Alert.Root status="error">
                                            <Alert.Indicator />
                                            <Alert.Content>
                                                <Alert.Title>Failed to load job information</Alert.Title>
                                                <Alert.Description>
                                                    {infoError?.message || 'Unknown error occurred'}
                                                </Alert.Description>
                                            </Alert.Content>
                                        </Alert.Root>
                                    ) : (
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {jobInfo ? JSON.stringify(jobInfo, null, 2) : 'No job information available'}
                                        </Code>
                                    )}
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="stdout">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Standard Output</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    {stdoutError ? (
                                        <Alert.Root status="error">
                                            <Alert.Indicator />
                                            <Alert.Content>
                                                <Alert.Title>Failed to load stdout</Alert.Title>
                                                <Alert.Description>
                                                    {stdoutError?.message || 'Unknown error occurred'}
                                                </Alert.Description>
                                            </Alert.Content>
                                        </Alert.Root>
                                    ) : (
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {stdout || 'N/A'}
                                        </Code>
                                    )}
                                </Accordion.ItemContent>
                            </Accordion.Item>

                            <Accordion.Item value="stderr">
                                <h3>
                                    <Accordion.ItemTrigger>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Standard Error</Text>
                                        </Box>
                                        <Accordion.ItemIndicator />
                                    </Accordion.ItemTrigger>
                                </h3>
                                <Accordion.ItemContent pb={4}>
                                    {stderrError ? (
                                        <Alert.Root status="error">
                                            <Alert.Indicator />
                                            <Alert.Content>
                                                <Alert.Title>Failed to load stderr</Alert.Title>
                                                <Alert.Description>
                                                    {stderrError?.message || 'Unknown error occurred'}
                                                </Alert.Description>
                                            </Alert.Content>
                                        </Alert.Root>
                                    ) : (
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {stderr || 'N/A'}
                                        </Code>
                                    )}
                                </Accordion.ItemContent>
                            </Accordion.Item>
                        </Accordion.Root>
                    </VStack>
                )}
            </Tabs.Content>

            <Tabs.Content value="data">
                <VStack align="stretch" gap={4}>
                    <Box>
                        <Text fontWeight="bold" mb={2}>Job Information</Text>
                        <Text color="gray.600">
                            Use the Logs tab to view job information, stdout, and stderr output.
                        </Text>
                    </Box>
                </VStack>
            </Tabs.Content>
        </Tabs.Root>
    );
};