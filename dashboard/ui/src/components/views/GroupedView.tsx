import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Box, Select, Field, HStack, Input, VStack, Button, Text, Heading, Dialog, Switch, useDisclosure, useListCollection } from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import axios from 'axios';
import { LuPlus, LuTrash2, LuCopy, LuDownload } from 'react-icons/lu';
import { saveQuery, getAllSavedQueries } from '../../services/api';
import { Tooltip } from "../../components/ui/tooltip"

interface ExtraField {
    field: string;
    alias: string;
}

type SelectItem = {
    label: string;
    value: string;
};

const GroupedView: React.FC = () => {
    usePageTitle('Grouped View');

    // Theme-aware colors - all hooks must be called at the top level
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const buttonHoverBg = useColorModeValue('gray.100', 'gray.700');
    const focusBorderColor = useColorModeValue('blue.500', 'blue.400');
    const greenButtonBg = useColorModeValue('green.500', 'green.600');
    const greenButtonHoverBg = useColorModeValue('green.600', 'green.500');
    const blueButtonBg = useColorModeValue('blue.500', 'blue.600');
    const blueButtonHoverBg = useColorModeValue('blue.600', 'blue.500');
    const redButtonHoverBg = useColorModeValue('red.50', 'red.900');
    const cardHoverBg = useColorModeValue('gray.50', 'gray.700');
    const inputBg = useColorModeValue('white', 'gray.800');
    const selectBg = useColorModeValue('white', 'gray.800');
    const relativeViewBg = useColorModeValue('gray.50', 'gray.800');

    const [searchParams, setSearchParams] = useSearchParams();
    const [extraFields, setExtraFields] = useState<ExtraField[]>([]);
    const [selectedField, setSelectedField] = useState<string>('');
    const [fieldAlias, setFieldAlias] = useState<string>('');

    // Save modal state
    const { open: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose, setOpen: setSaveModalOpen } = useDisclosure();
    const [saveQueryName, setSaveQueryName] = useState<string>('');

    // Load modal state
    const [isLoadModalOpen, setIsLoadModalOpen] = React.useState(false);
    const onLoadModalOpen = () => setIsLoadModalOpen(true);
    const onLoadModalClose = () => setIsLoadModalOpen(false);

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

    // Collections for Select components
    const groupFieldItems = useMemo<SelectItem[]>(() => [
        { label: 'None', value: '' },
        { label: 'group1', value: 'group1' },
        { label: 'group2', value: 'group2' },
        { label: 'group3', value: 'group3' },
        { label: 'group4', value: 'group4' },
    ], []);
    const groupFieldCollection = useListCollection({ initialItems: groupFieldItems });

    const metricItems = useMemo<SelectItem[]>(() => [
        { label: 'rate', value: 'rate' },
        { label: 'memory', value: 'memory' },
        { label: 'gpu', value: 'gpu' },
        { label: 'cpu', value: 'cpu' },
        { label: 'perf', value: 'perf' },
    ], []);
    const metricCollection = useListCollection({ initialItems: metricItems });

    const profileItems = useMemo<SelectItem[]>(() =>
        (availableProfiles || [])
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [availableProfiles]
    );
    const profileCollection = useListCollection({ initialItems: profileItems });

    const fieldItems = useMemo<SelectItem[]>(() =>
        (availableFields || [])
            .filter((field: string) => field != null && field !== '')
            .map((field: string) => ({ label: field, value: field })),
        [availableFields]
    );
    const fieldCollection = useListCollection({ initialItems: fieldItems });

    const columnItems = useMemo<SelectItem[]>(() =>
        availableColumns
            .filter((column: string) => column != null && column !== '')
            .map((column: string) => ({ label: column, value: column })),
        [availableColumns]
    );
    const columnCollection = useListCollection({ initialItems: columnItems });

    const baselineItems = useMemo<SelectItem[]>(() =>
        availableBaselineValues
            .filter((value: any) => value != null && value !== '')
            .map((value: any) => ({ label: String(value), value: String(value) })),
        [availableBaselineValues]
    );
    const baselineCollection = useListCollection({ initialItems: baselineItems });

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

    const handleG1Change = (details: { value: string[] }) => {
        const value = details.value[0] || '';
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

    const handleG2Change = (details: { value: string[] }) => {
        const value = details.value[0] || '';
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

    const handleMetricChange = (details: { value: string[] }) => {
        const value = details.value[0] || 'rate';
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

    const handleProfileChange = (details: { value: string[] }) => {
        const value = details.value[0] || '';
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

    const handleInvertedChange = (details: { checked: boolean }) => {
        const value = details.checked;
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

    const handleWeightedChange = (details: { checked: boolean }) => {
        const value = details.checked;
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

    const handleRelativeViewToggle = (details: { checked: boolean }) => {
        const newValue = details.checked;
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

    const handleRelativeColumnChange = (details: { value: string[] }) => {
        const value = details.value[0] || '';
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

    const handleRelativeBaselineChange = (details: { value: string[] }) => {
        const value = details.value[0] || '';
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
            toaster.create({
                title: 'No field selected',
                description: 'Please select a field to add',
                type: 'warning',
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
            toaster.create({
                title: 'Query name required',
                description: 'Please enter a name for your saved query',
                type: 'warning',
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

        toaster.create({
            title: 'Query loaded',
            description: `"${query.name}" has been loaded successfully`,
            type: 'success',
            duration: 3000,
        });

        onLoadModalClose();
    };

    const copyJsonToClipboard = async () => {
        try {
            if (!relativeData || relativeData.length === 0) {
                toaster.create({
                    title: 'No data to copy',
                    description: 'Please configure and load data first',
                    type: 'warning',
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

            toaster.create({
                title: 'JSON copied to clipboard',
                description: `${relativeData.length} rows copied as JSON`,
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Failed to copy JSON',
                description: 'Could not copy data to clipboard',
                type: 'error',
                duration: 3000,
            });
        }
    };

    const copyCsvToClipboard = async () => {
        try {
            if (!relativeData || relativeData.length === 0) {
                toaster.create({
                    title: 'No data to copy',
                    description: 'Please configure and load data first',
                    type: 'warning',
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

            toaster.create({
                title: 'CSV copied to clipboard',
                description: `${relativeData.length} rows copied as CSV`,
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Failed to copy CSV',
                description: 'Could not copy data to clipboard',
                type: 'error',
                duration: 3000,
            });
        }
    };

    return (
        <Box p={4} height="100vh" display="flex" flexDirection="column" bg={pageBg}>
            <VStack align="stretch" gap={6} height="100%">
                <HStack gap={4} mb={4} width="100%">
                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Column Field</Field.Label>
                        <Select.Root
                            collection={groupFieldCollection.collection}
                            value={g1Value ? [g1Value] : []}
                            onValueChange={handleG1Change}
                        >
                            <Select.HiddenSelect />
                            <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                <Select.Trigger>
                                    <Select.ValueText placeholder="Select column field" />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Select.Positioner>
                                <Select.Content>
                                    {groupFieldItems.map((item) => (
                                        <Select.Item key={item.value} item={item}>
                                            <Select.ItemText>{item.label}</Select.ItemText>
                                        </Select.Item>
                                    ))}
                                </Select.Content>
                            </Select.Positioner>
                        </Select.Root>
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Column Label</Field.Label>
                        <Input
                            value={n1Value}
                            onChange={handleN1Change}
                            placeholder="Enter group 1 label"
                            bg={inputBg}
                            borderColor={borderColor}
                            color={textColor}
                            _focus={{ borderColor: focusBorderColor }}
                        />
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Row Field</Field.Label>
                        <Select.Root
                            collection={groupFieldCollection.collection}
                            value={g2Value ? [g2Value] : []}
                            onValueChange={handleG2Change}
                        >
                            <Select.HiddenSelect />
                            <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                <Select.Trigger>
                                    <Select.ValueText placeholder="Select row field" />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Select.Positioner>
                                <Select.Content>
                                    {groupFieldItems.map((item) => (
                                        <Select.Item key={item.value} item={item}>
                                            <Select.ItemText>{item.label}</Select.ItemText>
                                        </Select.Item>
                                    ))}
                                </Select.Content>
                            </Select.Positioner>
                        </Select.Root>
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Row Label</Field.Label>
                        <Input
                            value={n2Value}
                            onChange={handleN2Change}
                            placeholder="Enter group 2 label"
                            bg={inputBg}
                            borderColor={borderColor}
                            color={textColor}
                            _focus={{ borderColor: focusBorderColor }}
                        />
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Metric</Field.Label>
                        <Select.Root
                            collection={metricCollection.collection}
                            value={metricValue ? [metricValue] : ['rate']}
                            onValueChange={handleMetricChange}
                        >
                            <Select.HiddenSelect />
                            <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                <Select.Trigger>
                                    <Select.ValueText />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Select.Positioner>
                                <Select.Content>
                                    {metricItems.map((item) => (
                                        <Select.Item key={item.value} item={item}>
                                            <Select.ItemText>{item.label}</Select.ItemText>
                                        </Select.Item>
                                    ))}
                                </Select.Content>
                            </Select.Positioner>
                        </Select.Root>
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Color Field</Field.Label>
                        <Input
                            value={colorValue}
                            onChange={handleColorChange}
                            placeholder="Enter color field"
                            bg={inputBg}
                            borderColor={borderColor}
                            color={textColor}
                            _focus={{ borderColor: focusBorderColor }}
                        />
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label>Invert X-Y Axis</Field.Label>
                        <Switch.Root
                            checked={invertedValue}
                            onCheckedChange={handleInvertedChange}
                            colorPalette="blue"
                        >
                            <Switch.HiddenInput />
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch.Root>
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label>Weighted</Field.Label>
                        <Switch.Root
                            checked={weightedValue}
                            onCheckedChange={handleWeightedChange}
                            colorPalette="blue"
                        >
                            <Switch.HiddenInput />
                            <Switch.Control>
                                <Switch.Thumb />
                            </Switch.Control>
                        </Switch.Root>
                    </Field.Root>
                </HStack>

                <HStack gap={4}>
                    <Field.Root flex="2">
                        <Heading size="md" color={textColor}>Execution IDs (comma-separated)</Heading>
                        <Input
                            value={execIdsValue}
                            onChange={handleExecIdsChange}
                            placeholder="Enter execution IDs (e.g., 1,2,3)"
                            bg={inputBg}
                            borderColor={borderColor}
                            color={textColor}
                            _focus={{ borderColor: focusBorderColor }}
                        />
                    </Field.Root>

                    <Field.Root flex="1">
                        <Field.Label color={textColor}>Profile</Field.Label>
                        <Select.Root
                            collection={profileCollection.collection}
                            value={profileValue ? [profileValue] : []}
                            onValueChange={handleProfileChange}
                        >
                            <Select.HiddenSelect />
                            <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                <Select.Trigger>
                                    <Select.ValueText placeholder="Select profile" />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Select.Positioner>
                                <Select.Content>
                                    {profileItems.map((item) => (
                                        <Select.Item key={item.value} item={item}>
                                            <Select.ItemText>{item.label}</Select.ItemText>
                                        </Select.Item>
                                    ))}
                                </Select.Content>
                            </Select.Positioner>
                        </Select.Root>
                    </Field.Root>
                </HStack>


                <HStack>
                    {/* Extra Fields Section */}
                    <Box
                        borderWidth={1}
                        borderRadius="md"
                        width="50%"
                        p={4}
                        bg={cardBg}
                        borderColor={borderColor}
                    >
                        <VStack align="stretch" gap={4}>
                            <Heading size="md" color={textColor}>Extra Fields</Heading>
                            {/* Add Field Form as the first row */}
                            <HStack>
                                <Field.Root>
                                    <Select.Root
                                        collection={fieldCollection.collection}
                                        value={selectedField ? [selectedField] : []}
                                        onValueChange={(details) => setSelectedField(details.value[0] || '')}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select a field" />
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
                                </Field.Root>
                                <Field.Root>
                                    <Input
                                        value={fieldAlias}
                                        onChange={(e) => setFieldAlias(e.target.value)}
                                        placeholder="Field Alias (optional)"
                                        bg={inputBg}
                                        borderColor={borderColor}
                                        color={textColor}
                                        _focus={{ borderColor: focusBorderColor }}
                                    />
                                </Field.Root>
                                <Button
                                    onClick={addExtraField}
                                    bg={blueButtonBg}
                                    color="white"
                                    whiteSpace="nowrap"
                                    minW="110px"
                                    maxW="140px"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    _hover={{ bg: blueButtonHoverBg }}
                                >
                                    <LuPlus style={{ marginRight: '8px' }} />
                                    Add Field
                                </Button>
                            </HStack>
                            {/* List of added extra fields */}
                            {extraFields.length > 0 && (
                                <Box p={2.5}>
                                    {extraFields.map((field, index) => (
                                        <HStack key={index} justify="space-between" mb={2}>
                                            <Text color={textColor}>
                                                <b>{field.field}</b> as <b>{field.alias}</b>
                                            </Text>
                                            <Button
                                                onClick={() => removeExtraField(index)}
                                                size="sm"
                                                variant="ghost"
                                                color={textColor}
                                                _hover={{ bg: redButtonHoverBg }}
                                            >
                                                <LuTrash2 style={{ marginRight: '4px' }} />
                                                Remove
                                            </Button>
                                        </HStack>
                                    ))}
                                </Box>
                            )}
                        </VStack>
                    </Box>

                    {/* Relative View Configuration Form */}
                    {(
                        <Box
                            borderWidth={1}
                            borderRadius="md"
                            width="50%"
                            height="100%"
                            p={4}
                            bg={relativeViewBg}
                            borderColor={borderColor}
                        >
                            <VStack align="stretch" gap={4}>
                                <HStack gap={4}>
                                    <Heading size="md" color={textColor}>Relative View Configuration</Heading>
                                    <Switch.Root
                                        checked={isRelativeView}
                                        onCheckedChange={handleRelativeViewToggle}
                                        disabled={false}
                                        colorPalette="green"
                                        size="md"
                                    >
                                        <Switch.HiddenInput />
                                        <Switch.Control>
                                            <Switch.Thumb />
                                        </Switch.Control>
                                    </Switch.Root>
                                </HStack>

                                <HStack gap={4}>
                                    <Field.Root flex="1">
                                        <Field.Label>Relative Column</Field.Label>
                                        <Select.Root
                                            collection={columnCollection.collection}
                                            value={relativeColumn ? [relativeColumn] : []}
                                            onValueChange={handleRelativeColumnChange}
                                        >
                                            <Select.HiddenSelect />
                                            <Select.Control>
                                                <Select.Trigger>
                                                    <Select.ValueText placeholder="Select column for relative calculations" />
                                                </Select.Trigger>
                                                <Select.IndicatorGroup>
                                                    <Select.Indicator />
                                                </Select.IndicatorGroup>
                                            </Select.Control>
                                            <Select.Positioner>
                                                <Select.Content>
                                                    {columnItems.map((item) => (
                                                        <Select.Item key={item.value} item={item}>
                                                            <Select.ItemText>{item.label}</Select.ItemText>
                                                        </Select.Item>
                                                    ))}
                                                </Select.Content>
                                            </Select.Positioner>
                                        </Select.Root>
                                    </Field.Root>
                                    <Field.Root flex="1">
                                        <Field.Label color={textColor}>Baseline Value</Field.Label>
                                        <Select.Root
                                            collection={baselineCollection.collection}
                                            value={relativeBaseline ? [relativeBaseline] : []}
                                            onValueChange={handleRelativeBaselineChange}
                                            disabled={!relativeColumn}
                                        >
                                            <Select.HiddenSelect />
                                            <Select.Control bg={selectBg} borderColor={borderColor} color={textColor}>
                                                <Select.Trigger>
                                                    <Select.ValueText placeholder="Select baseline value" />
                                                </Select.Trigger>
                                                <Select.IndicatorGroup>
                                                    <Select.Indicator />
                                                </Select.IndicatorGroup>
                                            </Select.Control>
                                            <Select.Positioner>
                                                <Select.Content>
                                                    {baselineItems.map((item) => (
                                                        <Select.Item key={item.value} item={item}>
                                                            <Select.ItemText>{item.label}</Select.ItemText>
                                                        </Select.Item>
                                                    ))}
                                                </Select.Content>
                                            </Select.Positioner>
                                        </Select.Root>
                                    </Field.Root>
                                </HStack>
                                {relativeColumn && relativeBaseline && (
                                    <Text fontSize="sm" color={mutedTextColor}>
                                        Values will be calculated relative to {relativeColumn} = "{relativeBaseline.replace(/"/g, '')}"
                                    </Text>
                                )}
                            </VStack>
                        </Box>
                    )}
                </HStack>





                {/* Save Query Button */}
                <HStack justify="center" gap={4}>
                    <Button
                        onClick={onSaveModalOpen}
                        size="md"
                        bg={greenButtonBg}
                        color="white"
                        _hover={{ bg: greenButtonHoverBg }}
                    >
                        Save Query
                    </Button>
                    <Button
                        onClick={onLoadModalOpen}
                        size="md"
                        bg={blueButtonBg}
                        color="white"
                        _hover={{ bg: blueButtonHoverBg }}
                    >
                        Load Query
                    </Button>
                    <Tooltip content="Copy data as JSON">
                        <Button
                            onClick={copyJsonToClipboard}
                            variant="outline"
                            size="md"
                            disabled={!relativeData || relativeData.length === 0}
                            borderColor={borderColor}
                            color={textColor}
                            _hover={{ bg: buttonHoverBg }}
                            _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                        >
                            <LuCopy style={{ marginRight: '8px' }} />
                            Copy as JSON
                        </Button>
                    </Tooltip>
                    <Tooltip content="Copy data as CSV">
                        <Button
                            onClick={copyCsvToClipboard}
                            variant="outline"
                            size="md"
                            disabled={!relativeData || relativeData.length === 0}
                            borderColor={borderColor}
                            color={textColor}
                            _hover={{ bg: buttonHoverBg }}
                            _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                        >
                            <LuDownload style={{ marginRight: '8px' }} />
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
            <Dialog.Root open={isSaveModalOpen} onOpenChange={(details) => setSaveModalOpen(details.open)}>
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
                                    <Field.Label color={textColor}>Query Name</Field.Label>
                                    <Input
                                        value={saveQueryName}
                                        onChange={(e) => setSaveQueryName(e.target.value)}
                                        placeholder="Enter a name for your query"
                                        bg={inputBg}
                                        borderColor={borderColor}
                                        color={textColor}
                                        _focus={{ borderColor: focusBorderColor }}
                                    />
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button
                                        onClick={handleSaveQuery}
                                        width="100%"
                                        bg={blueButtonBg}
                                        color="white"
                                        _hover={{ bg: blueButtonHoverBg }}
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        onClick={onSaveModalClose}
                                        width="100%"
                                        variant="outline"
                                        borderColor={borderColor}
                                        color={textColor}
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
                                        .filter((query: any) => query.query.url === '/grouped')
                                        .map((query: any) => (
                                            <Box
                                                key={query._id}
                                                p={4}
                                                borderWidth={1}
                                                borderRadius="md"
                                                cursor="pointer"
                                                bg={cardBg}
                                                borderColor={borderColor}
                                                _hover={{ bg: cardHoverBg }}
                                                onClick={() => handleLoadQuery(query)}
                                            >
                                                <HStack justify="space-between">
                                                    <VStack align="start" gap={1}>
                                                        <Text fontWeight="medium" color={textColor}>{query.name}</Text>
                                                        <Text fontSize="sm" color={mutedTextColor}>
                                                            Created: {new Date(query.created_time).toLocaleString()}
                                                        </Text>
                                                    </VStack>
                                                    <Button
                                                        size="sm"
                                                        bg={blueButtonBg}
                                                        color="white"
                                                        _hover={{ bg: blueButtonHoverBg }}
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
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};

export default GroupedView;
