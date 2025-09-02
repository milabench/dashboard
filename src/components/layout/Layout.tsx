import { Box } from '@chakra-ui/react';
import { MainSidebar } from './MainSidebar';

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    return (
        <Box h="100vh" w="100vw" bg="gray.50" className="layout">
            <MainSidebar />
            <Box
                className="main-content"
                ml="280px"
                h="100vh"
                transition="margin-left 0.3s ease"
            >
                {children}
            </Box>
        </Box>
    );
};