import { Box, Text } from '@chakra-ui/react';
import { useHealth } from '../../contexts/HealthContext';

export const MaintenanceBanner: React.FC = () => {
    const { isBackendOnline } = useHealth();

    if (isBackendOnline) return null;

    return (
        <Box
            position="fixed"
            top="0"
            left="0"
            right="0"
            zIndex="banner"
            bg="orange.500"
            color="white"
            textAlign="center"
            py="2"
            px="4"
            fontSize="sm"
            fontWeight="medium"
        >
            <Text>
                Backend is currently unreachable. Some features may be unavailable.
            </Text>
        </Box>
    );
};
