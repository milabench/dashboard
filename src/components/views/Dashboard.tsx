import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
    TimeIcon
} from '@chakra-ui/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MonacoEditor } from '../shared/MonacoEditor';
import {
    getSlurmJobs,
    getSlurmPersistedJobs,
    submitSlurmJob,
    cancelSlurmJob,
    getSlurmClusterInfo,
    getSlurmTemplates,
    getSlurmTemplateContent,
    getSlurmProfiles,
    saveSlurmProfile,
    saveSlurmTemplate,
} from '../../services/api';
import type { SlurmJob, SlurmJobSubmitRequest, SlurmJobLogs, SlurmJobData, SlurmProfile } from '../../services/types';

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

    const { data: persistedJobsData, isLoading: persistedJobsLoading, error: persistedJobsError } = useQuery({
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

    // Separate active jobs and persisted jobs
    const activeJobs = activeJobsData || [];
    const persistedJobIds = persistedJobsData || [];

    const runningJobs = activeJobs.filter((job: SlurmJob) =>
        job.job_state?.[0]?.toLowerCase() === 'running'
    );
    const pendingJobs = activeJobs.filter((job: SlurmJob) =>
        job.job_state?.[0]?.toLowerCase() === 'pending'
    );
    const completedJobs = activeJobs.filter((job: SlurmJob) =>
        job.job_state?.[0]?.toLowerCase() === 'completed'
    );


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

    // Job submission form state
    const [submitForm, setSubmitForm] = useState<SlurmJobSubmitRequest>({
        script: '',
        job_name: 'milabench_job',
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

        // Use the unified submit endpoint
        submitJobMutation.mutate({
            script: submitForm.script,
            job_name: submitForm.job_name,
            sbatch_args: sbatch_args
        });
    };

    const handleProfileSelect = (profileName: string) => {
        setSelectedProfile(profileName);

        // Load profile parameters into form if profile exists
        const selectedProfileData = profiles?.find(p => p.name === profileName);
        if (selectedProfileData) {
            setSubmitForm(prev => ({
                ...prev,
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

    const handleViewJobDetails = (job: SlurmJob) => {
        const jrJobId = typeof job.jr_job_id === 'string' ? job.jr_job_id : 'unknown';
        const jobId = job.job_id || 'unknown';
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

        saveProfileMutation.mutate({
            name: profileName,
            description: '',
            sbatch_args: sbatch_args
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
        <Box p={6}>
            <VStack align="stretch" spacing={6}>
                <Box>
                    <Heading size="lg" mb={2}>Slurm Cluster Dashboard</Heading>
                    <Text color="gray.600">
                        Monitor and manage your Milabench jobs on the Slurm cluster
                    </Text>
                </Box>

                {/* Cluster Statistics */}
                <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={6}>
                    <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                        <CardBody>
                            <Stat>
                                <StatLabel>Active Jobs</StatLabel>
                                <StatNumber>{activeJobs.length}</StatNumber>
                                <StatHelpText>
                                    <StatArrow type="increase" />
                                    23.36%
                                </StatHelpText>
                            </Stat>
                        </CardBody>
                    </Card>

                    <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                        <CardBody>
                            <Stat>
                                <StatLabel>Running Jobs</StatLabel>
                                <StatNumber color="green.500">{runningJobs.length}</StatNumber>
                                <StatHelpText>Active executions</StatHelpText>
                            </Stat>
                        </CardBody>
                    </Card>

                    <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                        <CardBody>
                            <Stat>
                                <StatLabel>Pending Jobs</StatLabel>
                                <StatNumber color="yellow.500">{pendingJobs.length}</StatNumber>
                                <StatHelpText>Waiting in queue</StatHelpText>
                            </Stat>
                        </CardBody>
                    </Card>

                    <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                        <CardBody>
                            <Stat>
                                <StatLabel>Persisted Jobs</StatLabel>
                                <StatNumber color="blue.500">{persistedJobIds.length}</StatNumber>
                                <StatHelpText>Available outputs</StatHelpText>
                            </Stat>
                        </CardBody>
                    </Card>
                </Grid>

                {/* Action Buttons */}
                <HStack spacing={4}>
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
                        }}
                        isLoading={activeJobsLoading || persistedJobsLoading}
                    >
                        Refresh Jobs
                    </Button>
                </HStack>

                {/* Active Jobs Table */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardHeader>
                        <Heading size="md">Active Jobs</Heading>
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
                                                            {job.job_state?.[0] || 'Unknown'}
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
                                                                aria-label="View job details"
                                                                icon={<ViewIcon />}
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleViewJobDetails(job)}
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
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardHeader>
                        <Heading size="md">Persisted Jobs</Heading>
                    </CardHeader>
                    <CardBody>
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
                                        {persistedJobIds.map((jrJobId: string) => {
                                            const job = activeJobs.find(j => j.jr_job_id === jrJobId);
                                            if (!job) {
                                                return (
                                                    <Tr key={`persisted-${jrJobId}`}>
                                                        <Td>
                                                            <Text fontWeight="bold">-</Text>
                                                        </Td>
                                                        <Td>
                                                            <Text fontFamily="mono" fontSize="sm">
                                                                {jrJobId}
                                                            </Text>
                                                        </Td>
                                                        <Td>
                                                            <Text>Persisted Job</Text>
                                                        </Td>
                                                        <Td>
                                                            <Badge colorScheme="gray">COMPLETED</Badge>
                                                        </Td>
                                                        <Td>N/A</Td>
                                                        <Td>N/A</Td>
                                                        <Td>N/A</Td>
                                                        <Td>
                                                            <HStack spacing={2}>
                                                                <Tooltip label="View Details">
                                                                    <IconButton
                                                                        aria-label="View job details"
                                                                        icon={<ViewIcon />}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleViewJobDetails({
                                                                            job_id: null,
                                                                            jr_job_id: jrJobId,
                                                                            name: 'Persisted Job',
                                                                            job_state: 'COMPLETED',
                                                                            partition: 'N/A',
                                                                            user_name: 'N/A',
                                                                            time_limit: { number: 0, set: false, infinite: false },
                                                                            nodes: 'N/A'
                                                                        })}
                                                                    />
                                                                </Tooltip>
                                                            </HStack>
                                                        </Td>
                                                    </Tr>
                                                );
                                            }
                                            return (
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
                                                                {job.job_state?.[0] || 'Unknown'}
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
                                                                    aria-label="View job details"
                                                                    icon={<ViewIcon />}
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleViewJobDetails(job)}
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
                                            );
                                        })}
                                    </Tbody>
                                </Table>
                                {persistedJobIds.length === 0 && (
                                    <Box textAlign="center" py={8}>
                                        <Text color="gray.500">No persisted jobs found</Text>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </CardBody>
                </Card>


                {/* Job Submission Modal */}
                <Modal isOpen={isOpen} onClose={onClose} size="full">
                    <ModalOverlay />
                    <ModalContent maxW="90vw" w="90vw">
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



// Job Submission Form Component
const JobSubmissionForm: React.FC<{
    form: SlurmJobSubmitRequest;
    setForm: (form: SlurmJobSubmitRequest) => void;
    template?: string;
    templates?: string[];
    profiles: SlurmProfile[];
    selectedProfile: string;
    onProfileSelect: (profileName: string) => void;
    selectedTemplate: string;
    onTemplateSelect: (templateName: string) => void;
    onSaveProfile: () => void;
    saveProfileMutation: {
        isPending: boolean;
    };
    onSaveTemplate: () => void;
    saveTemplateMutation: {
        isPending: boolean;
    };
}> = ({ form, setForm, template, templates, profiles, selectedProfile, onProfileSelect, selectedTemplate, onTemplateSelect, onSaveProfile, saveProfileMutation, onSaveTemplate, saveTemplateMutation }) => {

    return (
        <Grid templateColumns="repeat(2, 1fr)" gap={4} width={"100%"} height={"100%"} className="column-container" >
            <VStack align="stretch" className="column-1 slurm-options" flex={1}>
                <FormControl>
                    <FormLabel>Slurm Profile</FormLabel>
                    <HStack spacing={3}>
                        <Input
                            value={selectedProfile}
                            onChange={(e) => onProfileSelect(e.target.value)}
                            placeholder="Select a profile or enter custom name"
                            list="profile-list"
                            flex={1}
                        />
                        <Button
                            variant="outline"
                            onClick={onSaveProfile}
                            isLoading={saveProfileMutation.isPending}
                            size="md"
                        >
                            Save Profile
                        </Button>
                    </HStack>
                    <datalist id="profile-list">
                        {profiles.map((profile) => (
                            <option key={profile.name} value={profile.name}>
                                {profile.name} - {profile.description}
                            </option>
                        ))}
                    </datalist>
                    <Text fontSize="sm" color="gray.600" mt={1}>
                        Select an existing profile or enter a new name to create a new profile
                    </Text>
                </FormControl>

                <FormControl>
                    <FormLabel>Job Name</FormLabel>
                    <Input
                        value={form.job_name}
                        onChange={(e) => setForm({ ...form, job_name: e.target.value })}
                        placeholder="milabench_job"
                    />
                </FormControl>

                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                    <FormControl>
                        <FormLabel>Partition</FormLabel>
                        <Input
                            value={form.partition}
                            onChange={(e) => setForm({ ...form, partition: e.target.value })}
                            placeholder="Leave empty for default"
                        />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Nodes</FormLabel>
                        <NumberInput
                            value={form.nodes}
                            onChange={(_, value) => setForm({ ...form, nodes: value })}
                            min={1}
                            max={100}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper />
                                <NumberDecrementStepper />
                            </NumberInputStepper>
                        </NumberInput>
                    </FormControl>

                    <FormControl>
                        <FormLabel>Tasks</FormLabel>
                        <NumberInput
                            value={form.ntasks}
                            onChange={(_, value) => setForm({ ...form, ntasks: value })}
                            min={1}
                            max={100}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper />
                                <NumberDecrementStepper />
                            </NumberInputStepper>
                        </NumberInput>
                    </FormControl>

                    <FormControl>
                        <FormLabel>CPUs per Task</FormLabel>
                        <NumberInput
                            value={form.cpus_per_task}
                            onChange={(_, value) => setForm({ ...form, cpus_per_task: value })}
                            min={1}
                            max={64}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper />
                                <NumberDecrementStepper />
                            </NumberInputStepper>
                        </NumberInput>
                    </FormControl>

                    <FormControl>
                        <FormLabel>GPUs per Task</FormLabel>
                        <Input
                            value={form.gpus_per_task}
                            onChange={(e) => setForm({ ...form, gpus_per_task: e.target.value })}
                            placeholder="1"
                        />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Tasks per Node</FormLabel>
                        <NumberInput
                            value={form.ntasks_per_node}
                            onChange={(_, value) => setForm({ ...form, ntasks_per_node: value })}
                            min={1}
                            max={100}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper />
                                <NumberDecrementStepper />
                            </NumberInputStepper>
                        </NumberInput>
                    </FormControl>

                    <FormControl>
                        <FormLabel>Memory</FormLabel>
                        <Input
                            value={form.mem}
                            onChange={(e) => setForm({ ...form, mem: e.target.value })}
                            placeholder="8G"
                        />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Time Limit</FormLabel>
                        <Input
                            value={form.time_limit}
                            onChange={(e) => setForm({ ...form, time_limit: e.target.value })}
                            placeholder="02:00:00"
                        />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Export</FormLabel>
                        <Input
                            value={form.export}
                            onChange={(e) => setForm({ ...form, export: e.target.value })}
                            placeholder="ALL"
                        />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Node List</FormLabel>
                        <Input
                            value={form.nodelist}
                            onChange={(e) => setForm({ ...form, nodelist: e.target.value })}
                            placeholder="e.g., cn-d[003-004]"
                        />
                    </FormControl>
                </Grid>

                <FormControl>
                    <FormLabel>Exclusive</FormLabel>
                    <Checkbox
                        isChecked={form.exclusive}
                        onChange={(e) => setForm({ ...form, exclusive: e.target.checked })}
                    >
                        Request exclusive access to nodes
                    </Checkbox>
                </FormControl>
                <Spacer />
            </VStack>
            <VStack align="stretch" className="column-2 slurm-script" flex={1}>
                <FormControl>
                    <FormLabel>Script Template</FormLabel>
                    <HStack spacing={3}>
                        <Input
                            value={selectedTemplate}
                            onChange={(e) => onTemplateSelect(e.target.value)}
                            placeholder="Select a template or enter custom name"
                            list="template-list"
                            flex={1}
                        />
                        <Button
                            variant="outline"
                            onClick={onSaveTemplate}
                            isLoading={saveTemplateMutation.isPending}
                            size="md"
                        >
                            Save Template
                        </Button>
                    </HStack>
                    <datalist id="template-list">
                        {templates?.map((templateName) => (
                            <option key={templateName} value={templateName}>
                                {templateName}
                            </option>
                        ))}
                    </datalist>
                    {selectedTemplate && (
                        <Text fontSize="sm" color="gray.600" mt={1}>
                            Template loaded: {selectedTemplate}
                        </Text>
                    )}
                </FormControl>

                <FormControl>
                    <FormLabel>Script</FormLabel>
                    <MonacoEditor
                        value={form.script}
                        onChange={(value) => setForm({ ...form, script: value })}
                    />
                </FormControl>
            </VStack>
        </Grid>
    );
};

