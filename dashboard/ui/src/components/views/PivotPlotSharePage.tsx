import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Text } from '@chakra-ui/react';
import { usePageTitle } from '../../hooks/usePageTitle';
import VegaPlot from '../charts/VegaPlot';
import { isPivotEmbedMode } from '../../utils/pivotUrlParams';
import { parsePivotPlotSpecFromSearchParams } from '../../utils/pivotPlotUrlParams';

export function PivotPlotSharePage() {
    usePageTitle('Pivot Plot');

    const [searchParams] = useSearchParams();
    const embedMode = isPivotEmbedMode(searchParams);
    const spec = useMemo(
        () => parsePivotPlotSpecFromSearchParams(searchParams),
        [searchParams],
    );

    if (!spec) {
        return (
            <Box p={4}>
                <Text color="var(--color-text-muted)" fontSize="sm">
                    Missing or invalid Vega-Lite spec in URL.
                </Text>
            </Box>
        );
    }

    return (
        <Box
            w="100%"
            h={embedMode ? '100vh' : '100vh'}
            minH="100vh"
            p={embedMode ? 0 : 2}
            bg="var(--color-bg-page)"
            overflow="auto"
        >
            <VegaPlot spec={spec} height="100%" />
        </Box>
    );
}
