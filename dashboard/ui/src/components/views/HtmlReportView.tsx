import React from 'react';
import { Box, Heading, Text, VStack, Badge } from '@chakra-ui/react';
import { toaster } from '../ui/toaster-store';
import axios from 'axios';

interface HtmlReportViewProps {
    executionId: string | number;
    shareToken?: string;
    onClose: () => void;
}

export const HtmlReportView: React.FC<HtmlReportViewProps> = ({ executionId, shareToken, onClose }) => {
    const [reportHtml, setReportHtml] = React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const endpoint = shareToken
        ? `/html/report/share/${shareToken}`
        : `/html/report/${executionId}`;

    React.useEffect(() => {
        const fetchHtmlReport = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const response = await axios.get(endpoint);
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
    }, [endpoint]);

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
                <Text color="var(--color-text-danger)">Error: {error}</Text>
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
                    borderColor="var(--color-border)"
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
                        _hover={{ color: 'var(--color-text-muted)' }}
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
                    bg="var(--color-bg-stripe)"
                    p={3}
                    borderBottom="1px solid"
                    borderColor="var(--color-border)"
                >
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        Execution ID: {executionId} | Generated using {endpoint} endpoint
                    </Text>
                </Box>

            </VStack>
        </Box>
    );
};