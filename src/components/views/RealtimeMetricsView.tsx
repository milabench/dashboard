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
import type {BenchLogEntry } from '../../services/types';


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
    const [selectedJobIndex, setSelectedJobIndex] = useState(0);
    const [runMeta, setRunMeta] = useState<any>(null);
    const toast = useToast();

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
            toast({
                title: 'Server Status',
                description: data.msg,
                status: 'info',
                duration: 4000,
                isClosable: true,
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
    }, [toast]);

    // Removed auto-scroll as it's annoying when reading data

    const clearMetrics = () => {
        setRawMetrics([]);
        setJobMetrics({});
        setActiveJobs([]);
        setSelectedJobIndex(0);
        setRunMeta(null);
    };

    const exportMetrics = () => {
        const dataStr = JSON.stringify({
            rawMetrics,
            jobMetrics,
            runMeta,
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
            <VStack spacing={6} align="stretch" height={"100%"}>
                {/* Run Meta Information */}
                {runMeta && (
                    <Card>
                        <CardHeader>
                            <Heading size="md">Run Information</Heading>
                        </CardHeader>
                        <CardBody>
                            <VStack spacing={4} align="stretch">
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
                                        <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} mt={2}>
                                            <Stat size="sm">
                                                <StatLabel>Version</StatLabel>
                                                <StatNumber fontSize="md">{runMeta.milabench.version || 'N/A'}</StatNumber>
                                            </Stat>
                                            <Stat size="sm">
                                                <StatLabel>Tag</StatLabel>
                                                <StatNumber fontSize="md">{runMeta.milabench.tag || 'N/A'}</StatNumber>
                                            </Stat>
                                            <Stat size="sm">
                                                <StatLabel>Commit</StatLabel>
                                                <StatNumber fontSize="md">{runMeta.milabench.commit?.slice(0, 8) || 'N/A'}</StatNumber>
                                            </Stat>
                                            <Stat size="sm">
                                                <StatLabel>Date</StatLabel>
                                                <StatNumber fontSize="md">{runMeta.milabench.date || 'N/A'}</StatNumber>
                                            </Stat>
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
                        </CardBody>
                    </Card>
                )}

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
        <Box p={6} maxW="100%" mx="auto"  height={"100%"}>
            <VStack spacing={6} align="stretch" height={"100%"}>
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
                    <Tabs index={selectedJobIndex} onChange={setSelectedJobIndex}  height={"100%"}>
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

                        <TabPanels height={"100%"}>
                            {activeJobs.map((jobId) => (
                                <TabPanel key={jobId} p={0} pt={6} height={"100%"}>
                                    {(() => {
                                        const job = jobMetrics[jobId];
                                        if (!job || Object.keys(job.benchmarks).length === 0) {
                                            return (
                                                <Card height={"100%"}>
                                                    <CardBody height={"100%"}>
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
                    <Card height={"100%"}>
                        <CardBody height={"100%"}>
                            <Text color="gray.500" textAlign="center" py={8}>
                                Waiting for job metrics...
                            </Text>
                        </CardBody>
                    </Card>
                )}



                {/* Last 5 Raw Messages */}
                {rawMetrics.length > 0 && (
                    <Card width={"100%"} height={"100%"}>
                        <CardHeader>
                            <Heading size="sm">Recent Raw Messages</Heading>
                        </CardHeader>
                        <CardBody width={"100%"}>
                            <VStack spacing={3} align="stretch" width={"100%"}>
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
                        </CardBody>
                    </Card>
                )}
            </VStack>
        </Box>
    );
};