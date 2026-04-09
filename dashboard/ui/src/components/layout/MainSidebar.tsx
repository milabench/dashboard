import React, { useState, useEffect, useMemo } from 'react';
import { Box, VStack, Text, Badge } from '@chakra-ui/react';
import { Link, useLocation } from 'react-router-dom';
import Cookies from 'js-cookie';
import { ColorModeButton } from "../ui/color-mode"

interface NavItem {
    label: string;
    path?: string;
    routes?: NavItem[];
    env?: string;
}


const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/', env: 'dev' },
    { label: 'Latest Executions', path: '/executions' },
    {
        label: 'Slurm',
        env: "dev",
        routes: [
            { label: 'Jobs', path: '/' },
            { label: 'Pipelines', path: '/pipelines' },
            { label: 'Dashboard', path: '/realtime' },
        ]
    },
    {
        label: 'Search',
        routes: [
            { label: 'Pivot View', path: '/pivot' },
            { label: 'Explorer', path: '/explorer' },
            { label: 'Datafile', path: '/datafile', env: 'dev' },
        ]
    },

    {
        label: 'Plot',
        routes: [
            { label: 'Scaling', path: '/scaling' },
            { label: 'Grouped View', path: '/grouped' },
        ]
    },
    {
        label: 'Manage',
        env: 'dev',
        routes: [
            { label: 'Profiles', path: '/profile' },
            { label: 'Saved Queries', path: '/saved-queries' }
        ]
    },
    {
        label: 'Baremetal',
        env: 'dev',
        routes: [
            { label: 'Nodes & Jobs', path: '/baremetal' }
        ]
    }
];

function filterNavItems(items: NavItem[], devMode: boolean): NavItem[] {
    if (devMode) return items;

    return items.reduce<NavItem[]>((acc, item) => {
        if (item.env === 'dev') return acc;

        if (item.routes) {
            const filteredRoutes = item.routes.filter(r => r.env !== 'dev');
            if (filteredRoutes.length === 0) return acc;
            acc.push({ ...item, routes: filteredRoutes });
        } else {
            acc.push(item);
        }
        return acc;
    }, []);
}

export const MainSidebar: React.FC = () => {
    const location = useLocation();
    const [currentProfile, setCurrentProfile] = useState<string>('NONE');

    useEffect(() => {
        const savedProfile = Cookies.get('scoreProfile');
        if (savedProfile) {
            setCurrentProfile(savedProfile);
        }
    }, []);

    const visibleNavItems = useMemo(() => filterNavItems(navItems, import.meta.env.DEV), []);

    const renderNavItem = (item: NavItem, isSubItem: boolean = false) => {
        if (item.routes) {
            return (
                <Box key={item.label}>
                    <Box
                        p={3}
                        borderRadius="md"
                        bg="transparent"
                        opacity={0.7}
                        borderBottom="1px solid"
                        borderColor="var(--color-sidebar-border)"
                        mb={2}
                    >
                        <Text fontSize="sm" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide">
                            {item.label}
                        </Text>
                    </Box>
                    <VStack gap={1} align="stretch" ml={4} mb={4}>
                        {item.routes.map((route) => renderNavItem(route, true))}
                    </VStack>
                </Box>
            );
        } else {
            const isActive = location.pathname === item.path;
            return (
                <Link key={item.path} to={item.path!}>
                    <Box
                        p={3}
                        borderRadius="md"
                        bg={isActive ? 'var(--color-sidebar-active)' : 'transparent'}
                        _hover={{ bg: 'var(--color-sidebar-hover)' }}
                        transition="all 0.2s"
                        ml={isSubItem ? 2 : 0}
                    >
                        <Text fontSize={isSubItem ? 'sm' : 'md'}>{item.label}</Text>
                    </Box>
                </Link>
            );
        }
    };

    return (
        <Box
            w="280px"
            h="100vh"
            bg="var(--color-sidebar-bg)"
            color="var(--color-sidebar-text)"
            p={6}
            position="fixed"
            left={0}
            top={0}
            borderRight="1px"
            borderColor="var(--color-sidebar-border)"
        >
            <Text fontSize="2xl" fontWeight="bold" mb={8} display="flex" alignItems="center" gap={2}>
                <ColorModeButton />
                Milabench
                <Badge colorScheme="blue" fontSize="sm">
                    {currentProfile}
                </Badge>
            </Text>
            <VStack gap={2} align="stretch">
                {visibleNavItems.map((item) => renderNavItem(item))}
            </VStack>
        </Box>
    );
};
