import React, { useState, useRef } from 'react';
import { Tooltip } from "../../components/ui/tooltip"
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Table,
    Badge,
    IconButton,
    Dialog,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LuTrash2, LuExternalLink } from 'react-icons/lu';
import { getAllSavedQueries, deleteSavedQuery } from '../../services/api';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';

interface SavedQuery {
    _id: number;
    name: string;
    query: {
        url: string;
        parameters: Record<string, any>;
    };
    created_time: string;
}

const SavedQueriesView: React.FC = () => {
    usePageTitle('Saved Queries');

    // Theme-aware colors - all hooks must be called at the top level
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const buttonHoverBg = useColorModeValue('gray.100', 'gray.700');
    const redButtonBg = useColorModeValue('red.500', 'red.600');
    const redButtonHoverBg = useColorModeValue('red.600', 'red.500');
    const blueButtonBg = useColorModeValue('blue.500', 'blue.600');
    const blueButtonHoverBg = useColorModeValue('blue.600', 'blue.500');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.700');
    const headerBg = useColorModeValue('gray.100', 'gray.800');
    const headerTextColor = useColorModeValue('gray.900', 'gray.100');
    const badgeBg = useColorModeValue('blue.100', 'blue.900');
    const badgeTextColor = useColorModeValue('blue.800', 'blue.100');
    const errorTextColor = useColorModeValue('red.500', 'red.400');

    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [queryToDelete, setQueryToDelete] = useState<string | null>(null);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const cancelRef = useRef<HTMLButtonElement>(null);

    // Fetch all saved queries
    const { data: savedQueries, isLoading, error } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    const handleDeleteClick = (queryName: string) => {
        setQueryToDelete(queryName);
        setIsDeleteOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!queryToDelete) return;

        try {
            await deleteSavedQuery(queryToDelete);
            toaster.create({
                title: 'Query deleted',
                description: `"${queryToDelete}" has been deleted successfully`,
                type: 'success',
                duration: 3000,
            });
            queryClient.invalidateQueries({ queryKey: ['savedQueries'] });
        } catch (error) {
            toaster.create({
                title: 'Error deleting query',
                description: error instanceof Error ? error.message : 'Failed to delete query',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsDeleteOpen(false);
            setQueryToDelete(null);
        }
    };

    const handleViewQuery = (query: SavedQuery) => {
        const { url, parameters } = query.query;

        // Build URL with parameters
        const params = new URLSearchParams();
        Object.entries(parameters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                params.set(key, String(value));
            }
        });

        const fullUrl = `${url}?${params.toString()}`;
        navigate(fullUrl);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const getQueryType = (url: string) => {
        switch (url) {
            case '/grouped':
                return 'Grouped View';
            case '/pivot':
                return 'Pivot View';
            case '/explorer':
                return 'Explorer View';
            default:
                return 'Custom View';
        }
    };

    if (isLoading) {
        return (
            <Box p={4} bg={pageBg}>
                <Text color={textColor}>Loading saved queries...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={4} bg={pageBg}>
                <Text color={errorTextColor}>Error loading saved queries: {error instanceof Error ? error.message : 'Unknown error'}</Text>
            </Box>
        );
    }

    return (
        <Box p={4} bg={pageBg}>
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg" color={textColor}>Saved Queries</Heading>
                    <Text color={mutedTextColor}>
                        {savedQueries?.length || 0} saved query{(savedQueries?.length || 0) !== 1 ? 's' : ''}
                    </Text>
                </HStack>

                {savedQueries && savedQueries.length > 0 ? (
                    <Table.ScrollArea>
                        <Table.Root>
                            <Table.Header bg={headerBg}>
                                <Table.Row>
                                    <Table.ColumnHeader color={headerTextColor}>Name</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Type</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Created</Table.ColumnHeader>
                                    <Table.ColumnHeader color={headerTextColor}>Actions</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {savedQueries.map((query: SavedQuery) => (
                                    <Table.Row
                                        key={query._id}
                                        _hover={{ bg: rowHoverBg }}
                                        borderColor={borderColor}
                                    >
                                        <Table.Cell>
                                            <Text fontWeight="medium" color={textColor}>{query.name}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge bg={badgeBg} color={badgeTextColor}>
                                                {getQueryType(query.query.url)}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text fontSize="sm" color={mutedTextColor}>
                                                {formatDate(query.created_time)}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <HStack gap={2}>
                                                <Tooltip label="View Query">
                                                    <IconButton
                                                        aria-label="View query"
                                                        size="sm"
                                                        variant="ghost"
                                                        color={textColor}
                                                        _hover={{ bg: buttonHoverBg }}
                                                        onClick={() => handleViewQuery(query)}
                                                    >
                                                        <LuExternalLink />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip label="Delete Query">
                                                    <IconButton
                                                        aria-label="Delete query"
                                                        size="sm"
                                                        variant="ghost"
                                                        color={textColor}
                                                        _hover={{ bg: buttonHoverBg }}
                                                        onClick={() => handleDeleteClick(query.name)}
                                                    >
                                                        <LuTrash2 />
                                                    </IconButton>
                                                </Tooltip>
                                            </HStack>
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    </Table.ScrollArea>
                ) : (
                    <Box textAlign="center" py={8}>
                        <Text color={mutedTextColor} fontSize="lg">
                            No saved queries found
                        </Text>
                        <Text color={mutedTextColor} mt={2} opacity={0.7}>
                            Save queries from other views to see them here
                        </Text>
                    </Box>
                )}
            </VStack>

            {/* Delete Confirmation Dialog */}
            <Dialog.Root open={isDeleteOpen} onOpenChange={(details) => setIsDeleteOpen(details.open)} role="alertdialog">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content bg={cardBg}>
                        <Dialog.Header>
                            <Dialog.Title fontSize="lg" fontWeight="bold" color={textColor}>
                                Delete Saved Query
                            </Dialog.Title>
                        </Dialog.Header>

                        <Dialog.Body>
                            <Text color={textColor}>
                                Are you sure you want to delete "{queryToDelete}"? This action cannot be undone.
                            </Text>
                        </Dialog.Body>

                        <Dialog.Footer>
                            <Button
                                ref={cancelRef}
                                onClick={() => setIsDeleteOpen(false)}
                                variant="outline"
                                borderColor={borderColor}
                                color={textColor}
                                _hover={{ bg: buttonHoverBg }}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteConfirm}
                                ml={3}
                                bg={redButtonBg}
                                color="white"
                                _hover={{ bg: redButtonHoverBg }}
                            >
                                Delete
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};

export default SavedQueriesView;