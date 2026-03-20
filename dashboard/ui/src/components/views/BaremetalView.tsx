import React, { useMemo, useState } from 'react';
import { useColorModeValue } from '../ui/color-mode';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Table,
    Badge,
    Dialog,
    Input,
    Textarea,
    Card,
    Field,
    Flex,
    Grid,
    NativeSelect
} from '@chakra-ui/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toaster } from '../ui/toaster';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    getMetalHosts,
    registerMetalHost,
    getMetalJobs,
    submitMetalJob
} from '../../services/api';
import type { MetalJob, SlurmJob } from '../../services/types';

const statusColor = (status?: string) => {
    switch ((status || '').toLowerCase()) {
        case 'running':
            return 'blue';
        case 'completed':
            return 'green';
        case 'failed':
            return 'red';
        case 'cancelled':
            return 'gray';
        case 'pending':
            return 'yellow';
        default:
            return 'gray';
    }
};

const formatJobStatus = (job: SlurmJob) => {
    if (job.status) {
        return job.status;
    }
    if (job.state) {
        return job.state;
    }
    if (job.job_state && job.job_state.length > 0) {
        return job.job_state[0];
    }
    return 'unknown';
};

const formatJobName = (job: SlurmJob) => {
    return job.jr_job_id || job.job_name || job.name || job.job_id || 'unknown';
};

const formatTime = (value?: string | number) => {
    if (!value) {
        return '—';
    }
    if (typeof value === 'number') {
        return new Date(value * 1000).toLocaleString();
    }
    return value;
};

export const BaremetalView: React.FC = () => {
    usePageTitle('Baremetal');

    const queryClient = useQueryClient();
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const headerBg = useColorModeValue('gray.100', 'gray.700');
    const headerText = useColorModeValue('gray.700', 'gray.200');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.700');
    const textColor = useColorModeValue('gray.800', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.300');
    const modalBg = useColorModeValue('gray.50', 'gray.900');
    const shadow = useColorModeValue('sm', 'md');
    const primaryButtonBg = useColorModeValue('blue.600', 'blue.400');
    const primaryButtonHover = useColorModeValue('blue.700', 'blue.300');
    const secondaryButtonBg = useColorModeValue('green.600', 'green.400');
    const secondaryButtonHover = useColorModeValue('green.700', 'green.300');

    const [addOpen, setAddOpen] = useState(false);
    const [submitOpen, setSubmitOpen] = useState(false);
    const [newHost, setNewHost] = useState({ address: '', port: '', name: '' });
    const [selectedHost, setSelectedHost] = useState<string>('');
    const [jobScript, setJobScript] = useState('#!/bin/bash\n');
    const [jobName, setJobName] = useState('');
    const [dependencyEvent, setDependencyEvent] = useState('');
    const [dependencyJobId, setDependencyJobId] = useState('');
    const [jobErrors, setJobErrors] = useState<Record<string, string>>({});

    const hostsQuery = useQuery({
        queryKey: ['metal-hosts'],
        queryFn: getMetalHosts,
        refetchInterval: 15000
    });

    const hosts = hostsQuery.data || [];
    const jobsQuery = useQuery({
        queryKey: ['metal-jobs', hosts.map((host) => host.name).join(',')],
        enabled: hosts.length > 0,
        queryFn: async (): Promise<MetalJob[]> => {
            const errors: Record<string, string> = {};
            const results = await Promise.all(
                hosts.map(async (host) => {
                    try {
                        const jobs = await getMetalJobs(host.name);
                        return jobs.map((job) => ({ ...job, host: host.name }));
                    } catch (error: any) {
                        errors[host.name] = error?.message || 'Failed to fetch jobs';
                        return [];
                    }
                })
            );
            setJobErrors(errors);
            return results.flat();
        },
        refetchInterval: 10000
    });

    const registerMutation = useMutation({
        mutationFn: registerMetalHost,
        onSuccess: (data) => {
            if (data.status === 'ok') {
                toaster.create({
                    title: 'Host registered',
                    type: 'success'
                });
                setAddOpen(false);
                setNewHost({ address: '', port: '', name: '' });
                queryClient.invalidateQueries({ queryKey: ['metal-hosts'] });
            } else {
                toaster.create({
                    title: 'Registration failed',
                    description: data.error || 'Unknown error',
                    type: 'error'
                });
            }
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Registration failed',
                description: error?.message || 'Unknown error',
                type: 'error'
            });
        }
    });

    const submitMutation = useMutation({
        mutationFn: async () => {
            if (!selectedHost) {
                throw new Error('Select a host');
            }
            return submitMetalJob(selectedHost, {
                script: jobScript,
                job_name: jobName || undefined
            });
        },
        onSuccess: (data) => {
            if (data.status === 'ok') {
                toaster.create({
                    title: 'Job submitted',
                    description: data.job_id ? `Job ID: ${data.job_id}` : undefined,
                    type: 'success'
                });
                setSubmitOpen(false);
                setJobName('');
                setJobScript('#!/bin/bash\n');
                setDependencyEvent('');
                setDependencyJobId('');
                queryClient.invalidateQueries({ queryKey: ['metal-jobs'] });
            } else {
                toaster.create({
                    title: 'Job submission failed',
                    description: data.error || 'Unknown error',
                    type: 'error'
                });
            }
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Job submission failed',
                description: error?.message || 'Unknown error',
                type: 'error'
            });
        }
    });

    const handleRegister = () => {
        const port = parseInt(newHost.port, 10);
        if (!newHost.address || Number.isNaN(port)) {
            toaster.create({
                title: 'Missing host details',
                description: 'Provide a valid address and port.',
                type: 'error'
            });
            return;
        }
        registerMutation.mutate({
            address: newHost.address,
            port,
            name: newHost.name || undefined
        });
    };

    const jobs = jobsQuery.data || [];
    const dependencyJobs = useMemo(() => {
        return jobs.filter((job) => {
            const status = formatJobStatus(job).toLowerCase();
            return status === 'running' || status === 'pending';
        });
    }, [jobs]);
    const sortedJobs = useMemo(() => {
        return [...jobs].sort((a, b) => {
            const aTime = a.created_at ? Date.parse(a.created_at) : 0;
            const bTime = b.created_at ? Date.parse(b.created_at) : 0;
            return bTime - aTime;
        });
    }, [jobs]);

    return (
        <Box p={6} color={textColor}>
            <Flex mb={6} align="center" justify="space-between">
                <Heading size="lg">Baremetal Nodes</Heading>
                <HStack gap={3}>
                    <Button
                        onClick={() => setAddOpen(true)}
                        bg={primaryButtonBg}
                        color="white"
                        _hover={{ bg: primaryButtonHover }}
                        boxShadow="sm"
                    >
                        Register Node
                    </Button>
                    <Button
                        onClick={() => setSubmitOpen(true)}
                        bg={secondaryButtonBg}
                        color="white"
                        _hover={{ bg: secondaryButtonHover }}
                        boxShadow="sm"
                    >
                        Submit Job
                    </Button>
                </HStack>
            </Flex>

            <Card.Root bg={cardBg} borderColor={borderColor} borderWidth="1px" mb={8}>
                <Card.Header>
                    <Heading size="md">Registered Nodes</Heading>
                    <Text color="gray.500" fontSize="sm">
                        {hosts.length} node{hosts.length === 1 ? '' : 's'} registered
                    </Text>
                </Card.Header>
                <Card.Body>
                    {hostsQuery.isLoading ? (
                        <Text>Loading nodes...</Text>
                    ) : hosts.length === 0 ? (
                        <Text color="gray.500">No nodes registered yet.</Text>
                    ) : (
                        <Table.Root>
                            <Table.Header bg={headerBg}>
                                <Table.Row>
                                    <Table.ColumnHeader color={headerText}>Name</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>URL</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>SSH</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>Remote Folder</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {hosts.map((host) => (
                                    <Table.Row key={host.name} _hover={{ bg: rowHoverBg }} borderColor={borderColor}>
                                        <Table.Cell>{host.name}</Table.Cell>
                                        <Table.Cell>{host.url || '—'}</Table.Cell>
                                        <Table.Cell>{host.ssh || '—'}</Table.Cell>
                                        <Table.Cell>{host.remote_folder || '—'}</Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    )}
                </Card.Body>
            </Card.Root>

            <Card.Root bg={cardBg} borderColor={borderColor} borderWidth="1px">
                <Card.Header>
                    <Heading size="md">Jobs Across Nodes</Heading>
                    <Text color="gray.500" fontSize="sm">
                        Aggregated job list from all registered nodes
                    </Text>
                </Card.Header>
                <Card.Body>
                    {hosts.length === 0 ? (
                        <Text color="gray.500">Register a node to start listing jobs.</Text>
                    ) : jobsQuery.isLoading ? (
                        <Text>Loading jobs...</Text>
                    ) : sortedJobs.length === 0 ? (
                        <Text color="gray.500">No jobs reported yet.</Text>
                    ) : (
                        <Table.Root>
                            <Table.Header bg={headerBg}>
                                <Table.Row>
                                    <Table.ColumnHeader color={headerText}>Host</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>Job</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>Status</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerText}>Created</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {sortedJobs.map((job, idx) => (
                                    <Table.Row key={`${job.host}-${job.job_id || idx}`} _hover={{ bg: rowHoverBg }} borderColor={borderColor}>
                                        <Table.Cell>{job.host}</Table.Cell>
                                        <Table.Cell>{formatJobName(job)}</Table.Cell>
                                        <Table.Cell>
                                            <Badge colorScheme={statusColor(formatJobStatus(job))}>
                                                {formatJobStatus(job)}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>{formatTime(job.created_at)}</Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    )}
                    {Object.keys(jobErrors).length > 0 && (
                        <VStack align="start" mt={4} gap={2}>
                            {Object.entries(jobErrors).map(([host, message]) => (
                                <Text key={host} color="red.500" fontSize="sm">
                                    {host}: {message}
                                </Text>
                            ))}
                        </VStack>
                    )}
                </Card.Body>
            </Card.Root>

            <Dialog.Root open={addOpen} onOpenChange={(details) => { if (!details.open) setAddOpen(false); }}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="lg">
                        <Dialog.Header>
                            <Dialog.Title>Add Baremetal Node</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack gap={4} align="stretch">
                                <Field.Root>
                                    <Field.Label>Address</Field.Label>
                                    <Input
                                        placeholder="10.0.0.5"
                                        value={newHost.address}
                                        onChange={(event) => setNewHost({ ...newHost, address: event.target.value })}
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Port</Field.Label>
                                    <Input
                                        placeholder="27484"
                                        value={newHost.port}
                                        onChange={(event) => setNewHost({ ...newHost, port: event.target.value })}
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Display Name (optional)</Field.Label>
                                    <Input
                                        placeholder="gpu-node-01"
                                        value={newHost.name}
                                        onChange={(event) => setNewHost({ ...newHost, name: event.target.value })}
                                    />
                                </Field.Root>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <HStack gap={3}>
                                <Button variant="ghost" onClick={() => setAddOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorScheme="blue"
                                    onClick={handleRegister}
                                    loading={registerMutation.isPending}
                                >
                                    Register
                                </Button>
                            </HStack>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            <Dialog.Root open={submitOpen} onOpenChange={(details) => { if (!details.open) setSubmitOpen(false); }}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="80vw" w="80vw" style={{ margin: "5px" }}>
                        <Dialog.Header>
                            <Dialog.Title>Submit Job</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <Box width="100%" height="100%" p={6} bg={modalBg}>
                                <VStack align="stretch" gap={6} height="100%">
                                    <Grid templateColumns="repeat(2, 1fr)" gap={6} width="100%" flex="1" overflow="hidden">
                                        <VStack align="stretch" gap={4} overflowY="auto" pr={2}>
                                            <Card.Root
                                                bg={cardBg}
                                                borderWidth="1px"
                                                borderColor={borderColor}
                                                borderRadius="lg"
                                                boxShadow={shadow}
                                                p={4}
                                            >
                                                <VStack align="stretch" gap={4}>
                                                    <Heading size="sm" fontWeight="semibold" color={textColor}>
                                                        Job Options
                                                    </Heading>
                                                    <Field.Root>
                                                        <HStack gap={3} align="center">
                                                            <Field.Label minW="120px" mb={0} color={textColor}>Target Node</Field.Label>
                                                            <NativeSelect.Root flex={1}>
                                                                <NativeSelect.Field
                                                                    value={selectedHost}
                                                                    onChange={(event) => setSelectedHost(event.target.value)}
                                                                >
                                                                    <option value="">Select a node</option>
                                                                    {hosts.map((host) => (
                                                                        <option key={host.name} value={host.name}>
                                                                            {host.name}
                                                                        </option>
                                                                    ))}
                                                                </NativeSelect.Field>
                                                            </NativeSelect.Root>
                                                        </HStack>
                                                    </Field.Root>
                                                    <Field.Root>
                                                        <HStack gap={3} align="center">
                                                            <Field.Label minW="120px" mb={0} color={textColor}>Job Name</Field.Label>
                                                            <Input
                                                                placeholder="my-job"
                                                                value={jobName}
                                                                onChange={(event) => setJobName(event.target.value)}
                                                                flex={1}
                                                            />
                                                        </HStack>
                                                    </Field.Root>
                                                    <Field.Root>
                                                        <HStack gap={3} align="center">
                                                            <Field.Label minW="120px" fontWeight="semibold" mb={0} color={textColor}>Dependency</Field.Label>
                                                            <NativeSelect.Root flex={1}>
                                                                <NativeSelect.Field
                                                                    value={dependencyEvent}
                                                                    onChange={(event) => setDependencyEvent(event.target.value)}
                                                                    placeholder="Select event"
                                                                >
                                                                    <option value="">None</option>
                                                                    <option value="after">After</option>
                                                                    <option value="afterok">After Ok</option>
                                                                    <option value="afterany">After Any</option>
                                                                    <option value="afterburstbuffer">After Burst Buffer</option>
                                                                    <option value="aftercorr">After Corr</option>
                                                                    <option value="afternotok">After Not Ok</option>
                                                                    <option value="singleton">Singleton</option>
                                                                </NativeSelect.Field>
                                                            </NativeSelect.Root>
                                                            <NativeSelect.Root flex={1}>
                                                                <NativeSelect.Field
                                                                    value={dependencyJobId}
                                                                    onChange={(event) => setDependencyJobId(event.target.value)}
                                                                    placeholder="Select job"
                                                                >
                                                                    <option value="">Select job</option>
                                                                    {dependencyJobs.map((job) => (
                                                                        <option key={job.job_id || job.jr_job_id || job.name} value={job.job_id || ''}>
                                                                            {job.job_id || job.jr_job_id || 'unknown'} - {formatJobName(job)} ({formatJobStatus(job)})
                                                                        </option>
                                                                    ))}
                                                                </NativeSelect.Field>
                                                            </NativeSelect.Root>
                                                        </HStack>
                                                        <Text fontSize="sm" color={mutedTextColor} mt={1}>
                                                            Dependency settings are optional for baremetal jobs.
                                                        </Text>
                                                    </Field.Root>
                                                </VStack>
                                            </Card.Root>
                                        </VStack>
                                        <VStack align="stretch" gap={4} minH={0}>
                                            <Card.Root
                                                bg={cardBg}
                                                borderWidth="1px"
                                                borderColor={borderColor}
                                                borderRadius="lg"
                                                boxShadow={shadow}
                                                flex="1"
                                                overflow="hidden"
                                                display="flex"
                                                flexDirection="column"
                                                p={4}
                                            >
                                                <Heading size="sm" fontWeight="semibold" color={textColor} mb={3}>
                                                    Script
                                                </Heading>
                                                <Textarea
                                                    minH="320px"
                                                    value={jobScript}
                                                    onChange={(event) => setJobScript(event.target.value)}
                                                />
                                            </Card.Root>
                                        </VStack>
                                    </Grid>
                                    <HStack
                                        gap={3}
                                        justify="flex-end"
                                        pt={4}
                                        borderTopWidth="1px"
                                        borderTopColor={borderColor}
                                    >
                                        <Button
                                            variant="ghost"
                                            onClick={() => setSubmitOpen(false)}
                                            fontWeight="medium"
                                            color={textColor}
                                            _hover={{ bg: useColorModeValue('gray.100', 'gray.700') }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            colorScheme="blue"
                                            onClick={() => submitMutation.mutate()}
                                            loading={submitMutation.isPending}
                                            fontWeight="medium"
                                            size="md"
                                            bg={useColorModeValue('blue.500', 'blue.600')}
                                            color="white"
                                            _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
                                        >
                                            Submit Job
                                        </Button>
                                    </HStack>
                                </VStack>
                            </Box>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};

