import { Box, Heading, Center, Text } from '@chakra-ui/react';
import type { Pack } from '../../services/types';

interface MetricsViewProps {
    selectedPack: Pack;
    executionId: number;
}

export const MetricsView = ({ selectedPack, executionId }: MetricsViewProps) => {
    const getMetricsUrl = (pack: Pack) => {
        // If _id is 0, it means we're in group view, so use the pack name
        // Otherwise use the pack ID
        const packIdentifier = pack._id === 0 ? pack.name : pack._id;
        return `/html/exec/${executionId}/packs/${packIdentifier}/metrics`;
    };

    return (
        <Box
            p={3}
            width="100%"
            height="100vh"
            className='metric-view'
        >
            <Heading as='h2' size='lg'>Metrics</Heading>
            {selectedPack ? (
                <iframe
                    src={getMetricsUrl(selectedPack)}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        display: 'block',
                    }}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                />
            ) : (
                <Center h="100%" p={4}>
                    <Text color="gray.500">Select a pack to view metrics</Text>
                </Center>
            )}
        </Box>
    );
};