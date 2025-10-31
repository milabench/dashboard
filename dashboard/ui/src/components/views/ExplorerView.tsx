import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Input,
    Select,
    useToast,
    useDisclosure,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    FormControl,
    FormLabel,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    IconButton,
    Tooltip,
} from '@chakra-ui/react';
import { getAllSavedQueries, saveQuery } from '../../services/api';
import type { Execution } from '../../services/types';
import { Loading } from '../common/Loading';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SearchIcon, AddIcon, DeleteIcon, RepeatIcon } from '@chakra-ui/icons';

interface Filter {
    field: string;
    operator: string;
    value: string | string[];
}

// Helper function to format field names for display
const formatFieldName = (field: string) => {
    // Handle default fields with special names
    if (field === 'id') return 'Exec:id';
    if (field === 'run') return 'Exec:run';

    // Handle fields with "as" keyword
    const parts = field.split(' as ');
    const baseField = parts[0];

    // Split the base field into table and path
    const [table, path] = baseField.split(':');

    // If there's an alias, use it
    if (parts.length > 1) {
        return parts[1];
    }

    // Otherwise format the field name nicely
    return `${table}.${path}`;
};

// Helper function to ensure field has correct format
const ensureFieldFormat = (field: string) => {
    // If field already has a colon, return as is
    if (field.includes(':')) {
        return field;
    }

    // If field has "as" keyword, handle it
    const parts = field.split(' as ');
    const baseField = parts[0];

    // Add default table prefix if missing
    if (!baseField.includes(':')) {
        const formattedField = `Exec:${baseField}`;
        return parts.length > 1 ? `${formattedField} as ${parts[1]}` : formattedField;
    }

    return field;
};

export const ExplorerView = () => {
    usePageTitle('Explorer');

    const toast = useToast();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [filters, setFilters] = useState<Filter[]>([]);
    const [availableFields, setAvailableFields] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [quickFilters, setQuickFilters] = useState({
        gpu: [] as string[],
        pytorch: [] as string[],
        milabench: [] as string[],
    });

    // Save/Load modal state
    const { isOpen: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose } = useDisclosure();
    const { isOpen: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose } = useDisclosure();
    const [saveQueryName, setSaveQueryName] = useState<string>('');

    // Initialize filters from URL parameters
    useEffect(() => {
        const filtersParam = searchParams.get('filters');
        if (filtersParam) {
            try {
                const decodedFilters = JSON.parse(atob(filtersParam));
                setFilters(decodedFilters);
                // Trigger search with decoded filters
                handleSearchWithFilters(decodedFilters);
            } catch (error) {
                toast({
                    title: 'Invalid URL parameters',
                    description: 'Could not parse filters from URL',
                    status: 'error',
                    duration: 5000,
                });
            }
        }
    }, []);

    // Fetch available fields
    useQuery({
        queryKey: ['explorerFields'],
        queryFn: async () => {
            const response = await axios.get('/api/keys');
            setAvailableFields(response.data);
            return response.data;
        },
    });

    // Fetch saved queries for load functionality
    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    // Fetch executions based on filters
    const { data: executions, isLoading: isQueryLoading, refetch } = useQuery({
        queryKey: ['explorerExecutions', filters],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters.length > 0) {
                params.append('filters', btoa(JSON.stringify(filters)));
            }
            const response = await axios.get(`/api/exec/explore?${params.toString()}`);
            return response.data;
        },
        enabled: filters.length > 0,
    });

    // Fetch quick filter options
    const { data: gpuList } = useQuery({
        queryKey: ['gpuList'],
        queryFn: async () => {
            const response = await axios.get('/api/gpu/list');
            return response.data;
        },
    });

    const { data: pytorchList } = useQuery({
        queryKey: ['pytorchList'],
        queryFn: async () => {
            const response = await axios.get('/api/pytorch/list');
            return response.data;
        },
    });

    const { data: milabenchList } = useQuery({
        queryKey: ['milabenchList'],
        queryFn: async () => {
            const response = await axios.get('/api/milabench/list');
            return response.data;
        },
    });

    const addFilter = () => {
        const newFilters = [...filters, { field: '', operator: '==', value: '' }];
        setFilters(newFilters);
        updateUrlParams(newFilters);
    };

    const removeFilter = (index: number) => {
        const newFilters = [...filters];
        newFilters.splice(index, 1);
        setFilters(newFilters);
        updateUrlParams(newFilters);
    };

    const updateFilter = (index: number, field: string, operator: string, value: string | string[]) => {
        const newFilters = [...filters];
        // Ensure field has correct format before updating
        const formattedField = ensureFieldFormat(field);
        newFilters[index] = { field: formattedField, operator, value };
        setFilters(newFilters);
        updateUrlParams(newFilters);
    };

    const updateUrlParams = (newFilters: Filter[]) => {
        if (newFilters.length > 0) {
            searchParams.set('filters', btoa(JSON.stringify(newFilters)));
        } else {
            searchParams.delete('filters');
        }
        setSearchParams(searchParams);
    };

    const handleSearchWithFilters = async (filtersToSearch: Filter[]) => {
        if (filtersToSearch.length === 0) {
            toast({
                title: 'No filters',
                description: 'Please add at least one filter to search',
                status: 'warning',
                duration: 3000,
            });
            return;
        }

        setIsLoading(true);
        try {
            await refetch();
        } catch (error) {
            toast({
                title: 'Error searching executions',
                description: error instanceof Error ? error.message : 'Unknown error',
                status: 'error',
                duration: 5000,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async () => {
        await handleSearchWithFilters(filters);
    };

    // Get all unique field names from the executions data
    const getTableColumns = () => {
        if (!executions || executions.length === 0) return [];

        const allFields = new Set<string>();
        executions.forEach((exec: Execution) => {
            Object.keys(exec).forEach(key => allFields.add(key));
        });

        // Convert to array and ensure id and run are first
        const fields = Array.from(allFields);
        const orderedFields = ['id', 'run'];

        // Add remaining fields, excluding id and run if they exist
        fields.forEach(field => {
            if (!orderedFields.includes(field)) {
                orderedFields.push(field);
            }
        });

        return orderedFields;
    };

    // Format value based on field type
    const formatValue = (field: string, value: any) => {
        if (value === undefined || value === null) return '-';

        // Handle arrays (for 'in' operator)
        if (Array.isArray(value)) {
            return value.join(', ');
        }

        // Handle numeric values
        if (typeof value === 'number') {
            return value.toLocaleString();
        }

        // Handle dates
        if (field.toLowerCase().includes('date') || field.toLowerCase().includes('time')) {
            try {
                return new Date(value).toLocaleString();
            } catch {
                return value;
            }
        }

        return value;
    };

    const addQuickFilter = (type: 'gpu' | 'pytorch' | 'milabench', values: string[]) => {
        if (!values.length) return;

        const fieldMap = {
            gpu: 'Exec:meta.accelerators.gpus.0.product',
            pytorch: 'Exec:meta.pytorch.torch',
            milabench: 'Exec:meta.milabench.tag',
        };

        // Create a single filter with 'in' operator for multiple values
        const newFilter = {
            field: fieldMap[type],
            operator: values.length > 1 ? 'in' : '==',
            value: values.length > 1 ? values : values[0],
        };

        const updatedFilters = [...filters, newFilter];
        setFilters(updatedFilters);
        updateUrlParams(updatedFilters);
    };

    const handleCompare = () => {
        if (!executions || executions.length === 0) {
            toast({
                title: 'No executions to compare',
                description: 'Please add filters and search to get some executions to compare',
                status: 'warning',
                duration: 5000,
            });
            return;
        }

        // Create pivot parameters
        const params = new URLSearchParams();

        let pivot_cols = ['Metric:name'];
        for (const filter of filters) {
            pivot_cols.push(filter.field);
        }

        // Set default rows to include run, gpu, pytorch, and bench
        params.append('rows', 'Weight:priority,Pack:name');

        // Set default columns to include metrics
        params.append('cols', pivot_cols.join(','));

        // Set default values to include mean and max
        params.append('values', 'Metric:value');

        params.append("mode", "table")

        params.append("relative", "true")

        // Add current filters
        if (filters.length > 0) {

            let pivot_filters = [...filters];

            pivot_filters.push({
                field: 'Metric:name',
                operator: '==',
                value: 'rate',
            });

            params.append('filters', btoa(JSON.stringify(pivot_filters)));
        }

        // Navigate to pivot view with parameters
        navigate(`/pivot?${params.toString()}`);
    };

    const handleSaveQuery = async () => {
        if (!saveQueryName.trim()) {
            toast({
                title: 'Query name required',
                description: 'Please enter a name for your saved query',
                status: 'warning',
                duration: 3000,
            });
            return;
        }

        try {
            // Create the query object with current filters and quick filters
            const queryData = {
                url: '/explorer',
                parameters: {
                    filters: filters.length > 0 ? btoa(JSON.stringify(filters)) : '',
                    quickFilters: quickFilters,
                    timestamp: new Date().toISOString()
                }
            };

            await saveQuery(saveQueryName, queryData);

            toast({
                title: 'Query saved successfully',
                description: `Your query "${saveQueryName}" has been saved`,
                status: 'success',
                duration: 3000,
            });

            onSaveModalClose();
            setSaveQueryName('');
        } catch (error) {
            toast({
                title: 'Error saving query',
                description: error instanceof Error ? error.message : 'Failed to save query',
                status: 'error',
                duration: 5000,
            });
        }
    };

    const handleLoadQuery = (query: any) => {
        const { url, parameters } = query.query;

        if (url === '/explorer') {
            // Load explorer-specific parameters
            if (parameters.filters) {
                try {
                    const decodedFilters = JSON.parse(atob(parameters.filters));
                    setFilters(decodedFilters);
                    updateUrlParams(decodedFilters);
                } catch (error) {
                    toast({
                        title: 'Error loading filters',
                        description: 'Could not parse saved filters',
                        status: 'error',
                        duration: 5000,
                    });
                }
            }

            if (parameters.quickFilters) {
                setQuickFilters(parameters.quickFilters);
            }

            toast({
                title: 'Query loaded',
                description: `"${query.name}" has been loaded successfully`,
                status: 'success',
                duration: 3000,
            });
        } else {
            // Navigate to different view
            const params = new URLSearchParams();
            Object.entries(parameters).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    params.set(key, String(value));
                }
            });

            const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;
            navigate(fullUrl);
        }

        onLoadModalClose();
    };

    return (
        <Box p={4}>
            <VStack align="stretch" spacing={6}>
                <HStack justify="space-between">
                    <Heading>Execution Explorer</Heading>
                    <HStack spacing={4}>
                        <Button
                            colorScheme="green"
                            onClick={onSaveModalOpen}
                            leftIcon={<AddIcon />}
                        >
                            Save Query
                        </Button>
                        <Button
                            colorScheme="blue"
                            onClick={onLoadModalOpen}
                        >
                            Load Query
                        </Button>
                    </HStack>
                </HStack>

                {/* Quick Filters Section */}
                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <Heading size="md">Quick Filters</Heading>
                        <HStack>
                            <Select
                                value={quickFilters.gpu}
                                onChange={(e) => {
                                    const options = Array.from(e.target.selectedOptions, option => option.value);
                                    setQuickFilters({ ...quickFilters, gpu: options });
                                }}
                                placeholder="Select GPUs"
                                size="md"
                                height="100px"
                                multiple
                            >
                                {gpuList?.map((gpu: string) => (
                                    <option key={gpu} value={gpu}>
                                        {gpu}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('gpu', quickFilters.gpu)}
                                isDisabled={!quickFilters.gpu.length}
                            >
                                Add
                            </Button>
                        </HStack>
                        <HStack>
                            <Select
                                value={quickFilters.pytorch}
                                onChange={(e) => {
                                    const options = Array.from(e.target.selectedOptions, option => option.value);
                                    setQuickFilters({ ...quickFilters, pytorch: options });
                                }}
                                placeholder="Select PyTorch versions"
                                size="md"
                                height="100px"
                                multiple
                            >
                                {pytorchList?.map((version: string) => (
                                    <option key={version} value={version}>
                                        {version}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('pytorch', quickFilters.pytorch)}
                                isDisabled={!quickFilters.pytorch.length}
                            >
                                Add
                            </Button>
                        </HStack>
                        <HStack>
                            <Select
                                value={quickFilters.milabench}
                                onChange={(e) => {
                                    const options = Array.from(e.target.selectedOptions, option => option.value);
                                    setQuickFilters({ ...quickFilters, milabench: options });
                                }}
                                placeholder="Select Milabench versions"
                                size="md"
                                height="100px"
                                multiple
                            >
                                {milabenchList?.map((version: string) => (
                                    <option key={version} value={version}>
                                        {version}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('milabench', quickFilters.milabench)}
                                isDisabled={!quickFilters.milabench.length}
                            >
                                Add
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                {/* Filters Section */}
                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                            <Heading size="md">Filters</Heading>
                            <Button
                                leftIcon={<AddIcon />}
                                onClick={addFilter}
                                size="sm"
                            >
                                Add Filter
                            </Button>
                        </HStack>

                        {filters.map((filter, index) => (
                            <HStack key={index} spacing={2}>
                                <Select
                                    value={filter.field}
                                    onChange={(e) => updateFilter(index, e.target.value, filter.operator, filter.value)}
                                    placeholder="Select field"
                                    size="sm"
                                >
                                    {availableFields.map((field) => (
                                        <option key={field} value={field}>
                                            {formatFieldName(field)}
                                        </option>
                                    ))}
                                </Select>

                                <Select
                                    value={filter.operator}
                                    onChange={(e) => updateFilter(index, filter.field, e.target.value, filter.value)}
                                    size="sm"
                                >
                                    <option value="==">Equals (==)</option>
                                    <option value="!=">Not Equals (!=)</option>
                                    <option value=">">Greater Than (&gt;)</option>
                                    <option value=">=">Greater Than or Equal (&gt;=)</option>
                                    <option value="<">Less Than (&lt;)</option>
                                    <option value="<=">Less Than or Equal (&lt;=)</option>
                                    <option value="in">In List (in)</option>
                                    <option value="not in">Not In List (not in)</option>
                                    <option value="like">Like</option>
                                    <option value="not like">Not Like</option>
                                    <option value="is">Is</option>
                                    <option value="is not">Is Not</option>
                                </Select>

                                <Input
                                    value={Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}
                                    onChange={(e) => {
                                        const newValue = e.target.value;
                                        // If the operator is 'in' or 'not in', split by comma and trim whitespace
                                        if (filter.operator === 'in' || filter.operator === 'not in') {
                                            const values = newValue.split(',').map(v => v.trim()).filter(v => v);
                                            updateFilter(index, filter.field, filter.operator, values);
                                        } else {
                                            updateFilter(index, filter.field, filter.operator, newValue);
                                        }
                                    }}
                                    placeholder="Enter value"
                                    size="sm"
                                />

                                <IconButton
                                    aria-label="Remove filter"
                                    icon={<DeleteIcon />}
                                    onClick={() => removeFilter(index)}
                                    size="sm"
                                    colorScheme="red"
                                    variant="ghost"
                                />
                            </HStack>
                        ))}

                        <Button
                            leftIcon={<SearchIcon />}
                            onClick={handleSearch}
                            isLoading={isLoading}
                            colorScheme="blue"
                            alignSelf="flex-end"
                        >
                            Search
                        </Button>
                    </VStack>
                </Box>

                {/* Results Section */}
                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                            <Heading size="md">Results</Heading>
                            <HStack>
                                <Button
                                    leftIcon={<RepeatIcon />}
                                    onClick={handleCompare}
                                    colorScheme="purple"
                                    isDisabled={!executions || executions.length === 0}
                                >
                                    Compare
                                </Button>
                                <Button
                                    as={Link}
                                    to={`/grouped?exec_ids=${executions?.map((e: Execution) => e._id).join(',')}&more=Exec:name as run&color=run`}
                                    colorScheme="green"
                                    isDisabled={!executions || executions.length === 0}
                                >
                                    Plot
                                </Button>
                            </HStack>
                        </HStack>
                        {isQueryLoading ? (
                            <Loading />
                        ) : executions && executions.length > 0 ? (
                            <Table variant="simple">
                                <Thead>
                                    <Tr>
                                        {getTableColumns().map((field) => (
                                            <Th key={field}>{formatFieldName(field)}</Th>
                                        ))}
                                        <Th>Actions</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {executions.map((execution: Execution) => (
                                        <Tr key={execution._id}>
                                            {getTableColumns().map((field) => (
                                                <Td key={`${execution._id}-${field}`}>
                                                    {formatValue(field, (execution as any)[field])}
                                                </Td>
                                            ))}
                                            <Td>
                                                <HStack spacing={2}>
                                                    <Tooltip label="View Report">
                                                        <Button
                                                            as={Link}
                                                            to={`/executions/${execution._id}`}
                                                            size="sm"
                                                            colorScheme="blue"
                                                            variant="ghost"
                                                        >
                                                            Report
                                                        </Button>
                                                    </Tooltip>
                                                </HStack>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        ) : filters.length > 0 ? (
                            <Text color="gray.500" textAlign="center">No results found</Text>
                        ) : (
                            <Text color="gray.500" textAlign="center">Add filters and click Search to see results</Text>
                        )}
                    </VStack>
                </Box>
            </VStack>

            {/* Save Query Modal */}
            <Modal isOpen={isSaveModalOpen} onClose={onSaveModalClose}>
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Save Query</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        <VStack spacing={4}>
                            <FormControl>
                                <FormLabel>Query Name</FormLabel>
                                <Input
                                    value={saveQueryName}
                                    onChange={(e) => setSaveQueryName(e.target.value)}
                                    placeholder="Enter a name for your query"
                                />
                            </FormControl>
                            <HStack spacing={4} width="100%">
                                <Button colorScheme="blue" onClick={handleSaveQuery} width="100%">
                                    Save
                                </Button>
                                <Button onClick={onSaveModalClose} width="100%">
                                    Cancel
                                </Button>
                            </HStack>
                        </VStack>
                    </ModalBody>
                </ModalContent>
            </Modal>

            {/* Load Query Modal */}
            <Modal isOpen={isLoadModalOpen} onClose={onLoadModalClose} size="lg">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Load Saved Query</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        <VStack spacing={4} align="stretch">
                            {savedQueries && savedQueries.length > 0 ? (
                                savedQueries
                                    .filter((query: any) => query.query.url === '/explorer')
                                    .map((query: any) => (
                                        <Box
                                            key={query._id}
                                            p={4}
                                            borderWidth={1}
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: 'gray.50' }}
                                            onClick={() => handleLoadQuery(query)}
                                        >
                                            <HStack justify="space-between">
                                                <VStack align="start" spacing={1}>
                                                    <Text fontWeight="medium">{query.name}</Text>
                                                    <Text fontSize="sm" color="gray.600">
                                                        Explorer View
                                                    </Text>
                                                    <Text fontSize="sm" color="gray.600">
                                                        Created: {new Date(query.created_time).toLocaleString()}
                                                    </Text>
                                                </VStack>
                                                <Button size="sm" colorScheme="blue">
                                                    Load
                                                </Button>
                                            </HStack>
                                        </Box>
                                    ))
                            ) : (
                                <Text color="gray.500" textAlign="center">
                                    No saved queries found
                                </Text>
                            )}
                            {savedQueries && savedQueries.filter((query: any) => query.query.url === '/explorer').length === 0 && savedQueries.length > 0 && (
                                <Text color="gray.500" textAlign="center">
                                    No saved explorer queries found. Save queries from this view to see them here.
                                </Text>
                            )}
                        </VStack>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </Box>
    );
};