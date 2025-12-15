import React, { useState, useRef } from 'react';
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
    Tooltip,
    Dialog,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LuTrash2, LuExternalLink } from 'react-icons/lu';
import { getAllSavedQueries, deleteSavedQuery } from '../../services/api';
import { toaster } from '../ui/toaster';

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
            <Box p={4}>
                <Text>Loading saved queries...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={4}>
                <Text color="red.500">Error loading saved queries: {error instanceof Error ? error.message : 'Unknown error'}</Text>
            </Box>
        );
    }

    return (
        <Box p={4}>
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg">Saved Queries</Heading>
                    <Text color="gray.600">
                        {savedQueries?.length || 0} saved query{(savedQueries?.length || 0) !== 1 ? 's' : ''}
                    </Text>
                </HStack>

                {savedQueries && savedQueries.length > 0 ? (
                    <Table.ScrollArea>
                        <Table.Root variant="simple">
                            <Table.Header>
                                <Table.Row>
                                    <Table.ColumnHeader>Name</Table.ColumnHeader>
                                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                                    <Table.ColumnHeader>Created</Table.ColumnHeader>
                                    <Table.ColumnHeader>Actions</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {savedQueries.map((query: SavedQuery) => (
                                    <Table.Row key={query._id}>
                                        <Table.Cell>
                                            <Text fontWeight="medium">{query.name}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge colorScheme="blue">
                                                {getQueryType(query.query.url)}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text fontSize="sm" color="gray.600">
                                                {formatDate(query.created_time)}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <HStack gap={2}>
                                                <Tooltip label="View Query">
                                                    <IconButton
                                                        aria-label="View query"
                                                        icon={<LuExternalLink />}
                                                        size="sm"
                                                        colorScheme="blue"
                                                        variant="ghost"
                                                        onClick={() => handleViewQuery(query)}
                                                    />
                                                </Tooltip>
                                                <Tooltip label="Delete Query">
                                                    <IconButton
                                                        aria-label="Delete query"
                                                        icon={<LuTrash2 />}
                                                        size="sm"
                                                        colorScheme="red"
                                                        variant="ghost"
                                                        onClick={() => handleDeleteClick(query.name)}
                                                    />
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
                        <Text color="gray.500" fontSize="lg">
                            No saved queries found
                        </Text>
                        <Text color="gray.400" mt={2}>
                            Save queries from other views to see them here
                        </Text>
                    </Box>
                )}
            </VStack>

            {/* Delete Confirmation Dialog */}
            <Dialog.Root open={isDeleteOpen} onOpenChange={(details) => setIsDeleteOpen(details.open)} role="alertdialog">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title fontSize="lg" fontWeight="bold">
                                Delete Saved Query
                            </Dialog.Title>
                        </Dialog.Header>

                        <Dialog.Body>
                            Are you sure you want to delete "{queryToDelete}"? This action cannot be undone.
                        </Dialog.Body>

                        <Dialog.Footer>
                            <Button ref={cancelRef} onClick={() => setIsDeleteOpen(false)}>
                                Cancel
                            </Button>
                            <Button colorScheme="red" onClick={handleDeleteConfirm} ml={3}>
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