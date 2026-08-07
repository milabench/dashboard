import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { getAllSavedQueries, getPivot, getPivotMelt, saveQuery } from '../../services/api';
import {
    hasPivotApiFilters,
    hasPivotUrlConfig,
    parsePivotFieldsFromSearchParams,
    pivotApiSearchParams,
    pivotMeltApiSearchParams,
    pivotTableQueryKeyFromSearchParams,
    PIVOT_PLOT_SAVED_QUERY_URL,
    savedQueryParametersToSearchParams,
    searchParamsToSavedQueryParameters,
} from '../../utils/pivotUrlParams';
import { chartDataFromMeltRows } from '../../utils/pivotToChartData';
import { toaster } from '../ui/toaster';
import { PivotPlotView, PlotSidebarActionPanel, type PivotPlotPageActions } from './PivotPlotView';
import { PivotShareActions } from './PivotShareActions';

export function PivotPlotPage() {
    usePageTitle('Pivot Plot');

    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [saveQueryName, setSaveQueryName] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [headerToolbar, setHeaderToolbar] = useState<ReactNode>(null);
    const [plotShareSpec, setPlotShareSpec] = useState<Record<string, unknown> | null>(null);
    const loadedSavedQueryName = searchParams.get('savedQuery')?.trim() || null;
    const { open: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose, setOpen: setSaveModalOpen } = useDisclosure();
    const { open: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose, setOpen: setLoadModalOpen } = useDisclosure();

    const meltApiParams = useMemo(() => pivotMeltApiSearchParams(searchParams), [searchParams]);
    const pivotFields = useMemo(
        () => parsePivotFieldsFromSearchParams(searchParams) ?? [],
        [searchParams],
    );

    const canSharePlot = Boolean(plotShareSpec);
    const meltQueryKey = meltApiParams.toString();
    const backHref = `/pivot${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    const canFetchPivot = hasPivotUrlConfig(searchParams) && hasPivotApiFilters(searchParams);
    const missingFilters = hasPivotUrlConfig(searchParams) && !hasPivotApiFilters(searchParams);

    const cachedMelt = queryClient.getQueryData<Awaited<ReturnType<typeof getPivotMelt>>>(['pivotPlotMelt', meltQueryKey]);
    const hasCachedMelt = (cachedMelt?.length ?? 0) > 0;

    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    const {
        data: meltData,
        isLoading,
        isFetching,
        isError,
        error,
    } = useQuery({
        queryKey: ['pivotPlotMelt', meltQueryKey],
        queryFn: () => getPivotMelt(meltApiParams),
        enabled: canFetchPivot && !hasCachedMelt,
        staleTime: 0,
        retry: 1,
    });

    const resolvedMelt = meltData ?? cachedMelt ?? null;
    const chartData = useMemo(
        () => chartDataFromMeltRows(resolvedMelt, pivotFields),
        [resolvedMelt, pivotFields],
    );
    const hasChartRows = (chartData?.long.length ?? 0) > 0;

    // Keep wide table rows in React Query so pivot → plot → pivot restores the table.
    useEffect(() => {
        if (!canFetchPivot || !resolvedMelt?.length) return;

        const tableCacheKey = pivotTableQueryKeyFromSearchParams(searchParams);
        if (queryClient.getQueryData(tableCacheKey)) return;

        void getPivot(pivotApiSearchParams(searchParams)).then((rows) => {
            if (rows.length > 0) {
                queryClient.setQueryData(tableCacheKey, rows);
            }
        });
    }, [canFetchPivot, resolvedMelt, searchParams, queryClient]);

    const errorMessage = isError
        ? (error as { message?: string })?.message ?? 'Failed to load pivot data'
        : null;

    const showEmptyState = !isLoading && !isFetching && !hasChartRows && !errorMessage;
    const showSidebarShell = !hasChartRows || Boolean(errorMessage) || missingFilters || isLoading || showEmptyState;

    const plotTopBarRight = useMemo(
        () => (
            <>
                <PivotShareActions
                    kind="plot"
                    searchParams={searchParams}
                    plotShareSpec={plotShareSpec}
                    disabled={!canSharePlot}
                    size="xs"
                />
                <Button
                    asChild
                    size="xs"
                    variant="outline"
                    borderColor="var(--color-border)"
                    color="var(--color-text)"
                    _hover={{ bg: 'var(--color-bg-hover)' }}
                    flexShrink={0}
                >
                    <Link to={backHref}>Back to Pivot</Link>
                </Button>
            </>
        ),
        [searchParams, canSharePlot, backHref, plotShareSpec],
    );

    const handleRenderToolbar = useCallback((toolbar: ReactNode) => {
        setHeaderToolbar(toolbar);
    }, []);

    useEffect(() => {
        if (showSidebarShell) {
            setHeaderToolbar(null);
        }
    }, [showSidebarShell]);

    const plotSavedQueries = useMemo(
        () => savedQueries?.filter((query: { query?: { url?: string } }) => query.query?.url === PIVOT_PLOT_SAVED_QUERY_URL) ?? [],
        [savedQueries],
    );

    useEffect(() => {
        if (isSaveModalOpen && loadedSavedQueryName && !saveQueryName.trim()) {
            setSaveQueryName(loadedSavedQueryName);
        }
    }, [isSaveModalOpen, loadedSavedQueryName, saveQueryName]);

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
            const trimmedName = saveQueryName.trim();
            const queryData = {
                url: PIVOT_PLOT_SAVED_QUERY_URL,
                parameters: {
                    ...searchParamsToSavedQueryParameters(searchParams),
                    savedQuery: trimmedName,
                    timestamp: new Date().toISOString(),
                },
            };

            await saveQuery(trimmedName, queryData);
            queryClient.invalidateQueries({ queryKey: ['savedQueries'] });

            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('savedQuery', trimmedName);
            setSearchParams(nextParams, { replace: true });

            const isUpdate = loadedSavedQueryName === trimmedName;
            toaster.create({
                title: isUpdate ? 'Plot updated' : 'Plot saved',
                description: isUpdate
                    ? `"${trimmedName}" updated with current pivot config and plot settings`
                    : `"${trimmedName}" saved with pivot config and plot settings`,
                type: 'success',
                duration: 3000,
            });

            onSaveModalClose();
            if (!loadedSavedQueryName) {
                setSaveQueryName('');
            }
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
            await queryClient.invalidateQueries({ queryKey: ['pivotPlotMelt', meltQueryKey] });
            const data = await queryClient.fetchQuery({
                queryKey: ['pivotPlotMelt', meltQueryKey],
                queryFn: () => getPivotMelt(new URLSearchParams(meltApiParams)),
                staleTime: 0,
            });
            queryClient.setQueryData(['pivotPlotMelt', meltQueryKey], data);
            const rowCount = data?.length ?? 0;
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
        const savedName = String(parameters.savedQuery ?? query.name).trim();
        if (savedName) {
            params.set('savedQuery', savedName);
        }
        navigate(`${PIVOT_PLOT_SAVED_QUERY_URL}?${params.toString()}`);
        onLoadModalClose();
        toaster.create({
            title: 'Plot loaded',
            description: `"${savedName || query.name}" loaded — use Update plot to save changes`,
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
        savePlotLabel: loadedSavedQueryName ? 'Update plot' : 'Save plot',
        loadedSavedQueryName,
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

    const renderMainPanel = () => {
        if (isLoading || (isFetching && !hasChartRows)) {
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

        if (hasChartRows && chartData) {
            return (
                <Box flex="1" minH={0} opacity={isFetching && !isRefreshing ? 0.6 : 1} transition="opacity 0.15s">
                    <PivotPlotView
                        chartData={chartData}
                        pivotFields={pivotFields}
                        pivotConfigKey={meltQueryKey}
                        pageActions={pageActions}
                        topBarRight={plotTopBarRight}
                        onRenderToolbar={handleRenderToolbar}
                        onShareableSpecChange={setPlotShareSpec}
                    />
                </Box>
            );
        }

        return null;
    };

    return (
        <VStack align="stretch" gap={3} h="100%" minH={0} p={4}>
            <HStack justify="space-between" gap={2} flexShrink={0} align="center" flexWrap="nowrap" minW={0}>
                <Heading size="md" color="var(--color-text)" flexShrink={0}>Pivot Plot</Heading>
                <HStack gap={2} flexWrap="nowrap" flexShrink={0} overflowX="auto" maxW="100%" justify="flex-end">
                    {showSidebarShell ? (
                        <>
                            <PivotShareActions
                                kind="plot"
                                searchParams={searchParams}
                                plotShareSpec={plotShareSpec}
                                disabled={!canSharePlot}
                            />
                            <Button
                                asChild
                                size="sm"
                                variant="outline"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _hover={{ bg: 'var(--color-bg-hover)' }}
                                flexShrink={0}
                            >
                                <Link to={backHref}>Back to Pivot</Link>
                            </Button>
                        </>
                    ) : (
                        headerToolbar
                    )}
                </HStack>
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
                <Box flex="1" minH={0} display="flex" flexDirection="column">
                    {renderMainPanel()}
                </Box>
            )}

            <Dialog.Root open={isSaveModalOpen} onOpenChange={(details) => setSaveModalOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>{loadedSavedQueryName ? 'Update Pivot Plot' : 'Save Pivot Plot'}</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4}>
                                <Text fontSize="sm" color="var(--color-text-muted)">
                                    {loadedSavedQueryName
                                        ? 'Updates the saved pivot query, plot template, field mappings, and transforms.'
                                        : 'Saves the pivot query, plot template, field mappings, and transforms.'}
                                </Text>
                                {loadedSavedQueryName && (
                                    <Text fontSize="sm" color="var(--color-text-muted)">
                                        Currently editing: <Text as="span" fontWeight="semibold" color="var(--color-text)">{loadedSavedQueryName}</Text>
                                    </Text>
                                )}
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
                                        {loadedSavedQueryName ? 'Update' : 'Save'}
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
