import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
    Code,
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
    FormErrorMessage
} from '@chakra-ui/react';
import { ArrowBackIcon, RepeatIcon, ViewIcon, CloseIcon, DownloadIcon } from '@chakra-ui/icons';
import { useQuery } from '@tanstack/react-query';
import { getSlurmJobStdoutFull, getSlurmJobStderrFull, getSlurmJobStatus, rerunSlurmJob, cancelSlurmJob, saveSlurmJob } from '../../services/api';
import type { SlurmJob } from '../../services/types';

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
    const { slurmJobId, jrJobId } = useParams<{ slurmJobId: string; jrJobId: string }>();
    const navigate = useNavigate();
    const toast = useToast();
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Refs for auto-scrolling
    const stdoutRef = useRef<HTMLDivElement>(null);
    const stderrRef = useRef<HTMLDivElement>(null);

    // Countdown timer state
    const [countdown, setCountdown] = useState(30);
    const REFRESH_INTERVAL = 30000; // 30 seconds in milliseconds

    // Rerun state
    const [isRerunning, setIsRerunning] = useState(false);

    // Cancel state
    const [isCancelling, setIsCancelling] = useState(false);

    // Save job state
    const [isSaving, setIsSaving] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');
    const [commitMessageError, setCommitMessageError] = useState('');
    const { isOpen: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose } = useDisclosure();

    // Helper function to check if job is in finished state
    const isJobFinished = (jobStatus: SlurmJob[] | undefined) => {
        if (!jobStatus || jobStatus.length === 0) return false;
        const jobState = jobStatus[0].job_state;
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
    const canCancelJob = (jobStatus: SlurmJob[] | undefined) => {
        if (!jobStatus || jobStatus.length === 0) return false;
        const jobState = jobStatus[0].job_state;
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
    const getJobStatusString = (jobStatus: SlurmJob[] | undefined) => {
        if (!jobStatus || jobStatus.length === 0) return 'Unknown';
        const jobState = jobStatus[0].job_state;

        if (Array.isArray(jobState)) {
            return jobState[0] || 'Unknown';
        } else if (typeof jobState === 'string') {
            return jobState;
        }

        return 'Unknown';
    };

    // Helper function to get formatted job duration
    const getJobDuration = (jobStatus: SlurmJob[] | undefined) => {
        if (!jobStatus || jobStatus.length === 0) return 'Unknown';

        const job = jobStatus[0];

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

    // Get job status with auto-refresh every 30 seconds
    const {
        data: jobStatus,
        isLoading: statusLoading,
        error: statusError,
        refetch: refetchStatus
    } = useQuery({
        queryKey: ['slurm-job-status', slurmJobId],
        queryFn: () => getSlurmJobStatus(slurmJobId!),
        enabled: !!slurmJobId && slurmJobId !== '-',
        refetchInterval: 30000, // Refresh every 30 seconds
        refetchIntervalInBackground: true,
    });

    // Get job stdout with auto-refresh every 30 seconds
    const {
        data: stdout,
        isLoading: stdoutLoading,
        error: stdoutError,
        refetch: refetchStdout
    } = useQuery({
        queryKey: ['slurm-job-stdout-full', jrJobId],
        queryFn: () => getSlurmJobStdoutFull(jrJobId!),
        enabled: !!jrJobId,
        refetchInterval: isJobFinished(jobStatus) ? false : 30000, // Disable refresh if job is finished
        refetchIntervalInBackground: true,
    });

    // Get job stderr with auto-refresh every 30 seconds
    const {
        data: stderr,
        isLoading: stderrLoading,
        error: stderrError,
        refetch: refetchStderr
    } = useQuery({
        queryKey: ['slurm-job-stderr-full', jrJobId],
        queryFn: () => getSlurmJobStderrFull(jrJobId!),
        enabled: !!jrJobId,
        refetchInterval: isJobFinished(jobStatus) ? false : 30000, // Disable refresh if job is finished
        refetchIntervalInBackground: true,
    });

    const handleBack = () => {
        navigate(-1);
    };

    // Auto-scroll to bottom when logs update
    useEffect(() => {
        if (stdout && stdoutRef.current) {
            stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
        }
    }, [stdout]);

    useEffect(() => {
        if (stderr && stderrRef.current) {
            stderrRef.current.scrollTop = stderrRef.current.scrollHeight;
        }
    }, [stderr]);

    // Countdown timer effect
    useEffect(() => {
        // Stop countdown if job is finished
        if (isJobFinished(jobStatus)) {
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
    }, [jobStatus]);

    // Effect to perform final refresh when job finishes
    useEffect(() => {
        if (isJobFinished(jobStatus)) {
            // Perform one final refresh to get the latest logs
            refetchStdout();
            refetchStderr();
            toast({
                title: 'Job Finished',
                description: 'Job has completed. Performing final log refresh.',
                status: 'info',
                duration: 3000,
                isClosable: true,
            });
        }
    }, [jobStatus, refetchStdout, refetchStderr]);

    const handleRefresh = () => {
        refetchStdout();
        refetchStderr();
        if (slurmJobId && slurmJobId !== '-') {
            refetchStatus();
        }
        setCountdown(30); // Reset countdown
        toast({
            title: 'Logs Refreshed',
            description: 'Job logs have been refreshed',
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

                // Navigate to the new job logs after a short delay
                setTimeout(() => {
                    navigate(`/joblogs/${result.job_id || '-'}/${result.jr_job_id || jrJobId}`);
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
        <Box p={6}>
            <VStack align="stretch" spacing={6}>
                {/* Header */}
                <HStack justify="space-between">
                    <Box>
                        <Heading size="lg" mb={2}>Job Logs</Heading>
                        <HStack spacing={3} align="center">
                            <Text color="gray.600">
                                JR Job ID: {jrJobId}
                            </Text>
                            {slurmJobId && slurmJobId !== '-' && (
                                <Text color="gray.600">
                                    Slurm Job ID: {slurmJobId}
                                </Text>
                            )}
                            {jobStatus && jobStatus.length > 0 && (
                                <Badge colorScheme={getStatusColor(getJobStatusString(jobStatus))}>
                                    {getJobStatusString(jobStatus)}
                                </Badge>
                            )}
                            {statusLoading && (
                                <Badge colorScheme="gray">
                                    <Spinner size="xs" mr={1} />
                                    Checking Status...
                                </Badge>
                            )}
                            {statusError && (
                                <Badge colorScheme="red">
                                    Status Error
                                </Badge>
                            )}
                        </HStack>
                    </Box>
                    <HStack spacing={3}>
                        <Button
                            leftIcon={<RepeatIcon />}
                            variant="outline"
                            onClick={handleRefresh}
                            isLoading={stdoutLoading || stderrLoading || statusLoading}
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

                {/* Auto-refresh indicator */}
                <Alert status={isJobFinished(jobStatus) ? "warning" : "info"}>
                    <AlertIcon />
                    <AlertTitle>
                        {isJobFinished(jobStatus) ? "Auto-refresh disabled" : "Auto-refresh enabled"}
                    </AlertTitle>
                    <AlertDescription>
                        {isJobFinished(jobStatus) ? (
                            "Job is in finished state. Auto-refresh has been disabled to save resources. Click 'Refresh Now' to update manually."
                        ) : (
                            <>
                                Logs are automatically refreshed every 30 seconds. Next refresh in <strong>{countdown}</strong> seconds. Click "Refresh Now" to update immediately.
                            </>
                        )}
                    </AlertDescription>
                </Alert>

                {/* Logs Display */}
                <Flex gap={6} direction={{ base: 'column', lg: 'row' }}>
                    {/* STDOUT */}
                    <Card bg={bgColor} border="1px solid" borderColor={borderColor} flex={1}>
                        <CardHeader>
                            <HStack justify="space-between">
                                <Heading size="md">Standard Output (stdout)</Heading>
                                <Badge colorScheme={isJobFinished(jobStatus) ? "gray" : "green"}>
                                    {isJobFinished(jobStatus) ? "Manual refresh" : "Auto-refresh"}
                                </Badge>
                            </HStack>
                        </CardHeader>
                        <CardBody>
                            {stdoutError ? (
                                <Alert status="error">
                                    <AlertIcon />
                                    <AlertTitle>Error loading stdout</AlertTitle>
                                    <AlertDescription>
                                        {(stdoutError as any)?.message || 'Failed to load stdout'}
                                    </AlertDescription>
                                </Alert>
                            ) : stdoutLoading ? (
                                <Box textAlign="center" py={8}>
                                    <Spinner size="lg" />
                                    <Text mt={4}>Loading stdout...</Text>
                                </Box>
                            ) : (
                                <Box>
                                    {stdout ? (
                                        <Code
                                            ref={stdoutRef}
                                            display="block"
                                            whiteSpace="pre-wrap"
                                            fontSize="sm"
                                            p={4}
                                            bg="gray.50"
                                            color="gray.800"
                                            borderRadius="md"
                                            maxH="600px"
                                            overflowY="auto"
                                            fontFamily="mono"
                                        >
                                            {stdout}
                                        </Code>
                                    ) : (
                                        <Text color="gray.500" textAlign="center" py={8}>
                                            No stdout content available
                                        </Text>
                                    )}
                                </Box>
                            )}
                        </CardBody>
                    </Card>

                    {/* STDERR */}
                    <Card bg={bgColor} border="1px solid" borderColor={borderColor} flex={1}>
                        <CardHeader>
                            <HStack justify="space-between">
                                <Heading size="md">Standard Error (stderr)</Heading>
                                <Badge colorScheme={isJobFinished(jobStatus) ? "gray" : "green"}>
                                    {isJobFinished(jobStatus) ? "Manual refresh" : "Auto-refresh"}
                                </Badge>
                            </HStack>
                        </CardHeader>
                        <CardBody>
                            {stderrError ? (
                                <Alert status="error">
                                    <AlertIcon />
                                    <AlertTitle>Error loading stderr</AlertTitle>
                                    <AlertDescription>
                                        {(stderrError as any)?.message || 'Failed to load stderr'}
                                    </AlertDescription>
                                </Alert>
                            ) : stderrLoading ? (
                                <Box textAlign="center" py={8}>
                                    <Spinner size="lg" />
                                    <Text mt={4}>Loading stderr...</Text>
                                </Box>
                            ) : (
                                <Box>
                                    {stderr ? (
                                        <Code
                                            ref={stderrRef}
                                            display="block"
                                            whiteSpace="pre-wrap"
                                            fontSize="sm"
                                            p={4}
                                            bg="red.50"
                                            color="red.800"
                                            borderRadius="md"
                                            maxH="600px"
                                            overflowY="auto"
                                            fontFamily="mono"
                                        >
                                            {stderr}
                                        </Code>
                                    ) : (
                                        <Text color="gray.500" textAlign="center" py={8}>
                                            No stderr content available
                                        </Text>
                                    )}
                                </Box>
                            )}
                        </CardBody>
                    </Card>
                </Flex>

                {/* Footer Info */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardBody>
                        <VStack align="stretch" spacing={2}>
                            <Text fontSize="sm" color="gray.600">
                                <strong>Job Duration:</strong> {getJobDuration(jobStatus)}
                            </Text>
                            <Text fontSize="sm" color="gray.600">
                                <strong>Next refresh:</strong> {isJobFinished(jobStatus) ? "Disabled (job finished)" : `${countdown} seconds`}
                            </Text>
                            <Text fontSize="sm" color="gray.600">
                                <strong>JR Job ID:</strong> {jrJobId}
                            </Text>
                            {slurmJobId && slurmJobId !== '-' && (
                                <Text fontSize="sm" color="gray.600">
                                    <strong>Slurm Job ID:</strong> {slurmJobId}
                                </Text>
                            )}
                            {jobStatus && jobStatus.length > 0 && (
                                <Text fontSize="sm" color="gray.600">
                                    <strong>Job Status:</strong> {getJobStatusString(jobStatus)}
                                </Text>
                            )}
                        </VStack>
                    </CardBody>
                </Card>
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