import React, { useState, useEffect } from 'react';
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
import {
    getSlurmJobs,
    submitSlurmJob,
    cancelSlurmJob,
    getSlurmJobLogs,
    getSlurmJobData,
    getSlurmClusterInfo,
    getSlurmTemplate,
    getSlurmProfiles,
    generateSlurmScript,
    saveSlurmProfile,
    submitSlurmJobWithArgs
} from '../../services/api';
import type { SlurmJob, SlurmJobSubmitRequest, SlurmJobLogs, SlurmJobData, SlurmProfile } from '../../services/types';

// Simple textarea component without syntax highlighting
const SyntaxHighlightedTextarea: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
}> = ({ value, onChange, placeholder, rows = 25 }) => {
    const borderColor = useColorModeValue('gray.200', 'gray.600');

    return (
        <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            fontFamily="mono"
            fontSize="sm"
            borderColor={borderColor}
            _focus={{
                borderColor: "blue.500",
                boxShadow: "0 0 0 1px var(--chakra-colors-blue-500)"
            }}
        />
    );
};

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

export const SlurmJobsView: React.FC = () => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [selectedJob, setSelectedJob] = useState<SlurmJob | null>(null);
    const [filterStatus, setFilterStatus] = useState<string[]>([]);
    const [filterUser, setFilterUser] = useState<string>('');
    const [filterPartition, setFilterPartition] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState<string>('');

    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Queries
    const { data: jobsData, isLoading: jobsLoading, error: jobsError } = useQuery({
        queryKey: ['slurm-jobs'],
        queryFn: getSlurmJobs,
        refetchOnWindowFocus: false,
        staleTime: 30000, // Consider data fresh for 30 seconds
    });

    const { data: template } = useQuery({
        queryKey: ['slurm-template'],
        queryFn: getSlurmTemplate,
        refetchOnWindowFocus: false,
        staleTime: 300000, // Consider data fresh for 5 minutes
    });

    const { data: profiles } = useQuery({
        queryKey: ['slurm-profiles'],
        queryFn: getSlurmProfiles,
        refetchOnWindowFocus: false,
        staleTime: 300000, // Consider data fresh for 5 minutes
    });

    // Mutations
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
        script: template?.template || '',
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
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [newProfileDescription, setNewProfileDescription] = useState<string>('');

    const generateScriptMutation = useMutation({
        mutationFn: generateSlurmScript,
        onSuccess: (data) => {
            setSubmitForm(prev => ({
                ...prev,
                script: data.script,
                job_name: data.profile.replace(/-/g, '_') + '_job',
                // Load profile arguments into form
                partition: data.parsed_args.partition || prev.partition,
                nodes: data.parsed_args.nodes || prev.nodes,
                ntasks: data.parsed_args.ntasks || prev.ntasks,
                cpus_per_task: data.parsed_args.cpus_per_task || prev.cpus_per_task,
                mem: data.parsed_args.mem || prev.mem,
                time_limit: data.parsed_args.time_limit || prev.time_limit,
                gpus_per_task: data.parsed_args.gpus_per_task || prev.gpus_per_task,
                ntasks_per_node: data.parsed_args.ntasks_per_node || prev.ntasks_per_node,
                exclusive: data.parsed_args.exclusive !== undefined ? data.parsed_args.exclusive : prev.exclusive,
                export: data.parsed_args.export || prev.export,
                nodelist: data.parsed_args.nodelist || prev.nodelist,
            }));
        },
        onError: (error: any) => {
            toast({
                title: 'Script Generation Failed',
                description: error.message || 'Failed to generate script from profile',
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

    const submitJobWithArgsMutation = useMutation({
        mutationFn: submitSlurmJobWithArgs,
        onSuccess: (data) => {
            toast({
                title: 'Job Submitted',
                description: `Job ${data.job_id} submitted successfully`,
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
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
        // Get the selected profile's sbatch arguments
        const selectedProfileData = profiles?.find(p => p.name === selectedProfile);
        const sbatch_args = selectedProfileData?.sbatch_args || [];

        // Use the new submit-with-args endpoint
        submitJobWithArgsMutation.mutate({
            script: submitForm.script,
            job_name: submitForm.job_name,
            sbatch_args: sbatch_args
        });
    };

    const handleProfileSelect = (profileName: string) => {
        setSelectedProfile(profileName);
        generateScriptMutation.mutate({
            profile: profileName,
            script: submitForm.script
        });
    };

    const handleSaveProfile = () => {
        if (!newProfileName.trim()) {
            toast({
                title: 'Profile Name Required',
                description: 'Please enter a profile name to save the current configuration.',
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
            name: newProfileName.trim(),
            description: newProfileDescription.trim(),
            sbatch_args: sbatch_args
        });
    };

    const handleCancelJob = (jobId: string) => {
        if (window.confirm(`Are you sure you want to cancel job ${jobId}?`)) {
            cancelJobMutation.mutate(jobId);
        }
    };

    const handleViewJobDetails = (job: SlurmJob) => {
        setSelectedJob(job);
        onOpen();
    };

    // Filter and search logic
    const allJobs = [
        ...(jobsData?.active_jobs || []),
        ...(jobsData?.completed_jobs || [])
    ];

    const filteredJobs = allJobs.filter(job => {
        const status = job.status || job.state || job.job_state || '';
        const name = job.name || job.job_name || '';
        const user = job.user || job.user_name || '';
        const partition = job.partition || '';

        // Status filter
        if (filterStatus.length > 0 && !filterStatus.includes(status.toLowerCase())) {
            return false;
        }

        // User filter
        if (filterUser && !user.toLowerCase().includes(filterUser.toLowerCase())) {
            return false;
        }

        // Partition filter
        if (filterPartition && !partition.toLowerCase().includes(filterPartition.toLowerCase())) {
            return false;
        }

        // Search term
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            return (
                job.job_id.toLowerCase().includes(searchLower) ||
                name.toLowerCase().includes(searchLower) ||
                user.toLowerCase().includes(searchLower) ||
                partition.toLowerCase().includes(searchLower)
            );
        }

        return true;
    });

    const runningJobs = filteredJobs.filter(job =>
    (job.status?.toLowerCase() === 'running' ||
        job.state?.toLowerCase() === 'running' ||
        job.job_state?.toLowerCase() === 'running')
    );
    const pendingJobs = filteredJobs.filter(job =>
    (job.status?.toLowerCase() === 'pending' ||
        job.state?.toLowerCase() === 'pending' ||
        job.job_state?.toLowerCase() === 'pending')
    );
    const completedJobs = filteredJobs.filter(job =>
    (job.status?.toLowerCase() === 'completed' ||
        job.state?.toLowerCase() === 'completed' ||
        job.job_state?.toLowerCase() === 'completed')
    );

    // Get unique values for filters
    const uniqueUsers = [...new Set(allJobs.map(job => job.user || job.user_name).filter(Boolean))];
    const uniquePartitions = [...new Set(allJobs.map(job => job.partition).filter(Boolean))];
    const uniqueStatuses = [...new Set(allJobs.map(job => job.status || job.state || job.job_state).filter(Boolean))];

    return (
        <Box p={6}>
            <VStack align="stretch" spacing={6}>
                <Box>
                    <Heading size="lg" mb={2}>Slurm Job Management</Heading>
                    <Text color="gray.600">
                        Monitor, submit, and manage your Slurm jobs
                    </Text>
                </Box>

                {/* Statistics */}
                <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={6}>
                    <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                        <CardBody>
                            <Stat>
                                <StatLabel>Total Jobs</StatLabel>
                                <StatNumber>{filteredJobs.length}</StatNumber>
                                <StatHelpText>Filtered results</StatHelpText>
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
                                <StatLabel>Completed Jobs</StatLabel>
                                <StatNumber color="blue.500">{completedJobs.length}</StatNumber>
                                <StatHelpText>Finished jobs</StatHelpText>
                            </Stat>
                        </CardBody>
                    </Card>
                </Grid>

                {/* Filters and Actions */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardHeader>
                        <Flex align="center">
                            <Heading size="md">Filters & Actions</Heading>
                            <Spacer />
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
                                    onClick={() => queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] })}
                                    isLoading={jobsLoading}
                                >
                                    Refresh
                                </Button>
                            </HStack>
                        </Flex>
                    </CardHeader>
                    <CardBody>
                        <VStack align="stretch" spacing={4}>
                            {/* Search */}
                            <HStack>
                                <Box flex={1}>
                                    <Input
                                        placeholder="Search jobs by ID, name, user, or partition..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        leftIcon={<SearchIcon />}
                                    />
                                </Box>
                            </HStack>

                            {/* Filters */}
                            <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={4}>
                                <Box>
                                    <Text fontWeight="bold" mb={2}>Status</Text>
                                    <CheckboxGroup value={filterStatus} onChange={setFilterStatus}>
                                        <Stack spacing={2}>
                                            {uniqueStatuses.map(status => (
                                                <Checkbox key={status} value={status.toLowerCase()}>
                                                    {status}
                                                </Checkbox>
                                            ))}
                                        </Stack>
                                    </CheckboxGroup>
                                </Box>

                                <Box>
                                    <Text fontWeight="bold" mb={2}>User</Text>
                                    <Select
                                        placeholder="All users"
                                        value={filterUser}
                                        onChange={(e) => setFilterUser(e.target.value)}
                                    >
                                        {uniqueUsers.map(user => (
                                            <option key={user} value={user}>{user}</option>
                                        ))}
                                    </Select>
                                </Box>

                                <Box>
                                    <Text fontWeight="bold" mb={2}>Partition</Text>
                                    <Select
                                        placeholder="All partitions"
                                        value={filterPartition}
                                        onChange={(e) => setFilterPartition(e.target.value)}
                                    >
                                        {uniquePartitions.map(partition => (
                                            <option key={partition} value={partition}>{partition}</option>
                                        ))}
                                    </Select>
                                </Box>
                            </Grid>
                        </VStack>
                    </CardBody>
                </Card>

                {/* Jobs Table */}
                <Card bg={bgColor} border="1px solid" borderColor={borderColor}>
                    <CardHeader>
                        <Heading size="md">Job Queue</Heading>
                    </CardHeader>
                    <CardBody>
                        {jobsError ? (
                            <Alert status="error">
                                <AlertIcon />
                                <AlertTitle>Error loading jobs!</AlertTitle>
                                <AlertDescription>
                                    {(jobsError as any)?.message || 'Failed to load jobs'}
                                </AlertDescription>
                            </Alert>
                        ) : jobsLoading ? (
                            <Box textAlign="center" py={8}>
                                <Spinner size="lg" />
                                <Text mt={4}>Loading jobs...</Text>
                            </Box>
                        ) : (
                            <Box overflowX="auto">
                                <Table variant="simple">
                                    <Thead>
                                        <Tr>
                                            <Th>Job ID</Th>
                                            <Th>Name</Th>
                                            <Th>Status</Th>
                                            <Th>Partition</Th>
                                            <Th>User</Th>
                                            <Th>Time</Th>
                                            <Th>Actions</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {filteredJobs.map((job) => (
                                            <Tr key={job.job_id}>
                                                <Td>
                                                    <Text fontWeight="bold">{job.job_id}</Text>
                                                </Td>
                                                <Td>
                                                    <Text>{job.name || job.job_name || 'N/A'}</Text>
                                                </Td>
                                                <Td>
                                                    <HStack>
                                                        {getStatusIcon(job.status || job.state || job.job_state || '')}
                                                        <Badge colorScheme={getStatusColor(job.status || job.state || job.job_state || '')}>
                                                            {job.status || job.state || job.job_state || 'Unknown'}
                                                        </Badge>
                                                    </HStack>
                                                </Td>
                                                <Td>{job.partition || 'N/A'}</Td>
                                                <Td>{job.user || job.user_name || 'N/A'}</Td>
                                                <Td>{job.time || job.time_limit || job.elapsed || 'N/A'}</Td>
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
                                                        {(job.status?.toLowerCase() === 'running' ||
                                                            job.status?.toLowerCase() === 'pending' ||
                                                            job.state?.toLowerCase() === 'running' ||
                                                            job.state?.toLowerCase() === 'pending' ||
                                                            job.job_state?.toLowerCase() === 'running' ||
                                                            job.job_state?.toLowerCase() === 'pending') && (
                                                                <Tooltip label="Cancel Job">
                                                                    <IconButton
                                                                        aria-label="Cancel job"
                                                                        icon={<DeleteIcon />}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        colorScheme="red"
                                                                        onClick={() => handleCancelJob(job.job_id)}
                                                                    />
                                                                </Tooltip>
                                                            )}
                                                    </HStack>
                                                </Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                                {filteredJobs.length === 0 && (
                                    <Box textAlign="center" py={8}>
                                        <Text color="gray.500">No jobs found matching your filters</Text>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </CardBody>
                </Card>

                {/* Job Details Modal */}
                <Modal isOpen={isOpen && !!selectedJob} onClose={onClose} size="6xl">
                    <ModalOverlay />
                    <ModalContent>
                        <ModalHeader>
                            Job Details: {selectedJob?.job_id}
                        </ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            {selectedJob && (
                                <JobDetailsTabs job={selectedJob} />
                            )}
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="ghost" mr={3} onClick={onClose}>
                                Close
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>

                {/* Job Submission Modal */}
                <Modal isOpen={isOpen && !selectedJob} onClose={onClose} size="full">
                    <ModalOverlay />
                    <ModalContent maxW="90vw" w="90vw">
                        <ModalHeader>Submit New Job</ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            <JobSubmissionForm
                                form={submitForm}
                                setForm={setSubmitForm}
                                template={template?.template}
                                profiles={profiles || []}
                                selectedProfile={selectedProfile}
                                onProfileSelect={handleProfileSelect}
                                newProfileName={newProfileName}
                                setNewProfileName={setNewProfileName}
                                newProfileDescription={newProfileDescription}
                                setNewProfileDescription={setNewProfileDescription}
                            />
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="ghost" mr={3} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                variant="outline"
                                mr={3}
                                onClick={handleSaveProfile}
                                isLoading={saveProfileMutation.isPending}
                            >
                                Save as Profile
                            </Button>
                            <Button
                                colorScheme="blue"
                                onClick={handleSubmitJob}
                                isLoading={submitJobWithArgsMutation.isPending}
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

// Job Details Tabs Component (reused from Dashboard)
const JobDetailsTabs: React.FC<{ job: SlurmJob }> = ({ job }) => {
    const [activeTab, setActiveTab] = useState(0);

    const { data: logs, isLoading: logsLoading } = useQuery({
        queryKey: ['slurm-job-logs', job.job_id],
        queryFn: () => getSlurmJobLogs(job.job_id),
        enabled: !!job.job_id,
    });

    const { data: jobData, isLoading: dataLoading } = useQuery({
        queryKey: ['slurm-job-data', job.job_id],
        queryFn: () => getSlurmJobData(job.job_id),
        enabled: !!job.job_id,
    });

    return (
        <Tabs index={activeTab} onChange={setActiveTab}>
            <TabList>
                <Tab>Job Info</Tab>
                <Tab>Logs</Tab>
                <Tab>Data</Tab>
            </TabList>

            <TabPanels>
                <TabPanel>
                    <VStack align="stretch" spacing={4}>
                        <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                            <Box>
                                <Text fontWeight="bold">Job ID</Text>
                                <Text>{job.job_id}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Name</Text>
                                <Text>{job.name || job.job_name || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Status</Text>
                                <Badge colorScheme={getStatusColor(job.status || job.state || job.job_state || '')}>
                                    {job.status || job.state || job.job_state || 'Unknown'}
                                </Badge>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Partition</Text>
                                <Text>{job.partition || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">User</Text>
                                <Text>{job.user || 'N/A'}</Text>
                            </Box>
                            <Box>
                                <Text fontWeight="bold">Time</Text>
                                <Text>{job.time || job.elapsed || 'N/A'}</Text>
                            </Box>
                            {job.nodes && (
                                <Box>
                                    <Text fontWeight="bold">Nodes</Text>
                                    <Text>{job.nodes}</Text>
                                </Box>
                            )}
                            {job.nodelist && (
                                <Box>
                                    <Text fontWeight="bold">Node List</Text>
                                    <Text>{job.nodelist}</Text>
                                </Box>
                            )}
                        </Grid>
                    </VStack>
                </TabPanel>

                <TabPanel>
                    {logsLoading ? (
                        <Box textAlign="center" py={8}>
                            <Spinner size="lg" />
                            <Text mt={4}>Loading logs...</Text>
                        </Box>
                    ) : logs ? (
                        <VStack align="stretch" spacing={4}>
                            <Accordion allowMultiple>
                                <AccordionItem>
                                    <AccordionButton>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Job Information</Text>
                                        </Box>
                                        <AccordionIcon />
                                    </AccordionButton>
                                    <AccordionPanel pb={4}>
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {JSON.stringify(logs.job_info, null, 2)}
                                        </Code>
                                    </AccordionPanel>
                                </AccordionItem>

                                <AccordionItem>
                                    <AccordionButton>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Standard Output</Text>
                                        </Box>
                                        <AccordionIcon />
                                    </AccordionButton>
                                    <AccordionPanel pb={4}>
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {logs.stdout || 'No output available'}
                                        </Code>
                                    </AccordionPanel>
                                </AccordionItem>

                                <AccordionItem>
                                    <AccordionButton>
                                        <Box as="span" flex='1' textAlign='left'>
                                            <Text fontWeight="bold">Standard Error</Text>
                                        </Box>
                                        <AccordionIcon />
                                    </AccordionButton>
                                    <AccordionPanel pb={4}>
                                        <Code display="block" whiteSpace="pre-wrap" p={4}>
                                            {logs.stderr || 'No error output available'}
                                        </Code>
                                    </AccordionPanel>
                                </AccordionItem>
                            </Accordion>
                        </VStack>
                    ) : (
                        <Text color="gray.500">No logs available</Text>
                    )}
                </TabPanel>

                <TabPanel>
                    {dataLoading ? (
                        <Box textAlign="center" py={8}>
                            <Spinner size="lg" />
                            <Text mt={4}>Loading job data...</Text>
                        </Box>
                    ) : jobData ? (
                        <VStack align="stretch" spacing={4}>
                            <Box>
                                <Text fontWeight="bold">Working Directory</Text>
                                <Text fontFamily="mono" bg="gray.100" p={2} borderRadius="md">
                                    {jobData.work_dir}
                                </Text>
                            </Box>

                            <Box>
                                <Text fontWeight="bold" mb={2}>Data Files</Text>
                                {jobData.data_files.length > 0 ? (
                                    <VStack align="stretch" spacing={2}>
                                        {jobData.data_files.map((file, index) => (
                                            <Box key={index} p={2} bg="gray.50" borderRadius="md">
                                                <Text fontFamily="mono">{file}</Text>
                                            </Box>
                                        ))}
                                    </VStack>
                                ) : (
                                    <Text color="gray.500">No data files found</Text>
                                )}
                            </Box>
                        </VStack>
                    ) : (
                        <Text color="gray.500">No job data available</Text>
                    )}
                </TabPanel>
            </TabPanels>
        </Tabs>
    );
};

// Job Submission Form Component (reused from Dashboard)
const JobSubmissionForm: React.FC<{
    form: SlurmJobSubmitRequest;
    setForm: (form: SlurmJobSubmitRequest) => void;
    template?: string;
    profiles?: SlurmProfile[];
    selectedProfile: string;
    onProfileSelect: (profileName: string) => void;
    newProfileName: string;
    setNewProfileName: (name: string) => void;
    newProfileDescription: string;
    setNewProfileDescription: (desc: string) => void;
}> = ({ form, setForm, template, profiles, selectedProfile, onProfileSelect, newProfileName, setNewProfileName, newProfileDescription, setNewProfileDescription }) => {
    const selectedProfileData = profiles?.find(p => p.name === selectedProfile);

    return (
        <VStack align="stretch" spacing={4}>
            {/* Profile Selection */}
            <FormControl>
                <FormLabel>Slurm Profile</FormLabel>
                <Select
                    value={selectedProfile}
                    onChange={(e) => onProfileSelect(e.target.value)}
                    placeholder="Select a profile"
                >
                    {profiles?.map((profile) => (
                        <option key={profile.name} value={profile.name}>
                            {profile.name} - {profile.description}
                        </option>
                    ))}
                </Select>
                {selectedProfileData && (
                    <Box mt={2} p={3} bg="blue.50" borderRadius="md">
                        <Text fontWeight="bold" mb={2}>Profile Details:</Text>
                        <VStack align="stretch" spacing={1}>
                            <Text fontSize="sm">
                                <strong>Description:</strong> {selectedProfileData.description}
                            </Text>
                            {selectedProfileData.parsed_args.partition && (
                                <Text fontSize="sm">
                                    <strong>Partition:</strong> {selectedProfileData.parsed_args.partition}
                                </Text>
                            )}
                            {selectedProfileData.parsed_args.nodes && (
                                <Text fontSize="sm">
                                    <strong>Nodes:</strong> {selectedProfileData.parsed_args.nodes}
                                </Text>
                            )}
                            {selectedProfileData.parsed_args.gpus_per_task && (
                                <Text fontSize="sm">
                                    <strong>GPUs per Task:</strong> {selectedProfileData.parsed_args.gpus_per_task}
                                </Text>
                            )}
                            {selectedProfileData.parsed_args.cpus_per_task && (
                                <Text fontSize="sm">
                                    <strong>CPUs per Task:</strong> {selectedProfileData.parsed_args.cpus_per_task}
                                </Text>
                            )}
                            {selectedProfileData.parsed_args.mem && (
                                <Text fontSize="sm">
                                    <strong>Memory:</strong> {selectedProfileData.parsed_args.mem}
                                </Text>
                            )}
                            {selectedProfileData.parsed_args.time_limit && (
                                <Text fontSize="sm">
                                    <strong>Time Limit:</strong> {selectedProfileData.parsed_args.time_limit}
                                </Text>
                            )}
                        </VStack>
                    </Box>
                )}
            </FormControl>

            {/* Save Profile Fields */}
            <Box p={4} bg="gray.50" borderRadius="md">
                <Text fontWeight="bold" mb={3}>Save as New Profile</Text>
                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                    <FormControl>
                        <FormLabel>Profile Name</FormLabel>
                        <Input
                            value={newProfileName}
                            onChange={(e) => setNewProfileName(e.target.value)}
                            placeholder="Enter profile name"
                        />
                    </FormControl>
                    <FormControl>
                        <FormLabel>Profile Description</FormLabel>
                        <Input
                            value={newProfileDescription}
                            onChange={(e) => setNewProfileDescription(e.target.value)}
                            placeholder="Enter profile description (optional)"
                        />
                    </FormControl>
                </Grid>
            </Box>

            {/* Form Layout - Two Columns */}
            <Grid templateColumns="1fr 1.5fr" gap={8}>
                {/* Left Column - Form Fields */}
                <VStack align="stretch" spacing={4}>
                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                        <FormControl>
                            <FormLabel>Job Name</FormLabel>
                            <Input
                                value={form.job_name}
                                onChange={(e) => setForm({ ...form, job_name: e.target.value })}
                                placeholder="milabench_job"
                            />
                        </FormControl>

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
                </VStack>

                {/* Right Column - Script */}
                <VStack align="stretch" spacing={4}>
                    <FormControl>
                        <FormLabel>Script</FormLabel>
                        <SyntaxHighlightedTextarea
                            value={form.script}
                            onChange={(value) => setForm({ ...form, script: value })}
                            placeholder="Enter your SLURM script here..."
                        />
                    </FormControl>
                </VStack>
            </Grid>
        </VStack>
    );
};