import React from 'react';
import {
    Box,
    Heading,
    Text,
    HStack,
    Card,
    CardBody,
    CardHeader,
    Spinner,
    Alert,
    AlertIcon,
    AlertTitle,
    AlertDescription,
    useColorModeValue,
    Badge,
    Code
} from '@chakra-ui/react';

interface LogDisplayProps {
    logType: 'stdout' | 'stderr';
    logData: string | undefined;
    isLoading: boolean;
    error: any;
    isTruncated: boolean;
    logSize: number | null;
    isJobFinished: boolean;
    logRef: React.RefObject<HTMLDivElement>;
    formatFileSize: (bytes: number) => string;
}

export const LogDisplay: React.FC<LogDisplayProps> = ({
    logType,
    logData,
    isLoading,
    error,
    isTruncated,
    logSize,
    isJobFinished,
    logRef,
    formatFileSize
}) => {
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    const displayName = logType === 'stdout' ? 'Standard Output (stdout)' : 'Standard Error (stderr)';
    const logBgColor = logType === 'stdout' ? 'gray.50' : 'red.50';
    const logTextColor = logType === 'stdout' ? 'gray.800' : 'red.800';

    return (
        <Card bg={bgColor} border="1px solid" borderColor={borderColor} flex={1}>
            <CardHeader paddingBottom="5px">
                <HStack justify="space-between">
                    <Heading size="md">{displayName}</Heading>

                    <HStack justify="space-between">
                        {isTruncated && logSize && (
                            <Badge colorScheme="orange">
                                Truncated ({formatFileSize(logSize)})
                            </Badge>
                        )}
                        <Badge colorScheme={isJobFinished ? "gray" : "green"}>
                            {isJobFinished ? "Manual refresh" : "Auto-refresh"}
                        </Badge>
                    </HStack>
                </HStack>
            </CardHeader>
            <CardBody>
                {error ? (
                    <Alert status="error">
                        <AlertIcon />
                        <AlertTitle>Error loading {logType}</AlertTitle>
                        <AlertDescription>
                            {error?.message || `Failed to load ${logType}`}
                        </AlertDescription>
                    </Alert>
                ) : isLoading ? (
                    <Box textAlign="center" py={8}>
                        <Spinner size="lg" />
                        <Text mt={4}>Loading {logType}...</Text>
                    </Box>
                ) : (
                    <Box>
                        {logData ? (
                            <Code
                                ref={logRef}
                                display="block"
                                whiteSpace="pre-wrap"
                                fontSize="sm"
                                p={4}
                                bg={logBgColor}
                                color={logTextColor}
                                borderRadius="md"
                                maxH="600px"
                                overflowY="auto"
                                fontFamily="mono"
                            >
                                {logData}
                            </Code>
                        ) : (
                            <Text color="gray.500" textAlign="center" py={8}>
                                No {logType} content available
                            </Text>
                        )}
                    </Box>
                )}
            </CardBody>
        </Card>
    );
};