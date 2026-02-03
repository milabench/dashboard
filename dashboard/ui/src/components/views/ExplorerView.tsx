import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Tooltip } from "../../components/ui/tooltip"
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Input,
    Select,
    Dialog,
    Field,
    Table,
    IconButton,
    useListCollection,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import { getAllSavedQueries, saveQuery } from '../../services/api';
import type { Execution } from '../../services/types';
import { Loading } from '../common/Loading';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { LuSearch, LuPlus, LuTrash2, LuRefreshCw } from 'react-icons/lu';

interface Filter {
    field: string;
    operator: string;
    value: string | string[];
}

type SelectItem = {
    label: string;
    value: string;
};

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

    // Theme-aware colors - all hooks must be called at the top level
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const buttonHoverBg = useColorModeValue('gray.100', 'gray.700');
    const queryItemHoverBg = useColorModeValue('gray.50', 'gray.700');
    const focusBorderColor = useColorModeValue('blue.500', 'blue.400');
    const greenButtonBg = useColorModeValue('green.500', 'green.600');
    const greenButtonHoverBg = useColorModeValue('green.600', 'green.500');

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
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const onSaveModalOpen = () => setIsSaveModalOpen(true);
    const onSaveModalClose = () => setIsSaveModalOpen(false);
    const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
    const onLoadModalOpen = () => setIsLoadModalOpen(true);
    const onLoadModalClose = () => setIsLoadModalOpen(false);
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
                toaster.create({
                    title: 'Invalid URL parameters',
                    description: 'Could not parse filters from URL',
                    type: 'error',
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

    // Collections for Select components
    const gpuItems = useMemo<SelectItem[]>(() =>
        (gpuList || [])
            .filter((gpu: string) => gpu != null && gpu !== '')
            .map((gpu: string) => ({ label: gpu, value: gpu })),
        [gpuList]
    );
    const gpuCollection = useListCollection({ initialItems: gpuItems });

    const pytorchItems = useMemo<SelectItem[]>(() =>
        (pytorchList || [])
            .filter((version: string) => version != null && version !== '')
            .map((version: string) => ({ label: version, value: version })),
        [pytorchList]
    );
    const pytorchCollection = useListCollection({ initialItems: pytorchItems });

    const milabenchItems = useMemo<SelectItem[]>(() =>
        (milabenchList || [])
            .filter((version: string) => version != null && version !== '')
            .map((version: string) => ({ label: version, value: version })),
        [milabenchList]
    );
    const milabenchCollection = useListCollection({ initialItems: milabenchItems });

    const fieldItems = useMemo<SelectItem[]>(() =>
        (availableFields || [])
            .filter((field: string) => field != null && field !== '')
            .map((field: string) => ({ label: formatFieldName(field), value: field })),
        [availableFields]
    );
    const fieldCollection = useListCollection({ initialItems: fieldItems });

    const operatorItems = useMemo<SelectItem[]>(() => [
        { label: 'Equals (==)', value: '==' },
        { label: 'Not Equals (!=)', value: '!=' },
        { label: 'Greater Than (>)', value: '>' },
        { label: 'Greater Than or Equal (>=)', value: '>=' },
        { label: 'Less Than (<)', value: '<' },
        { label: 'Less Than or Equal (<=)', value: '<=' },
        { label: 'In List (in)', value: 'in' },
        { label: 'Not In List (not in)', value: 'not in' },
        { label: 'Like', value: 'like' },
        { label: 'Not Like', value: 'not like' },
        { label: 'Is', value: 'is' },
        { label: 'Is Not', value: 'is not' },
    ], []);
    const operatorCollection = useListCollection({ initialItems: operatorItems });

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
            toaster.create({
                title: 'No filters',
                description: 'Please add at least one filter to search',
                type: 'warning',
                duration: 3000,
            });
            return;
        }

        setIsLoading(true);
        try {
            await refetch();
        } catch (error) {
            toaster.create({
                title: 'Error searching executions',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
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
            toaster.create({
                title: 'No executions to compare',
                description: 'Please add filters and search to get some executions to compare',
                type: 'warning',
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
            toaster.create({
                title: 'Query name required',
                description: 'Please enter a name for your saved query',
                type: 'warning',
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

            toaster.create({
                title: 'Query saved successfully',
                description: `Your query "${saveQueryName}" has been saved`,
                type: 'success',
                duration: 3000,
            });

            onSaveModalClose();
            setSaveQueryName('');
        } catch (error) {
            toaster.create({
                title: 'Error saving query',
                description: error instanceof Error ? error.message : 'Failed to save query',
                type: 'error',
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
                    toaster.create({
                        title: 'Error loading filters',
                        description: 'Could not parse saved filters',
                        type: 'error',
                        duration: 5000,
                    });
                }
            }

            if (parameters.quickFilters) {
                setQuickFilters(parameters.quickFilters);
            }

            toaster.create({
                title: 'Query loaded',
                description: `"${query.name}" has been loaded successfully`,
                type: 'success',
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
        <Box p={4} bg={pageBg} minH="100vh">
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading color={textColor}>Execution Explorer</Heading>
                    <HStack gap={4}>
                        <Button
                            colorScheme="green"
                            onClick={onSaveModalOpen}
                            variant="solid"
                            color="white"
                            _hover={{ color: 'white', bg: greenButtonHoverBg }}
                        >
                            <HStack gap={2} as="span">
                                <LuPlus />
                                <Text>Save Query</Text>
                            </HStack>
                        </Button>
                        <Button
                            colorScheme="blue"
                            onClick={onLoadModalOpen}
                            variant="solid"
                            color="white"
                        >
                            Load Query
                        </Button>
                    </HStack>
                </HStack>

                {/* Quick Filters Section */}
                <Box borderWidth={1} borderColor={borderColor} borderRadius="md" p={4} bg={cardBg}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color={textColor}>Quick Filters</Heading>
                        <HStack>
                            <Select.Root
                                collection={gpuCollection.collection}
                                value={quickFilters.gpu.filter((val: string) => gpuItems.some(item => item.value === val))}
                                onValueChange={(details) => {
                                    setQuickFilters({ ...quickFilters, gpu: details.value });
                                }}
                                multiple
                                size="md"
                            >
                                <Select.HiddenSelect />
                                <Select.Control bg={cardBg} borderColor={borderColor} _focus={{ borderColor: focusBorderColor }}>
                                    <Select.Trigger>
                                        <Select.ValueText placeholder="Select GPUs" color={textColor} />
                                    </Select.Trigger>
                                    <Select.IndicatorGroup>
                                        <Select.Indicator />
                                    </Select.IndicatorGroup>
                                </Select.Control>
                                <Select.Positioner>
                                    <Select.Content maxH="200px">
                                        {gpuItems.map((item) => (
                                            <Select.Item key={item.value} item={item}>
                                                <Select.ItemText>{item.label}</Select.ItemText>
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Select.Root>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('gpu', quickFilters.gpu)}
                                disabled={!quickFilters.gpu.length}
                                colorScheme="blue"
                                variant="solid"
                                color="white"
                            >
                                Add
                            </Button>
                        </HStack>
                        <HStack>
                            <Select.Root
                                collection={pytorchCollection.collection}
                                value={quickFilters.pytorch.filter((val: string) => pytorchItems.some(item => item.value === val))}
                                onValueChange={(details) => {
                                    setQuickFilters({ ...quickFilters, pytorch: details.value });
                                }}
                                multiple
                                size="md"
                            >
                                <Select.HiddenSelect />
                                <Select.Control bg={cardBg} borderColor={borderColor} _focus={{ borderColor: focusBorderColor }}>
                                    <Select.Trigger>
                                        <Select.ValueText placeholder="Select PyTorch versions" color={textColor} />
                                    </Select.Trigger>
                                    <Select.IndicatorGroup>
                                        <Select.Indicator />
                                    </Select.IndicatorGroup>
                                </Select.Control>
                                <Select.Positioner>
                                    <Select.Content maxH="200px">
                                        {pytorchItems.map((item) => (
                                            <Select.Item key={item.value} item={item}>
                                                <Select.ItemText>{item.label}</Select.ItemText>
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Select.Root>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('pytorch', quickFilters.pytorch)}
                                disabled={!quickFilters.pytorch.length}
                                colorScheme="blue"
                                variant="solid"
                                color="white"
                            >
                                Add
                            </Button>
                        </HStack>
                        <HStack>
                            <Select.Root
                                collection={milabenchCollection.collection}
                                value={quickFilters.milabench.filter((val: string) => milabenchItems.some(item => item.value === val))}
                                onValueChange={(details) => {
                                    setQuickFilters({ ...quickFilters, milabench: details.value });
                                }}
                                multiple
                                size="md"
                            >
                                <Select.HiddenSelect />
                                <Select.Control bg={cardBg} borderColor={borderColor} _focus={{ borderColor: focusBorderColor }}>
                                    <Select.Trigger>
                                        <Select.ValueText placeholder="Select Milabench versions" color={textColor} />
                                    </Select.Trigger>
                                    <Select.IndicatorGroup>
                                        <Select.Indicator />
                                    </Select.IndicatorGroup>
                                </Select.Control>
                                <Select.Positioner>
                                    <Select.Content maxH="200px">
                                        {milabenchItems.map((item) => (
                                            <Select.Item key={item.value} item={item}>
                                                <Select.ItemText>{item.label}</Select.ItemText>
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Select.Root>
                            <Button
                                size="sm"
                                onClick={() => addQuickFilter('milabench', quickFilters.milabench)}
                                disabled={!quickFilters.milabench.length}
                                colorScheme="blue"
                                variant="solid"
                                color="white"
                            >
                                Add
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                {/* Filters Section */}
                <Box borderWidth={1} borderColor={borderColor} borderRadius="md" p={4} bg={cardBg}>
                    <VStack align="stretch" gap={4}>
                        <HStack justify="space-between">
                            <Heading size="md" color={textColor}>Filters</Heading>
                            <Button
                                onClick={addFilter}
                                size="sm"
                                colorScheme="blue"
                                variant="solid"
                                color="white"
                            >
                                <HStack gap={2} as="span">
                                    <LuPlus />
                                    <Text>Add Filter</Text>
                                </HStack>
                            </Button>
                        </HStack>

                        {filters.map((filter, index) => (
                            <HStack key={index} gap={2}>
                                <Select.Root
                                    collection={fieldCollection.collection}
                                    value={filter.field && fieldItems.some(item => item.value === filter.field) ? [filter.field] : []}
                                    onValueChange={(details) => updateFilter(index, details.value[0] || '', filter.operator, filter.value)}
                                    size="sm"
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg={cardBg} borderColor={borderColor} _focus={{ borderColor: focusBorderColor }}>
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select field" color={textColor} />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {fieldItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>

                                <Select.Root
                                    collection={operatorCollection.collection}
                                    value={filter.operator && operatorItems.some(item => item.value === filter.operator) ? [filter.operator] : ['==']}
                                    onValueChange={(details) => updateFilter(index, filter.field, details.value[0] || '==', filter.value)}
                                    size="sm"
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg={cardBg} borderColor={borderColor} _focus={{ borderColor: focusBorderColor }}>
                                        <Select.Trigger>
                                            <Select.ValueText color={textColor} />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {operatorItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>

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
                                    bg={cardBg}
                                    borderColor={borderColor}
                                    color={textColor}
                                    _focus={{ borderColor: focusBorderColor }}
                                />

                                <IconButton
                                    aria-label="Remove filter"
                                    onClick={() => removeFilter(index)}
                                    size="sm"
                                    colorScheme="red"
                                    variant="ghost"
                                >
                                    <LuTrash2 />
                                </IconButton>
                            </HStack>
                        ))}

                        <Button
                            onClick={handleSearch}
                            loading={isLoading}
                            colorScheme="blue"
                            variant="solid"
                            color="white"
                            alignSelf="flex-end"
                        >
                            <HStack gap={2} as="span">
                                <LuSearch />
                                <Text>Search</Text>
                            </HStack>
                        </Button>
                    </VStack>
                </Box>

                {/* Results Section */}
                <Box borderWidth={1} borderColor={borderColor} borderRadius="md" p={4} bg={cardBg}>
                    <VStack align="stretch" gap={4}>
                        <HStack justify="space-between">
                            <Heading size="md" color={textColor}>Results</Heading>
                            <HStack>
                                <Button
                                    onClick={handleCompare}
                                    colorScheme="purple"
                                    variant="solid"
                                    color="white"
                                    disabled={!executions || executions.length === 0}
                                >
                                    <HStack gap={2} as="span">
                                        <LuRefreshCw />
                                        <Text>Compare</Text>
                                    </HStack>
                                </Button>
                                <Button
                                    asChild
                                    bg={greenButtonBg}
                                    variant="solid"
                                    color="white"
                                    disabled={!executions || executions.length === 0}
                                    _hover={{ color: 'white', bg: greenButtonHoverBg }}
                                    _disabled={{ opacity: 0.6, color: 'white', bg: greenButtonBg }}
                                >
                                    <Link to={`/grouped?exec_ids=${executions?.map((e: Execution) => e._id).join(',')}&more=Exec:name as run&color=run`}>
                                        Plot
                                    </Link>
                                </Button>
                            </HStack>
                        </HStack>
                        {isQueryLoading ? (
                            <Loading />
                        ) : executions && executions.length > 0 ? (
                            <Table.Root variant="line">
                                <Table.Header>
                                    <Table.Row>
                                        {getTableColumns().map((field) => (
                                            <Table.ColumnHeader key={field}>{formatFieldName(field)}</Table.ColumnHeader>
                                        ))}
                                        <Table.ColumnHeader>Actions</Table.ColumnHeader>
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {executions.map((execution: Execution) => (
                                        <Table.Row key={execution._id}>
                                            {getTableColumns().map((field) => (
                                                <Table.Cell key={`${execution._id}-${field}`}>
                                                    {formatValue(field, (execution as any)[field])}
                                                </Table.Cell>
                                            ))}
                                            <Table.Cell>
                                                <HStack gap={2}>
                                                    <Tooltip content="View Report">
                                                        <Button
                                                            asChild
                                                            size="sm"
                                                            colorScheme="blue"
                                                            variant="ghost"
                                                        >
                                                            <Link to={`/executions/${execution._id}`}>
                                                                Report
                                                            </Link>
                                                        </Button>
                                                    </Tooltip>
                                                </HStack>
                                            </Table.Cell>
                                        </Table.Row>
                                    ))}
                                </Table.Body>
                            </Table.Root>
                        ) : filters.length > 0 ? (
                            <Text color={mutedTextColor} textAlign="center">No results found</Text>
                        ) : (
                            <Text color={mutedTextColor} textAlign="center">Add filters and click Search to see results</Text>
                        )}
                    </VStack>
                </Box>
            </VStack>

            {/* Save Query Modal */}
            <Dialog.Root open={isSaveModalOpen} onOpenChange={(details) => setIsSaveModalOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Save Query</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4}>
                                <Field.Root>
                                    <Field.Label>Query Name</Field.Label>
                                    <Input
                                        value={saveQueryName}
                                        onChange={(e) => setSaveQueryName(e.target.value)}
                                        placeholder="Enter a name for your query"
                                        bg={cardBg}
                                        borderColor={borderColor}
                                        color={textColor}
                                        _focus={{ borderColor: focusBorderColor }}
                                    />
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button
                                        colorScheme="blue"
                                        onClick={handleSaveQuery}
                                        width="100%"
                                        variant="solid"
                                        color="white"
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        onClick={onSaveModalClose}
                                        width="100%"
                                        variant="outline"
                                        color={textColor}
                                        borderColor={borderColor}
                                        _hover={{ bg: buttonHoverBg }}
                                    >
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Load Query Modal */}
            <Dialog.Root open={isLoadModalOpen} onOpenChange={(details) => setIsLoadModalOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="lg">
                        <Dialog.Header>
                            <Dialog.Title>Load Saved Query</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4} align="stretch">
                                {savedQueries && savedQueries.length > 0 ? (
                                    savedQueries
                                        .filter((query: any) => query.query.url === '/explorer')
                                        .map((query: any) => (
                                            <Box
                                                key={query._id}
                                                p={4}
                                                borderWidth={1}
                                                borderColor={borderColor}
                                                borderRadius="md"
                                                bg={cardBg}
                                                cursor="pointer"
                                                _hover={{ bg: queryItemHoverBg }}
                                                onClick={() => handleLoadQuery(query)}
                                            >
                                                <HStack justify="space-between">
                                                    <VStack align="start" gap={1}>
                                                        <Text fontWeight="medium" color={textColor}>{query.name}</Text>
                                                        <Text fontSize="sm" color={mutedTextColor}>
                                                            Explorer View
                                                        </Text>
                                                        <Text fontSize="sm" color={mutedTextColor}>
                                                            Created: {new Date(query.created_time).toLocaleString()}
                                                        </Text>
                                                    </VStack>
                                                    <Button
                                                        size="sm"
                                                        colorScheme="blue"
                                                        variant="solid"
                                                        color="white"
                                                    >
                                                        Load
                                                    </Button>
                                                </HStack>
                                            </Box>
                                        ))
                                ) : (
                                    <Text color={mutedTextColor} textAlign="center">
                                        No saved queries found
                                    </Text>
                                )}
                                {savedQueries && savedQueries.filter((query: any) => query.query.url === '/explorer').length === 0 && savedQueries.length > 0 && (
                                    <Text color={mutedTextColor} textAlign="center">
                                        No saved explorer queries found. Save queries from this view to see them here.
                                    </Text>
                                )}
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};