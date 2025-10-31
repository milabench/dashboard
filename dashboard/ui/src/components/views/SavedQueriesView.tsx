import React, { useState, useRef } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    useToast,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Badge,
    IconButton,
    Tooltip,
    AlertDialog,
    AlertDialogBody,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogContent,
    AlertDialogOverlay,
    useDisclosure,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DeleteIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import { getAllSavedQueries, deleteSavedQuery } from '../../services/api';

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

    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [queryToDelete, setQueryToDelete] = useState<string | null>(null);
    const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
    const cancelRef = useRef<HTMLButtonElement>(null);

    // Fetch all saved queries
    const { data: savedQueries, isLoading, error } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    const handleDeleteClick = (queryName: string) => {
        setQueryToDelete(queryName);
        onDeleteOpen();
    };

    const handleDeleteConfirm = async () => {
        if (!queryToDelete) return;

        try {
            await deleteSavedQuery(queryToDelete);
            toast({
                title: 'Query deleted',
                description: `"${queryToDelete}" has been deleted successfully`,
                status: 'success',
                duration: 3000,
            });
            queryClient.invalidateQueries({ queryKey: ['savedQueries'] });
        } catch (error) {
            toast({
                title: 'Error deleting query',
                description: error instanceof Error ? error.message : 'Failed to delete query',
                status: 'error',
                duration: 5000,
            });
        } finally {
            onDeleteClose();
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
            <VStack align="stretch" spacing={6}>
                <HStack justify="space-between">
                    <Heading size="lg">Saved Queries</Heading>
                    <Text color="gray.600">
                        {savedQueries?.length || 0} saved query{(savedQueries?.length || 0) !== 1 ? 's' : ''}
                    </Text>
                </HStack>

                {savedQueries && savedQueries.length > 0 ? (
                    <Box overflowX="auto">
                        <Table variant="simple">
                            <Thead>
                                <Tr>
                                    <Th>Name</Th>
                                    <Th>Type</Th>
                                    <Th>Created</Th>
                                    <Th>Actions</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {savedQueries.map((query: SavedQuery) => (
                                    <Tr key={query._id}>
                                        <Td>
                                            <Text fontWeight="medium">{query.name}</Text>
                                        </Td>
                                        <Td>
                                            <Badge colorScheme="blue">
                                                {getQueryType(query.query.url)}
                                            </Badge>
                                        </Td>
                                        <Td>
                                            <Text fontSize="sm" color="gray.600">
                                                {formatDate(query.created_time)}
                                            </Text>
                                        </Td>
                                        <Td>
                                            <HStack spacing={2}>
                                                <Tooltip label="View Query">
                                                    <IconButton
                                                        aria-label="View query"
                                                        icon={<ExternalLinkIcon />}
                                                        size="sm"
                                                        colorScheme="blue"
                                                        variant="ghost"
                                                        onClick={() => handleViewQuery(query)}
                                                    />
                                                </Tooltip>
                                                <Tooltip label="Delete Query">
                                                    <IconButton
                                                        aria-label="Delete query"
                                                        icon={<DeleteIcon />}
                                                        size="sm"
                                                        colorScheme="red"
                                                        variant="ghost"
                                                        onClick={() => handleDeleteClick(query.name)}
                                                    />
                                                </Tooltip>
                                            </HStack>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </Box>
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
            <AlertDialog isOpen={isDeleteOpen} onClose={onDeleteClose} leastDestructiveRef={cancelRef}>
                <AlertDialogOverlay>
                    <AlertDialogContent>
                        <AlertDialogHeader fontSize="lg" fontWeight="bold">
                            Delete Saved Query
                        </AlertDialogHeader>

                        <AlertDialogBody>
                            Are you sure you want to delete "{queryToDelete}"? This action cannot be undone.
                        </AlertDialogBody>

                        <AlertDialogFooter>
                            <Button ref={cancelRef} onClick={onDeleteClose}>
                                Cancel
                            </Button>
                            <Button colorScheme="red" onClick={handleDeleteConfirm} ml={3}>
                                Delete
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialogOverlay>
            </AlertDialog>
        </Box>
    );
};

export default SavedQueriesView;