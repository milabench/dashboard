import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Grid,
    GridItem,
    Button,
    useToast,
    Badge,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalFooter,
    ModalBody,
    ModalCloseButton,
    useDisclosure,
    Textarea,
    FormControl,
    FormLabel,
    Input,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    NumberIncrementStepper,
    NumberDecrementStepper,
    Select,
    Tabs,
    TabList,
    TabPanels,
    Tab,
    TabPanel,
    Card,
    CardBody,
    CardHeader,
    Stat,
    StatLabel,
    StatNumber,
    StatHelpText,
    StatArrow,
    Accordion,
    AccordionItem,
    AccordionButton,
    AccordionPanel,
    AccordionIcon,
    Code,
    Divider,
    Spinner,
    Alert,
    AlertIcon,
    AlertTitle,
    AlertDescription,
    IconButton,
    Tooltip,
    useColorModeValue,
    Flex,
    Spacer,
    Checkbox
} from '@chakra-ui/react';
import {
    AddIcon,
    ViewIcon,
    DownloadIcon,
    DeleteIcon,
    RepeatIcon,
    InfoIcon,
    CheckCircleIcon,
    WarningIcon,
    TimeIcon,
    ExternalLinkIcon
} from '@chakra-ui/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MonacoEditor } from '../shared/MonacoEditor';
import { JobSubmissionForm } from './JobSubmit';
import {
    getSlurmJobs,
    getSlurmPersistedJobs,
    submitSlurmJob,
    cancelSlurmJob,
    rerunSlurmJob,
    getSlurmClusterInfo,
    getSlurmTemplates,
    getSlurmTemplateContent,
    getSlurmProfiles,
    saveSlurmProfile,
    saveSlurmTemplate,
    getSlurmClusterStatus,
} from '../../services/api';
import type { SlurmJob, SlurmJobSubmitRequest, SlurmJobLogs, SlurmJobData, SlurmProfile, PersitedJobInfo } from '../../services/types';
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

const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'r':
            return <CheckCircleIcon color="green.500" />;
        case 'pending':
        case 'pd':
            return <TimeIcon color="yellow.500" />;
        case 'completed':
        case 'cd':
            return <CheckCircleIcon color="blue.500" />;
        case 'failed':
        case 'f':
            return <WarningIcon color="red.500" />;
        default:
            return <InfoIcon color="gray.500" />;
    }
};

export const DashboardView: React.FC<DashboardViewProps> = () => {
    usePageTitle('Dashboard');

    const toast = useToast();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { isOpen, onOpen, onClose } = useDisclosure();

    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

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

    const getJobState = (job: SlurmJob) => {
        const state = job.job_state?.[0];
        return state ? state.toLowerCase() : '';
    };

    const cancelJobMutation = useMutation({
        mutationFn: cancelSlurmJob,
        onSuccess: (data) => {
            toast({
                title: 'Job Cancelled',
                description: data.message || 'Job cancelled successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Cancellation Failed',
                description: error.message || 'Failed to cancel job',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const rerunJobMutation = useMutation({
        mutationFn: rerunSlurmJob,
        onSuccess: (data) => {
            toast({
                title: 'Job Rerun',
                description: data.message || 'Job rerun successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Error Rerunning Job',
                description: error?.response?.data?.error || 'Failed to rerun job',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    // Job submission form state
    const [submitForm, setSubmitForm] = useState<SlurmJobSubmitRequest>({
        script: '',
        job_name: 'milabench_job',
        script_args: {},
        partition: '',
        nodes: 1,
        ntasks: 1,
        cpus_per_task: 4,
        mem: '8G',
        time_limit: '02:00:00',
        gpus_per_task: '1',
        ntasks_per_node: 1,
        exclusive: false,
        export: 'ALL',
        nodelist: '',
    });

    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');



    const loadTemplateMutation = useMutation({
        mutationFn: getSlurmTemplateContent,
        onSuccess: (content) => {
            setSubmitForm(prev => ({
                ...prev,
                script: content
            }));
        },
        onError: (error: any) => {
            toast({
                title: 'Template Loading Failed',
                description: error.message || 'Failed to load template content',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const saveProfileMutation = useMutation({
        mutationFn: saveSlurmProfile,
        onSuccess: (data) => {
            toast({
                title: 'Profile Saved',
                description: data.message || 'Profile saved successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            // Refresh profiles
            queryClient.invalidateQueries({ queryKey: ['slurm-profiles'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Profile Save Failed',
                description: error.message || 'Failed to save profile',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const saveTemplateMutation = useMutation({
        mutationFn: saveSlurmTemplate,
        onSuccess: (data) => {
            toast({
                title: 'Template Saved',
                description: data.message || 'Template saved successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            // Refresh templates
            queryClient.invalidateQueries({ queryKey: ['slurm-templates'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Template Save Failed',
                description: error.message || 'Failed to save template',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const submitJobMutation = useMutation({
        mutationFn: submitSlurmJob,
        onSuccess: (data) => {
            toast({
                title: 'Job Submitted',
                description: `Job ${data.job_id} submitted successfully`,
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
            onClose();
        },
        onError: (error: any) => {
            toast({
                title: 'Submission Failed',
                description: error.message || 'Failed to submit job',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const handleSubmitJob = () => {
        // Always build sbatch arguments from form fields, taking precedence over profile
        const sbatch_args = [];

        if (submitForm.partition) {
            sbatch_args.push(`--partition=${submitForm.partition}`);
        }
        if (submitForm.nodes) {
            sbatch_args.push(`--nodes=${submitForm.nodes}`);
        }
        if (submitForm.ntasks) {
            sbatch_args.push(`--ntasks=${submitForm.ntasks}`);
        }
        if (submitForm.cpus_per_task) {
            sbatch_args.push(`--cpus-per-task=${submitForm.cpus_per_task}`);
        }
        if (submitForm.mem) {
            sbatch_args.push(`--mem=${submitForm.mem}`);
        }
        if (submitForm.time_limit) {
            sbatch_args.push(`--time=${submitForm.time_limit}`);
        }
        if (submitForm.gpus_per_task) {
            sbatch_args.push(`--gpus-per-task=${submitForm.gpus_per_task}`);
        }
        if (submitForm.ntasks_per_node) {
            sbatch_args.push(`--ntasks-per-node=${submitForm.ntasks_per_node}`);
        }
        if (submitForm.exclusive) {
            sbatch_args.push('--exclusive');
        }
        if (submitForm.export) {
            sbatch_args.push(`--export=${submitForm.export}`);
        }
        if (submitForm.nodelist) {
            sbatch_args.push(`-w ${submitForm.nodelist}`);
        }
        if (submitForm.dependency) {
            const dep = [];
            for (const [event, job_id] of submitForm.dependency) {
                dep.push(`${event}:${job_id}`);
            }
            const dependency = dep.join(",");
            sbatch_args.push(`--dependency=${dependency}`);
        }

        // Use the unified submit endpoint
        submitJobMutation.mutate({
            script: submitForm.script,
            job_name: submitForm.job_name,
            sbatch_args: sbatch_args,
            script_args: submitForm.script_args
        });
    };

    const handleProfileSelect = (profileName: string) => {
        setSelectedProfile(profileName);

        // Load profile parameters into form if profile exists
        const selectedProfileData = profiles?.find(p => p.name === profileName);
        if (selectedProfileData) {
            setSubmitForm(prev => ({
                ...prev,
                job_name: selectedProfileData.parsed_args.job_name || prev.job_name,
                partition: selectedProfileData.parsed_args.partition || prev.partition,
                nodes: selectedProfileData.parsed_args.nodes || prev.nodes,
                ntasks: selectedProfileData.parsed_args.ntasks || prev.ntasks,
                cpus_per_task: selectedProfileData.parsed_args.cpus_per_task || prev.cpus_per_task,
                mem: selectedProfileData.parsed_args.mem || prev.mem,
                time_limit: selectedProfileData.parsed_args.time_limit || prev.time_limit,
                gpus_per_task: selectedProfileData.parsed_args.gpus_per_task || prev.gpus_per_task,
                ntasks_per_node: selectedProfileData.parsed_args.ntasks_per_node || prev.ntasks_per_node,
                exclusive: selectedProfileData.parsed_args.exclusive !== undefined ? selectedProfileData.parsed_args.exclusive : prev.exclusive,
                export: selectedProfileData.parsed_args.export || prev.export,
                nodelist: selectedProfileData.parsed_args.nodelist || prev.nodelist,
            }));
        }
    };

    const handleTemplateSelect = (templateName: string) => {
        setSelectedTemplate(templateName);
        if (templateName && templateNames?.includes(templateName)) {
            loadTemplateMutation.mutate(templateName);
        }
    };

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

    const handleViewJobDetails = (job: SlurmJob) => {
        const jrJobId = typeof job.jr_job_id === 'string' ? job.jr_job_id : NO_JR_JOB_ID;
        const jobId = job.job_id || NO_JOB_ID;
        navigate(`/jobrunner/${jobId}/${jrJobId}`);
    };

    const handleSaveProfile = () => {
        const profileName = selectedProfile.trim();
        if (!profileName) {
            toast({
                title: 'Profile Name Required',
                description: 'Please select or enter a profile name to save the current configuration.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        // Convert form fields to sbatch arguments
        // NOTE: Deliberately exclude dependency - dependencies are job-specific and should not be saved in reusable profiles
        const sbatch_args = [];

        if (submitForm.job_name) {
            sbatch_args.push(`--job-name=${submitForm.job_name}`);
        }
        if (submitForm.partition) {
            sbatch_args.push(`--partition=${submitForm.partition}`);
        }
        if (submitForm.nodes) {
            sbatch_args.push(`--nodes=${submitForm.nodes}`);
        }
        if (submitForm.ntasks) {
            sbatch_args.push(`--ntasks=${submitForm.ntasks}`);
        }
        if (submitForm.cpus_per_task) {
            sbatch_args.push(`--cpus-per-task=${submitForm.cpus_per_task}`);
        }
        if (submitForm.mem) {
            sbatch_args.push(`--mem=${submitForm.mem}`);
        }
        if (submitForm.time_limit) {
            sbatch_args.push(`--time=${submitForm.time_limit}`);
        }
        if (submitForm.gpus_per_task) {
            sbatch_args.push(`--gpus-per-task=${submitForm.gpus_per_task}`);
        }
        if (submitForm.ntasks_per_node) {
            sbatch_args.push(`--ntasks-per-node=${submitForm.ntasks_per_node}`);
        }
        if (submitForm.exclusive) {
            sbatch_args.push('--exclusive');
        }
        if (submitForm.export) {
            sbatch_args.push(`--export=${submitForm.export}`);
        }
        if (submitForm.nodelist) {
            sbatch_args.push(`-w ${submitForm.nodelist}`);
        }

        // Explicitly filter out any dependency-related arguments (safety check)
        const filteredArgs = sbatch_args.filter(arg => !arg.startsWith('--dependency'));

        saveProfileMutation.mutate({
            name: profileName,
            description: '',
            sbatch_args: filteredArgs
        });
    };

    const handleSaveTemplate = () => {
        const templateName = selectedTemplate.trim();
        if (!templateName) {
            toast({
                title: 'Template Name Required',
                description: 'Please select or enter a template name to save the current script.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        if (!submitForm.script.trim()) {
            toast({
                title: 'Script Content Required',
                description: 'Please enter script content before saving as template.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        saveTemplateMutation.mutate({
            name: templateName,
            content: submitForm.script
        });
    };

    return (
        <Box p={5} marginLeft="-5px" h="100%">
            <VStack align="stretch" spacing={4} h="100%">

                {/* Action Buttons */}
                <HStack spacing={3} justify={"space-between"}>
                     <HStack spacing={2}>
                        <Heading size="lg" mb={2}>Jobs</Heading>
                        {clusterStatusLoading ? (
                                <Tooltip label="Checking cluster status...">
                                    <Spinner size="sm" />
                                </Tooltip>
                            ) : clusterStatus ? (
                                <Tooltip
                                    label={
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
                                        px={3}
                                        py={1}
                                        borderRadius="full"
                                        cursor="help"
                                    >
                                        Cluster {clusterStatus.status === 'online' ? 'Online' : 'Offline'}
                                    </Badge>
                                </Tooltip>
                            ) : (
                                <Tooltip label="Unable to determine cluster status">
                                    <Badge
                                        colorScheme="gray"
                                        variant="solid"
                                        fontSize="sm"
                                        px={3}
                                        py={1}
                                        borderRadius="full"
                                        cursor="help"
                                    >
                                        Status Unknown
                                    </Badge>
                                </Tooltip>
                            )}
                    </HStack>

                    <HStack spacing={3} justify={"space-between"}>
                        
                            <Button
                                leftIcon={<AddIcon />}
                                colorScheme="blue"
                                onClick={onOpen}
                            >
                                Submit New Job
                            </Button>
                            
                        <Button
                            leftIcon={<RepeatIcon />}
                            variant="outline"
                            onClick={() => {
                                queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
                                queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
                                queryClient.invalidateQueries({ queryKey: ['slurm-cluster-status'] });
                            }}
                            isLoading={activeJobsLoading || persistedJobsLoading || clusterStatusLoading}
                        >
                            Refresh Jobs
                        </Button>
                    </HStack>
                </HStack>

                {/* Active Jobs Table */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardHeader>
                        <Heading size="md">Active Jobs (squeue)</Heading>
                    </CardHeader>
                    <CardBody>
                        {(activeJobsError) ? (
                            <Alert status="error">
                                <AlertIcon />
                                <AlertTitle>Error loading active jobs!</AlertTitle>
                                <AlertDescription>
                                    {(activeJobsError as any)?.message || 'Failed to load active jobs'}
                                </AlertDescription>
                            </Alert>
                        ) : (activeJobsLoading) ? (
                            <Box textAlign="center" py={8}>
                                <Spinner size="lg" />
                                <Text mt={4}>Loading active jobs...</Text>
                            </Box>
                        ) : (
                            <Box overflowX="auto">
                                <Table variant="simple">
                                    <Thead>
                                        <Tr>
                                            <Th>Job ID</Th>
                                            <Th>JR Job ID</Th>
                                            <Th>Name</Th>
                                            <Th>Status</Th>
                                            <Th>Partition</Th>
                                            <Th>User</Th>
                                            <Th>Time</Th>
                                            <Th>Actions</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {activeJobs.map((job: SlurmJob) => (
                                            <Tr key={job.job_id}>
                                                <Td>
                                                    <Text fontWeight="bold">{job.job_id}</Text>
                                                </Td>
                                                <Td>
                                                    <Text fontFamily="mono" fontSize="sm">
                                                        {job.jr_job_id}
                                                    </Text>
                                                </Td>
                                                <Td>
                                                    <Text>{job.name || 'N/A'}</Text>
                                                </Td>
                                                <Td>
                                                    <HStack>
                                                        {getStatusIcon(job.job_state?.[0] || '')}
                                                        <Badge colorScheme={getStatusColor(job.job_state?.[0] || '')}>
                                                            {job.job_state?.[0] || NO_JOB_STATE}
                                                        </Badge>
                                                    </HStack>
                                                </Td>
                                                <Td>{job.partition || 'N/A'}</Td>
                                                <Td>{job.user_name || 'N/A'}</Td>
                                                <Td>
                                                    {typeof job.time_limit === 'string'
                                                        ? job.time_limit
                                                        : job.time_limit?.number
                                                            ? `${job.time_limit.number}min`
                                                            : 'N/A'
                                                    }
                                                </Td>
                                                <Td>
                                                    <HStack spacing={2}>
                                                        <Tooltip label="View Details">
                                                            <IconButton
                                                                as={Link}
                                                                to={`/jobrunner/${job.job_id || NO_JOB_ID}/${typeof job.jr_job_id === 'string' ? job.jr_job_id : NO_JR_JOB_ID}`}
                                                                aria-label="View job details"
                                                                icon={<InfoIcon />}
                                                                size="sm"
                                                                variant="ghost"
                                                            />
                                                        </Tooltip>
                                                        <Tooltip label="View Logs">
                                                            <IconButton
                                                                as={Link}
                                                                to={`/joblogs/${job.job_id}/${job.jr_job_id}`}
                                                                aria-label="View job logs"
                                                                icon={<ViewIcon />}
                                                                size="sm"
                                                                variant="ghost"
                                                            />
                                                        </Tooltip>
                                                        {(job.job_state?.[0]?.toLowerCase() === 'running' ||
                                                            job.job_state?.[0]?.toLowerCase() === 'pending') && (
                                                                <Tooltip label="Cancel Job">
                                                                    <IconButton
                                                                        aria-label="Cancel job"
                                                                        icon={<DeleteIcon />}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        colorScheme="red"
                                                                        onClick={() => job.job_id && handleCancelJob(job.job_id)}
                                                                    />
                                                                </Tooltip>
                                                            )}
                                                    </HStack>
                                                </Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                                {activeJobs.length === 0 && (
                                    <Box textAlign="center" py={8}>
                                        <Text color="gray.500">No active jobs found</Text>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </CardBody>
                </Card>

                {/* Persisted Jobs Table */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor} h="100%" overflow="auto">
                    <CardHeader>
                        <Heading size="md">Persisted Jobs (filesystem)</Heading>
                    </CardHeader>
                    <CardBody overflowY="auto">
                        {(persistedJobsError) ? (
                            <Alert status="error">
                                <AlertIcon />
                                <AlertTitle>Error loading persisted jobs!</AlertTitle>
                                <AlertDescription>
                                    {(persistedJobsError as any)?.message || 'Failed to load persisted jobs'}
                                </AlertDescription>
                            </Alert>
                        ) : (persistedJobsLoading) ? (
                            <Box textAlign="center" py={8}>
                                <Spinner size="lg" />
                                <Text mt={4}>Loading persisted jobs...</Text>
                            </Box>
                        ) : (
                            <Box>
                                <Table variant="simple">
                                    <Thead>
                                        <Tr>
                                            <Th>Job ID</Th>
                                            <Th>JR Job ID</Th>
                                            <Th>Name</Th>
                                            <Th>Status</Th>
                                            <Th>Partition</Th>
                                            <Th>User</Th>
                                            <Th>Time</Th>
                                            <Th>Actions</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {persistedJobs.map((persistedJobInfo: PersitedJobInfo) => {
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
                                                if (ratio <= 0) return '#22c55e'; // Green
                                                if (ratio >= 1) return '#92400e'; // Brown
                                                
                                                // Interpolate between green and brown
                                                const green = [34, 197, 94]; // RGB for green
                                                const brown = [146, 64, 14]; // RGB for brown
                                                
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
                                                    <Tr key={`persisted-${jrJobId}`}>
                                                        <Td>
                                                        <HStack spacing={2}>
                                                            <Tooltip label={formatDuration(persistedJobInfo.freshness)}>
                                                                <Box
                                                                    width="12px"
                                                                    height="12px"
                                                                    backgroundColor={getFreshnessColor(freshnessRatio)}
                                                                    borderRadius="2px"
                                                                    cursor="pointer"
                                                                />
                                                            </Tooltip>
                                                            <Text fontWeight="bold">{jobId}</Text>
                                                        </HStack>
                                                        </Td>
                                                        <Td>
                                                            <Text fontFamily="mono" fontSize="sm">
                                                                {jrJobId}
                                                            </Text>
                                                        </Td>
                                                        <Td>
                                                        <Text>{jobName}</Text>
                                                        </Td>
                                                        <Td>
                                                        <HStack>
                                                            {getStatusIcon(jobStatus)}
                                                            <Badge colorScheme={getStatusColor(jobStatus)}>
                                                                {jobStatus}
                                                            </Badge>
                                                        </HStack>
                                                        </Td>
                                                    <Td>{partition}</Td>
                                                    <Td>{user}</Td>
                                                    <Td>{timeLimit}</Td>
                                                        <Td>
                                                            <HStack spacing={2}>
                                                                <Tooltip label="View Details">
                                                                    <IconButton
                                                                        as={Link}
                                                                    to={`/jobrunner/${jobId}/${jrJobId}`}
                                                                        aria-label="View job details"
                                                                        icon={<InfoIcon />}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                    />
                                                                </Tooltip>
                                                                <Tooltip label="View Logs">
                                                                    <IconButton
                                                                        as={Link}
                                                                    to={`/joblogs/${jobId}/${jrJobId}`}
                                                                        aria-label="View job logs"
                                                                        icon={<ViewIcon />}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                    />
                                                                </Tooltip>
                                                            <Tooltip label="Rerun Job">
                                                                <IconButton
                                                                    aria-label="Rerun job"
                                                                    icon={<RepeatIcon />}
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    colorScheme="blue"
                                                                    onClick={() => handleRerunJob(jrJobId)}
                                                                />
                                                            </Tooltip>
                                                        </HStack>
                                                    </Td>
                                                </Tr>
                                            );
                                        })}
                                    </Tbody>
                                </Table>
                                {persistedJobs.length === 0 && (
                                    <Box textAlign="center" py={8}>
                                        <Text color="gray.500">No persisted jobs found</Text>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </CardBody>
                </Card>


                {/* Job Submission Modal */}
                <Modal isOpen={isOpen} onClose={onClose} >
                    <ModalOverlay />
                    <ModalContent maxW="80vw" w="80vw" style={{ margin: "5px" }}>
                        <ModalHeader>Submit New Job</ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            <JobSubmissionForm
                                form={submitForm}
                                setForm={setSubmitForm}
                                template=""
                                templates={templateNames}
                                profiles={profiles || []}
                                selectedProfile={selectedProfile}
                                onProfileSelect={handleProfileSelect}
                                selectedTemplate={selectedTemplate}
                                onTemplateSelect={handleTemplateSelect}
                                onSaveProfile={handleSaveProfile}
                                saveProfileMutation={saveProfileMutation}
                                onSaveTemplate={handleSaveTemplate}
                                saveTemplateMutation={saveTemplateMutation}
                                activeJobs={activeJobs}
                            />
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="ghost" mr={3} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                colorScheme="blue"
                                onClick={handleSubmitJob}
                                isLoading={submitJobMutation.isPending}
                            >
                                Submit Job
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            </VStack>
        </Box>
    );
};



