import React from 'react';
import { Box } from '@chakra-ui/react';
import { MainSidebar } from './MainSidebar';
import { useColorModeValue } from '../ui/color-mode';

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    // Theme-aware background colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');

    return (
        <Box h="100vh" w="100vw" bg={pageBg} className="layout">
            <MainSidebar />
            <Box
                className="main-content"
                ml="280px"
                h="100vh"
                transition="margin-left 0.3s ease"
                bg={pageBg}
            >
                {children}
            </Box>
        </Box>
    );
};