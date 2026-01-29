import React, { useState, useEffect, useMemo } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Field,
    Badge,
    Code,
    Table,
    Dialog,
    useDisclosure,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import { toaster } from '../ui/toaster';
import { Loading } from '../common/Loading';
import {
    getDatafileFields,
    previewDatafileSelection,
    type DatafileFields,
    type SelectedFields,
} from '../../services/api';

export const DatafileView: React.FC = () => {
    usePageTitle('Datafile View');

    const [folderPath, setFolderPath] = useState<string>('');
    const [fieldPatterns, setFieldPatterns] = useState<Record<string, string>>({});
    const navigate = useNavigate();
    const { open: isFolderDialogOpen, onOpen: onFolderDialogOpen, onClose: onFolderDialogClose } = useDisclosure();

    // Load folder from cookie on mount
    useEffect(() => {
        const savedFolder = Cookies.get('folder');
        if (savedFolder) {
            setFolderPath(savedFolder);
        }
    }, []);

    // Fetch available fields
    const { data: fieldsData, isLoading: isLoadingFields, refetch: refetchFields } = useQuery<DatafileFields>({
        queryKey: ['datafileFields', folderPath],
        queryFn: getDatafileFields,
        enabled: !!folderPath,
    });

    // Keep patterns for any newly loaded fields
    useEffect(() => {
        if (!fieldsData) return;
        setFieldPatterns((prev) => {
            const next = { ...prev };
            for (const fieldName of Object.keys(fieldsData)) {
                if (!(fieldName in next)) {
                    next[fieldName] = '';
                }
            }
            return next;
        });
    }, [fieldsData]);

    const fieldList = useMemo(() => {
        if (!fieldsData) return [];
        return Object.keys(fieldsData);
    }, [fieldsData]);

    // Build selected fields object for API calls
    const selectedFields: SelectedFields = {};
    for (const [fieldName, pattern] of Object.entries(fieldPatterns)) {
        if (pattern.trim()) {
            selectedFields[fieldName] = pattern;
        }
    }

    // Fetch metrics when filters are applied
    const hasFilters = Object.keys(selectedFields).length > 0;
    const { data: metrics, isLoading: isLoadingMetrics, refetch: refetchMetrics } = useQuery<any[]>({
        queryKey: ['datafileSelectedGroups', selectedFields],
        queryFn: () => previewDatafileSelection(selectedFields),
        enabled: hasFilters && !!folderPath,
    });

    const buildMetricsUrl = () => {
        const encoded = btoa(JSON.stringify(selectedFields));
        const baseUrl = window.location.origin;
        return `${baseUrl}/api/datafile/select/metrics?filters=${encodeURIComponent(encoded)}`;
    };

    const handleOpenVegaBuilder = () => {
        const url = buildMetricsUrl();
        navigate(`/datafile/vega?dataUrl=${encodeURIComponent(url)}`);
    };

    const handleCopyMetricsUrl = async () => {
        const url = buildMetricsUrl();
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                const tempInput = document.createElement('textarea');
                tempInput.value = url;
                tempInput.setAttribute('readonly', 'true');
                tempInput.style.position = 'absolute';
                tempInput.style.left = '-9999px';
                document.body.appendChild(tempInput);
                tempInput.select();
                const success = document.execCommand('copy');
                document.body.removeChild(tempInput);
                if (!success) {
                    throw new Error('document.execCommand("copy") failed');
                }
            }
            toaster.create({
                title: 'URL copied',
                description: 'Metrics URL copied to clipboard',
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toaster.create({
                title: 'Copy failed',
                description: `Unable to copy the URL: ${message}`,
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleSetFolder = () => {
        if (!folderPath.trim()) {
            toaster.create({
                title: 'Folder path required',
                description: 'Please enter a folder path',
                type: 'warning',
                duration: 3000,
            });
            return;
        }

        Cookies.set('folder', folderPath.trim(), { expires: 365 });
        toaster.create({
            title: 'Folder set successfully',
            description: `Folder set to: ${folderPath.trim()}`,
            type: 'success',
            duration: 3000,
        });
        refetchFields();
        setFieldPatterns({});
        onFolderDialogClose();
    };

    const handlePatternChange = (fieldName: string, pattern: string) => {
        setFieldPatterns((prev) => ({ ...prev, [fieldName]: pattern }));
    };

    const getFieldValues = (fieldName: string): any[] => {
        if (!fieldsData || !fieldsData[fieldName]) {
            return [];
        }
        return fieldsData[fieldName];
    };

    const renderMetricsTable = (metricsData: any[] | undefined) => {
        if (!metricsData || metricsData.length === 0) {
            return <Text>No metrics data available. Add field filters and ensure patterns match.</Text>;
        }

        if (metricsData.length > 0 && typeof metricsData[0] === 'object') {
            const keys: string[] = Array.from(
                metricsData.reduce((acc, row) => {
                    Object.keys((row as Record<string, unknown>) || {}).forEach((key) => acc.add(key));
                    return acc;
                }, new Set<string>())
            );
            return (
                <VStack align="stretch" gap={4}>
                    <Box>
                        <Text fontSize="sm" fontWeight="bold">
                            Showing {metricsData.length} metric{metricsData.length !== 1 ? 's' : ''}
                        </Text>
                    </Box>
                    <Table.ScrollArea>
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    {keys.map((key) => (
                                        <Table.ColumnHeader key={key}>{key}</Table.ColumnHeader>
                                    ))}
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {metricsData.map((row: any, idx: number) => {
                                    const rowData = row as Record<string, unknown>;
                                    return (
                                        <Table.Row key={idx}>
                                            {keys.map((key) => {
                                                const value = rowData[key];
                                                return (
                                                    <Table.Cell key={key}>
                                                        {typeof value === 'object'
                                                            ? JSON.stringify(value)
                                                            : String(value ?? '')}
                                                    </Table.Cell>
                                                );
                                            })}
                                        </Table.Row>
                                    );
                                })}
                            </Table.Body>
                        </Table.Root>
                    </Table.ScrollArea>
                </VStack>
            );
        }

        // If it's a simple array, render as list
        return (
            <VStack align="stretch" gap={2}>
                <Box>
                    <Text fontSize="sm" fontWeight="bold">
                        Showing {metricsData.length} metric{metricsData.length !== 1 ? 's' : ''}
                    </Text>
                </Box>
                {metricsData.map((item: any, idx: number) => (
                    <Box key={idx} p={2} borderRadius="md" borderWidth={1}>
                        <Code fontSize="sm">{JSON.stringify(item)}</Code>
                    </Box>
                ))}
            </VStack>
        );
    };

    return (
        <Box p={4} minH="100vh">
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg">Datafile View</Heading>
                    <HStack gap={2}>
                        {folderPath ? (
                            <>
                                <Badge fontSize="md" px={3} py={1}>
                                    Folder: {folderPath}
                                </Badge>
                                <Button
                                    onClick={onFolderDialogOpen}
                                    size="sm"
                                >
                                    Change Folder
                                </Button>
                            </>
                        ) : (
                            <Button
                                onClick={onFolderDialogOpen}
                                size="sm"
                                variant="outline"
                            >
                                Folder: Not Set
                            </Button>
                        )}
                    </HStack>
                </HStack>

                {!folderPath ? (
                    <Box textAlign="center" py={8} borderRadius="md" borderWidth={1} p={4}>
                        <Text fontSize="lg" mb={4}>
                            Please set a folder path to view datafile fields
                        </Text>
                        <Button onClick={onFolderDialogOpen}>
                            Set Folder Path
                        </Button>
                    </Box>
                ) : (
                    <HStack align="stretch" gap={4} flex="1">
                        {/* Field Selection Panel */}
                        <Box
                            w="400px"
                            borderRadius="md"
                            p={4}
                            borderWidth={1}
                        >
                            <VStack align="stretch" gap={4}>
                                <Heading size="sm">Field Filters</Heading>

                                {isLoadingFields ? (
                                    <Loading />
                                ) : !fieldsData || Object.keys(fieldsData).length === 0 ? (
                                    <Text fontSize="sm">
                                        No fields available
                                    </Text>
                                ) : (
                                    <VStack align="stretch" gap={3}>
                                        {fieldList.map((fieldName) => {
                                            const fieldValues = getFieldValues(fieldName);
                                            const uniqueValues = Array.from(new Set(fieldValues.map(v => String(v))));
                                            const listId = `field-values-${fieldName}`;

                                            return (
                                                <Box
                                                    key={fieldName}
                                                    p={3}
                                                    borderRadius="md"
                                                    borderWidth={1}
                                                >
                                                    <VStack align="stretch" gap={2}>
                                                        <HStack align="center" gap={3}>
                                                            <Text fontSize="sm" fontWeight="medium" minW="160px">
                                                                {fieldName}
                                                            </Text>
                                                            <Input
                                                                value={fieldPatterns[fieldName] || ''}
                                                                onChange={(e) => handlePatternChange(fieldName, e.target.value)}
                                                                placeholder="Enter pattern (supports * and ?)"
                                                                size="sm"
                                                                list={listId}
                                                            />
                                                        </HStack>
                                                        <datalist id={listId}>
                                                            {uniqueValues.map((value) => (
                                                                <option key={value} value={value} />
                                                            ))}
                                                        </datalist>
                                                    </VStack>
                                                </Box>
                                            );
                                        })}
                                    </VStack>
                                )}
                            </VStack>
                        </Box>

                        {/* Metrics Results Panel */}
                        <Box flex="1" borderRadius="md" p={4} borderWidth={1}>
                            <VStack align="stretch" gap={4}>
                                <HStack justify="space-between">
                                    <Heading size="md">Selected Datafiles</Heading>
                                    {hasFilters && (
                                        <HStack gap={2}>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleCopyMetricsUrl}
                                                disabled={isLoadingMetrics}
                                            >
                                                Copy Metrics URL
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleOpenVegaBuilder}
                                            >
                                                Vega Plot Builder
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => refetchMetrics()}
                                                disabled={isLoadingMetrics}
                                            >
                                                Refresh
                                            </Button>
                                        </HStack>
                                    )}
                                </HStack>

                                {!hasFilters ? (
                                    <Box textAlign="center" py={8}>
                                        <Text fontSize="lg">
                                            Add field filters to view metrics
                                        </Text>
                                        <Text fontSize="sm" mt={2}>
                                            Select fields and enter patterns to filter metrics
                                        </Text>
                                    </Box>
                                ) : isLoadingMetrics ? (
                                    <Loading />
                                ) : (
                                    renderMetricsTable(metrics)
                                )}
                            </VStack>
                        </Box>
                    </HStack>
                )}
            </VStack>

            {/* Folder Setting Dialog */}
            <Dialog.Root open={isFolderDialogOpen} onOpenChange={(details) => {
                if (!details.open) {
                    onFolderDialogClose();
                }
            }}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Set Folder Path</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack gap={4} align="stretch">
                                <Field.Root>
                                    <Field.Label>Folder Path</Field.Label>
                                    <Input
                                        value={folderPath}
                                        onChange={(e) => setFolderPath(e.target.value)}
                                        placeholder="/path/to/data/folder"
                                    />
                                    <Field.HelperText>
                                        This folder will be used for all datafile operations
                                    </Field.HelperText>
                                </Field.Root>
                                <HStack gap={2} justify="flex-end">
                                    <Button
                                        variant="outline"
                                        onClick={onFolderDialogClose}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleSetFolder}
                                    >
                                        Set Folder
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};
