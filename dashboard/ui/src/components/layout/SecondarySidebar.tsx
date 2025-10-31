import { Box, VStack, Text, IconButton } from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';

interface SecondarySidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export const SecondarySidebar = ({ isOpen, onClose, title, children }: SecondarySidebarProps) => {
    return (
        <Box
            w="320px"
            h="100vh"
            bg="gray.800"
            color="white"
            p={6}
            position="fixed"
            left={isOpen ? '280px' : '-320px'}
            top={0}
            transition="left 0.3s ease"
            borderRight="1px"
            borderColor="gray.700"
            zIndex={1}
        >
            <Box position="relative">
                <IconButton
                    aria-label="Close sidebar"
                    position="absolute"
                    right={0}
                    top={0}
                    onClick={onClose}
                    variant="ghost"
                    colorScheme="whiteAlpha"
                >
                    <CloseIcon />
                </IconButton>
                <Text fontSize="xl" fontWeight="bold" mb={6}>
                    {title}
                </Text>
            </Box>
            <VStack gap={4} align="stretch" overflowY="auto" h="calc(100vh - 100px)">
                {children}
            </VStack>
        </Box>
    );
};