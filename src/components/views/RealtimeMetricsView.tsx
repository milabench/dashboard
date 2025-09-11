import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Input,
    Button,
    Badge,
    Card,
    CardHeader,
    CardBody,
    useToast,
    Flex,
    IconButton,
    Spacer,
    Code,
    Divider,
    Alert,
    AlertIcon,
    AlertTitle,
    AlertDescription,
    Tabs,
    TabList,
    TabPanels,
    Tab,
    TabPanel,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    TableContainer,
    Progress,
    Stat,
    StatLabel,
    StatNumber,
    StatHelpText,
    SimpleGrid,
} from '@chakra-ui/react';
import { DeleteIcon, DownloadIcon } from '@chakra-ui/icons';
import { webSocketService, type MetricData } from '../../services/websocket';

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
    then: (jobId: string, accumulatedData: Record<string, any>, currentBench: any) => void
) {
    let accumulatedData: Record<string, any> = {};

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

    const processor = (jobId: string, data: any) => {
        let jobData = setDefault(accumulatedData, jobId, {});

        let currentBench = setDefault(jobData, data.tag, {
            id: Object.keys(jobData).length,
            config: null,
            meta: null,
            start: 0,
            data: 0,
            stop: 0,
            error: 0,
            end: 0,
        });

        switch (data.event) {
            case "config":
                currentBench["config"] = data.data;
                break;

            case "meta":
                currentBench["meta"] = data.data;
                break;

            case "start":
                currentBench["start"] += 1;
                break;

            case "data":
                currentBench["data"] += 1;
                break;

            case "stop":
                currentBench["stop"] += 1;
                break;

            case "error":
                currentBench["error"] += 1;
                break;

            case "end":
                currentBench["end"] += 1;
                break;
        }

        if (then) {
            then(jobId, jobData, currentBench);
        }
    };

    return processor;
}

export const RealtimeMetricsView: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [rawMetrics, setRawMetrics] = useState<MetricEntry[]>([]);
    const [jobMetrics, setJobMetrics] = useState<{ [jobId: string]: JobMetrics }>({});
    const [activeJobs, setActiveJobs] = useState<string[]>([]);
    const [selectedJobIndex, setSelectedJobIndex] = useState(0);
    const [statusMessages, setStatusMessages] = useState<string[]>([]);
    const toast = useToast();
    
    const metricProcessor = metricStreamProcessor((jobId, jobData) => {
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
    })


    useEffect(() => {
        // Connect to WebSocket when component mounts
        webSocketService.connect();

        // Set up event listeners
        webSocketService.onConnect(() => {
            setIsConnected(true);
            toast({
                title: 'Connected',
                description: 'Connected to milabench metrics server',
                status: 'success',
                duration: 3000,
                isClosable: true,
            });
        });

        webSocketService.onDisconnect(() => {
            setIsConnected(false);
            toast({
                title: 'Disconnected',
                description: 'Disconnected from metrics server',
                status: 'warning',
                duration: 3000,
                isClosable: true,
            });
        });

        webSocketService.onStatus((data) => {
            setStatusMessages(prev => [data.msg, ...prev.slice(0, 4)]);
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
    }, [toast]);

    // Removed auto-scroll as it's annoying when reading data

    const clearMetrics = () => {
        setRawMetrics([]);
        setStatusMessages([]);
        setJobMetrics({});
        setActiveJobs([]);
        setSelectedJobIndex(0);
    };

    const exportMetrics = () => {
        const dataStr = JSON.stringify({
            rawMetrics,
            jobMetrics,
            statusMessages,
            timestamp: new Date().toISOString()
        }, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `milabench-metrics-${new Date().toISOString()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const getBenchmarkProgress = (bench: BenchmarkStats) => {
        if (bench.start === 0) return 0;
        return (bench.end / bench.start) * 100;
    };

    const formatMetricValue = (value: number) => {
        if (value < 0.01) return value.toExponential(2);
        if (value < 1) return value.toFixed(4);
        if (value < 100) return value.toFixed(2);
        return value.toFixed(1);
    };

    const formatMetricData = (data: any) => {
        if (!data) return null;

        try {
            return JSON.stringify(data, null, 2);
        } catch {
            return String(data);
        }
    };

    const renderJobMetrics = (job: JobMetrics | undefined) => {
        if (!job || Object.keys(job.benchmarks).length === 0) {
            return (
                <Card>
                    <CardBody>
                        <Text color="gray.500" textAlign="center" py={8}>
                            No benchmark data available for this job
                        </Text>
                    </CardBody>
                </Card>
            );
        }

        return (
            <VStack spacing={6} align="stretch">
                {/* Job Overview */}
                <Card>
                    <CardHeader>
                        <Heading size="md">Job Overview: {job.jobId}</Heading>
                    </CardHeader>
                    <CardBody>
                        <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                            <Stat>
                                <StatLabel>Benchmarks</StatLabel>
                                <StatNumber>{Object.keys(job.benchmarks).length}</StatNumber>
                            </Stat>
                            <Stat>
                                <StatLabel>Total Started</StatLabel>
                                <StatNumber>
                                    {Object.values(job.benchmarks).reduce((sum, b) => sum + b.start, 0)}
                                </StatNumber>
                            </Stat>
                            <Stat>
                                <StatLabel>Total Finished</StatLabel>
                                <StatNumber>
                                    {Object.values(job.benchmarks).reduce((sum, b) => sum + b.end, 0)}
                                </StatNumber>
                            </Stat>
                            <Stat>
                                <StatLabel>Error Rate</StatLabel>
                                <StatNumber>
                                    {(() => {
                                        const totalFinished = Object.values(job.benchmarks).reduce((sum, b) => sum + b.end, 0);
                                        const totalErrors = Object.values(job.benchmarks).reduce((sum, b) => sum + b.error, 0);
                                        return totalFinished > 0 ? `${((totalErrors / totalFinished) * 100).toFixed(1)}%` : 'N/A';
                                    })()}
                                </StatNumber>
                            </Stat>
                        </SimpleGrid>
                    </CardBody>
                </Card>

                {/* Benchmarks Table */}
                <Card>
                    <CardHeader>
                        <Heading size="md">Benchmark Progress</Heading>
                    </CardHeader>
                    <CardBody>
                        <TableContainer>
                            <Table variant="simple" size="sm">
                                <Thead>
                                    <Tr>
                                        <Th>Benchmark</Th>
                                        <Th isNumeric>Started</Th>
                                        <Th isNumeric>Data</Th>
                                        <Th isNumeric>Finished</Th>
                                        <Th isNumeric>Errors</Th>
                                        <Th isNumeric>Stopped</Th>
                                        <Th>Progress</Th>
                                        <Th>Status</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {Object.values(job.benchmarks).map((bench) => {
                                        const progress = getBenchmarkProgress(bench);
                                        const isComplete = bench.end >= bench.start && bench.start > 0;
                                        const hasErrors = bench.error > 0;

                                        return (
                                            <Tr key={bench.name}>
                                                <Td fontWeight="medium">{bench.name}</Td>
                                                <Td isNumeric>{bench.start}</Td>
                                                <Td isNumeric>{bench.data}</Td>
                                                <Td isNumeric>{bench.end}</Td>
                                                <Td isNumeric>
                                                    <Text color={hasErrors ? 'red.500' : 'inherit'}>
                                                        {bench.error}
                                                    </Text>
                                                </Td>
                                                <Td isNumeric>{bench.stop}</Td>
                                                <Td>
                                                    <Progress
                                                        value={progress}
                                                        colorScheme={hasErrors ? 'red' : 'green'}
                                                        size="sm"
                                                        width="100px"
                                                    />
                                                </Td>
                                                <Td>
                                                    <Badge
                                                        colorScheme={
                                                            isComplete ? (hasErrors ? 'red' : 'green') : 'blue'
                                                        }
                                                        variant="solid"
                                                    >
                                                        {isComplete ? 'Complete' : 'Running'}
                                                    </Badge>
                                                </Td>
                                            </Tr>
                                        );
                                    })}
                                </Tbody>
                            </Table>
                        </TableContainer>
                    </CardBody>
                </Card>

                {/* Metrics Table
                {Object.values(job.benchmarks).some(b => Object.keys(b.metrics).length > 0) && (
                    <Card>
                        <CardHeader>
                            <Heading size="md">Performance Metrics</Heading>
                        </CardHeader>
                        <CardBody>
                            <TableContainer>
                                <Table variant="simple" size="sm">
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
                        </CardBody>
                    </Card>
                )} */}
            </VStack>
        );
    };

    const selectedJob = activeJobs[selectedJobIndex];
    const currentJobMetrics = selectedJob ? jobMetrics[selectedJob] : null;

    // Note: renderJobMetrics function is defined above

    return (
        <Box p={6} maxW="100%" mx="auto">
            <VStack spacing={6} align="stretch">
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

                {/* Controls */}
                <Card>
                    <CardBody>
                        <HStack>
                            <IconButton
                                aria-label="Clear metrics"
                                icon={<DeleteIcon />}
                                colorScheme="red"
                                variant="outline"
                                onClick={clearMetrics}
                            />
                            <IconButton
                                aria-label="Export metrics"
                                icon={<DownloadIcon />}
                                colorScheme="green"
                                variant="outline"
                                onClick={exportMetrics}
                                isDisabled={rawMetrics.length === 0}
                            />
                            <Text fontSize="sm" color="gray.600">
                                {rawMetrics.length} recent messages
                            </Text>
                        </HStack>
                    </CardBody>
                </Card>

                {/* Job Tabs */}
                {activeJobs.length > 0 ? (
                    <Tabs index={selectedJobIndex} onChange={setSelectedJobIndex}>
                        <TabList>
                            {activeJobs.map((jobId, index) => {
                                const job = jobMetrics[jobId];
                                const isActive = job?.isActive &&
                                    (new Date().getTime() - job.lastActivity.getTime()) < 30000; // 30 seconds
                                return (
                                    <Tab key={jobId}>
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
                                    </Tab>
                                );
                            })}
                        </TabList>

                        <TabPanels>
                            {activeJobs.map((jobId) => (
                                <TabPanel key={jobId} p={0} pt={6}>
                                    {(() => {
                                        const job = jobMetrics[jobId];
                                        if (!job || Object.keys(job.benchmarks).length === 0) {
                                            return (
                                                <Card>
                                                    <CardBody>
                                                        <Text color="gray.500" textAlign="center" py={8}>
                                                            No benchmark data available for this job
                                                        </Text>
                                                    </CardBody>
                                                </Card>
                                            );
                                        }
                                        return renderJobMetrics(job);
                                    })()}
                                </TabPanel>
                            ))}
                        </TabPanels>
                    </Tabs>
                ) : (
                    <Card>
                        <CardBody>
                            <Text color="gray.500" textAlign="center" py={8}>
                                Waiting for job metrics...
                            </Text>
                        </CardBody>
                    </Card>
                )}

                {/* Recent Messages */}
                {statusMessages.length > 0 && (
                    <Card>
                        <CardHeader>
                            <Heading size="sm">Status Messages</Heading>
                        </CardHeader>
                        <CardBody>
                            <VStack spacing={2} align="stretch">
                                {statusMessages.map((msg, index) => (
                                    <Text key={index} fontSize="sm" color="blue.600">
                                        {msg}
                                    </Text>
                                ))}
                            </VStack>
                        </CardBody>
                    </Card>
                )}

                {/* Last 5 Raw Messages */}
                {rawMetrics.length > 0 && (
                    <Card>
                        <CardHeader>
                            <Heading size="sm">Recent Raw Messages</Heading>
                        </CardHeader>
                        <CardBody>
                            <VStack spacing={3} align="stretch">
                                {rawMetrics.map((metric) => (
                                    <Box
                                        key={metric.id}
                                        p={3}
                                        bg="gray.50"
                                        borderRadius="md"
                                        borderLeft="4px solid"
                                        borderLeftColor="blue.400"
                                    >
                                        <HStack justify="space-between" mb={2}>
                                            <Badge colorScheme="cyan" variant="solid">
                                                {metric.jobId}
                                            </Badge>
                                            <Text fontSize="xs" color="gray.600">
                                                {metric.timestamp.toLocaleTimeString()}
                                            </Text>
                                        </HStack>

                                        {metric.data ? (
                                            <Code
                                                display="block"
                                                whiteSpace="pre-wrap"
                                                p={2}
                                                bg="white"
                                                borderRadius="sm"
                                                fontSize="sm"
                                                maxH="200px"
                                                overflowY="auto"
                                            >
                                                {formatMetricData(metric.data)}
                                            </Code>
                                        ) : (
                                            <Code
                                                display="block"
                                                p={2}
                                                bg="white"
                                                borderRadius="sm"
                                                fontSize="sm"
                                            >
                                                {metric.rawLine}
                                            </Code>
                                        )}
                                    </Box>
                                ))}
                            </VStack>
                        </CardBody>
                    </Card>
                )}
            </VStack>
        </Box>
    );
};