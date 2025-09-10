import { useParams, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Badge,
    useToast,
    Stat,
    StatLabel,
    StatNumber,
    StatHelpText,
    SimpleGrid,
    Button,
    Accordion,
    AccordionItem,
    AccordionButton,
    AccordionPanel,
    AccordionIcon,
    Tooltip,
    GridItem
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { getExecution, getPacks } from '../../services/api';
import type { Execution, Pack } from '../../services/types';
import { DataTable } from '../common/Table';
import type { Column } from '../common/Table';
import { Loading } from '../common/Loading';
import { MetricsView } from './MetricsView';
import { FastReportView } from './FastReportView';
import { HtmlReportView } from './HtmlReportView';

const copyToClipboard = (toast: any, text: string) => {
    return () => {
        navigator.clipboard.writeText(text);
        toast({
            title: "Copied to clipboard",
            status: "success",
        });
    }
};

const copyCurrentURL = (toast: any) => {
    return () => {
        const currentURL = window.location.href;
        navigator.clipboard.writeText(currentURL);
        toast({
            title: "Link copied to clipboard",
            description: "You can now share this report link with others",
            status: "success",
            duration: 3000,
        });
    }
};

/**
 * ExecutionReport Component
 *
 * Feature Toggle: Report Generation Method
 * - Set cookie 'feature_db_report=true' to use fast API endpoint (/api/report/fast)
 * - Set cookie 'feature_db_report=false' or remove cookie to use HTML endpoint (/html/report/{id})
 * - The button will show which method is currently active
 */
export const ExecutionReport = () => {
    const { id } = useParams<{ id: string }>();
    usePageTitle(`Execution Report - ${id || 'Unknown'}`);

    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
    const [sideView, setSideView] = useState('NONE');

    const { data: execution, isLoading: isLoadingExecution } = useQuery<Execution>({
        queryKey: ['execution', id],
        queryFn: () => getExecution(Number(id)),
        enabled: !!id,
    });

    const { data: packs, isLoading: isLoadingPacks } = useQuery<Pack[]>({
        queryKey: ['packs', id],
        queryFn: () => getPacks(Number(id)),
        enabled: !!id,
    });

    // Handle URL parameters for shared report links
    useEffect(() => {
        const report = searchParams.get('report');
        const packParam = searchParams.get('pack');

        if (report === 'sql') {
            setSideView('FAST_REPORT');
        } else if (report === 'pandas') {
            setSideView('HTML_REPORT');
        } else if (packParam && packs) {
            // Handle shared pack metrics link
            // First try to find by ID (individual pack)
            const packId = Number(packParam);
            let pack = packs.find(p => p._id === packId);

            if (pack) {
                // Individual pack found
                setSelectedPack(pack);
                setSideView('METRICS');
            } else {
                // Try to find by name (group view)
                pack = packs.find(p => p.name === packParam);
                if (pack) {
                    // Group view - set _id to 0 to indicate group
                    setSelectedPack({ ...pack, _id: 0 });
                    setSideView('METRICS');
                }
            }
        }
    }, [searchParams, packs]);

    const packColumns: Column<Pack>[] = [
        { header: 'ID', accessor: '_id', width: '80px' },
        {
            header: 'Name',
            accessor: (pack: Pack) => (
                <Button
                    variant="link"
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPack(pack);
                        setSideView('METRICS');
                        // Update URL for sharing pack metrics
                        const newSearchParams = new URLSearchParams(searchParams);
                        newSearchParams.set('pack', pack._id.toString());
                        newSearchParams.delete('report'); // Clear report parameter if present
                        setSearchParams(newSearchParams);
                    }}
                >
                    {pack.tag}
                </Button>
            ),
            width: '200px'
        },
        {
            header: 'Command',
            accessor: (pack: Pack) => (
                pack.command ?
                    <Tooltip label={(pack.command || []).join(' ')}>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={copyToClipboard(toast, (pack.command || []).join(' '))}
                        >
                            Copy Command
                        </Button>
                    </Tooltip> :
                    <Text>-</Text>
            ),
            width: '150px'
        },
        {
            header: "Config",
            accessor: (pack: Pack) => (
                <Tooltip label={<pre>{JSON.stringify(pack.config, null, 2)}</pre>}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={copyToClipboard(toast, JSON.stringify(pack.config, null, 2))}
                    >
                        Copy Config
                    </Button>
                </Tooltip>
            ),
            width: '150px'
        }
    ];

    const generateSQLReport = () => {
        setSideView('FAST_REPORT');
        // Update URL for sharing
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('report', 'sql');
        newSearchParams.delete('pack'); // Clear pack parameter if present
        setSearchParams(newSearchParams);

        // Show toast notification
        toast({
            title: "SQL Report Generated",
            description: "You can now share this report using the 'Copy Link' button",
            status: "info",
            duration: 3000,
        });
    };

    const generatePythonReport = () => {
        setSideView('HTML_REPORT');
        // Update URL for sharing
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('report', 'pandas');
        newSearchParams.delete('pack'); // Clear pack parameter if present
        setSearchParams(newSearchParams);

        // Show toast notification
        toast({
            title: "Pandas Report Generated",
            description: "You can now share this report using the 'Copy Link' button",
            status: "info",
            duration: 3000,
        });
    };

    const handlePackGroupClick = async (pack: Pack) => {
        setSelectedPack({ ...pack, _id: 0 });
        setSideView('METRICS');
        // Update URL for sharing pack group metrics (use pack name for groups)
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('pack', pack.name); // Use pack name for group view
        newSearchParams.delete('report'); // Clear report parameter if present
        setSearchParams(newSearchParams);
    };

    const closeSidePanel = () => {
        setSideView('NONE');
        // Clear URL parameters when closing
        setSearchParams(new URLSearchParams());
    };

    if (isLoadingExecution || isLoadingPacks) {
        return <Loading message="Loading execution report..." />;
    }

    if (!execution) {
        return <Text>Execution not found</Text>;
    }

    // Group packs by name
    const groupedPacks = packs?.reduce((acc, pack) => {
        if (!acc[pack.name]) {
            acc[pack.name] = [];
        }
        acc[pack.name].push(pack);
        return acc;
    }, {} as { [key: string]: Pack[] }) || {};

    return (
        <Box height="100%" width="100%">
        <HStack align="flex-start" height="100%" width="100%">
            <Box p={4} className="execution-details" maxW="500px" height="100%">
                <VStack align="stretch" spacing={6} overflow="hidden" height="100%">
                    <HStack justify="space-between" overflow="hidden" height="10%">
                        <Heading size="lg">Execution Report</Heading>
                        <HStack>
                            <Button
                                colorScheme='green'
                                onClick={generateSQLReport}
                            >
                                SQL Report
                            </Button>
                            <Button
                                colorScheme='blue'
                                onClick={generatePythonReport}
                            >
                                Pandas Report
                            </Button>
                        </HStack>
                    </HStack>

                    {/* Execution Details */}
                    <Box p={2} borderWidth={1} height={"50%"} borderRadius="md" overflow="hidden">
                        
                        <SimpleGrid columns={3} spacing={4}>
                            <GridItem colSpan={{ base: 1, md: 3 }}>
                            <Stat >
                            <StatLabel>Name</StatLabel>
                            <StatNumber>{execution.name} </StatNumber>
                            <StatHelpText>{execution.namespace}</StatHelpText>
                        </Stat>
                            </GridItem>
                            <GridItem colSpan={{ base: 1, md: 2 }}>
                            <Stat>
                                <StatLabel>GPU</StatLabel>
                                <StatNumber>
                                    {execution.meta?.accelerators?.gpus?.[0]?.product || 'N/A'}
                                </StatNumber>
                                <StatHelpText>
                                    Driver: {execution.meta?.accelerators?.system?.CUDA_DRIVER || 'N/A'}
                                </StatHelpText>
                            </Stat>
                            </GridItem>
                            <GridItem>
                            <Stat>
                                <StatLabel>PyTorch</StatLabel>
                                <StatNumber>{execution.meta?.pytorch?.build_settings?.TORCH_VERSION || 'N/A'}</StatNumber>
                                <StatHelpText>CUDA: {execution.meta?.pytorch?.build_settings?.CUDA_VERSION || 'N/A'}</StatHelpText>
                            </Stat>
                            </GridItem>
                            <GridItem>
                            <Stat>
                                <StatLabel>CPU</StatLabel>
                                <StatNumber>{execution.meta?.cpu?.count || 'N/A'}</StatNumber>
                                <StatHelpText>{execution.meta?.cpu?.brand || 'N/A'}</StatHelpText>
                            </Stat>
                            </GridItem>
                            <GridItem>
                            <Stat>
                                <StatLabel>System</StatLabel>
                                <StatNumber>{execution.meta?.os?.machine || 'N/A'}</StatNumber>
                                <StatHelpText>Kernel: {execution.meta?.os?.release || 'N/A'}</StatHelpText>
                            </Stat>
                            </GridItem>
                            <GridItem>
                            <Stat>
                                <StatLabel>Milabench</StatLabel>
                                <StatNumber>{execution.meta?.milabench?.tag || 'N/A'}</StatNumber>
                                <StatHelpText>Date: {execution.meta?.milabench?.date || 'N/A'}</StatHelpText>
                            </Stat>
                            </GridItem>
                            <GridItem>
                            <Stat>
                                <StatLabel>Status</StatLabel>
                                <StatNumber>
                                    <Badge
                                        colorScheme={
                                            execution.status === 'completed'
                                                ? 'green'
                                                : execution.status === 'failed'
                                                    ? 'red'
                                                    : 'yellow'
                                        }
                                    >
                                        {execution.status}
                                    </Badge>
                                </StatNumber>
                            </Stat>
                            </GridItem>
                            <GridItem colSpan={{ base: 1, md: 2 }}>
                                <Stat>
                                    <StatLabel>Created Time</StatLabel>
                                    <StatNumber>{new Date(execution.created_time).toLocaleString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</StatNumber>
                                    <StatHelpText>

                                    </StatHelpText>
                                </Stat>
                            </GridItem>
                        </SimpleGrid>
                    </Box>

                    {/* Packs */}
                    <Box overflow="hidden" height={"100%"}>
                        <Heading size="md" mb={4}>Packs</Heading>
                        <Box overflow={"auto"} height={"100%"}>
                            <Accordion allowMultiple>
                                {Object.entries(groupedPacks).map(([name, packs]) => (
                                    <AccordionItem key={name}>
                                        <h2>
                                            <AccordionButton
                                                onClick={() => handlePackGroupClick(packs[0])}
                                                _hover={{ bg: 'gray.50' }}
                                            >
                                                <Box flex="1" textAlign="left">
                                                    <HStack>
                                                        <Heading size="sm">{name}</Heading>
                                                        <Badge colorScheme="blue">{packs.length} runs</Badge>
                                                    </HStack>
                                                </Box>
                                                <AccordionIcon />
                                            </AccordionButton>
                                        </h2>
                                        <AccordionPanel pb={4}>
                                            <DataTable
                                                data={packs}
                                                columns={packColumns}
                                            />
                                        </AccordionPanel>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </Box>
                    </Box>
                </VStack>
            </Box>

            <Box p={4} className="side-panel" width="100%" height="100%" overflow={"auto"}>
                {sideView === 'METRICS' && (
                    <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                            <Heading size="md">Pack Metrics</Heading>
                            <HStack>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={copyCurrentURL(toast)}
                                >
                                    Copy Link
                                </Button>
                                <Button size="sm" onClick={closeSidePanel}>
                                    Close
                                </Button>
                            </HStack>
                        </HStack>
                        <MetricsView
                            selectedPack={selectedPack!}
                            executionId={Number(id)}
                        />
                    </VStack>
                )}
                {sideView === 'FAST_REPORT' && (
                    <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                            <Heading size="md">SQL Report</Heading>
                            <HStack>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={copyCurrentURL(toast)}
                                >
                                    Copy Link
                                </Button>
                                <Button size="sm" onClick={closeSidePanel}>
                                    Close
                                </Button>
                            </HStack>
                        </HStack>
                        <FastReportView
                            executionId={Number(id)}
                            onClose={closeSidePanel}
                        />
                    </VStack>
                )}
                {sideView === 'HTML_REPORT' && (
                    <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                            <Heading size="md">Pandas Report</Heading>
                            <HStack>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={copyCurrentURL(toast)}
                                >
                                    Copy Link
                                </Button>
                                <Button size="sm" onClick={closeSidePanel}>
                                    Close
                                </Button>
                            </HStack>
                        </HStack>
                        <HtmlReportView
                            executionId={Number(id)}
                            onClose={closeSidePanel}
                        />
                    </VStack>
                )}
            </Box>
        </HStack>
        </Box>
    );
};