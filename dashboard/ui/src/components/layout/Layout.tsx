import React from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { MainSidebar } from './MainSidebar';

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    const location = useLocation();
    const isEmbedView = location.pathname.startsWith('/pivot/view/');

    if (isEmbedView) {
        return (
            <Box w="100%" bg="var(--color-bg-page)" className="layout">
                {children}
            </Box>
        );
    }

    return (
        <Box h="100vh" w="100vw" bg="var(--color-bg-page)" className="layout">
            <MainSidebar />
            <Box
                className="main-content"
                ml="280px"
                h="100vh"
                transition="margin-left 0.3s ease"
                bg="var(--color-bg-page)"
            >
                {children}
            </Box>
        </Box>
    );
};
