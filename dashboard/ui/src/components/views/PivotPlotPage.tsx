import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Box,
    Button,
    Dialog,
    Field,
    Heading,
    HStack,
    Input,
    Spinner,
    Stack,
    Text,
    useDisclosure,
    VStack,
} from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { getAllSavedQueries, getPivot, saveQuery } from '../../services/api';
import {
    hasPivotApiFilters,
    hasPivotUrlConfig,
    parsePivotFieldsFromSearchParams,
    pivotApiSearchParams,
    PIVOT_PLOT_SAVED_QUERY_URL,
    savedQueryParametersToSearchParams,
    searchParamsToSavedQueryParameters,
} from '../../utils/pivotUrlParams';
import { toaster } from '../ui/toaster';
import { PivotPlotView, PlotSidebarActionPanel, type PivotPlotPageActions } from './PivotPlotView';

interface PivotPlotLocationState {
    pivotData?: Record<string, unknown>[];
}

export function PivotPlotPage() {
    usePageTitle('Pivot Plot');

    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [searchParams] = useSearchParams();
    const [saveQueryName, setSaveQueryName] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { open: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose, setOpen: setSaveModalOpen } = useDisclosure();
    const { open: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose, setOpen: setLoadModalOpen } = useDisclosure();

    const apiParams = useMemo(() => pivotApiSearchParams(searchParams), [searchParams]);
    const pivotFields = useMemo(
        () => parsePivotFieldsFromSearchParams(searchParams) ?? [],
        [searchParams],
    );
    const pivotQueryKey = apiParams.toString();
    const backHref = `/pivot${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    const canFetchPivot = hasPivotUrlConfig(searchParams) && hasPivotApiFilters(searchParams);
    const missingFilters = hasPivotUrlConfig(searchParams) && !hasPivotApiFilters(searchParams);

    const navPivotData = (location.state as PivotPlotLocationState | null)?.pivotData;
    if (navPivotData?.length && !queryClient.getQueryData(['pivotPlot', pivotQueryKey])) {
        queryClient.setQueryData(['pivotPlot', pivotQueryKey], navPivotData);
    }

    const cachedRows = queryClient.getQueryData<Record<string, unknown>[]>(['pivotPlot', pivotQueryKey]);
    const hasCachedRows = (cachedRows?.length ?? 0) > 0;

    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    const {
        data: pivotData,
        isLoading,
        isFetching,
        isError,
        error,
    } = useQuery({
        queryKey: ['pivotPlot', pivotQueryKey],
        queryFn: () => getPivot(apiParams),
        enabled: canFetchPivot && !hasCachedRows,
        staleTime: 0,
        retry: 1,
    });

    const pivotRows = Array.isArray(pivotData)
        ? pivotData
        : (cachedRows ?? []);
    const hasPivotRows = pivotRows.length > 0;

    const plotSavedQueries = useMemo(
        () => savedQueries?.filter((query: { query?: { url?: string } }) => query.query?.url === PIVOT_PLOT_SAVED_QUERY_URL) ?? [],
        [savedQueries],
    );

    const handleSaveQuery = async () => {
        if (!saveQueryName.trim()) {
            toaster.create({
                title: 'Query name required',
                description: 'Please enter a name for your saved query',
                type: 'warning',
                duration: 3000,
            });
            return;
        }

        try {
            const queryData = {
                url: PIVOT_PLOT_SAVED_QUERY_URL,
                parameters: {
                    ...searchParamsToSavedQueryParameters(searchParams),
                    timestamp: new Date().toISOString(),
                },
            };

            await saveQuery(saveQueryName, queryData);
            queryClient.invalidateQueries({ queryKey: ['savedQueries'] });

            toaster.create({
                title: 'Plot saved',
                description: `"${saveQueryName}" saved with pivot config and plot settings`,
                type: 'success',
                duration: 3000,
            });

            onSaveModalClose();
            setSaveQueryName('');
        } catch (err) {
            toaster.create({
                title: 'Error saving plot',
                description: err instanceof Error ? err.message : 'Failed to save query',
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleLoadData = async () => {
        if (!canFetchPivot) {
            toaster.create({
                title: 'Cannot refresh pivot data',
                description: missingFilters
                    ? 'Add at least one filter on the pivot view — the API requires filters to run.'
                    : 'Configure rows, columns, or values on the pivot view first.',
                type: 'warning',
                duration: 5000,
            });
            return;
        }

        setIsRefreshing(true);
        try {
            await queryClient.invalidateQueries({ queryKey: ['pivotPlot', pivotQueryKey] });
            const data = await queryClient.fetchQuery({
                queryKey: ['pivotPlot', pivotQueryKey],
                queryFn: () => getPivot(new URLSearchParams(apiParams)),
                staleTime: 0,
            });
            queryClient.setQueryData(['pivotPlot', pivotQueryKey], data);
            const rowCount = data.length;
            toaster.create({
                title: 'Data refreshed',
                description: rowCount > 0
                    ? `${rowCount.toLocaleString()} rows loaded`
                    : 'Query completed with no rows',
                type: rowCount > 0 ? 'success' : 'warning',
                duration: 3000,
            });
        } catch (err) {
            const message = err instanceof Error
                ? err.message
                : (err as { message?: string })?.message ?? 'Could not run pivot query';
            toaster.create({
                title: 'Failed to refresh data',
                description: message,
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleLoadQuery = (query: { name: string; query: { url: string; parameters: Record<string, unknown> } }) => {
        const { parameters } = query.query;
        const params = savedQueryParametersToSearchParams(parameters);
        navigate(`${PIVOT_PLOT_SAVED_QUERY_URL}?${params.toString()}`);
        onLoadModalClose();
        toaster.create({
            title: 'Plot loaded',
            description: `"${query.name}" loaded successfully`,
            type: 'success',
            duration: 3000,
        });
    };

    const pageActions: PivotPlotPageActions = {
        onSavePlot: onSaveModalOpen,
        onLoadPlot: onLoadModalOpen,
        onLoadData: handleLoadData,
        isLoadingData: isRefreshing || isFetching,
        showSavePlot: import.meta.env.DEV,
    };

    if (!hasPivotUrlConfig(searchParams)) {
        return (
            <Box p={8} textAlign="center">
                <VStack gap={4}>
                    <Text color="var(--color-text-muted)">
                        No pivot configuration in the URL. Configure and run a query on the pivot view first.
                    </Text>
                    <Button asChild size="sm" variant="outline" borderColor="var(--color-border)" color="var(--color-text)">
                        <Link to="/pivot">Open Pivot View</Link>
                    </Button>
                </VStack>
            </Box>
        );
    }

    const errorMessage = isError
        ? (error as { message?: string })?.message ?? 'Failed to load pivot data'
        : null;

    const showEmptyState = !isLoading && !isFetching && !hasPivotRows && !errorMessage;

    const renderMainPanel = () => {
        if (isLoading || (isFetching && !hasPivotRows)) {
            return (
                <Box display="flex" alignItems="center" justifyContent="center" flex="1" minH="320px">
                    <HStack gap={3}>
                        <Spinner size="sm" />
                        <Text color="var(--color-text-muted)">Loading pivot data…</Text>
                    </HStack>
                </Box>
            );
        }

        if (missingFilters) {
            return (
                <Box p={6} textAlign="center" borderWidth="1px" borderColor="var(--color-border)" borderRadius="md" flex="1">
                    <Text color="var(--color-text-muted)" mb={4}>
                        This pivot configuration has no filters in the URL. The pivot API requires at least one filter
                        (for example Exec or Metric) before it will return data.
                    </Text>
                    <Button asChild size="sm" variant="outline" borderColor="var(--color-border)" color="var(--color-text)">
                        <Link to={backHref}>Back to Pivot to add filters</Link>
                    </Button>
                </Box>
            );
        }

        if (errorMessage) {
            return (
                <Box p={6} textAlign="center" borderWidth="1px" borderColor="var(--color-border)" borderRadius="md" flex="1">
                    <Text color="var(--color-text-muted)" mb={4}>{errorMessage}</Text>
                    <Button asChild size="sm" variant="outline" borderColor="var(--color-border)" color="var(--color-text)">
                        <Link to={backHref}>Back to Pivot</Link>
                    </Button>
                </Box>
            );
        }

        if (showEmptyState) {
            return (
                <Box p={6} textAlign="center" borderWidth="1px" borderColor="var(--color-border)" borderRadius="md" flex="1">
                    <Text color="var(--color-text-muted)">
                        No pivot rows loaded yet. Execute the query on the pivot view, open Plot from there, or use
                        Refresh data at the bottom of the side panel.
                    </Text>
                </Box>
            );
        }

        if (hasPivotRows) {
            return (
                <Box flex="1" minH={0} opacity={isFetching && !isRefreshing ? 0.6 : 1} transition="opacity 0.15s">
                    <PivotPlotView
                        pivotData={pivotRows}
                        pivotFields={pivotFields}
                        pivotConfigKey={pivotQueryKey}
                        pageActions={pageActions}
                    />
                </Box>
            );
        }

        return null;
    };

    const showSidebarShell = !hasPivotRows || Boolean(errorMessage) || missingFilters || isLoading || showEmptyState;

    return (
        <VStack align="stretch" gap={3} h="100%" minH={0} p={4}>
            <HStack justify="space-between" flexWrap="wrap" gap={2} flexShrink={0}>
                <Heading size="md" color="var(--color-text)">Pivot Plot</Heading>
                <Button
                    asChild
                    size="sm"
                    variant="outline"
                    borderColor="var(--color-border)"
                    color="var(--color-text)"
                    _hover={{ bg: 'var(--color-bg-hover)' }}
                >
                    <Link to={backHref}>Back to Pivot</Link>
                </Button>
            </HStack>

            {showSidebarShell ? (
                <Stack
                    direction={{ base: 'column', lg: 'row' }}
                    align="stretch"
                    gap={3}
                    flex="1"
                    minH={0}
                >
                    <PlotSidebarActionPanel pageActions={pageActions} />
                    {renderMainPanel()}
                </Stack>
            ) : (
                renderMainPanel()
            )}

            <Dialog.Root open={isSaveModalOpen} onOpenChange={(details) => setSaveModalOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Save Pivot Plot</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4}>
                                <Text fontSize="sm" color="var(--color-text-muted)">
                                    Saves the pivot query, plot template, field mappings, and transforms.
                                </Text>
                                <Field.Root>
                                    <Field.Label>Name</Field.Label>
                                    <Input
                                        value={saveQueryName}
                                        onChange={(e) => setSaveQueryName(e.target.value)}
                                        placeholder="Enter a name for this plot"
                                    />
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button
                                        bg="var(--color-primary)"
                                        color="var(--color-primary-text)"
                                        _hover={{ bg: 'var(--color-primary-hover)' }}
                                        onClick={handleSaveQuery}
                                        width="100%"
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        variant="outline"
                                        color="var(--color-text)"
                                        borderColor="var(--color-border)"
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        onClick={onSaveModalClose}
                                        width="100%"
                                    >
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            <Dialog.Root open={isLoadModalOpen} onOpenChange={(details) => setLoadModalOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="lg">
                        <Dialog.Header>
                            <Dialog.Title>Load Saved Plot</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4} align="stretch">
                                {plotSavedQueries.length > 0 ? (
                                    plotSavedQueries.map((query: { _id: number; name: string; created_time: string; query: { url: string; parameters: Record<string, unknown> } }) => (
                                        <Box
                                            key={query._id}
                                            p={4}
                                            borderWidth={1}
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: 'var(--color-bg-hover)' }}
                                            onClick={() => handleLoadQuery(query)}
                                        >
                                            <HStack justify="space-between">
                                                <VStack align="start" gap={1}>
                                                    <Text fontWeight="medium">{query.name}</Text>
                                                    <Text fontSize="sm" color="var(--color-text-muted)">
                                                        Pivot Plot
                                                    </Text>
                                                    <Text fontSize="sm" color="var(--color-text-muted)">
                                                        Created: {new Date(query.created_time).toLocaleString()}
                                                    </Text>
                                                </VStack>
                                                <Button size="sm" bg="var(--color-btn-load-bg)" color="var(--color-btn-load-text)" _hover={{ bg: 'var(--color-btn-load-hover)' }}>
                                                    Load
                                                </Button>
                                            </HStack>
                                        </Box>
                                    ))
                                ) : (
                                    <Text color="var(--color-text-muted)" textAlign="center">
                                        No saved pivot plots found. Save a plot from this page to see it here.
                                    </Text>
                                )}
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </VStack>
    );
}

export default PivotPlotPage;
