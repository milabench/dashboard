import React from 'react';
import { Box, Heading, Text, VStack, Badge } from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import axios from 'axios';

interface HtmlReportViewProps {
    executionId: string | number;
    onClose: () => void;
}

export const HtmlReportView: React.FC<HtmlReportViewProps> = ({ executionId, onClose }) => {
    const [reportHtml, setReportHtml] = React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const fetchHtmlReport = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const response = await axios.get(`/html/report/${executionId}`);
                setReportHtml(response.data);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                setError(errorMessage);
                toaster.create({
                    title: 'Error fetching HTML report',
                    description: errorMessage,
                    type: 'error',
                    duration: 5000,
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchHtmlReport();
    }, [executionId]);

    if (isLoading) {
        return (
            <Box p={4}>
                <Text>Loading HTML report...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={4}>
                <Text color="red.500">Error: {error}</Text>
            </Box>
        );
    }

    return (
        <Box
            p={3}
            width="100%"
            height="100vh"
            className='metric-view'
        >
            <VStack align="stretch" gap={0} height="100%">
                <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    p={4}
                    borderBottom="1px solid"
                    borderColor="gray.200"
                >
                    <VStack align="start" gap={1}>
                        <Heading size="md">HTML Report</Heading>
                        <Badge colorScheme="blue">Iframe View</Badge>
                    </VStack>
                    <Text
                        cursor="pointer"
                        onClick={onClose}
                        fontSize="lg"
                        fontWeight="bold"
                        _hover={{ color: 'gray.600' }}
                    >
                        ×
                    </Text>
                </Box>

                <Box flex={1} position="relative">
                    <iframe
                        srcDoc={reportHtml}
                        style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',

                        }}
                        title="HTML Report"
                        sandbox="allow-same-origin allow-scripts"
                    />
                </Box>

                {/* Information box */}
                <Box
                    bg="gray.50"
                    p={3}
                    borderBottom="1px solid"
                    borderColor="gray.200"
                >
                    <Text fontSize="sm" color="gray.600">
                        Execution ID: {executionId} | Generated using /html/report/{executionId} endpoint
                    </Text>
                </Box>

            </VStack>
        </Box>
    );
};