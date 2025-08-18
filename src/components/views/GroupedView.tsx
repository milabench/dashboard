import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Box, Select, FormControl, FormLabel, HStack, Input, VStack, Button, useToast, Text, Heading, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, useDisclosure, Switch, Tooltip } from '@chakra-ui/react';
import axios from 'axios';
import { AddIcon, DeleteIcon, CopyIcon, DownloadIcon } from '@chakra-ui/icons';
import { saveQuery, getAllSavedQueries } from '../../services/api';

interface ExtraField {
    field: string;
    alias: string;
}

const GroupedView: React.FC = () => {
    usePageTitle('Grouped View');

    const [searchParams, setSearchParams] = useSearchParams();
    const toast = useToast();
    const [extraFields, setExtraFields] = useState<ExtraField[]>([]);
    const [selectedField, setSelectedField] = useState<string>('');
    const [fieldAlias, setFieldAlias] = useState<string>('');

    // Save modal state
    const { isOpen: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose } = useDisclosure();
    const [saveQueryName, setSaveQueryName] = useState<string>('');

    // Load modal state
    const { isOpen: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose } = useDisclosure();

    // Relative view state
    const [isRelativeView, setIsRelativeView] = useState<boolean>(false);
    const [relativeColumn, setRelativeColumn] = useState<string>('');
    const [relativeBaseline, setRelativeBaseline] = useState<string>('');

    // Local state for input values
    const [g1Value, setG1Value] = useState<string>('');
    const [n1Value, setN1Value] = useState<string>('');
    const [g2Value, setG2Value] = useState<string>('');
    const [n2Value, setN2Value] = useState<string>('');
    const [metricValue, setMetricValue] = useState<string>('');
    const [colorValue, setColorValue] = useState<string>('');
    const [execIdsValue, setExecIdsValue] = useState<string>('');
    const [profileValue, setProfileValue] = useState<string>('');
    const [invertedValue, setInvertedValue] = useState<boolean>(false);
    const [weightedValue, setWeightedValue] = useState<boolean>(false);

    // Default values for the parameters (used for URL and iframe)
    const more = searchParams.get('more') || '';

    // Initialize local state from URL parameters
    useEffect(() => {
        setG1Value(searchParams.get('g1') || '');
        setN1Value(searchParams.get('n1') || '');
        setG2Value(searchParams.get('g2') || '');
        setN2Value(searchParams.get('n2') || '');
        setMetricValue(searchParams.get('metric') || '');
        setColorValue(searchParams.get('color') || '');
        setExecIdsValue(searchParams.get('exec_ids') || '');
        setProfileValue(searchParams.get('profile') || '');
        setInvertedValue(searchParams.get('inverted') === 'true');
        setWeightedValue(searchParams.get('weighted') === 'true');

        // Initialize relative view from URL
        const relativeParam = searchParams.get('relative') || '';
        if (relativeParam) {
            const [column, baseline] = relativeParam.split('=');
            if (column && baseline) {
                setIsRelativeView(true);
                setRelativeColumn(decodeURIComponent(column));
                setRelativeBaseline(decodeURIComponent(baseline));
            }
        } else {
            setIsRelativeView(false);
            setRelativeColumn('');
            setRelativeBaseline('');
        }
    }, [searchParams]);

    // Initialize extraFields from more parameter
    useEffect(() => {
        if (more) {
            const fields = more.split(',').map(field => {
                const [fieldName, alias] = field.split(' as ');
                return {
                    field: fieldName,
                    alias: alias || fieldName
                };
            });
            setExtraFields(fields);
        }
    }, []); // Only run on mount

    // Fetch available fields
    const { data: availableFields } = useQuery({
        queryKey: ['explorerFields'],
        queryFn: async () => {
            const response = await axios.get('/api/keys');
            return response.data;
        },
    });

    // Fetch available profiles
    const { data: availableProfiles } = useQuery({
        queryKey: ['profiles'],
        queryFn: async () => {
            const response = await axios.get('/api/profile/list');
            return response.data;
        },
    });

    // Fetch saved queries for load functionality
    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    // Fetch grouped plot data for copy functionality
    const { data: groupedData } = useQuery({
        queryKey: ['groupedData', g1Value, n1Value, g2Value, n2Value, metricValue, more, execIdsValue, colorValue, profileValue, invertedValue, weightedValue],
        queryFn: async () => {
            if (!execIdsValue) return [];

            const params = new URLSearchParams();
            if (g1Value) params.set('g1', g1Value);
            if (n1Value) params.set('n1', n1Value);
            if (g2Value) params.set('g2', g2Value);
            if (n2Value) params.set('n2', n2Value);

            params.set('metric', metricValue || 'rate');

            if (more) params.set('more', more);
            params.set('exec_ids', execIdsValue);
            if (colorValue) params.set('color', colorValue);
            if (profileValue) params.set('profile', profileValue);
            if (invertedValue) params.set('inverted', 'true');
            if (weightedValue) params.set('weighted', 'true');

            const response = await axios.get(`/api/grouped/plot?${params.toString()}`);
            return response.data;
        },
        enabled: !!execIdsValue,
    });

    // Get available columns from grouped data
    const availableColumns = React.useMemo(() => {
        if (!groupedData || groupedData.length === 0) return [];

        const columns = Object.keys(groupedData[0]).filter(key =>
            key !== metricValue
        );
        return columns;
    }, [groupedData, metricValue]);

    // Get available values for the selected relative column
    const availableBaselineValues = React.useMemo(() => {
        if (!groupedData || !relativeColumn || groupedData.length === 0) return [];

        const values = [...new Set(groupedData.map((row: any) => row[relativeColumn]))];
        return values.filter(value => value !== null && value !== undefined);
    }, [groupedData, relativeColumn]);

    // Compute relative data
    const relativeData = React.useMemo(() => {
        if (!isRelativeView || !groupedData || !relativeColumn || !relativeBaseline || groupedData.length === 0) {
            return groupedData;
        }

        // Create a lookup for baseline values
        const baselineLookup = new Map();

        // Group data by the combination of group fields (excluding the relative column)
        const groupKeys = Object.keys(groupedData[0]).filter(key =>
            key !== relativeColumn &&
            key !== metricValue
        );

        // Find baseline values for each group combination
        groupedData.forEach((row: any) => {
            if (row[relativeColumn] === relativeBaseline) {
                const groupKey = groupKeys.map(key => row[key]).join('|');
                baselineLookup.set(groupKey, row[metricValue]);
            }
        });

        // Apply relative calculations
        return groupedData.map((row: any) => {
            const groupKey = groupKeys.map(key => row[key]).join('|');
            const baselineValue = baselineLookup.get(groupKey);

            if (baselineValue && baselineValue !== 0) {
                return {
                    ...row,
                    [metricValue]: row[metricValue] / baselineValue
                };
            }
            return row;
        });
    }, [groupedData, isRelativeView, relativeColumn, relativeBaseline, metricValue]);

    const handleG1Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setG1Value(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('g1', value);
            } else {
                newParams.delete('g1');
            }
            return newParams;
        });
    };

    const handleN1Change = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setN1Value(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('n1', value);
            } else {
                newParams.delete('n1');
            }
            return newParams;
        });
    };

    const handleG2Change = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setG2Value(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('g2', value);
            } else {
                newParams.delete('g2');
            }
            return newParams;
        });
    };

    const handleN2Change = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setN2Value(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('n2', value);
            } else {
                newParams.delete('n2');
            }
            return newParams;
        });
    };

    const handleMetricChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setMetricValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('metric', value);
            } else {
                newParams.delete('metric');
            }
            return newParams;
        });
    };

    const handleColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setColorValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('color', value);
            } else {
                newParams.delete('color');
            }
            return newParams;
        });
    };

    const handleExecIdsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setExecIdsValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('exec_ids', value);
            } else {
                newParams.delete('exec_ids');
            }
            return newParams;
        });
    };

    const handleProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setProfileValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('profile', value);
            } else {
                newParams.delete('profile');
            }
            return newParams;
        });
    };

    const handleInvertedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.checked;
        setInvertedValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('inverted', 'true');
            } else {
                newParams.delete('inverted');
            }
            return newParams;
        });
    };

    const handleWeightedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.checked;
        setWeightedValue(value);
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value) {
                newParams.set('weighted', 'true');
            } else {
                newParams.delete('weighted');
            }
            return newParams;
        });
    };

    const handleRelativeViewToggle = () => {
        const newValue = !isRelativeView;
        setIsRelativeView(newValue);

        if (!newValue) {
            // Clear relative settings when disabling
            setRelativeColumn('');
            setRelativeBaseline('');
        }

        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (newValue) {
                // Keep the relative parameter if we have both column and baseline
                if (relativeColumn && relativeBaseline) {
                    newParams.set('relative', `${encodeURIComponent(relativeColumn)}=${encodeURIComponent(relativeBaseline)}`);
                }
            } else {
                newParams.delete('relative');
            }
            return newParams;
        });
    };

    const handleRelativeColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setRelativeColumn(value);
        setRelativeBaseline(''); // Reset baseline when column changes

        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value && isRelativeView) {
                // Only set relative parameter if relative view is enabled
                newParams.set('relative', `${encodeURIComponent(value)}=`);
            }
            return newParams;
        });
    };

    const handleRelativeBaselineChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setRelativeBaseline(value);

        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (value && relativeColumn && isRelativeView) {
                newParams.set('relative', `${encodeURIComponent(relativeColumn)}=${encodeURIComponent(value)}`);
            }
            return newParams;
        });
    };

    const addExtraField = () => {
        if (!selectedField) {
            toast({
                title: 'No field selected',
                description: 'Please select a field to add',
                status: 'warning',
                duration: 3000,
            });
            return;
        }

        const newField: ExtraField = {
            field: selectedField,
            alias: fieldAlias || selectedField
        };

        const updatedFields = [...extraFields, newField];
        setExtraFields(updatedFields);

        // Update more parameter with all fields
        const moreFields = updatedFields.map(f => `${f.field} as ${f.alias}`).join(',');
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('more', moreFields);
            return newParams;
        });

        // Reset form
        setSelectedField('');
        setFieldAlias('');
    };

    const removeExtraField = (index: number) => {
        const updatedFields = extraFields.filter((_, i) => i !== index);
        setExtraFields(updatedFields);

        // Update more parameter
        const moreFields = updatedFields.map(f => `${f.field} as ${f.alias}`).join(',');
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('more', moreFields);
            return newParams;
        });
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
            // Create the query object with all current parameters
            const queryData = {
                url: '/grouped',
                parameters: {
                    g1: g1Value,
                    n1: n1Value || 'Group 1',
                    g2: g2Value,
                    n2: n2Value || 'Group 2',
                    metric: metricValue || 'rate',
                    more: more,
                    exec_ids: execIdsValue,
                    color: colorValue || 'pytorch',
                    profile: profileValue || 'default',
                    inverted: invertedValue,
                    weighted: weightedValue,
                    relative: isRelativeView && relativeColumn && relativeBaseline
                        ? `${encodeURIComponent(relativeColumn)}=${encodeURIComponent(relativeBaseline)}`
                        : ''
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
        const { parameters } = query.query;

        // Update all form values with the loaded parameters
        setG1Value(parameters.g1 || '');
        setN1Value(parameters.n1 || '');
        setG2Value(parameters.g2 || '');
        setN2Value(parameters.n2 || '');
        setMetricValue(parameters.metric || '');
        setColorValue(parameters.color || '');
        setExecIdsValue(parameters.exec_ids || '');
        setProfileValue(parameters.profile || '');
        setInvertedValue(parameters.inverted || false);
        setWeightedValue(parameters.weighted || false);

        // Load relative view parameters
        const relativeParam = parameters.relative || '';
        if (relativeParam) {
            const [column, baseline] = relativeParam.split('=');
            if (column && baseline) {
                setIsRelativeView(true);
                setRelativeColumn(decodeURIComponent(column));
                setRelativeBaseline(decodeURIComponent(baseline));
            }
        } else {
            setIsRelativeView(false);
            setRelativeColumn('');
            setRelativeBaseline('');
        }

        // Update URL parameters
        const newParams = new URLSearchParams();
        Object.entries(parameters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                newParams.set(key, String(value));
            }
        });
        setSearchParams(newParams);

        // Update extra fields if they exist
        if (parameters.more) {
            const fields = parameters.more.split(',').map((field: string) => {
                const [fieldName, alias] = field.split(' as ');
                return {
                    field: fieldName,
                    alias: alias || fieldName
                };
            });
            setExtraFields(fields);
        }

        toast({
            title: 'Query loaded',
            description: `"${query.name}" has been loaded successfully`,
            status: 'success',
            duration: 3000,
        });

        onLoadModalClose();
    };

    const copyJsonToClipboard = async () => {
        try {
            if (!relativeData || relativeData.length === 0) {
                toast({
                    title: 'No data to copy',
                    description: 'Please configure and load data first',
                    status: 'warning',
                    duration: 3000,
                });
                return;
            }

            const jsonData = JSON.stringify(relativeData, null, 2);

            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(jsonData);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = jsonData;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            toast({
                title: 'JSON copied to clipboard',
                description: `${relativeData.length} rows copied as JSON`,
                status: 'success',
                duration: 3000,
            });
        } catch (error) {
            toast({
                title: 'Failed to copy JSON',
                description: 'Could not copy data to clipboard',
                status: 'error',
                duration: 3000,
            });
        }
    };

    const copyCsvToClipboard = async () => {
        try {
            if (!relativeData || relativeData.length === 0) {
                toast({
                    title: 'No data to copy',
                    description: 'Please configure and load data first',
                    status: 'warning',
                    duration: 3000,
                });
                return;
            }

            // Create CSV format
            const headers = Object.keys(relativeData[0]);
            const csvContent = [
                headers.join(','),
                ...relativeData.map((row: any) =>
                    headers.map(col => {
                        const value = row[col];
                        // Handle numbers and strings appropriately
                        if (typeof value === 'number') {
                            return value.toString();
                        }
                        // Escape any commas or quotes in text
                        return String(value || '').replace(/,/g, ';').replace(/"/g, '""');
                    }).join(',')
                )
            ].join('\n');

            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(csvContent);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = csvContent;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            toast({
                title: 'CSV copied to clipboard',
                description: `${relativeData.length} rows copied as CSV`,
                status: 'success',
                duration: 3000,
            });
        } catch (error) {
            toast({
                title: 'Failed to copy CSV',
                description: 'Could not copy data to clipboard',
                status: 'error',
                duration: 3000,
            });
        }
    };

    return (
        <Box p={4} height="100vh" display="flex" flexDirection="column">
            <VStack align="stretch" spacing={6} height="100%">
                <HStack spacing={4} mb={4} width="100%">
                    <FormControl flex="1">
                        <FormLabel>Column Field</FormLabel>
                        <Select value={g1Value} onChange={handleG1Change}>
                            <option value="">None</option>
                            <option value="group1">group1</option>
                            <option value="group2">group2</option>
                            <option value="group3">group3</option>
                            <option value="group4">group4</option>
                        </Select>
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Column Label</FormLabel>
                        <Input value={n1Value} onChange={handleN1Change} placeholder="Enter group 1 label" />
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Row Field</FormLabel>
                        <Select value={g2Value} onChange={handleG2Change}>
                            <option value="">None</option>
                            <option value="group1">group1</option>
                            <option value="group2">group2</option>
                            <option value="group3">group3</option>
                            <option value="group4">group4</option>
                        </Select>
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Row Label</FormLabel>
                        <Input value={n2Value} onChange={handleN2Change} placeholder="Enter group 2 label" />
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Metric</FormLabel>
                        <Select value={metricValue} onChange={handleMetricChange}>
                            <option value="rate">rate</option>
                            <option value="memory">memory</option>
                            <option value="gpu">gpu</option>
                            <option value="cpu">cpu</option>
                            <option value="perf">perf</option>
                        </Select>
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Color Field</FormLabel>
                        <Input value={colorValue} onChange={handleColorChange} placeholder="Enter color field" />
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Invert X-Y Axis</FormLabel>
                        <Switch
                            isChecked={invertedValue}
                            onChange={handleInvertedChange}
                            colorScheme="blue"
                        />
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Weighted</FormLabel>
                        <Switch
                            isChecked={weightedValue}
                            onChange={handleWeightedChange}
                            colorScheme="blue"
                        />
                    </FormControl>
                </HStack>

                <HStack spacing={4}>
                    <FormControl flex="2">
                        <Heading size="md">Execution IDs (comma-separated)</Heading>
                        <Input
                            value={execIdsValue}
                            onChange={handleExecIdsChange}
                            placeholder="Enter execution IDs (e.g., 1,2,3)"
                        />
                    </FormControl>

                    <FormControl flex="1">
                        <FormLabel>Profile</FormLabel>
                        <Select value={profileValue} onChange={handleProfileChange}>
                            {availableProfiles?.map((profile: string) => (
                                <option key={profile} value={profile}>
                                    {profile}
                                </option>
                            ))}
                        </Select>
                    </FormControl>
                </HStack>


                <HStack>
                    {/* Extra Fields Section */}
                    <Box borderWidth={1} borderRadius="md" width="50%" p={4}>
                        <VStack align="stretch" spacing={4}>
                            <Heading size="md">Extra Fields</Heading>
                            {/* Add Field Form as the first row */}
                            <HStack>
                                <FormControl>
                                    <Select
                                        value={selectedField}
                                        onChange={(e) => setSelectedField(e.target.value)}
                                        placeholder="Select a field"
                                    >
                                        {availableFields?.map((field: string) => (
                                            <option key={field} value={field}>
                                                {field}
                                            </option>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl>
                                    <Input
                                        value={fieldAlias}
                                        onChange={(e) => setFieldAlias(e.target.value)}
                                        placeholder="Field Alias (optional)"
                                    />
                                </FormControl>
                                <Button
                                    leftIcon={<AddIcon />}
                                    onClick={addExtraField}
                                    colorScheme="blue"
                                    whiteSpace="nowrap"
                                    minW="110px"
                                    maxW="140px"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                >
                                    Add Field
                                </Button>
                            </HStack>
                            {/* List of added extra fields */}
                            {extraFields.length > 0 && (
                                <div style={{ padding: '10px' }}>
                                    {extraFields.map((field, index) => (
                                        <HStack key={index} justify="space-between">
                                            <Text>
                                                <b>{field.field}</b> as <b>{field.alias}</b>
                                            </Text>
                                            <Button
                                                leftIcon={<DeleteIcon />}
                                                onClick={() => removeExtraField(index)}
                                                size="sm"
                                                colorScheme="red"
                                                variant="ghost"
                                            >
                                                Remove
                                            </Button>
                                        </HStack>
                                    ))}
                                </div>
                            )}
                        </VStack>
                    </Box>

                    {/* Relative View Configuration Form */}
                    {(
                        <Box borderWidth={1} borderRadius="md" width="50%" height="100%" p={4} bg="gray.50">
                            <VStack align="stretch" spacing={4}>
                                <HStack spacing={4}>
                                    <Heading size="md">Relative View Configuration</Heading>
                                    <Switch
                                        id="relative-view-toggle"
                                        isChecked={isRelativeView}
                                        onChange={handleRelativeViewToggle}
                                        isDisabled={false}
                                        colorScheme="green"
                                        size="md"
                                    />
                                </HStack>

                                <HStack spacing={4}>
                                    <FormControl flex="1">
                                        <FormLabel>Relative Column</FormLabel>
                                        <Select
                                            value={relativeColumn}
                                            onChange={handleRelativeColumnChange}
                                            placeholder="Select column for relative calculations"
                                        >
                                            {availableColumns.map((column) => (
                                                <option key={column} value={column}>
                                                    {column}
                                                </option>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <FormControl flex="1">
                                        <FormLabel>Baseline Value</FormLabel>
                                        <Select
                                            value={relativeBaseline}
                                            onChange={handleRelativeBaselineChange}
                                            placeholder="Select baseline value"
                                            isDisabled={!relativeColumn}
                                        >
                                            {availableBaselineValues.map((value) => (
                                                <option key={String(value)} value={String(value)}>
                                                    {String(value).replace(/"/g, '')}
                                                </option>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </HStack>
                                {relativeColumn && relativeBaseline && (
                                    <Text fontSize="sm" color="gray.600">
                                        Values will be calculated relative to {relativeColumn} = "{relativeBaseline.replace(/"/g, '')}"
                                    </Text>
                                )}
                            </VStack>
                        </Box>
                    )}
                </HStack>





                {/* Save Query Button */}
                <HStack justify="center" spacing={4}>
                    <Button
                        colorScheme="green"
                        onClick={onSaveModalOpen}
                        size="md"
                    >
                        Save Query
                    </Button>
                    <Button
                        colorScheme="blue"
                        onClick={onLoadModalOpen}
                        size="md"
                    >
                        Load Query
                    </Button>
                    <Tooltip label="Copy data as JSON">
                        <Button
                            leftIcon={<CopyIcon />}
                            onClick={copyJsonToClipboard}
                            colorScheme="blue"
                            variant="outline"
                            size="md"
                            isDisabled={!relativeData || relativeData.length === 0}
                        >
                            Copy as JSON
                        </Button>
                    </Tooltip>
                    <Tooltip label="Copy data as CSV">
                        <Button
                            leftIcon={<DownloadIcon />}
                            onClick={copyCsvToClipboard}
                            colorScheme="green"
                            variant="outline"
                            size="md"
                            isDisabled={!relativeData || relativeData.length === 0}
                        >
                            Copy as CSV
                        </Button>
                    </Tooltip>
                </HStack>

                <Box flex="1">
                    <iframe
                        src={`/html/grouped/plot?${[
                            g1Value && `g1=${g1Value}`,
                            n1Value && `n1=${n1Value}`,
                            g2Value && `g2=${g2Value}`,
                            n2Value && `n2=${n2Value}`,
                            `metric=${metricValue || 'rate'}`,
                            `more=${more}`,
                            `exec_ids=${execIdsValue}`,
                            `color=${colorValue || 'pytorch'}`,
                            `profile=${profileValue || 'default'}`,
                            invertedValue ? 'inverted=true' : '',
                            weightedValue ? 'weighted=true' : '',
                            isRelativeView ? `relative=${relativeColumn}=${encodeURIComponent(relativeBaseline)}` : ''
                        ].filter((param): param is string => Boolean(param)).join('&')}`}
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title="Grouped Plot"
                    />
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
                                    .filter((query: any) => query.query.url === '/grouped')
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
                        </VStack>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </Box>
    );
};

export default GroupedView;
