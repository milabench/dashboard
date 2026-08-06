import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    Box,
    Button,
    Heading,
    HStack,
    Spinner,
    Text,
    VStack,
} from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { getPivot } from '../../services/api';
import {
    hasPivotUrlConfig,
    parsePivotFieldsFromSearchParams,
    pivotApiSearchParams,
} from '../../utils/pivotUrlParams';
import { PivotPlotView } from './PivotPlotView';

export function PivotPlotPage() {
    usePageTitle('Pivot Plot');

    const [searchParams] = useSearchParams();
    const apiParams = useMemo(() => pivotApiSearchParams(searchParams), [searchParams]);
    const pivotFields = useMemo(
        () => parsePivotFieldsFromSearchParams(searchParams) ?? [],
        [searchParams],
    );
    const pivotQueryKey = apiParams.toString();
    const backHref = `/pivot${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

    const {
        data: pivotData,
        isLoading,
        isError,
        error,
    } = useQuery({
        queryKey: ['pivotPlot', pivotQueryKey],
        queryFn: () => getPivot(apiParams),
        enabled: hasPivotUrlConfig(searchParams),
        staleTime: 60_000,
    });

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

            {isLoading && (
                <Box display="flex" alignItems="center" justifyContent="center" flex="1" minH="320px">
                    <HStack gap={3}>
                        <Spinner size="sm" />
                        <Text color="var(--color-text-muted)">Loading pivot data…</Text>
                    </HStack>
                </Box>
            )}

            {errorMessage && !isLoading && (
                <Box p={6} textAlign="center" borderWidth="1px" borderColor="var(--color-border)" borderRadius="md">
                    <Text color="var(--color-text-muted)" mb={4}>{errorMessage}</Text>
                    <Button asChild size="sm" variant="outline" borderColor="var(--color-border)" color="var(--color-text)">
                        <Link to={backHref}>Back to Pivot</Link>
                    </Button>
                </Box>
            )}

            {!isLoading && !errorMessage && pivotData && (
                <Box flex="1" minH={0}>
                    <PivotPlotView
                        pivotData={pivotData as Record<string, unknown>[]}
                        pivotFields={pivotFields}
                        pivotConfigKey={pivotQueryKey}
                    />
                </Box>
            )}
        </VStack>
    );
}

export default PivotPlotPage;
