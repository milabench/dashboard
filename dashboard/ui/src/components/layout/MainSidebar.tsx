import React, { useState } from 'react';
import { Box, HStack, VStack, Text, Badge, Spacer } from '@chakra-ui/react';
import { Link, useLocation } from 'react-router-dom';
import Cookies from 'js-cookie';
import { ColorModeButton } from "../ui/color-mode"
import { useViewMode, usePreview, type ViewMode, type DbTarget } from '../../hooks/useViewMode';

interface NavItem {
    label: string;
    path?: string;
    routes?: NavItem[];
    external?: boolean;
}

// Each mode gets its own nav list — switching modes swaps the whole
// sidebar, rather than filtering one merged list, so it reads as three
// separate apps sharing a shell.
const publicNavItems: NavItem[] = [
    { label: 'Latest Executions', path: '/executions' },
    {
        label: 'Search',
        routes: [
            { label: 'Pivot View', path: '/pivot' },
            { label: 'Explorer', path: '/explorer' },
        ]
    },
    {
        label: 'Plot',
        routes: [
            { label: 'Scaling', path: '/scaling' },
            { label: 'GPU Comparison', path: '/gpu-comparison' },
            { label: 'Benchmarks', path: '/bench-history' },
        ]
    },
    {
        label: 'Manage',
        routes: [
            { label: 'Run Groups', path: '/groups/hardware' },
            { label: 'Profiles', path: '/profile' },
            { label: 'Saved Queries', path: '/saved-queries' },
            { label: 'Push Results', path: '/push' },
        ]
    },
];

const experimentalNavItems: NavItem[] = [
    { label: 'Health', path: '/health' },
    { label: 'Scaling Live', path: '/scaling-live' },
    { label: 'Benchmark Docs', path: '/bench-doc' },
    { label: 'Timeline', path: '/timeline' },
    { label: 'Breakdown', path: '/breakdown' },
];

const devNavItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard' },
    {
        label: 'Experimental',
        routes: experimentalNavItems,
    },
    {
        label: 'Slurm',
        routes: [
            { label: 'Jobs', path: '/jobs' },
            { label: 'Submit Job', path: '/jobs/submit' },
            { label: 'Scheduled Jobs', path: '/scheduled' },
            { label: 'Pipelines', path: '/pipelines' },
            { label: 'Dashboard', path: '/realtime' },
        ]
    },
    { label: 'Datafile', path: '/datafile' },
    {
        label: 'Baremetal',
        routes: [
            { label: 'Nodes & Jobs', path: '/baremetal' }
        ]
    },
];

const previewNavItems: NavItem[] = [
    {
        label: 'Experimental',
        routes: experimentalNavItems,
    },
];

const adminNavItems: NavItem[] = [
    { label: 'Database Sync', path: '/db-sync' },
    { label: 'Push Keys', path: '/push-keys' },
    { label: 'Run Visibility', path: '/run-visibility' },
    { label: 'Data Invalidation', path: '/invalidation' },
    { label: 'Admin Tools', path: '/admin-tools' },
    { label: 'Feature Flags', path: '/feature-flags' },
    { label: 'Deploy', path: '/deploy' },
];

function navItemsForMode(mode: ViewMode): NavItem[] {
    switch (mode) {
        case 'dev': return devNavItems;
        case 'admin': return adminNavItems;
        case 'preview': return previewNavItems;
        default: return publicNavItems;
    }
}

const DEV_MODE_LABELS: Record<Exclude<ViewMode, 'preview'>, string> = {
    public: 'Public',
    dev: 'Dev',
    admin: 'Admin',
};

const ModeToggle: React.FC<{ modes: ViewMode[]; labels: Record<string, string> }> = ({ modes, labels }) => {
    const { mode, setMode } = useViewMode();

    return (
        <HStack gap={0} borderRadius="md" borderWidth={1} borderColor="var(--color-sidebar-border)" overflow="hidden" mb={4}>
            {modes.map((m) => (
                <Box
                    key={m}
                    as="button"
                    flex={1}
                    py={1}
                    fontSize="xs"
                    fontWeight="semibold"
                    textAlign="center"
                    cursor="pointer"
                    bg={mode === m ? 'var(--color-sidebar-active)' : 'transparent'}
                    _hover={{ bg: 'var(--color-sidebar-hover)' }}
                    onClick={() => setMode(m)}
                >
                    {labels[m]}
                </Box>
            ))}
        </HStack>
    );
};

const DB_TARGET_LABELS: Record<DbTarget, string> = { dev: 'DEV db', prod: 'PROD db' };

const DbTargetToggle: React.FC = () => {
    const { dbTarget, setDbTarget } = useViewMode();

    return (
        <HStack
            gap={0}
            borderRadius="md"
            borderWidth={2}
            borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-sidebar-border)'}
            overflow="hidden"
            mb={4}
        >
            {(['dev', 'prod'] as DbTarget[]).map((t) => (
                <Box
                    key={t}
                    as="button"
                    flex={1}
                    py={1}
                    fontSize="xs"
                    fontWeight="bold"
                    textAlign="center"
                    cursor="pointer"
                    bg={dbTarget === t ? (t === 'prod' ? 'red.500' : 'var(--color-sidebar-active)') : 'transparent'}
                    color={dbTarget === t && t === 'prod' ? 'white' : undefined}
                    _hover={{ bg: dbTarget === t ? undefined : 'var(--color-sidebar-hover)' }}
                    onClick={() => setDbTarget(t)}
                >
                    {DB_TARGET_LABELS[t]}
                </Box>
            ))}
        </HStack>
    );
};

export const MainSidebar: React.FC = () => {
    const location = useLocation();
    const [currentProfile] = useState<string>(() => Cookies.get('scoreProfile') || 'NONE');
    const { mode, devMode, setMode } = useViewMode();
    const { previewAvailable, previewUnlocked, lockPreview } = usePreview();

    const visibleNavItems = navItemsForMode(mode);

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
        } else if (item.external) {
            return (
                <a key={item.path} href={item.path} target="_blank" rel="noopener noreferrer">
                    <Box
                        p={3}
                        borderRadius="md"
                        bg="transparent"
                        _hover={{ bg: 'var(--color-sidebar-hover)' }}
                        transition="all 0.2s"
                        ml={isSubItem ? 2 : 0}
                    >
                        <Text fontSize={isSubItem ? 'sm' : 'md'}>{item.label} ↗</Text>
                    </Box>
                </a>
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
            display="flex"
            flexDirection="column"
        >
            <Box mb={devMode ? 2 : 6} textAlign="center">
                <Link to="/" style={{ textDecoration: 'none' }}>
                    <img
                        src="/name.svg"
                        alt="Milabench"
                        style={{ height: '82px', filter: "invert(1)", margin: '0 auto' }}
                    />
                </Link>
            </Box>
            {devMode && (
                <ModeToggle
                    modes={['public', 'dev', 'admin']}
                    labels={DEV_MODE_LABELS}
                />
            )}
            {!devMode && previewAvailable && previewUnlocked && (
                <ModeToggle
                    modes={['public', 'preview']}
                    labels={{ public: 'Public', preview: 'Preview' }}
                />
            )}
            {devMode && mode === 'admin' && <DbTargetToggle />}
            {!devMode && previewUnlocked && mode === 'preview' && (
                <Box mb={4}>
                    <Box
                        as="button"
                        w="100%"
                        py={1}
                        fontSize="xs"
                        borderRadius="md"
                        borderWidth={1}
                        borderColor="var(--color-sidebar-border)"
                        _hover={{ bg: 'var(--color-sidebar-hover)' }}
                        onClick={() => {
                            lockPreview();
                            setMode('public');
                        }}
                    >
                        Lock preview
                    </Box>
                </Box>
            )}
            <VStack gap={2} align="stretch" flex={1} overflowY="auto">
                {visibleNavItems.map((item) => renderNavItem(item))}
            </VStack>
            <HStack
                gap={2}
                pt={4}
                borderTop="1px solid"
                borderColor="var(--color-sidebar-border)"
                justify="space-between"
                align="center"
            >
                <Badge colorScheme="blue" fontSize="sm">
                    {currentProfile}
                </Badge>
                <Spacer />
                <ColorModeButton />
            </HStack>
        </Box>
    );
};
