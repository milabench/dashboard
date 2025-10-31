import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
    Code,
    Tooltip
} from '@chakra-ui/react';
import { ArrowBackIcon, RepeatIcon, ViewIcon, CloseIcon, DownloadIcon, InfoIcon, ExternalLinkIcon, TimeIcon } from '@chakra-ui/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSlurmJobStdoutFull, getSlurmJobStderrFull, getSlurmJobStdoutSize, getSlurmJobStderrSize, getSlurmJobStatusSimple, getSlurmJobAccounting, rerunSlurmJob, cancelSlurmJob, saveSlurmJob, getSlurmJobInfo, getSlurmClusterStatus, pushJobFolder, earlySyncJob } from '../../services/api';
import type { SlurmJob, SlurmJobAccounting, SlurmJobStatusResponse } from '../../services/types';
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

function isStateTerminal(state: string) {
    return [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMEOUT",
        "NODE_FAIL",
        "OUT_OF_MEMORY"
    ].includes(state?.toUpperCase());
}

export const JobLogsView: React.FC<JobLogsViewProps> = () => {
    const params = useParams<{ slurmJobId: string; jrJobId: string }>();
    const params_SlurmJobId = params["slurmJobId"];
    const jrJobId = params["jrJobId"];

    const [slurmJobId, setSlurmJobId] = useState(params_SlurmJobId);
    const [jobStatus, setJobStatus] = useState<string | null>(null);
    const [isJobTerminal, setIsJobTerminal] = useState(false);
    const [shouldPoll, setShouldPoll] = useState(true);
    const [countdown, setCountdown] = useState(30);
    const [realtimeUpdateTrigger, setRealtimeUpdateTrigger] = useState(0);

    // Keep slurmJobId in sync with URL parameters (important for rerun navigation)
    useEffect(() => {
        if (params_SlurmJobId !== slurmJobId) {
            console.log('URL parameter changed, updating slurmJobId from', slurmJobId, 'to', params_SlurmJobId);
            setSlurmJobId(params_SlurmJobId);
            // Reset state when navigating to a new job
            setJobStatus(null);
            setIsJobTerminal(false);
            setShouldPoll(true);
            setRealtimeUpdateTrigger(0);
        }
    }, [params_SlurmJobId]);

    usePageTitle(`Job Logs - ${slurmJobId || 'Unknown'}`);

    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Rerun state
    const [isRerunning, setIsRerunning] = useState(false);

    // Cancel state
    const [isCancelling, setIsCancelling] = useState(false);

    // Save job state
    const [isSaving, setIsSaving] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [commitMessageError, setCommitMessageError] = useState('');
    const { isOpen: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose } = useDisclosure();

    // Push data state
    const [isPushing, setIsPushing] = useState(false);

    // Early sync state
    const [isEarlySync, setIsEarlySync] = useState(false);

    // Helper function to format file size
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Primary job status query - this is our main data source
    const {
        data: jobStatusData,
        isLoading: statusLoading,
        error: statusError,
        refetch: refetchStatus
    } = useQuery({
        queryKey: ['slurm-job-status-simple', jrJobId, slurmJobId],
        queryFn: () => {
            if (!jrJobId || !slurmJobId || slurmJobId === '-') {
                throw new Error('Missing job IDs');
            }
            return getSlurmJobStatusSimple(jrJobId, slurmJobId);
        },
        enabled: !!jrJobId && !!slurmJobId && slurmJobId !== '-' && shouldPoll,
        refetchInterval: shouldPoll ? 30000 : false, // Refresh every 30 seconds when polling
        refetchIntervalInBackground: true,
        staleTime: 5000, // Consider data fresh for 5 seconds to avoid excessive requests
    });

    // Update local state when job status changes
    useEffect(() => {
        if (jobStatusData?.status) {
            const newStatus = jobStatusData.status;
            const wasTerminal = isJobTerminal;
            const nowTerminal = isStateTerminal(newStatus);

            setJobStatus(newStatus);
            setIsJobTerminal(nowTerminal);

            // Only trigger final log refresh if job just became terminal (transition from non-terminal to terminal)
            // Don't trigger if job was already terminal or if this is the first status load
            if (!wasTerminal && nowTerminal && jobStatus !== null) {
                setShouldPoll(false);
                toast({
                    title: 'Job Finished',
                    description: `Job status changed to ${newStatus}. Logs will perform final refresh in 2 seconds.`,
                    status: 'info',
                    duration: 5000,
                    isClosable: true,
                });

                // Trigger final log refresh after 2 seconds
                setTimeout(() => {
                    queryClient.invalidateQueries({ queryKey: ['slurm-job-logs'] });
                }, 2000);
            } else if (nowTerminal) {
                // Job is already terminal, just stop polling without final refresh
                setShouldPoll(false);
            }
        }
    }, [jobStatusData, isJobTerminal, jobStatus, toast, queryClient]);

    // Backup job info query for additional details (non-polling)
    const {
        data: jobInfoData,
        isLoading: jobInfoLoading,
        error: jobInfoError
    } = useQuery({
        queryKey: ['slurm-job-info', jrJobId, slurmJobId],
        queryFn: () => {
            const useJobId = slurmJobId && slurmJobId !== '-' ? slurmJobId : undefined;
            return getSlurmJobInfo(jrJobId!, useJobId);
        },
        enabled: !!jrJobId && !!jobStatus, // Only load after we have status
        staleTime: 60 * 1000, // Cache for 60 seconds
    });

    // Cluster status query to show stale badge when offline
    const { data: clusterStatus } = useQuery({
        queryKey: ['slurm-cluster-status'],
        queryFn: getSlurmClusterStatus,
        refetchOnWindowFocus: false,
        staleTime: 30000,
        refetchInterval: 60000,
        retry: false,
    });

    // Accounting data query - only fetch when job is terminal for accurate duration
    const { data: accountingData } = useQuery({
        queryKey: ['slurm-job-accounting', jrJobId, slurmJobId],
        queryFn: () => {
            if (!jrJobId || !slurmJobId || slurmJobId === '-') {
                throw new Error('Missing job IDs');
            }
            return getSlurmJobAccounting(jrJobId, slurmJobId);
        },
        enabled: !!jrJobId && !!slurmJobId && slurmJobId !== '-' && isJobTerminal,
        staleTime: 300000, // Cache for 5 minutes since accounting data doesn't change
        refetchOnWindowFocus: false,
    });

    // Helper function to check if job can be cancelled (only running or pending jobs)
    const canCancelJob = (status: string | null) => {
        if (!status) return false;
        const lowerStatus = status.toLowerCase();
        return lowerStatus === 'running' || lowerStatus === 'pending' || lowerStatus === 'r' || lowerStatus === 'pd';
    };

    // Helper function to format elapsed seconds to duration string
    const formatElapsedSeconds = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        if (days > 0) {
            return `${days}-${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    };

    // Helper function to get job duration (uses realtimeUpdateTrigger for real-time updates)
    const getJobDuration = (jobData: any) => {
        if (!jobData) return 'Unknown';

        // For terminal jobs, prioritize accounting data elapsed time if available
        if (isJobTerminal && accountingData?.time?.elapsed) {
            return formatElapsedSeconds(accountingData.time.elapsed);
        }

        // If job has explicit elapsed time, use it
        if (jobData.elapsed) {
            return jobData.elapsed;
        }

        // Calculate duration from timestamps (real-time for running jobs)
        const currentTime = Math.floor(Date.now() / 1000);

        // Check if job has started
        if (jobData.start_time?.set && jobData.start_time.number > 0) {
            const startTime = jobData.start_time.number;
            let endTime = currentTime;

            // For finished jobs, use end_time if available
            if (isJobTerminal && jobData.end_time?.set && jobData.end_time.number > 0) {
                endTime = jobData.end_time.number;
            }
            // For running jobs, use current time for real-time updates
            // (realtimeUpdateTrigger ensures this recalculates every second)

            const durationSeconds = endTime - startTime;
            return formatElapsedSeconds(durationSeconds);
        }

        // Check job state for pending jobs
        if (jobStatus?.toLowerCase() === 'pending' || jobStatus?.toLowerCase() === 'pd') {
            return 'Pending (not started)';
        }

        // If job has a time field, use it as fallback
        if (jobData.time) {
            return jobData.time;
        }

        return 'Not started';
    };

    // Memoized job duration that updates in real-time for running jobs
    const currentJobDuration = useMemo(() => {
        return getJobDuration(jobInfoData);
    }, [jobInfoData, accountingData, isJobTerminal, jobStatus, realtimeUpdateTrigger]);

    // Countdown timer effect
    useEffect(() => {
        if (!shouldPoll) {
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
    }, [shouldPoll]);

    // Real-time duration timer for running jobs
    useEffect(() => {
        // Only update for running jobs (not pending, not terminal)
        const isRunning = jobStatus && !isJobTerminal &&
            !['pending', 'pd'].includes(jobStatus.toLowerCase());

        if (!isRunning) {
            return;
        }

        const timer = setInterval(() => {
            setRealtimeUpdateTrigger(prev => prev + 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [jobStatus, isJobTerminal]);

    const handleBack = () => {
        navigate(-1);
    };

    const handleRefresh = () => {
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ['slurm-job-logs'] });
        queryClient.invalidateQueries({ queryKey: ['slurm-cluster-status'] });
        setCountdown(30);
        toast({
            title: 'Status Refreshed',
            description: 'Job status and logs have been refreshed.',
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
                queryClient.invalidateQueries({ queryKey: ['slurm-job-status-simple'] });
                queryClient.invalidateQueries({ queryKey: ['slurm-job-info'] });

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
                refetchStatus();
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

    const handlePushData = async () => {
        if (!jrJobId) return;

        setIsPushing(true);
        try {
            const result = await pushJobFolder(jrJobId);

            if (result.status === 'OK') {
                toast({
                    title: 'Data Pushed Successfully',
                    description: `Job data for ${jrJobId} has been pushed successfully.`,
                    status: 'success',
                    duration: 5000,
                    isClosable: true,
                });
            } else {
                toast({
                    title: 'Push Failed',
                    description: 'Failed to push job data',
                    status: 'error',
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error: any) {
            toast({
                title: 'Push Failed',
                description: error.message || 'An unexpected error occurred',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsPushing(false);
        }
    };

    const handleEarlySync = async () => {
        if (!jrJobId || !slurmJobId || slurmJobId === '-') {
            toast({
                title: 'Cannot Sync',
                description: 'Job ID or Slurm Job ID is missing',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        setIsEarlySync(true);
        try {
            const result = await earlySyncJob(jrJobId, slurmJobId);

            if (result.status === 'ok') {
                toast({
                    title: 'Early Sync Successful',
                    description: 'Job results have been synced early from the compute node.',
                    status: 'success',
                    duration: 5000,
                    isClosable: true,
                });

                // Refresh the logs after sync
                queryClient.invalidateQueries({ queryKey: ['slurm-job-logs'] });
            } else {
                toast({
                    title: 'Early Sync Failed',
                    description: 'Could not sync job results early. Job may not be running or compute node unavailable.',
                    status: 'warning',
                    duration: 5000,
                    isClosable: true,
                });
            }
        } catch (error: any) {
            toast({
                title: 'Early Sync Failed',
                description: error.message || 'An unexpected error occurred',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsEarlySync(false);
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
                    <HStack spacing={3}>
                        <Heading size="lg" mb={2}>Job Logs</Heading>
                        {clusterStatus?.status === 'offline' && (
                            <Tooltip
                                label={`Logs may be stale - cluster is offline${clusterStatus.reason ? `: ${clusterStatus.reason}` : ''}`}
                            >
                                <Badge
                                    colorScheme="orange"
                                    variant="solid"
                                    fontSize="sm"
                                    px={3}
                                    py={1}
                                    borderRadius="full"
                                    cursor="help"
                                >
                                    Stale Data
                                </Badge>
                            </Tooltip>
                        )}
                    </HStack>
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
                        <Button
                            leftIcon={<TimeIcon />}
                            variant="outline"
                            colorScheme="orange"
                            onClick={handleEarlySync}
                            isLoading={isEarlySync}
                            isDisabled={!slurmJobId || slurmJobId === '-' || isJobTerminal}
                        >
                            Early Sync
                        </Button>
                        <Button
                            leftIcon={<ExternalLinkIcon />}
                            variant="outline"
                            colorScheme="blue"
                            onClick={handlePushData}
                            isLoading={isPushing}
                            isDisabled={!isJobTerminal}
                        >
                            Push Data
                        </Button>
                        {canCancelJob(jobStatus) && (
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
                            as={Link}
                            to={`/jobrunner/${slurmJobId}/${jrJobId}`}
                            leftIcon={<InfoIcon />}
                            variant="outline"
                            colorScheme="blue"
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
                                            : currentJobDuration
                                    }
                                </Text>
                            </WrapItem>

                            {/* Additional job details from job data */}
                            {(jobInfoData as any)?.gres_detail && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>GRES:</strong> {(jobInfoData as any).gres_detail}
                                    </Text>
                                </WrapItem>
                            )}
                            {(jobInfoData as any)?.cpus?.number && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>CPUs:</strong> {(jobInfoData as any).cpus.number}
                                    </Text>
                                </WrapItem>
                            )}
                            {(jobInfoData as any)?.job_resources?.allocated_nodes?.[0]?.memory_allocated && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>RAM:</strong> {Math.round((jobInfoData as any).job_resources.allocated_nodes[0].memory_allocated / 1024)} GB
                                    </Text>
                                </WrapItem>
                            )}
                            {(jobInfoData as any)?.nodes && (
                                <WrapItem>
                                    <Text fontSize="sm" color="gray.600">
                                        <strong>Nodes:</strong> {(jobInfoData as any).nodes}
                                    </Text>
                                </WrapItem>
                            )}

                            {jobStatus && (
                                <WrapItem>
                                    <Badge colorScheme={getStatusColor(jobStatus)}>
                                        {jobStatus}
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
                            {shouldPoll && countdown > 0 && (
                                <WrapItem>
                                    <Text fontSize="xs" color="gray.500">
                                        Next refresh in {countdown}s
                                    </Text>
                                </WrapItem>
                            )}
                        </Wrap>
                    </CardBody>
                </Card>

                {/* Logs Display - Only show when we have job status */}
                {jobStatus && (
                    <Flex gap={6} direction={{ base: 'column', lg: 'row' }} className="log-holder" h="100%" flex="1" display="flex">
                        <LogDisplay
                            logType="stdout"
                            jrJobId={jrJobId!}
                            isJobFinished={isJobTerminal}
                            formatFileSize={formatFileSize}
                            fetchLogData={getSlurmJobStdoutFull}
                            getSlurmJobLogSize={getSlurmJobStdoutSize}
                        />

                        <LogDisplay
                            logType="stderr"
                            jrJobId={jrJobId!}
                            isJobFinished={isJobTerminal}
                            formatFileSize={formatFileSize}
                            fetchLogData={getSlurmJobStderrFull}
                            getSlurmJobLogSize={getSlurmJobStderrSize}
                        />
                    </Flex>
                )}

                {/* Loading state for logs */}
                {!jobStatus && statusLoading && (
                    <Card bg={bgColor} border="1px solid" borderColor={borderColor} flex="1">
                        <CardBody>
                            <VStack spacing={4} justify="center" h="100%">
                                <Spinner size="xl" />
                                <Text>Loading job status...</Text>
                            </VStack>
                        </CardBody>
                    </Card>
                )}

                {/* Error state */}
                {statusError && !jobStatus && (
                    <Alert status="error">
                        <AlertIcon />
                        <AlertTitle>Failed to load job status</AlertTitle>
                        <AlertDescription>
                            {(statusError as any)?.message || 'Unknown error occurred'}
                        </AlertDescription>
                    </Alert>
                )}
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