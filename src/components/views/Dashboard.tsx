import React from 'react';
import {
    Box,
    Heading,
    Text,
    VStack
} from '@chakra-ui/react';

interface DashboardViewProps {
    // Add props as needed
}

export const DashboardView: React.FC<DashboardViewProps> = () => {
    return (
        <Box p={6}>
            <VStack align="stretch" spacing={6}>
                <Box>
                    <Heading size="lg" mb={2}>Dashboard</Heading>
                    <Text color="gray.600">
                        Welcome to the Milabench Dashboard
                    </Text>
                </Box>

                <Box
                    bg="white"
                    p={6}
                    borderRadius="lg"
                    border="1px solid"
                    borderColor="gray.200"
                    shadow="sm"
                >
                    <Text color="gray.500" textAlign="center">
                        Dashboard content will be added here
                    </Text>
                </Box>
            </VStack>
        </Box>
    );
};
