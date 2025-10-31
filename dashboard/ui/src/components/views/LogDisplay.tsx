import React, { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
    jrJobId: string;
    isJobFinished: boolean;
    formatFileSize: (bytes: number) => string;
    fetchLogData: (jrJobId: string, start?: number, end?: number) => Promise<string>;
    getSlurmJobLogSize: (jrJobId: string) => Promise<number>;
}

export const LogDisplay: React.FC<LogDisplayProps> = ({
    logType,
    jrJobId,
    isJobFinished,
    formatFileSize,
    fetchLogData,
    getSlurmJobLogSize
}) => {
    const bgColor = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');

    // Internal state for truncation and log size
    const [isTruncated, setIsTruncated] = useState(false);
    const [logSize, setLogSize] = useState<number | null>(null);
    // Track previous job finished state to detect when job just finished
    const [prevIsJobFinished, setPrevIsJobFinished] = useState(isJobFinished);
    const logRef = useRef<HTMLDivElement>(null);

    const displayName = logType === 'stdout' ? 'Standard Output (stdout)' : 'Standard Error (stderr)';
    const logBgColor = logType === 'stdout' ? 'gray.50' : 'red.50';
    const logTextColor = logType === 'stdout' ? 'gray.800' : 'red.800';

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const CHUNK_SIZE = 500 * 1024;

    // Custom function to load logs with chunked loading for large files
    const loadLogsChunked = async (jrJobId: string): Promise<string> => {
        try {
            // Get log size first
            const logSize = await getSlurmJobLogSize(jrJobId);
            setLogSize(logSize);

            // If size is small enough, load normally
            if (logSize <= MAX_SIZE) {
                setIsTruncated(false);
                return await fetchLogData(jrJobId);
            }

            // For large files, load only the last 5MB to avoid browser performance issues
            const start = Math.max(0, logSize - CHUNK_SIZE);
            const end = logSize * 2;
            setIsTruncated(true);

            return await fetchLogData(jrJobId, start, end);
        } catch (error) {
            throw error;
        }
    };

    // Get log data with auto-refresh every 30 seconds
    const {
        data: logData,
        isLoading,
        error,
        refetch
    } = useQuery({
        queryKey: [`slurm-job-${logType}-full`, jrJobId],
        queryFn: () => loadLogsChunked(jrJobId),
        enabled: !!jrJobId,
        refetchInterval: isJobFinished ? false : 30000, // Disable refresh if job is finished
        refetchIntervalInBackground: true,
    });

    // Effect to perform final refresh when job finishes
    useEffect(() => {
        // If job just finished (changed from false to true), do a final refresh
        if (!prevIsJobFinished && isJobFinished) {
            console.log(`Job finished, performing final ${logType} refresh`);
            // Wait a short delay to ensure any final output is written
            setTimeout(() => {
                refetch();
            }, 2000); // 2 second delay to allow final output to be written
        }
        setPrevIsJobFinished(isJobFinished);
    }, [isJobFinished, prevIsJobFinished, refetch, logType]);

    // Auto-scroll effect
    useEffect(() => {
        if (logData && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logData]);

    return (
        <Card bg={bgColor} border="1px solid" borderColor={borderColor} className="logview" maxH="100%" flex={1}>
            <CardHeader paddingBottom="5px">
                <HStack justify="space-between">
                    <Heading size="md">{displayName}</Heading>

                    <HStack justify="space-between">
                        {isTruncated && logSize && (
                            <Badge colorScheme="orange">
                                Truncated ({formatFileSize(CHUNK_SIZE)}/{formatFileSize(logSize)})
                            </Badge>
                        )}
                        <Badge colorScheme={isJobFinished ? "gray" : "green"}>
                            {isJobFinished ? "Manual refresh" : "Auto-refresh"}
                        </Badge>
                    </HStack>
                </HStack>
            </CardHeader>
            <CardBody h="100%" maxH="100%">
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
                    <Box h="100%" maxH="100%" >
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
                                overflowY="auto"
                                fontFamily="mono"
                                h="100%"
                                maxH="calc(100vh - 18em)"
                                onCopy={(event) => {
                                    event.clipboardData.setData("text/plain", window.getSelection().toString());
                                    event.preventDefault();
                                  }}
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