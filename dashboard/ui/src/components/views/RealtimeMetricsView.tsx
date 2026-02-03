import React, { useState, useEffect } from 'react';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Badge,
    Card,
    Flex,
    Spacer,
    Code,
    Tabs,
    Table,
    Progress,
    Stat,
    SimpleGrid,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { webSocketService, type MetricData } from '../../services/websocket';
import type { BenchLogEntry } from '../../services/types';


interface MetricEntry {
    id: string;
    timestamp: Date;
    jobId: string;
    data: any;
    rawLine: string;
}

interface BenchmarkStats {
    id: number;
    name: string;
    config: any;
    meta: any;
    start: number;
    data: number;
    stop: number;
    error: number;
    end: number;
}

interface JobMetrics {
    jobId: string;
    benchmarks: { [tag: string]: BenchmarkStats };
    lastActivity: Date;
    isActive: boolean;
}


function metricStreamProcessor(
    onUpdate: (jobId: string, accumulatedData: Record<string, any>, currentBench: any) => void,
    onMeta: (meta: any) => void,
) {
    let accumulatedData: Record<string, any> = {};
    let hasMeta = false;

    function setDefault<T, K extends keyof any>(
        obj: Record<K, T>,
        key: K,
        value: T
    ): T {
        if (!(key in obj)) {
            obj[key] = value;
        }
        return obj[key];
    }

    const processor = (jobId: string, data: BenchLogEntry) => {
        let jobData = setDefault(accumulatedData, jobId, {});

        let currentBench = setDefault(jobData, data.tag, {
            id: Object.keys(jobData).length,
            config: null,
            meta: null,
            start: 0,
            data: 0,
            stop: 0,
            error: 0,
            line: 0,
            end: 0,
            stdout: 0,
            stderr: 0,
        });

        switch (data.event) {
            case "config":
                currentBench["config"] = data.data;
                break;

            case "meta":
                currentBench["meta"] = data.data;
                if (!hasMeta) {
                    onMeta(data.data);
                    hasMeta = true;
                }
                break;

            case "start":
                currentBench["start"] += 1;
                break;

            case "data":
                currentBench["data"] += 1;

                if ("gpudata" in data.data) {

                }
                if ("cpudata" in data.data) {

                }

                break;

            case "stop":
                currentBench["stop"] += 1;
                break;

            case "line":
                currentBench["line"] += 1;
                switch (data.pipe) {
                    case "stderr":
                        currentBench["stderr"] += 1;
                        break;

                    case "stdout":
                        currentBench["stdout"] += 1;
                        break;
                }
                break;

            case "error":
                currentBench["error"] += 1;
                break;

            case "end":
                currentBench["end"] += 1;
                break;
        }

        if (onUpdate) {
            onUpdate(jobId, jobData, currentBench);
        }
    };

    return processor;
}

export const RealtimeMetricsView: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [rawMetrics, setRawMetrics] = useState<MetricEntry[]>([]);
    const [jobMetrics, setJobMetrics] = useState<{ [jobId: string]: JobMetrics }>({});
    const [activeJobs, setActiveJobs] = useState<string[]>([]);
    const [selectedJobId, setSelectedJobId] = useState<string>('');
    const [runMeta, setRunMeta] = useState<any>(null);

    const metricProcessor = metricStreamProcessor(
        (jobId, jobData) => {
            // Update the jobMetrics state with the new accumulated data
            setJobMetrics(prev => {
                const newMetrics = { ...prev };

                if (!newMetrics[jobId]) {
                    newMetrics[jobId] = {
                        jobId,
                        benchmarks: {},
                        lastActivity: new Date(),
                        isActive: true,
                    };
                }

                const job = newMetrics[jobId];
                job.lastActivity = new Date();
                job.isActive = true;

                // Convert the accumulated data structure to our JobMetrics format
                job.benchmarks = {};
                Object.entries(jobData).forEach(([tag, benchData]: [string, any]) => {
                    job.benchmarks[tag] = {
                        id: benchData.id,
                        name: tag,
                        config: benchData.config,
                        meta: benchData.meta,
                        start: benchData.start,
                        data: benchData.data,
                        stop: benchData.stop,
                        error: benchData.error,
                        end: benchData.end,
                    };
                });

                return newMetrics;
            });
        },
        (meta) => {
            // Display the meta information about the run
            setRunMeta(meta);
        }
    );

    useEffect(() => {
        // Connect to WebSocket when component mounts
        webSocketService.connect();

        // Set up event listeners
        webSocketService.onConnect(() => {
            setIsConnected(true);
            toaster.create({
                title: 'Connected',
                description: 'Connected to milabench metrics server',
                type: 'success',
                duration: 3000,
            });
        });

        webSocketService.onDisconnect(() => {
            setIsConnected(false);
            toaster.create({
                title: 'Disconnected',
                description: 'Disconnected from metrics server',
                type: 'warning',
                duration: 3000,
            });
        });

        webSocketService.onStatus((data) => {
            toaster.create({
                title: 'Server Status',
                description: data.msg,
                type: 'info',
                duration: 4000,
            });
        });

        webSocketService.onMetricData((data: MetricData) => {
            const newMetric: MetricEntry = {
                id: `${Date.now()}-${Math.random()}`,
                timestamp: new Date(),
                jobId: data.jr_job_id,
                data: data.data,
                rawLine: data.raw_line,
            };

            // Add to raw metrics (keep last 5)
            setRawMetrics(prev => [newMetric, ...prev.slice(0, 4)]);

            // Process for structured display
            metricProcessor(data.jr_job_id, data.data);

            // Update active jobs list
            setActiveJobs(prev => {
                if (!prev.includes(data.jr_job_id)) {
                    return [...prev, data.jr_job_id];
                }
                return prev;
            });
        });

        // Cleanup on unmount
        return () => {
            webSocketService.disconnect();
        };
    }, []);

    // Removed auto-scroll as it's annoying when reading data

    useEffect(() => {
        if (activeJobs.length === 0) {
            if (selectedJobId) {
                setSelectedJobId('');
            }
            return;
        }
        if (!selectedJobId || !activeJobs.includes(selectedJobId)) {
            setSelectedJobId(activeJobs[0]);
        }
    }, [activeJobs, selectedJobId]);

    const getBenchmarkProgress = (bench: BenchmarkStats) => {
        if (bench.start === 0) return 0;
        return (bench.end / bench.start) * 100;
    };

    const renderJobMetrics = (job: JobMetrics | undefined) => {
        if (!job || Object.keys(job.benchmarks).length === 0) {
            return (
                <Card.Root>
                    <Card.Body>
                        <Text color="gray.500" textAlign="center" py={8}>
                            No benchmark data available for this job
                        </Text>
                    </Card.Body>
                </Card.Root>
            );
        }

        return (
            <VStack gap={6} align="stretch" height={"100%"}>
                {/* Run Meta Information */}
                {runMeta && (
                    <Card.Root>
                        <Card.Header>
                            <Heading size="md">Run Information</Heading>
                        </Card.Header>
                        <Card.Body>
                            <VStack gap={4} align="stretch">
                                {runMeta.arch && (
                                    <Box>
                                        <Text fontWeight="bold" fontSize="sm">System Architecture:</Text>
                                        <Code display="block" p={2} mt={1}>
                                            {JSON.stringify(runMeta.arch, null, 2)}
                                        </Code>
                                    </Box>
                                )}
                                {runMeta.milabench && (
                                    <Box>
                                        <Text fontWeight="bold" fontSize="sm">Milabench Info:</Text>
                                        <SimpleGrid columns={{ base: 2, md: 4 }} gap={4} mt={2}>
                                            <Stat.Root size="sm">
                                                <Stat.Label>Version</Stat.Label>
                                                <Stat.ValueText fontSize="md">{runMeta.milabench.version || 'N/A'}</Stat.ValueText>
                                            </Stat.Root>
                                            <Stat.Root size="sm">
                                                <Stat.Label>Tag</Stat.Label>
                                                <Stat.ValueText fontSize="md">{runMeta.milabench.tag || 'N/A'}</Stat.ValueText>
                                            </Stat.Root>
                                            <Stat.Root size="sm">
                                                <Stat.Label>Commit</Stat.Label>
                                                <Stat.ValueText fontSize="md">{runMeta.milabench.commit?.slice(0, 8) || 'N/A'}</Stat.ValueText>
                                            </Stat.Root>
                                            <Stat.Root size="sm">
                                                <Stat.Label>Date</Stat.Label>
                                                <Stat.ValueText fontSize="md">{runMeta.milabench.date || 'N/A'}</Stat.ValueText>
                                            </Stat.Root>
                                        </SimpleGrid>
                                    </Box>
                                )}
                                {Object.keys(runMeta).length > 0 && (
                                    <Box>
                                        <Text fontWeight="bold" fontSize="sm">Full Meta Data:</Text>
                                        <Code
                                            display="block"
                                            p={3}
                                            mt={1}
                                            maxH="300px"
                                            overflowY="auto"
                                            whiteSpace="pre-wrap"
                                        >
                                            {JSON.stringify(runMeta, null, 2)}
                                        </Code>
                                    </Box>
                                )}
                            </VStack>
                        </Card.Body>
                    </Card.Root>
                )}

                {/* Benchmarks Table */}
                <Card.Root>
                    <Card.Header>
                        <Heading size="md">Benchmark Progress</Heading>
                    </Card.Header>
                    <Card.Body>
                        <Table.ScrollArea>
                            <Table.Root variant="line" size="sm">
                                <Table.Header>
                                    <Table.Row>
                                        <Table.ColumnHeader>Benchmark</Table.ColumnHeader>
                                        <Table.ColumnHeader textAlign="end">Started</Table.ColumnHeader>
                                        <Table.ColumnHeader textAlign="end">Data</Table.ColumnHeader>
                                        <Table.ColumnHeader textAlign="end">Finished</Table.ColumnHeader>
                                        <Table.ColumnHeader textAlign="end">Errors</Table.ColumnHeader>
                                        <Table.ColumnHeader textAlign="end">Stopped</Table.ColumnHeader>
                                        <Table.ColumnHeader>Progress</Table.ColumnHeader>
                                        <Table.ColumnHeader>Status</Table.ColumnHeader>
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {Object.values(job.benchmarks).map((bench) => {
                                        const progress = getBenchmarkProgress(bench);
                                        const isComplete = bench.end >= bench.start && bench.start > 0;
                                        const hasErrors = bench.error > 0;

                                        return (
                                            <Table.Row key={bench.name}>
                                                <Table.Cell fontWeight="medium">{bench.name}</Table.Cell>
                                                <Table.Cell textAlign="end">{bench.start}</Table.Cell>
                                                <Table.Cell textAlign="end">{bench.data}</Table.Cell>
                                                <Table.Cell textAlign="end">{bench.end}</Table.Cell>
                                                <Table.Cell textAlign="end">
                                                    <Text color={hasErrors ? 'red.500' : 'inherit'}>
                                                        {bench.error}
                                                    </Text>
                                                </Table.Cell>
                                                <Table.Cell textAlign="end">{bench.stop}</Table.Cell>
                                                <Table.Cell>
                                                    <Progress.Root
                                                        value={progress}
                                                        colorScheme={hasErrors ? 'red' : 'green'}
                                                        size="sm"
                                                        width="100px"
                                                    >
                                                        <Progress.Track>
                                                            <Progress.Range />
                                                        </Progress.Track>
                                                    </Progress.Root>
                                                </Table.Cell>
                                                <Table.Cell>
                                                    <Badge
                                                        colorScheme={
                                                            isComplete ? (hasErrors ? 'red' : 'green') : 'blue'
                                                        }
                                                        variant="solid"
                                                    >
                                                        {isComplete ? 'Complete' : 'Running'}
                                                    </Badge>
                                                </Table.Cell>
                                            </Table.Row>
                                        );
                                    })}
                                </Table.Body>
                            </Table.Root>
                        </Table.ScrollArea>
                    </Card.Body>
                </Card.Root>

                {/* Metrics Table
                {Object.values(job.benchmarks).some(b => Object.keys(b.metrics).length > 0) && (
                    <Card.Root>
                        <Card.Header>
                            <Heading size="md">Performance Metrics</Heading>
                        </Card.Header>
                        <Card.Body>
                            <TableContainer>
                                <Table variant="line" size="sm">
                                    <Thead>
                                        <Tr>
                                            <Th>Benchmark</Th>
                                            <Th>Metric</Th>
                                            <Th isNumeric>Count</Th>
                                            <Th isNumeric>Mean</Th>
                                            <Th isNumeric>Std</Th>
                                            <Th isNumeric>Min</Th>
                                            <Th isNumeric>Max</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {Object.values(job.benchmarks).map((bench) =>
                                            Object.entries(bench.metrics).map(([metricName, groups]) =>
                                                Object.entries(groups).map(([groupName, values]) => {
                                                    const stats = computeStats(values);
                                                    if (!stats) return null;

                                                    return (
                                                        <Tr key={`${bench.name}-${metricName}-${groupName}`}>
                                                            <Td>{bench.name}</Td>
                                                            <Td>{metricName}</Td>
                                                            <Td isNumeric>{values.length}</Td>
                                                            <Td isNumeric>{formatMetricValue(stats.mean)}</Td>
                                                            <Td isNumeric>{formatMetricValue(stats.std)}</Td>
                                                            <Td isNumeric>{formatMetricValue(stats.min)}</Td>
                                                            <Td isNumeric>{formatMetricValue(stats.max)}</Td>
                                                        </Tr>
                                                    );
                                                })
                                            )
                                        )}
                                    </Tbody>
                                </Table>
                            </TableContainer>
                        </Card.Body>
                    </Card.Root>
                )} */}
            </VStack>
        );
    };

    // Note: renderJobMetrics function is defined above

    return (
        <Box p={6} maxW="100%" mx="auto" height={"100%"}>
            <VStack gap={6} align="stretch" height={"100%"}>
                {/* Header */}
                <Flex align="center">
                    <Heading size="lg">Real-time Metrics Dashboard</Heading>
                    <Spacer />
                    <HStack>
                        <Badge
                            colorScheme={isConnected ? 'green' : 'red'}
                            variant="solid"
                            px={3}
                            py={1}
                        >
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </Badge>
                        <Badge colorScheme="blue" variant="outline">
                            {activeJobs.length} Jobs
                        </Badge>
                    </HStack>
                </Flex>



                {/* Job Tabs */}
                {activeJobs.length > 0 ? (
                    <Tabs.Root value={selectedJobId || activeJobs[0] || ""} onValueChange={(details) => setSelectedJobId(details.value)} height={"100%"}>
                        <Tabs.List>
                            {activeJobs.map((jobId) => {
                                const job = jobMetrics[jobId];
                                const isActive = job?.isActive &&
                                    (new Date().getTime() - job.lastActivity.getTime()) < 30000; // 30 seconds
                                return (
                                    <Tabs.Trigger key={jobId} value={jobId}>
                                        <HStack>
                                            <Text>{jobId}</Text>
                                            <Badge
                                                colorScheme={isActive ? 'green' : 'gray'}
                                                variant="solid"
                                                size="sm"
                                            >
                                                {Object.keys(job?.benchmarks || {}).length}
                                            </Badge>
                                        </HStack>
                                    </Tabs.Trigger>
                                );
                            })}
                        </Tabs.List>

                        {activeJobs.map((jobId) => (
                            <Tabs.Content key={jobId} value={jobId} p={0} pt={6} height={"100%"}>
                                {(() => {
                                    const job = jobMetrics[jobId];
                                    if (!job || Object.keys(job.benchmarks).length === 0) {
                                        return (
                                            <Card.Root height={"100%"}>
                                                <Card.Body height={"100%"}>
                                                    <Text color="gray.500" textAlign="center" py={8}>
                                                        No benchmark data available for this job
                                                    </Text>
                                                </Card.Body>
                                            </Card.Root>
                                        );
                                    }
                                    return renderJobMetrics(job);
                                })()}
                            </Tabs.Content>
                        ))}
                    </Tabs.Root>
                ) : (
                    <Card.Root height={"100%"}>
                        <Card.Body height={"100%"}>
                            <Text color="gray.500" textAlign="center" py={8}>
                                Waiting for job metrics...
                            </Text>
                        </Card.Body>
                    </Card.Root>
                )}



                {/* Last 5 Raw Messages */}
                {rawMetrics.length > 0 && (
                    <Card.Root width={"100%"} height={"100%"}>
                        <Card.Header>
                            <Heading size="sm">Recent Raw Messages</Heading>
                        </Card.Header>
                        <Card.Body width={"100%"}>
                            <VStack gap={3} align="stretch" width={"100%"}>
                                {rawMetrics.map((metric) => (
                                    <Box
                                        key={metric.id}
                                        p={3}
                                        bg="gray.50"
                                        borderRadius="md"
                                        borderLeft="4px solid"
                                        borderLeftColor="blue.400"
                                        width={"100%"}
                                    >

                                        {metric.data ? (
                                            <HStack width={"100%"}>
                                                <Text fontSize="xs" color="gray.600">
                                                    {metric.timestamp.toLocaleTimeString()}
                                                </Text>
                                                <Badge colorScheme="cyan" variant="solid">
                                                    {metric.jobId}
                                                </Badge>
                                                <Code
                                                    display="block"
                                                    p={2}
                                                    bg="white"
                                                    borderRadius="sm"
                                                    fontSize="sm"
                                                    overflow="clip"
                                                    width={"100%"}
                                                >
                                                    {JSON.stringify(metric.data)}
                                                </Code>
                                            </HStack>
                                        ) : (
                                            <Code
                                                display="block"
                                                p={2}
                                                bg="white"
                                                borderRadius="sm"
                                                fontSize="sm"
                                                wordBreak="break-all"
                                            >
                                                {metric.rawLine}
                                            </Code>
                                        )}
                                    </Box>
                                ))}
                            </VStack>
                        </Card.Body>
                    </Card.Root>
                )}
            </VStack>
        </Box>
    );
};