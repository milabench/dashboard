import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    useToast,
    Card,
    CardBody,
    CardHeader,
    Spinner,
    Alert,
    AlertIcon,
    AlertTitle,
    AlertDescription,
    useColorModeValue,
    Badge,
    Flex,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalFooter,
    ModalBody,
    ModalCloseButton,
    useDisclosure,
    Input,
    FormControl,
    FormLabel,
    FormErrorMessage,
    Wrap,
    WrapItem,
    Grid,
    GridItem,
    Accordion,
    AccordionItem,
    AccordionButton,
    AccordionPanel,
    AccordionIcon,
    Code
} from '@chakra-ui/react';
import { ArrowBackIcon, RepeatIcon, ViewIcon, CloseIcon, DownloadIcon } from '@chakra-ui/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlurmJobStdoutFull, getSlurmJobStderrFull, getSlurmJobStdoutSize, getSlurmJobStderrSize, getSlurmJobStatus, getSlurmJobAccounting, rerunSlurmJob, cancelSlurmJob, saveSlurmJob, getSlurmJobInfo } from '../../services/api';
import type { SlurmJob, SlurmJobAccounting } from '../../services/types';
import { LogDisplay } from './LogDisplay';
import { NO_JOB_ID } from '../../Constant';

interface JobLogsViewProps {
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

export const JobLogsView: React.FC<JobLogsViewProps> = () => {
    const params = useParams<{ slurmJobId: string; jrJobId: string }>();

    const params_SlurmJobId = params["slurmJobId"]
    const jrJobId = params["jrJobId"]

    const [slurmJobId, setSlurmJobId] = useState(params_SlurmJobId);
    const [jobInfo, setJobInfo] = useState<SlurmJob | null>(null);

    // Keep slurmJobId in sync with URL parameters (important for rerun navigation)
    useEffect(() => {
        if (params_SlurmJobId !== slurmJobId) {
            console.log('URL parameter changed, updating slurmJobId from', slurmJobId, 'to', params_SlurmJobId);
            setSlurmJobId(params_SlurmJobId);
            // Reset jobInfo when navigating to a new job to prevent stale data
            setJobInfo(null);
        }
    }, [params_SlurmJobId]);

    usePageTitle(`Job Logs - ${slurmJobId || 'Unknown'}`);

    const updateJobInfo = (newJobInfo: SlurmJob) => {
        if (slurmJobId === NO_JOB_ID) {
            setSlurmJobId(newJobInfo.job_id || undefined);
        }
        setJobInfo(newJobInfo)
    };

    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Auto-scrolling is now handled internally by LogDisplay components

    // Countdown timer state
    const [countdown, setCountdown] = useState(30);
    const REFRESH_INTERVAL = 30000; // 30 seconds in milliseconds

    // State to control whether status polling should continue
    const [shouldPollStatus, setShouldPollStatus] = useState(true);

    // Rerun state
    const [isRerunning, setIsRerunning] = useState(false);

    // Cancel state
    const [isCancelling, setIsCancelling] = useState(false);

    // Save job state
    const [isSaving, setIsSaving] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [commitMessageError, setCommitMessageError] = useState('');
    const { isOpen: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose } = useDisclosure();

    // Keep log data for backward compatibility with existing queries
    // The LogDisplay component will manage its own state internally

    // Helper function to format file size
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Helper function to convert accounting data to SlurmJob format
    const convertAccountingToSlurmJob = (accounting: SlurmJobAccounting): SlurmJob => {
        return {
            job_id: accounting.job_id?.toString() || null,
            partition: accounting.partition,
            name: accounting.name,
            user: accounting.user,
            job_state: accounting.state?.current || [],
            time: accounting.time?.elapsed?.toString(),
            elapsed: accounting.time?.elapsed?.toString(),
            nodes: accounting.nodes,
            start_time: accounting.time?.start ? {
                number: accounting.time.start,
                set: true,
                infinite: false
            } : undefined,
            end_time: accounting.time?.end ? {
                number: accounting.time.end,
                set: true,
                infinite: false
            } : undefined,
            submit_time: accounting.time?.submission ? {
                number: accounting.time.submission,
                set: true,
                infinite: false
            } : undefined,
            exit_code: accounting.exit_code?.return_code?.number?.toString(),
        };
    };

    // Helper function to check if job is finished based on accounting data
    const isJobFinishedAccounting = (accounting: SlurmJobAccounting | undefined) => {
        if (!accounting) return false;
        const currentState = accounting.state?.current?.[0];
        if (!currentState) return false;
        const lowerStatus = currentState.toLowerCase();
        return lowerStatus === 'completed' || lowerStatus === 'failed' || lowerStatus === 'cancelled' ||
            lowerStatus === 'timeout' || lowerStatus === 'node_fail' || lowerStatus === 'out_of_memory';
    };

    // Helper function to check if job is in finished state
    const isJobFinished = (jobStatus: SlurmJob | undefined) => {
        if (!jobStatus) return false;
        const jobState = jobStatus.job_state;
        let status: string | undefined;

        if (Array.isArray(jobState)) {
            status = jobState[0];
        } else if (typeof jobState === 'string') {
            status = jobState;
        }

        if (!status) return false;
        const lowerStatus = status.toLowerCase();
        return lowerStatus === 'completed' || lowerStatus === 'failed' || lowerStatus === 'cancelled' || lowerStatus === 'cd' || lowerStatus === 'f' || lowerStatus === 'ca';
    };

    // Helper function to check if job can be cancelled (only running or pending jobs)
    const canCancelJob = (jobStatus: SlurmJob | undefined) => {
        if (!jobStatus) return false;
        const jobState = jobStatus.job_state;
        let status: string | undefined;

        if (Array.isArray(jobState)) {
            status = jobState[0];
        } else if (typeof jobState === 'string') {
            status = jobState;
        }

        if (!status) return false;
        const lowerStatus = status.toLowerCase();
        return lowerStatus === 'running' || lowerStatus === 'pending' || lowerStatus === 'r' || lowerStatus === 'pd';
    };

    // Helper function to get job status string
    const getJobStatusString = (jobStatus: SlurmJob | undefined) => {
        if (!jobStatus) return 'Unknown';
        const jobState = jobStatus.job_state;

        if (Array.isArray(jobState)) {
            return jobState[0] || 'Unknown';
        } else if (typeof jobState === 'string') {
            return jobState;
        }

        return 'Unknown';
    };

    // Helper function to get formatted job duration
    const getJobDuration = (jobData: any) => {
        // Always try to get duration from job data when available
        if (jobData) {
            // Check if job is actually finished (not running) before using end_time
            const isJobActuallyFinished = jobData.job_state &&
                !jobData.job_state.includes('RUNNING') &&
                !jobData.job_state.includes('PENDING');

            // For truly finished jobs, use start_time and end_time
            if (isJobActuallyFinished &&
                jobData.start_time?.set && jobData.start_time?.number &&
                jobData.end_time?.set && jobData.end_time?.number) {

                const startTime = jobData.start_time.number;
                const endTime = jobData.end_time.number;

                if (endTime > startTime) {
                    const durationSeconds = endTime - startTime;

                    // Format duration as HH:MM:SS or DD-HH:MM:SS
                    const days = Math.floor(durationSeconds / 86400);
                    const hours = Math.floor((durationSeconds % 86400) / 3600);
                    const minutes = Math.floor((durationSeconds % 3600) / 60);
                    const seconds = durationSeconds % 60;

                    if (days > 0) {
                        return `${days}-${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    } else {
                        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    }
                }
            }

            // For running jobs or jobs without valid end_time, calculate elapsed time from start
            if (jobData.start_time?.set && jobData.start_time?.number) {
                const startTime = jobData.start_time.number;
                const currentTime = Math.floor(Date.now() / 1000);
                const durationSeconds = currentTime - startTime;

                // Format duration as HH:MM:SS or DD-HH:MM:SS
                const days = Math.floor(durationSeconds / 86400);
                const hours = Math.floor((durationSeconds % 86400) / 3600);
                const minutes = Math.floor((durationSeconds % 3600) / 60);
                const seconds = durationSeconds % 60;

                if (days > 0) {
                    return `${days}-${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                } else {
                    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }
            }
        }

        // Fallback to basic job data if no timestamp info available
        if (!jobData) return 'Unknown';

        const job = jobData;

        // If job has explicit elapsed time, use it
        if (job.elapsed) {
            return job.elapsed;
        }

        // Calculate duration from timestamps
        const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds

        // Check if job has started
        if (job.start_time?.set && job.start_time.number > 0) {
            const startTime = job.start_time.number;
            let endTime = currentTime;

            // Check if job is not running, then use end_time if available
            const jobState = Array.isArray(job.job_state) ? job.job_state[0] : job.job_state;
            const isRunning = jobState?.toLowerCase() === 'running' || jobState?.toLowerCase() === 'r';

            if (!isRunning && job.end_time?.set && job.end_time.number > 0) {
                endTime = job.end_time.number;
            }

            const durationSeconds = endTime - startTime;

            // Format duration as HH:MM:SS or DD-HH:MM:SS
            const days = Math.floor(durationSeconds / 86400);
            const hours = Math.floor((durationSeconds % 86400) / 3600);
            const minutes = Math.floor((durationSeconds % 3600) / 60);
            const seconds = durationSeconds % 60;

            if (days > 0) {
                return `${days}-${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }

        // Check job state for pending jobs
        const jobState = Array.isArray(job.job_state) ? job.job_state[0] : job.job_state;
        if (jobState?.toLowerCase() === 'pending' || jobState?.toLowerCase() === 'pd') {
            return 'Pending (not started)';
        }

        // If job has a time field, use it as fallback
        if (job.time) {
            return job.time;
        }

        return 'Not started';
    };

    // Primary job info fetch - this is our main data source
    const {
        data: jobInfoData,
        isLoading: jobInfoLoading,
        error: jobInfoError
    } = useQuery({
        queryKey: ['slurm-job-info', jrJobId, slurmJobId],
        queryFn: () => {
            // Use slurm job ID if available and valid, otherwise use job runner ID
            const useJobId = slurmJobId && slurmJobId !== '-' ? slurmJobId : undefined;
            return getSlurmJobInfo(jrJobId!, useJobId);
        },
        enabled: !!jrJobId,
        staleTime: 30 * 1000, // Cache for 30 seconds to allow fresh data for reruns
    });

    // Update jobInfo state when new data comes from the query
    useEffect(() => {
        if (jobInfoData) {
            updateJobInfo(jobInfoData);
        }
    }, [jobInfoData]);

    // Job status polling with fallback to accounting data - only if we have a slurm job ID and should poll
    const {
        data: jobStatus,
        isLoading: statusLoading,
        error: statusError,
        refetch: refetchStatus
    } = useQuery({
        queryKey: ['slurm-job-status-with-fallback', slurmJobId, jrJobId],
        queryFn: async () => {
            try {
                // First try to get the current job status
                return await getSlurmJobStatus(slurmJobId!);
            } catch (statusError) {
                console.log('Job status fetch failed, trying accounting data:', statusError);

                // If status fails, try to get accounting data
                if (jrJobId) {
                    try {
                        const accountingData = await getSlurmJobAccounting(jrJobId, slurmJobId!);
                        console.log('Found accounting data:', accountingData);

                        // Convert accounting data to SlurmJob format, but preserve existing job info
                        const convertedJob = convertAccountingToSlurmJob(accountingData);

                        // Merge with existing jobInfo to preserve allocation information
                        // Only update status-related fields from accounting data
                        const preservedJobData = {
                            ...jobInfo, // Keep original allocation info (GRES, CPUs, memory, etc.)
                            ...convertedJob, // Update with accounting data (status, times, etc.)
                            // Explicitly preserve important allocation fields that might be overwritten
                            ...(jobInfo && {
                                gres_detail: (jobInfo as any).gres_detail,
                                cpus: (jobInfo as any).cpus,
                                job_resources: (jobInfo as any).job_resources,
                                allocated_nodes: (jobInfo as any).allocated_nodes,
                            })
                        };

                        // Update jobInfo with the merged data if job is finished
                        if (isJobFinishedAccounting(accountingData)) {
                            updateJobInfo(preservedJobData as SlurmJob);
                        }

                        return preservedJobData;
                    } catch (accountingError) {
                        console.log('Accounting data fetch also failed:', accountingError);
                        throw statusError; // Throw the original status error
                    }
                } else {
                    throw statusError;
                }
            }
        },
        enabled: !!slurmJobId && !!jrJobId && shouldPollStatus,
        refetchInterval: shouldPollStatus ? 30000 : false, // Stop refresh when shouldPollStatus is false
        refetchIntervalInBackground: true,
    });

    // Merged job data - jobStatus updates take precedence over jobInfo for current state
    const mergedJobData = useMemo(() => {
        return jobStatus ? { ...jobInfo, ...jobStatus } : jobInfo;
    }, [jobStatus, jobInfo]);

    // Effect to control status polling based on job state and errors
    useEffect(() => {
        // Stop polling if job is finished (from either status or accounting data)
        if (mergedJobData && isJobFinished(mergedJobData)) {
            setShouldPollStatus(false);
            return;
        }

        // Stop polling if we get a 404 error and the job data shows it's finished
        // This handles cases where we got accounting data showing completion
        if (statusError && (statusError as any).status === 404) {
            // If we have job data showing completion, stop polling
            if (mergedJobData && isJobFinished(mergedJobData)) {
                setShouldPollStatus(false);
                return;
            }
            // Otherwise, let the query fallback to accounting data handle it
        }

        // Resume polling if we had stopped but conditions change
        if (!shouldPollStatus && mergedJobData && !isJobFinished(mergedJobData) && (!statusError || (statusError as any).status !== 404)) {
            setShouldPollStatus(true);
        }
    }, [mergedJobData, statusError, shouldPollStatus]);

    // Effect to disable polling when slurm job ID is not available
    useEffect(() => {
        if (!slurmJobId) {
            setShouldPollStatus(false);
        } else if (!shouldPollStatus && (!mergedJobData || !isJobFinished(mergedJobData)) && (!statusError || (statusError as any).status !== 404)) {
            // Re-enable polling if slurm job ID becomes available and other conditions are met
            setShouldPollStatus(true);
        }
    }, [slurmJobId, mergedJobData, statusError, shouldPollStatus]);

    // Log fetching is now handled internally by LogDisplay components

    // Log fetching is now handled internally by LogDisplay components

    const handleBack = () => {
        navigate(-1);
    };

    // Auto-scrolling is now handled internally by LogDisplay components

    // Countdown timer effect
    useEffect(() => {
        // Stop countdown if polling is disabled
        if (!shouldPollStatus) {
            setCountdown(0);
            return;
        }

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    return 30; // Reset to 30 seconds
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [shouldPollStatus]);

    // Effect to show notification when job finishes
    useEffect(() => {
        if (isJobFinished(mergedJobData || undefined)) {
            // LogDisplay components handle their own final refresh
            toast({
                title: 'Job Finished',
                description: 'Job has completed. LogDisplay components will perform final refresh automatically.',
                status: 'info',
                duration: 3000,
                isClosable: true,
            });
        }
    }, [mergedJobData]);

    const handleRefresh = () => {
        // LogDisplay components handle their own refresh internally
        if (slurmJobId && slurmJobId !== '-') {
            refetchStatus();
        }
        setCountdown(30); // Reset countdown
        toast({
            title: 'Status Refreshed',
            description: 'Job status has been refreshed. Logs auto-refresh independently.',
            status: 'success',
            duration: 2000,
            isClosable: true,
        });
    };

    const handleRerun = async () => {
        if (!jrJobId) return;

        setIsRerunning(true);
        try {
            const result = await rerunSlurmJob(jrJobId);

            if (result.success) {
                toast({
                    title: 'Job Rerun Successfully',
                    description: `New job submitted with ID: ${result.job_id}. Job runner ID: ${result.jr_job_id}`,
                    status: 'success',
                    duration: 5000,
                    isClosable: true,
                });

                // Invalidate old queries to ensure fresh data for the new job
                queryClient.invalidateQueries({ queryKey: ['slurm-job-info'] });
                queryClient.invalidateQueries({ queryKey: ['slurm-job-status-with-fallback'] });

                // Navigate to the new job logs after a short delay
                setTimeout(() => {
                    navigate(`/joblogs/${result.job_id || NO_JOB_ID}/${result.jr_job_id || NO_JOB_ID}`);
                }, 2000);
            } else {
                toast({
                    title: 'Rerun Failed',
                    description: result.error || 'Failed to rerun job',
                    status: 'error',
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error: any) {
            toast({
                title: 'Rerun Failed',
                description: error.message || 'An unexpected error occurred',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsRerunning(false);
        }
    };

    const handleCancel = async () => {
        if (!slurmJobId || slurmJobId === '-') {
            toast({
                title: 'Cannot Cancel Job',
                description: 'No Slurm job ID available for cancellation',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        setIsCancelling(true);
        try {
            const result = await cancelSlurmJob(slurmJobId);

            if (result.success) {
                toast({
                    title: 'Job Cancelled Successfully',
                    description: result.message || `Job ${slurmJobId} has been cancelled`,
                    status: 'success',
                    duration: 5000,
                    isClosable: true,
                });

                // Refresh status to show updated state
                if (slurmJobId && slurmJobId !== '-') {
                    refetchStatus();
                }
            } else {
                toast({
                    title: 'Cancel Failed',
                    description: result.error || 'Failed to cancel job',
                    status: 'error',
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error: any) {
            toast({
                title: 'Cancel Failed',
                description: error.message || 'An unexpected error occurred',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsCancelling(false);
        }
    };

    const handleSaveClick = () => {
        setCommitMessage('');
        setCommitMessageError('');
        onSaveModalOpen();
    };

    const handleSave = async () => {
        if (!jrJobId) return;

        // Validate commit message
        if (!commitMessage.trim()) {
            setCommitMessageError('Commit message is required');
            return;
        }

        setIsSaving(true);
        try {
            const result = await saveSlurmJob(jrJobId, commitMessage.trim());

            // Since the API returns an empty object on success, we check for the absence of error
            if (!result.error) {
                toast({
                    title: 'Job Saved Successfully',
                    description: `Job ${jrJobId} has been saved with commit message: "${commitMessage.trim()}"`,
                    status: 'success',
                    duration: 5000,
                    isClosable: true,
                });

                onSaveModalClose();
                setCommitMessage('');
            } else {
                toast({
                    title: 'Save Failed',
                    description: result.error || 'Failed to save job',
                    status: 'error',
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error: any) {
            toast({
                title: 'Save Failed',
                description: error.message || 'An unexpected error occurred',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (!jrJobId) {
        return (
            <Box p={6}>
                <Alert status="error">
                    <AlertIcon />
                    <AlertTitle>Invalid Job ID</AlertTitle>
                    <AlertDescription>
                        No JR job ID provided in the URL.
                    </AlertDescription>
                </Alert>
            </Box>
        );
    }

    return (
        <Box p={6} className="job-logs-view" h="100%">
            <VStack align="stretch" spacing={3} h="100%">
                {/* Header */}
                <HStack justify="space-between">
                    <Box>
                        <Heading size="lg" mb={2}>Job Logs</Heading>
                    </Box>
                    <HStack spacing={3}>
                        <Button
                            leftIcon={<RepeatIcon />}
                            variant="outline"
                            onClick={handleRefresh}
                            isLoading={statusLoading}
                        >
                            Refresh Now
                        </Button>
                        <Button
                            leftIcon={<RepeatIcon />}
                            variant="outline"
                            colorScheme="green"
                            onClick={handleRerun}
                            isLoading={isRerunning}
                        >
                            Rerun Job
                        </Button>
                        {canCancelJob(mergedJobData || undefined) && (
                            <Button
                                leftIcon={<CloseIcon />}
                                variant="outline"
                                colorScheme="red"
                                onClick={handleCancel}
                                isLoading={isCancelling}
                            >
                                Cancel Job
                            </Button>
                        )}
                        <Button
                            leftIcon={<DownloadIcon />}
                            variant="outline"
                            colorScheme="purple"
                            onClick={handleSaveClick}
                            isLoading={isSaving}
                        >
                            Save Job
                        </Button>
                        <Button
                            leftIcon={<ViewIcon />}
                            variant="outline"
                            colorScheme="blue"
                            onClick={() => navigate(`/jobrunner/${slurmJobId}/${jrJobId}`)}
                            isDisabled={!slurmJobId || slurmJobId === '-'}
                        >
                            Job Details
                        </Button>
                        <Button leftIcon={<ArrowBackIcon />} onClick={handleBack} variant="ghost">
                            Back
                        </Button>
                    </HStack>
                </HStack>

                {/* Job Quick Info */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardBody>
                        <Wrap spacing={4} rowGap={2} align="center">
                            <WrapItem>
                                <Text fontSize="sm" color="gray.600">
                                    <strong>ID:</strong> {jrJobId}
                                </Text>
                            </WrapItem>
                            {slurmJobId && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>Slurm Job ID:</strong> {slurmJobId}
                                    </Text>
                                </WrapItem>
                            )}
                            <WrapItem>
                                <Text fontSize="sm" color="gray.600">
                                    <strong>Job Duration:</strong> {
                                        jobInfoLoading
                                            ? <><Spinner size="xs" mr={1} />Loading...</>
                                            : getJobDuration(mergedJobData)
                                    }
                                </Text>
                            </WrapItem>

                            {/* Additional job details from job data */}
                            {(mergedJobData as any)?.gres_detail && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>GRES:</strong> {(mergedJobData as any).gres_detail}
                                    </Text>
                                </WrapItem>
                            )}
                            {(mergedJobData as any)?.cpus?.number && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>CPUs:</strong> {(mergedJobData as any).cpus.number}
                                    </Text>
                                </WrapItem>
                            )}
                            {(mergedJobData as any)?.job_resources?.allocated_nodes?.[0]?.memory_allocated && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>RAM:</strong> {Math.round((mergedJobData as any).job_resources.allocated_nodes[0].memory_allocated / 1024)} GB
                                    </Text>
                                </WrapItem>
                            )}

                            {mergedJobData && (
                                <WrapItem>
                                    <Badge colorScheme={getStatusColor(getJobStatusString(mergedJobData || undefined))}>
                                        {getJobStatusString(mergedJobData || undefined)}
                                    </Badge>
                                </WrapItem>
                            )}
                            {statusLoading && (
                                <WrapItem>
                                    <Badge colorScheme="gray">
                                        <Spinner size="xs" mr={1} />
                                        Checking Status...
                                    </Badge>
                                </WrapItem>
                            )}
                            {statusError && (
                                <WrapItem>
                                    <Badge colorScheme="red">
                                        Status Error
                                    </Badge>
                                </WrapItem>
                            )}
                        </Wrap>
                    </CardBody>
                </Card>

                {/* Logs Display */}
                <Flex gap={6} direction={{ base: 'column', lg: 'row' }} className="log-holder" h="100%" flex="1" display="flex">
                    <LogDisplay
                        logType="stdout"
                        jrJobId={jrJobId!}
                        isJobFinished={isJobFinished(mergedJobData || undefined)}
                        formatFileSize={formatFileSize}
                        fetchLogData={getSlurmJobStdoutFull}
                        getSlurmJobLogSize={getSlurmJobStdoutSize}
                    />

                    <LogDisplay
                        logType="stderr"
                        jrJobId={jrJobId!}
                        isJobFinished={isJobFinished(mergedJobData || undefined)}
                        formatFileSize={formatFileSize}
                        fetchLogData={getSlurmJobStderrFull}
                        getSlurmJobLogSize={getSlurmJobStderrSize}
                    />
                </Flex>
            </VStack>

            {/* Save Job Modal */}
            <Modal isOpen={isSaveModalOpen} onClose={onSaveModalClose}>
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Save Job</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <VStack align="stretch" spacing={4}>
                            <FormControl isInvalid={!!commitMessageError}>
                                <FormLabel>Commit Message</FormLabel>
                                <Input
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    placeholder="Enter a commit message for this job"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !isSaving && commitMessage.trim()) {
                                            handleSave();
                                        }
                                    }}
                                />
                                <FormErrorMessage>{commitMessageError}</FormErrorMessage>
                            </FormControl>
                        </VStack>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="outline" mr={3} onClick={onSaveModalClose}>
                            Cancel
                        </Button>
                        <Button colorScheme="blue" onClick={handleSave} isLoading={isSaving}>
                            Save Job
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </Box>
    );
};