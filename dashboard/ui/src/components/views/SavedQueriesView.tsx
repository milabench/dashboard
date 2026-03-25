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
            <Box p={4} bg="var(--color-bg-page)">
                <Text color="var(--color-text)">Loading saved queries...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={4} bg="var(--color-bg-page)">
                <Text color="var(--color-text)">Error loading saved queries: {error instanceof Error ? error.message : 'Unknown error'}</Text>
            </Box>
        );
    }

    return (
        <Box p={4} bg="var(--color-bg-page)">
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg" color="var(--color-text)">Saved Queries</Heading>
                    <Text color="var(--color-text-muted)">
                        {savedQueries?.length || 0} saved query{(savedQueries?.length || 0) !== 1 ? 's' : ''}
                    </Text>
                </HStack>

                {savedQueries && savedQueries.length > 0 ? (
                    <Table.ScrollArea>
                        <Table.Root>
                            <Table.Header bg="var(--color-bg-header)">
                                <Table.Row>
                                    <Table.ColumnHeader color="var(--color-text)">Name</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Type</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Created</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Actions</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {savedQueries.map((query: SavedQuery) => (
                                    <Table.Row
                                        key={query._id}
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        borderColor="var(--color-border)"
                                    >
                                        <Table.Cell>
                                            <Text fontWeight="medium" color="var(--color-text)">{query.name}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Badge bg="var(--color-primary)" color="var(--color-primary-text)">
                                                {getQueryType(query.query.url)}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text fontSize="sm" color="var(--color-text-muted)">
                                                {formatDate(query.created_time)}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <HStack gap={2}>
                                                <Tooltip content="View Query">
                                                    <IconButton
                                                        aria-label="View query"
                                                        size="sm"
                                                        variant="ghost"
                                                        color="var(--color-text)"
                                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                                        onClick={() => handleViewQuery(query)}
                                                    >
                                                        <LuExternalLink />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip content="Delete Query">
                                                    <IconButton
                                                        aria-label="Delete query"
                                                        size="sm"
                                                        variant="ghost"
                                                        color="var(--color-text)"
                                                        _hover={{ bg: 'var(--color-bg-hover)' }}
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
                        <Text color="var(--color-text-muted)" fontSize="lg">
                            No saved queries found
                        </Text>
                        <Text color="var(--color-text-muted)" mt={2} opacity={0.7}>
                            Save queries from other views to see them here
                        </Text>
                    </Box>
                )}
            </VStack>

            {/* Delete Confirmation Dialog */}
            <Dialog.Root open={isDeleteOpen} onOpenChange={(details) => setIsDeleteOpen(details.open)} role="alertdialog">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content bg="var(--color-bg-card)">
                        <Dialog.Header>
                            <Dialog.Title fontSize="lg" fontWeight="bold" color="var(--color-text)">
                                Delete Saved Query
                            </Dialog.Title>
                        </Dialog.Header>

                        <Dialog.Body>
                            <Text color="var(--color-text)">
                                Are you sure you want to delete "{queryToDelete}"? This action cannot be undone.
                            </Text>
                        </Dialog.Body>

                        <Dialog.Footer>
                            <Button
                                ref={cancelRef}
                                onClick={() => setIsDeleteOpen(false)}
                                variant="outline"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _hover={{ bg: 'var(--color-bg-hover)' }}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteConfirm}
                                ml={3}
                                bg="var(--color-btn-danger)"
                                color="var(--color-primary-text)"
                                _hover={{ bg: 'var(--color-btn-danger-hover)' }}
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