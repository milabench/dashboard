import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Spinner, Text, VStack } from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { getPivot, PIVOT_TIMEOUT_MS } from '../../services/api';
import {
    hasPivotApiFilters,
    hasPivotUrlConfig,
    isPivotEmbedMode,
    parsePivotFieldsFromSearchParams,
    pivotApiSearchParams,
    PIVOT_SAVED_QUERY_URL,
} from '../../utils/pivotUrlParams';
import { PivotTableView } from './PivotTableView';

export function PivotTableSharePage() {
    usePageTitle('Pivot Table');

    const [searchParams] = useSearchParams();
    const [triggerGeneration, setTriggerGeneration] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [executionTime, setExecutionTime] = useState<number | null>(null);

    const fields = useMemo(
        () => parsePivotFieldsFromSearchParams(searchParams) ?? [],
        [searchParams],
    );
    const apiParams = useMemo(() => pivotApiSearchParams(searchParams), [searchParams]);
    const isRelativePivot = searchParams.get('relative') === 'true';
    const embedMode = isPivotEmbedMode(searchParams);
    const canFetch = hasPivotUrlConfig(searchParams) && hasPivotApiFilters(searchParams);

    const { isError, error } = useQuery({
        queryKey: ['pivotShareTable', apiParams.toString()],
        queryFn: () => getPivot(apiParams),
        enabled: false,
    });

    useEffect(() => {
        if (canFetch) {
            setTriggerGeneration(true);
        }
    }, [canFetch, apiParams.toString()]);

    if (!hasPivotUrlConfig(searchParams)) {
        return (
            <Box p={8} textAlign="center">
                <VStack gap={4}>
                    <Text color="var(--color-text-muted)">
                        Missing pivot query parameters. Open the pivot builder to configure a query first.
                    </Text>
                    <Button asChild size="sm" variant="outline" borderColor="var(--color-border)" color="var(--color-text)">
                        <Link to={PIVOT_SAVED_QUERY_URL}>Open Pivot View</Link>
                    </Button>
                </VStack>
            </Box>
        );
    }

    const errorMessage = isError
        ? (error as { message?: string })?.message ?? 'Failed to load pivot data'
        : null;

    return (
        <Box p={embedMode ? 0 : 4} bg="var(--color-bg-page)">
            {errorMessage && (
                <Box mb={4} p={3} borderWidth={1} borderColor="var(--color-border)" borderRadius="md" bg="var(--color-bg-card)">
                    <Text color="var(--color-text)" fontSize="sm">{errorMessage}</Text>
                </Box>
            )}

            {!canFetch && (
                <Box mb={4} p={3} borderWidth={1} borderColor="var(--color-border)" borderRadius="md" bg="var(--color-bg-card)">
                    <Text color="var(--color-text-muted)" fontSize="sm">
                        Add at least one filter to run the pivot query.
                    </Text>
                </Box>
            )}

            {isGenerating && (
                <Box mb={3} display="flex" alignItems="center" gap={2}>
                    <Spinner size="sm" />
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        Running query… (timeout {PIVOT_TIMEOUT_MS / 1000}s)
                    </Text>
                </Box>
            )}

            {executionTime !== null && !isGenerating && (
                <Text mb={3} fontSize="xs" color="var(--color-text-muted)">
                    Loaded in {executionTime < 1000 ? `${executionTime.toFixed(0)}ms` : `${(executionTime / 1000).toFixed(2)}s`}
                </Text>
            )}

            <PivotTableView
                fields={fields}
                isRelativePivot={isRelativePivot}
                triggerGeneration={triggerGeneration}
                setTriggerGeneration={setTriggerGeneration}
                setIsGenerating={setIsGenerating}
                onGenerationComplete={() => {
                    setTriggerGeneration(false);
                }}
                previewEnabled={false}
                shareView
            />
        </Box>
    );
}
