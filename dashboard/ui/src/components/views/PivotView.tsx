import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Text,
    Heading,
    Button,
    Dialog,
    Select,
    Input,
    Badge,
    Grid,
    GridItem,
    ButtonGroup,
    useToken,
    useDisclosure,
    Field,
    useListCollection,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import { getAllSavedQueries, saveQuery } from '../../services/api';
import { PivotTableView } from './PivotTableView';
import { PivotIframeView } from './PivotIframeView';

interface PivotField {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    operator?: string;
    value?: string;
    aggregators?: string[];  // For value fields - multiple aggregators
}

// Add these interfaces for the edit modals
interface EditableValue {
    field: string;
    aggregators: string[];
}

interface EditableFilter {
    field: string;
    operator: string;
    value: string;
}

export const PivotView = () => {
    usePageTitle('Pivot View');

    const [isOpen, setIsOpen] = useState(false);
    const onOpen = () => setIsOpen(true);
    const onClose = () => setIsOpen(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedField, setSelectedField] = useState<PivotField | null>(null);
    const [isRelativePivot, setIsRelativePivot] = useState(() => {
        const relative = searchParams.get('relative');
        return relative === 'true';
    });
    const [viewMode, setViewMode] = useState<'iframe' | 'table'>(() => {
        const mode = searchParams.get('mode');
        return mode === 'iframe' ? 'iframe' : 'table'; // Default to SQL (table)
    });
    const [fields, setFields] = useState<PivotField[]>([
        { field: 'Exec:name', type: 'row' },
        { field: 'Pack:name', type: 'row' },
        { field: 'Metric:name', type: 'column' },
        { field: 'Metric:value', type: 'value', aggregators: ['avg'] },
    ]);
    const dropZonesRef = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const [triggerGeneration, setTriggerGeneration] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [executionTime, setExecutionTime] = useState<number | null>(null);
    const [hasInitialized, setHasInitialized] = useState(false);

    // Theme-aware colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const fieldsPanelBg = useColorModeValue('gray.50', 'gray.800');
    const fieldItemBg = useColorModeValue('white', 'gray.700');
    const fieldItemHoverBg = useColorModeValue('gray.50', 'gray.600');
    const fieldItemBorderHover = useColorModeValue('gray.300', 'gray.600');
    const fieldItemShadow = useColorModeValue('sm', 'dark-lg');

    // Color tokens for drop zones
    const [blue50, blue200, blue300, blue400, blue500, blue600] = useToken('colors', ['blue.50', 'blue.200', 'blue.300', 'blue.400', 'blue.500', 'blue.600']);
    const [green50, green200, green300, green400, green600] = useToken('colors', ['green.50', 'green.200', 'green.300', 'green.400', 'green.600']);
    const [purple50, purple200, purple300, purple400, purple600] = useToken('colors', ['purple.50', 'purple.200', 'purple.300', 'purple.400', 'purple.600']);
    const [orange50, orange200, orange300, orange400, orange600] = useToken('colors', ['orange.50', 'orange.200', 'orange.300', 'orange.400', 'orange.600']);

    // Theme-aware drop zone colors - keep colors visible in both modes
    const rowBg = useColorModeValue(blue50, 'blue.950');
    const rowBorder = useColorModeValue(blue200, 'blue.700');
    const rowBorderHover = useColorModeValue(blue300, 'blue.600');
    const rowText = useColorModeValue(blue400, blue300);
    const rowHeading = useColorModeValue(blue600, blue400);

    const colBg = useColorModeValue(green50, 'green.950');
    const colBorder = useColorModeValue(green200, 'green.700');
    const colBorderHover = useColorModeValue(green300, 'green.600');
    const colText = useColorModeValue(green400, green300);
    const colHeading = useColorModeValue(green600, green400);

    const valueBg = useColorModeValue(purple50, 'purple.950');
    const valueBorder = useColorModeValue(purple200, 'purple.700');
    const valueBorderHover = useColorModeValue(purple300, 'purple.600');
    const valueText = useColorModeValue(purple400, purple300);
    const valueHeading = useColorModeValue(purple600, purple400);
    const valueItemBg = useColorModeValue('white', 'gray.700');
    const valueItemHoverBg = useColorModeValue(purple50, 'purple.900');

    const filterBg = useColorModeValue(orange50, 'orange.950');
    const filterBorder = useColorModeValue(orange200, 'orange.700');
    const filterBorderHover = useColorModeValue(orange300, 'orange.600');
    const filterText = useColorModeValue(orange400, orange300);
    const filterHeading = useColorModeValue(orange600, orange400);
    const filterItemBg = useColorModeValue('white', 'gray.700');
    const filterItemHoverBg = useColorModeValue(orange50, 'orange.900');
    const queryItemHoverBg = useColorModeValue('gray.50', 'gray.700');
    const buttonHoverBg = useColorModeValue('gray.100', 'gray.700');

    // Theme colors for drag handlers
    // Helper to convert hex to rgba
    const hexToRgba = (hex: string, alpha: number): string => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            const r = parseInt(result[1], 16);
            const g = parseInt(result[2], 16);
            const b = parseInt(result[3], 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return `rgba(59, 130, 246, ${alpha})`; // fallback
    };
    const dragOverBg = useColorModeValue(hexToRgba(blue500, 0.1), hexToRgba(blue400, 0.1));
    const dragOverBorder = useColorModeValue(blue500, blue400);

    // Collections for Select components
    const operatorItems = [
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
    ];
    const operatorCollection = useListCollection({ initialItems: operatorItems });

    const aggregatorItems = [
        { label: 'Average', value: 'avg' },
        { label: 'Sum', value: 'sum' },
        { label: 'Count', value: 'count' },
        { label: 'Minimum', value: 'min' },
        { label: 'Maximum', value: 'max' },
        { label: 'Standard Deviation', value: 'std' },
        { label: 'Variance', value: 'var' },
        { label: 'Median', value: 'median' },
    ];
    const aggregatorCollection = useListCollection({ initialItems: aggregatorItems });

    // Save/Load modal state
    const { open: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose, setOpen: setSaveModalOpen } = useDisclosure();
    const { open: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose, setOpen: setLoadModalOpen } = useDisclosure();
    const [saveQueryName, setSaveQueryName] = useState<string>('');

    // Edit modals state
    const [isEditValueOpen, setIsEditValueOpen] = useState(false);
    const onEditValueOpen = () => setIsEditValueOpen(true);
    const onEditValueClose = () => setIsEditValueOpen(false);
    const [isEditFilterOpen, setIsEditFilterOpen] = useState(false);
    const onEditFilterOpen = () => setIsEditFilterOpen(true);
    const onEditFilterClose = () => setIsEditFilterOpen(false);
    const [editingValueIndex, setEditingValueIndex] = useState<number>(-1);
    const [editingFilterIndex, setEditingFilterIndex] = useState<number>(-1);
    const [editableValue, setEditableValue] = useState<EditableValue>({ field: '', aggregators: ['avg'] });
    const [editableFilter, setEditableFilter] = useState<EditableFilter>({ field: '', operator: '==', value: '' });

    // Fetch available fields from /api/keys
    const { data: availableFields } = useQuery({
        queryKey: ['pivotFields'],
        queryFn: async () => {
            const response = await axios.get('/api/keys');
            return response.data;
        },
    });

    // Fetch saved queries for load functionality
    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    // Load configuration from URL on mount and auto-execute query if URL has parameters
    useEffect(() => {
        const rows = searchParams.get('rows');
        const cols = searchParams.get('cols');
        const values = searchParams.get('values');
        const filters = searchParams.get('filters');

        if (rows || cols || values || filters) {
            const newFields: PivotField[] = [];

            if (rows) {
                rows.split(',').forEach(field => {
                    newFields.push({ field, type: 'row' });
                });
            }

            if (cols) {
                cols.split(',').forEach(field => {
                    newFields.push({ field, type: 'column' });
                });
            }

            if (values) {
                try {
                    const decodedValues = JSON.parse(atob(values));
                    if (Array.isArray(decodedValues)) {
                        decodedValues.forEach((value: any) => {
                            if (value.field) {
                                newFields.push({
                                    field: value.field,
                                    type: 'value',
                                    aggregators: value.aggregators || ['avg']
                                });
                            }
                        });
                    }
                } catch (error) {
                    // Fallback to old format (comma-separated string)
                    values.split(',').forEach(field => {
                        if (field.trim()) {
                            newFields.push({
                                field: field.trim(),
                                type: 'value',
                                aggregators: ['avg']
                            });
                        }
                    });
                }
            }

            if (filters) {
                try {
                    const decodedFilters = JSON.parse(atob(filters));
                    decodedFilters.forEach((filter: any) => {
                        newFields.push({
                            field: filter.field,
                            type: 'filter',
                            operator: filter.operator,
                            value: filter.value
                        });
                    });
                } catch (error) {
                    console.error('Error parsing filters from URL:', error);
                }
            }

            if (newFields.length > 0) {
                setFields(newFields);
            }
        }
        // Mark as initialized without auto-executing
        if (!hasInitialized) {
            setHasInitialized(true);
        }
    }, [searchParams, hasInitialized]);

    // Auto-update URL when fields change (but not on initial load)
    useEffect(() => {
        if (hasInitialized) {
            updateURLParams();
        }
    }, [fields, isRelativePivot, viewMode, hasInitialized]);

    // Reset timing when view mode changes
    useEffect(() => {
        setExecutionTime(null);
        setGenerationStartTime(null);
    }, [viewMode]);

    const handleFieldDrop = (type: 'row' | 'column' | 'value' | 'filter', field: string) => {
        if (type === 'filter') {
            setSelectedField({ field, type });
            onOpen();
        } else if (type === 'value') {
            // Default aggregator for new value fields
            setFields([...fields, { field, type, aggregators: ['avg'] }]);
        } else {
            setFields([...fields, { field, type }]);
        }
    };

    const handleFilterApply = (operator: string, value: string) => {
        if (selectedField) {
            setFields([...fields, { ...selectedField, operator, value }]);
            onClose();
        }
    };

    const handleEditValue = (index: number) => {
        const field = fields[index];
        setEditingValueIndex(index);
        setEditableValue({
            field: field.field,
            aggregators: field.aggregators || ['avg']
        });
        onEditValueOpen();
    };

    const handleEditFilter = (index: number) => {
        const field = fields[index];
        setEditingFilterIndex(index);
        setEditableFilter({
            field: field.field,
            operator: field.operator || '==',
            value: field.value || ''
        });
        onEditFilterOpen();
    };

    const handleValueSave = () => {
        if (editingValueIndex >= 0) {
            const newFields = [...fields];
            newFields[editingValueIndex] = {
                ...newFields[editingValueIndex],
                aggregators: editableValue.aggregators
            };
            setFields(newFields);
            onEditValueClose();
        }
    };

    const handleFilterSave = () => {
        if (editingFilterIndex >= 0) {
            const newFields = [...fields];
            newFields[editingFilterIndex] = {
                ...newFields[editingFilterIndex],
                operator: editableFilter.operator,
                value: editableFilter.value
            };
            setFields(newFields);
            onEditFilterClose();
        }
    };

    const removeField = (index: number) => {
        const newFields = [...fields];
        newFields.splice(index, 1);
        setFields(newFields);
    };

    const updateURLParams = useCallback(() => {
        const params = new URLSearchParams();

        const rows = fields.filter(f => f.type === 'row').map(f => f.field);
        const cols = fields.filter(f => f.type === 'column').map(f => f.field);
        const values = fields.filter(f => f.type === 'value').map(f => ({
            field: f.field,
            aggregators: f.aggregators || ['avg']
        }));

        params.append('rows', rows.join(','));
        params.append('cols', cols.join(','));
        params.append('values', btoa(JSON.stringify(values)));

        const filters = fields.filter(f => f.type === 'filter').map(f => ({
            field: f.field,
            operator: f.operator,
            value: f.value
        }));

        if (filters.length > 0) {
            params.append('filters', btoa(JSON.stringify(filters)));
        }

        // Add mode parameter
        params.append('mode', viewMode);

        // Add relative pivot parameter
        if (isRelativePivot) {
            params.append('relative', 'true');
        }

        // Update URL with current configuration
        setSearchParams(params);
    }, [fields, viewMode, isRelativePivot, setSearchParams]);

    const handleModeChange = useCallback((newMode: 'iframe' | 'table') => {
        setViewMode(newMode);
        // Update URL immediately when mode changes
        const params = new URLSearchParams(searchParams);
        params.set('mode', newMode);
        setSearchParams(params);
    }, [searchParams, setSearchParams]);

    const handleRelativePivotChange = useCallback((newValue: boolean) => {
        setIsRelativePivot(newValue);
        // Update URL immediately when relative pivot changes
        const params = new URLSearchParams(searchParams);
        if (newValue) {
            params.set('relative', 'true');
        } else {
            params.delete('relative');
        }
        setSearchParams(params);
    }, [searchParams, setSearchParams]);

    const resetPivot = () => {
        setFields([
            { field: 'Exec:name', type: 'row' },
            { field: 'Pack:name', type: 'row' },
            { field: 'Metric:name', type: 'column' },
            { field: 'Metric:value', type: 'value', aggregators: ['avg'] },
        ]);
        setViewMode('iframe');
        setIsRelativePivot(false);
        setSearchParams(new URLSearchParams());
    };

    const generatePivot = () => {
        // Start timing
        setGenerationStartTime(performance.now());
        setExecutionTime(null);

        // Increment trigger to signal child components to generate
        console.log('Generate pivot triggered from PivotView');
        setTriggerGeneration(true);
    };


    const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);

    const handleGenerationComplete = () => {
        if (generationStartTime) {
            const endTime = performance.now();
            const duration = endTime - generationStartTime;
            setExecutionTime(duration);
            setGenerationStartTime(null);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLDivElement;
        const dropZone = target.getAttribute('data-drop-zone');

        switch (dropZone) {
            case 'row':
                target.style.backgroundColor = 'var(--chakra-colors-blue-100)';
                target.style.borderColor = 'var(--chakra-colors-blue-400)';
                break;
            case 'column':
                target.style.backgroundColor = 'var(--chakra-colors-green-100)';
                target.style.borderColor = 'var(--chakra-colors-green-400)';
                break;
            case 'value':
                target.style.backgroundColor = 'var(--chakra-colors-purple-100)';
                target.style.borderColor = 'var(--chakra-colors-purple-400)';
                break;
            case 'filter':
                target.style.backgroundColor = 'var(--chakra-colors-orange-100)';
                target.style.borderColor = 'var(--chakra-colors-orange-400)';
                break;
            default:
                target.style.backgroundColor = 'var(--chakra-colors-blue-100)';
                target.style.borderColor = 'var(--chakra-colors-blue-400)';
        }

        target.style.transform = 'scale(1.02)';
        target.style.transition = 'all 0.2s';
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLDivElement;
        target.style.backgroundColor = '';
        target.style.borderColor = '';
        target.style.transform = '';
    };

    const handleDrop = (e: React.DragEvent, type: 'row' | 'column' | 'value' | 'filter') => {
        e.preventDefault();
        const target = e.currentTarget as HTMLDivElement;
        target.style.backgroundColor = '';
        target.style.borderColor = '';
        target.style.transform = '';

        const draggedData = e.dataTransfer.getData('text/plain');

        // Check if we're reordering an existing field
        const reorderData = e.dataTransfer.getData('application/json');
        if (reorderData) {
            try {
                const { fieldIndex, sourceType } = JSON.parse(reorderData);
                handleFieldReorder(fieldIndex, sourceType, type);
            } catch (error) {
                console.error('Error parsing reorder data:', error);
            }
        } else {
            // Adding a new field
            handleFieldDrop(type, draggedData);
        }
    };

    const handleFieldReorder = (sourceIndex: number, sourceType: string, targetType: string) => {
        const newFields = [...fields];
        const sourceField = newFields[sourceIndex];

        if (sourceType === targetType) {
            // Reordering within the same type - move to end of the type group
            newFields.splice(sourceIndex, 1);

            // Find the position to insert at the end of the same type group

            const firstSameTypeIndex = newFields.findIndex(f => f.type === targetType);

            if (firstSameTypeIndex === -1) {
                // No other fields of this type, add at the end
                newFields.push(sourceField);
            } else {
                // Find the last position of this type
                let lastSameTypeIndex = firstSameTypeIndex;
                for (let i = firstSameTypeIndex; i < newFields.length; i++) {
                    if (newFields[i].type === targetType) {
                        lastSameTypeIndex = i;
                    } else {
                        break;
                    }
                }
                newFields.splice(lastSameTypeIndex + 1, 0, sourceField);
            }

            setFields(newFields);
        } else {
            // Moving to a different type - remove from source and add to target
            newFields.splice(sourceIndex, 1);
            const updatedField = { ...sourceField, type: targetType as 'row' | 'column' | 'value' | 'filter' };

            if (targetType === 'filter') {
                // Handle filter fields specially
                setSelectedField(updatedField);
                setFields(newFields); // Update fields to remove the original
                onOpen();
                return;
            } else if (targetType === 'value' && !updatedField.aggregators) {
                // Add default aggregator for value fields
                updatedField.aggregators = ['avg'];
            }

            newFields.push(updatedField);
            setFields(newFields);
        }
    };

    const handleFieldDragStart = (e: React.DragEvent, fieldIndex: number, fieldType: string) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            fieldIndex,
            sourceType: fieldType
        }));

        // Add visual feedback
        const target = e.currentTarget as HTMLElement;
        target.style.opacity = '0.5';
        target.style.transform = 'scale(0.95)';
    };

    const handleFieldDragEnd = (e: React.DragEvent) => {
        const target = e.currentTarget as HTMLElement;
        target.style.opacity = '1';
        target.style.transform = 'scale(1)';
    };



    // Add drop zones between fields for precise positioning
    const handleFieldDropZone = (e: React.DragEvent, beforeIndex: number, zoneType: string) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = '';
        target.style.borderTop = '';

        const reorderData = e.dataTransfer.getData('application/json');
        if (reorderData) {
            try {
                const { fieldIndex, sourceType } = JSON.parse(reorderData);

                if (sourceType === zoneType) {
                    // Reordering within the same zone - use precise positioning
                    handlePreciseReorder(fieldIndex, beforeIndex, zoneType);
                } else {
                    // Moving between different zones
                    handleFieldReorder(fieldIndex, sourceType, zoneType);
                }
            } catch (error) {
                console.error('Error parsing reorder data:', error);
            }
        }
    };

    const handlePreciseReorder = (sourceIndex: number, beforeIndex: number, zoneType: string) => {
        const newFields = [...fields];
        const sourceField = newFields[sourceIndex];

        // Remove source field
        newFields.splice(sourceIndex, 1);

        // Get fields of the same type in their current order
        const sameTypeIndices: number[] = [];
        newFields.forEach((field, index) => {
            if (field.type === zoneType) {
                sameTypeIndices.push(index);
            }
        });

        // Determine insertion position
        let insertIndex;
        if (beforeIndex === -1 || beforeIndex >= sameTypeIndices.length) {
            // Insert at the end of the zone
            insertIndex = sameTypeIndices.length > 0 ? sameTypeIndices[sameTypeIndices.length - 1] + 1 : newFields.length;
        } else {
            // Adjust the beforeIndex based on the removal
            const adjustedBeforeIndex = beforeIndex;
            insertIndex = sameTypeIndices[adjustedBeforeIndex] || newFields.length;
        }

        // Insert the field at the new position
        newFields.splice(insertIndex, 0, sourceField);
        setFields(newFields);
    };

    const handleFieldDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = dragOverBg;
        target.style.borderTop = `2px solid ${dragOverBorder}`;
    };

    const handleFieldDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = '';
        target.style.borderTop = '';
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
            // Create the query object with current pivot configuration
            const queryData = {
                url: '/pivot',
                parameters: {
                    rows: fields.filter(f => f.type === 'row').map(f => f.field).join(','),
                    cols: fields.filter(f => f.type === 'column').map(f => f.field).join(','),
                    values: btoa(JSON.stringify(fields.filter(f => f.type === 'value').map(f => ({
                        field: f.field,
                        aggregators: f.aggregators || ['avg']
                    })))),
                    filters: fields.filter(f => f.type === 'filter').length > 0 ?
                        btoa(JSON.stringify(fields.filter(f => f.type === 'filter').map(f => ({
                            field: f.field,
                            operator: f.operator,
                            value: f.value
                        })))) : '',
                    isRelativePivot: isRelativePivot,
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

        if (url === '/pivot') {
            // Load pivot-specific parameters
            const newFields: PivotField[] = [];

            // Load rows
            if (parameters.rows) {
                parameters.rows.split(',').forEach((field: string) => {
                    if (field.trim()) {
                        newFields.push({ field: field.trim(), type: 'row' });
                    }
                });
            }

            // Load columns
            if (parameters.cols) {
                parameters.cols.split(',').forEach((field: string) => {
                    if (field.trim()) {
                        newFields.push({ field: field.trim(), type: 'column' });
                    }
                });
            }

            // Load values
            if (parameters.values) {
                try {
                    const decodedValues = JSON.parse(atob(parameters.values));
                    if (Array.isArray(decodedValues)) {
                        decodedValues.forEach((value: any) => {
                            if (value.field) {
                                newFields.push({
                                    field: value.field,
                                    type: 'value',
                                    aggregators: value.aggregators || ['avg']
                                });
                            }
                        });
                    }
                } catch (error) {
                    // Fallback to old format (comma-separated string)
                    parameters.values.split(',').forEach((field: string) => {
                        if (field.trim()) {
                            newFields.push({
                                field: field.trim(),
                                type: 'value',
                                aggregators: ['avg']
                            });
                        }
                    });
                }
            }

            // Load filters
            if (parameters.filters) {
                try {
                    const decodedFilters = JSON.parse(atob(parameters.filters));
                    decodedFilters.forEach((filter: any) => {
                        newFields.push({
                            field: filter.field,
                            type: 'filter',
                            operator: filter.operator,
                            value: filter.value
                        });
                    });
                } catch (error) {
                    console.error('Error parsing filters from saved query:', error);
                }
            }

            // Set fields and view type
            setFields(newFields);
            if (parameters.isRelativePivot !== undefined) {
                setIsRelativePivot(parameters.isRelativePivot);
            }

            // Fields are automatically used by child components

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
            window.location.href = fullUrl;
        }

        onLoadModalClose();
    };

    return (
        <Box p={4} h="100vh" display="flex" flexDirection="column" bg={pageBg}>
            <HStack justify="space-between" mb={6}>
                <Heading color={textColor}>Pivot View</Heading>
                <HStack gap={4}>
                    <Button
                        colorScheme="green"
                        onClick={onSaveModalOpen}
                    // leftIcon={<LuPlus />}
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

            <Grid templateColumns="360px 1fr" gap={6} templateRows="200px 50px auto" flex="1" minH="0" className="pivot-view-grid" width="99%">
                {/* Fields Panel */}
                <GridItem rowSpan={3} colSpan={1} className="pivot-fields">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color={mutedTextColor}>Available Fields</Heading>
                        <Box
                            h="calc(100vh - 170px)"
                            overflowY="auto"
                            bg={fieldsPanelBg}
                            borderRadius="md"
                            p={3}
                            borderWidth={1}
                            borderColor={borderColor}
                        >
                            <VStack align="stretch" gap={2}>
                                {availableFields?.map((field: string) => (
                                    <Box
                                        key={field}
                                        p={3}
                                        bg={fieldItemBg}
                                        borderWidth={1}
                                        borderColor={borderColor}
                                        borderRadius="md"
                                        cursor="move"
                                        _hover={{
                                            bg: fieldItemHoverBg,
                                            borderColor: fieldItemBorderHover,
                                            transform: 'translateY(-1px)',
                                            boxShadow: fieldItemShadow
                                        }}
                                        transition="all 0.2s"
                                        draggable
                                        onDragStart={(e) => e.dataTransfer.setData('text/plain', field)}
                                        overflowX="hidden"
                                        textOverflow="ellipsis"
                                        whiteSpace="nowrap"
                                        fontSize="sm"
                                        fontWeight="medium"
                                        color={textColor}
                                    >
                                        {field}
                                    </Box>
                                ))}
                            </VStack>
                        </Box>
                    </VStack>
                </GridItem>

                <GridItem colStart={2} rowSpan={1} className="pivot-builder">
                    <HStack align="stretch" gap={4}>
                        {/* Rows */}
                        <VStack align="stretch" flex="1" gap={2}>
                            <Heading size="sm" color={rowHeading}>Rows</Heading>
                            <Box
                                ref={(el: HTMLDivElement | null) => { dropZonesRef.current['row'] = el; }}
                                p={4}
                                bg={rowBg}
                                borderWidth={2}
                                borderStyle="dashed"
                                borderColor={rowBorder}
                                borderRadius="md"
                                minH="150px"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'row')}
                                _hover={{
                                    borderColor: rowBorderHover
                                }}
                                transition="all 0.2s"
                                data-drop-zone="row"
                            >
                                {fields
                                    .filter((f) => f.type === 'row')
                                    .map((field, index) => {
                                        const globalIndex = fields.findIndex(f => f === field);
                                        return (
                                            <HStack key={`row-${index}`} align="center" gap={0}>
                                                {/* Drop zone before field */}
                                                <Box
                                                    w={2}
                                                    h="20px"
                                                    onDragOver={handleFieldDragOver}
                                                    onDragLeave={handleFieldDragLeave}
                                                    onDrop={(e) => handleFieldDropZone(e, index, 'row')}
                                                    cursor="pointer"
                                                />
                                                <Badge
                                                    m={1}
                                                    p={2}
                                                    px={3}
                                                    colorScheme="blue"
                                                    variant="solid"
                                                    cursor="move"
                                                    draggable
                                                    onClick={() => removeField(globalIndex)}
                                                    _hover={{
                                                        bg: 'blue.600',
                                                        transform: 'scale(1.05)'
                                                    }}
                                                    transition="all 0.2s"
                                                    borderRadius="full"
                                                    onDragStart={(e) => handleFieldDragStart(e, globalIndex, 'row')}
                                                    onDragEnd={handleFieldDragEnd}
                                                >
                                                    {field.field} ×
                                                </Badge>
                                                {/* Drop zone after last field */}
                                                {index === fields.filter((f) => f.type === 'row').length - 1 && (
                                                    <Box
                                                        w={2}
                                                        h="20px"
                                                        onDragOver={handleFieldDragOver}
                                                        onDragLeave={handleFieldDragLeave}
                                                        onDrop={(e) => handleFieldDropZone(e, index + 1, 'row')}
                                                        cursor="pointer"
                                                    />
                                                )}
                                            </HStack>
                                        );
                                    })}
                                {fields.filter((f) => f.type === 'row').length === 0 && (
                                    <Text color={rowText} fontSize="sm" textAlign="center" mt={8}>
                                        Drop row fields here
                                    </Text>
                                )}
                            </Box>
                        </VStack>

                        {/* Columns */}
                        <VStack align="stretch" flex="1" gap={2}>
                            <Heading size="sm" color={colHeading}>Columns</Heading>
                            <Box
                                ref={(el: HTMLDivElement | null) => { dropZonesRef.current['column'] = el; }}
                                p={4}
                                bg={colBg}
                                borderWidth={2}
                                borderStyle="dashed"
                                borderColor={colBorder}
                                borderRadius="md"
                                minH="150px"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'column')}
                                _hover={{
                                    borderColor: colBorderHover
                                }}
                                transition="all 0.2s"
                                data-drop-zone="column"
                            >
                                {fields
                                    .filter((f) => f.type === 'column')
                                    .map((field, index) => {
                                        const globalIndex = fields.findIndex(f => f === field);
                                        return (
                                            <HStack key={`column-${index}`} align="center" gap={0}>
                                                {/* Drop zone before field */}
                                                <Box
                                                    w={2}
                                                    h="20px"
                                                    onDragOver={handleFieldDragOver}
                                                    onDragLeave={handleFieldDragLeave}
                                                    onDrop={(e) => handleFieldDropZone(e, index, 'column')}
                                                    cursor="pointer"
                                                />
                                                <Badge
                                                    m={1}
                                                    p={2}
                                                    px={3}
                                                    colorScheme="green"
                                                    variant="solid"
                                                    cursor="move"
                                                    draggable
                                                    onClick={() => removeField(globalIndex)}
                                                    _hover={{
                                                        bg: 'green.600',
                                                        transform: 'scale(1.05)'
                                                    }}
                                                    transition="all 0.2s"
                                                    borderRadius="full"
                                                    onDragStart={(e) => handleFieldDragStart(e, globalIndex, 'column')}
                                                    onDragEnd={handleFieldDragEnd}
                                                >
                                                    {field.field} ×
                                                </Badge>
                                                {/* Drop zone after last field */}
                                                {index === fields.filter((f) => f.type === 'column').length - 1 && (
                                                    <Box
                                                        w={2}
                                                        h="20px"
                                                        onDragOver={handleFieldDragOver}
                                                        onDragLeave={handleFieldDragLeave}
                                                        onDrop={(e) => handleFieldDropZone(e, index + 1, 'column')}
                                                        cursor="pointer"
                                                    />
                                                )}
                                            </HStack>
                                        );
                                    })}
                                {fields.filter((f) => f.type === 'column').length === 0 && (
                                    <Text color={colText} fontSize="sm" textAlign="center" mt={8}>
                                        Drop column fields here
                                    </Text>
                                )}
                            </Box>
                        </VStack>

                        <VStack align="stretch" flex="1" gap={2}>
                            <Heading size="sm" color={valueHeading}>Values</Heading>
                            <Box
                                ref={(el: HTMLDivElement | null) => { dropZonesRef.current['value'] = el; }}
                                p={4}
                                bg={valueBg}
                                borderWidth={2}
                                borderStyle="dashed"
                                borderColor={valueBorder}
                                borderRadius="md"
                                minH="150px"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'value')}
                                _hover={{
                                    borderColor: valueBorderHover
                                }}
                                transition="all 0.2s"
                                data-drop-zone="value"
                            >
                                {fields
                                    .filter((f) => f.type === 'value')
                                    .map((field, index) => {
                                        const fieldIndex = fields.findIndex(f => f === field);
                                        return (
                                            <VStack key={`value-${index}`} align="stretch" gap={0}>
                                                {/* Drop zone before field */}
                                                <Box
                                                    w="100%"
                                                    h={2}
                                                    onDragOver={handleFieldDragOver}
                                                    onDragLeave={handleFieldDragLeave}
                                                    onDrop={(e) => handleFieldDropZone(e, index, 'value')}
                                                    cursor="pointer"
                                                />
                                                <Box
                                                    m={1}
                                                    p={2}
                                                    bg={valueItemBg}
                                                    borderRadius="md"
                                                    borderWidth={1}
                                                    borderColor={valueBorder}
                                                    cursor="move"
                                                    draggable
                                                    _hover={{
                                                        borderColor: valueBorderHover,
                                                        bg: valueItemHoverBg
                                                    }}
                                                    transition="all 0.2s"
                                                    onDragStart={(e) => handleFieldDragStart(e, fieldIndex, 'value')}
                                                    onDragEnd={handleFieldDragEnd}
                                                >
                                                    <VStack align="stretch" gap={2}>
                                                        <HStack gap={2} justify="space-between">
                                                            <Badge
                                                                colorScheme="purple"
                                                                variant="solid"
                                                                cursor="pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEditValue(fieldIndex);
                                                                }}
                                                                _hover={{
                                                                    bg: 'purple.600',
                                                                    transform: 'scale(1.05)'
                                                                }}
                                                                transition="all 0.2s"
                                                                px={3}
                                                                py={1}
                                                                borderRadius="full"
                                                            >
                                                                📝 {field.field}
                                                            </Badge>
                                                            <Badge
                                                                colorScheme="red"
                                                                variant="solid"
                                                                cursor="pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removeField(fieldIndex);
                                                                }}
                                                                _hover={{
                                                                    bg: 'red.600',
                                                                    transform: 'scale(1.05)'
                                                                }}
                                                                transition="all 0.2s"
                                                                borderRadius="full"
                                                                w={6}
                                                                h={6}
                                                                display="flex"
                                                                alignItems="center"
                                                                justifyContent="center"
                                                            >
                                                                ×
                                                            </Badge>
                                                        </HStack>
                                                        <HStack gap={1} flexWrap="wrap">
                                                            {(field.aggregators || ['avg']).map((aggregator, aggIndex) => (
                                                                <Badge
                                                                    key={`${field.field}-${aggregator}-${aggIndex}`}
                                                                    colorScheme="purple"
                                                                    variant="outline"
                                                                    fontSize="xs"
                                                                    px={2}
                                                                    py={1}
                                                                    borderRadius="full"
                                                                >
                                                                    {aggregator.toUpperCase()}
                                                                </Badge>
                                                            ))}
                                                        </HStack>
                                                    </VStack>
                                                </Box>
                                                {/* Drop zone after last field */}
                                                {index === fields.filter((f) => f.type === 'value').length - 1 && (
                                                    <Box
                                                        w="100%"
                                                        h={2}
                                                        onDragOver={handleFieldDragOver}
                                                        onDragLeave={handleFieldDragLeave}
                                                        onDrop={(e) => handleFieldDropZone(e, index + 1, 'value')}
                                                        cursor="pointer"
                                                    />
                                                )}
                                            </VStack>
                                        );
                                    })}
                                {fields.filter((f) => f.type === 'value').length === 0 && (
                                    <Text color={valueText} fontSize="sm" textAlign="center" mt={8}>
                                        Drop value fields here
                                    </Text>
                                )}
                            </Box>
                        </VStack>

                        <VStack align="stretch" flex="1" gap={2}>
                            <Heading size="sm" color={filterHeading}>Filters</Heading>
                            <Box
                                ref={(el: HTMLDivElement | null) => { dropZonesRef.current['filter'] = el; }}
                                p={4}
                                bg={filterBg}
                                borderWidth={2}
                                borderStyle="dashed"
                                borderColor={filterBorder}
                                borderRadius="md"
                                minH="150px"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'filter')}
                                _hover={{
                                    borderColor: filterBorderHover
                                }}
                                transition="all 0.2s"
                                data-drop-zone="filter"
                            >
                                {fields
                                    .filter((f) => f.type === 'filter')
                                    .map((field, index) => {
                                        const fieldIndex = fields.findIndex(f => f === field);
                                        return (
                                            <VStack key={`filter-${index}`} align="stretch" gap={0}>
                                                {/* Drop zone before field */}
                                                <Box
                                                    w="100%"
                                                    h={2}
                                                    onDragOver={handleFieldDragOver}
                                                    onDragLeave={handleFieldDragLeave}
                                                    onDrop={(e) => handleFieldDropZone(e, index, 'filter')}
                                                    cursor="pointer"
                                                />
                                                <Box
                                                    m={1}
                                                    p={2}
                                                    bg={filterItemBg}
                                                    borderRadius="md"
                                                    borderWidth={1}
                                                    borderColor={filterBorder}
                                                    cursor="move"
                                                    draggable
                                                    _hover={{
                                                        borderColor: filterBorderHover,
                                                        bg: filterItemHoverBg
                                                    }}
                                                    transition="all 0.2s"
                                                    onDragStart={(e) => handleFieldDragStart(e, fieldIndex, 'filter')}
                                                    onDragEnd={handleFieldDragEnd}
                                                >
                                                    <HStack gap={2} justify="space-between">
                                                        <Badge
                                                            colorScheme="orange"
                                                            variant="solid"
                                                            cursor="pointer"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEditFilter(fieldIndex);
                                                            }}
                                                            _hover={{
                                                                bg: 'orange.600',
                                                                transform: 'scale(1.05)'
                                                            }}
                                                            transition="all 0.2s"
                                                            px={3}
                                                            py={1}
                                                            borderRadius="full"
                                                        >
                                                            🔍 {field.field} {field.operator} {field.value}
                                                        </Badge>
                                                        <Badge
                                                            colorScheme="red"
                                                            variant="solid"
                                                            cursor="pointer"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                removeField(fieldIndex);
                                                            }}
                                                            _hover={{
                                                                bg: 'red.600',
                                                                transform: 'scale(1.05)'
                                                            }}
                                                            transition="all 0.2s"
                                                            borderRadius="full"
                                                            w={6}
                                                            h={6}
                                                            display="flex"
                                                            alignItems="center"
                                                            justifyContent="center"
                                                        >
                                                            ×
                                                        </Badge>
                                                    </HStack>
                                                </Box>
                                                {/* Drop zone after last field */}
                                                {index === fields.filter((f) => f.type === 'filter').length - 1 && (
                                                    <Box
                                                        w="100%"
                                                        h={2}
                                                        onDragOver={handleFieldDragOver}
                                                        onDragLeave={handleFieldDragLeave}
                                                        onDrop={(e) => handleFieldDropZone(e, index + 1, 'filter')}
                                                        cursor="pointer"
                                                    />
                                                )}
                                            </VStack>
                                        );
                                    })}
                                {fields.filter((f) => f.type === 'filter').length === 0 && (
                                    <Text color={filterText} fontSize="sm" textAlign="center" mt={8}>
                                        Drop filter fields here
                                    </Text>
                                )}
                            </Box>
                        </VStack>
                    </HStack>
                </GridItem>

                <GridItem colStart={2} rowSpan={1} className="pivot-options">
                    <HStack gap={4} align="stretch" flex="1">
                        <ButtonGroup size="sm" attached variant="outline">
                            <Button
                                colorScheme={viewMode === 'iframe' ? 'blue' : 'gray'}
                                variant={viewMode === 'iframe' ? 'solid' : 'outline'}
                                onClick={() => handleModeChange('iframe')}
                                color={viewMode === 'iframe' ? 'white' : textColor}
                                borderColor={viewMode === 'iframe' ? undefined : borderColor}
                                _hover={{
                                    bg: viewMode === 'iframe' ? undefined : buttonHoverBg,
                                    color: viewMode === 'iframe' ? 'white' : textColor
                                }}
                            >
                                Pandas
                            </Button>
                            <Button
                                colorScheme={viewMode === 'table' ? 'blue' : 'gray'}
                                variant={viewMode === 'table' ? 'solid' : 'outline'}
                                onClick={() => handleModeChange('table')}
                                color={viewMode === 'table' ? 'white' : textColor}
                                borderColor={viewMode === 'table' ? undefined : borderColor}
                                _hover={{
                                    bg: viewMode === 'table' ? undefined : buttonHoverBg,
                                    color: viewMode === 'table' ? 'white' : textColor
                                }}
                            >
                                SQL
                            </Button>
                        </ButtonGroup>
                        <Button
                            size="sm"
                            onClick={resetPivot}
                            colorScheme="gray"
                            variant="outline"
                            color={textColor}
                            borderColor={borderColor}
                            _hover={{ bg: buttonHoverBg }}
                        >
                            Reset
                        </Button>
                        <Button
                            size="sm"
                            colorScheme={isRelativePivot ? "green" : "gray"}
                            variant={isRelativePivot ? "solid" : "outline"}
                            onClick={() => handleRelativePivotChange(!isRelativePivot)}
                            color={!isRelativePivot ? textColor : undefined}
                            borderColor={!isRelativePivot ? borderColor : undefined}
                            _hover={{ bg: !isRelativePivot ? buttonHoverBg : undefined }}
                        >
                            {!isRelativePivot ? "Relative View" : "Normal View"}
                        </Button>

                        <Button
                            size="sm"
                            onClick={generatePivot}
                            loading={isGenerating}
                            colorScheme="blue"
                            variant="solid"
                            color="white"
                            _hover={{ color: 'white' }}
                        >
                            Execute Query
                        </Button>
                        {executionTime !== null && (
                            <HStack gap={1} ml={2}>
                                <Text fontSize="sm" color={useColorModeValue('green.600', 'green.400')} fontWeight="semibold">
                                    ✓
                                </Text>
                                <Text fontSize="sm" color={mutedTextColor} fontWeight="medium">
                                    {executionTime < 1000 ? `${executionTime.toFixed(0)}ms` : `${(executionTime / 1000).toFixed(2)}s`}
                                </Text>
                            </HStack>
                        )}
                        {isGenerating && executionTime === null && (
                            <HStack gap={1} ml={2}>
                                <Text fontSize="sm" color={useColorModeValue('blue.600', 'blue.400')} fontWeight="medium">
                                    Generating...
                                </Text>
                            </HStack>
                        )}
                    </HStack>
                </GridItem>

                <GridItem colStart={2} rowSpan={1} className="pivot-result" overflow="auto">
                    {viewMode === 'iframe' ? (
                        <PivotIframeView
                            fields={fields.map(f => f.field)}
                            isRelativePivot={isRelativePivot}
                            triggerGeneration={triggerGeneration}
                            setTriggerGeneration={setTriggerGeneration}
                            setIsGenerating={setIsGenerating}
                            onGenerationComplete={handleGenerationComplete}
                        />
                    ) : (
                        <PivotTableView
                            fields={fields}
                            isRelativePivot={isRelativePivot}
                            triggerGeneration={triggerGeneration}
                            setTriggerGeneration={setTriggerGeneration}
                            setIsGenerating={setIsGenerating}
                            onGenerationComplete={handleGenerationComplete}
                        />
                    )}
                </GridItem>
            </Grid>

            {/* Filter Dialog */}
            <Dialog.Root open={isOpen} onOpenChange={(details) => setIsOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Add Filter</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack gap={4} pb={4}>
                                <Select.Root
                                    collection={operatorCollection.collection}
                                    value={selectedField?.operator ? [selectedField.operator] : []}
                                    onValueChange={(details) => setSelectedField({ ...selectedField!, operator: details.value[0] || '' })}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control>
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select operator" />
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
                                    placeholder="Enter filter value"
                                    onChange={(e) => setSelectedField({ ...selectedField!, value: e.target.value })}
                                />
                                <Button
                                    colorScheme="blue"
                                    onClick={() => {
                                        if (selectedField?.operator && selectedField?.value) {
                                            handleFilterApply(selectedField.operator, selectedField.value);
                                        }
                                    }}
                                >
                                    Apply Filter
                                </Button>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

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
                                    <Field.Label>Query Name</Field.Label>
                                    <Input
                                        value={saveQueryName}
                                        onChange={(e) => setSaveQueryName(e.target.value)}
                                        placeholder="Enter a name for your query"
                                    />
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button colorScheme="blue" onClick={handleSaveQuery} width="100%">
                                        Save
                                    </Button>
                                    <Button onClick={onSaveModalClose} width="100%">
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Load Query Modal */}
            <Dialog.Root open={isLoadModalOpen} onOpenChange={(details) => setLoadModalOpen(details.open)}>
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
                                        .filter((query: any) => query.query.url === '/pivot')
                                        .map((query: any) => (
                                            <Box
                                                key={query._id}
                                                p={4}
                                                borderWidth={1}
                                                borderRadius="md"
                                                cursor="pointer"
                                                _hover={{ bg: queryItemHoverBg }}
                                                onClick={() => handleLoadQuery(query)}
                                            >
                                                <HStack justify="space-between">
                                                    <VStack align="start" gap={1}>
                                                        <Text fontWeight="medium">{query.name}</Text>
                                                        <Text fontSize="sm" color={mutedTextColor}>
                                                            Pivot View
                                                        </Text>
                                                        <Text fontSize="sm" color={mutedTextColor}>
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
                                    <Text color={mutedTextColor} textAlign="center">
                                        No saved queries found
                                    </Text>
                                )}
                                {savedQueries && savedQueries.filter((query: any) => query.query.url === '/pivot').length === 0 && savedQueries.length > 0 && (
                                    <Text color={mutedTextColor} textAlign="center">
                                        No saved pivot queries found. Save queries from this view to see them here.
                                    </Text>
                                )}
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Edit Value Modal */}
            <Dialog.Root open={isEditValueOpen} onOpenChange={(details) => setIsEditValueOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Edit Value Field</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4}>
                                <Field.Root>
                                    <Field.Label>Field</Field.Label>
                                    <Input
                                        value={editableValue.field}
                                        disabled
                                        bg={useColorModeValue('gray.100', 'gray.700')}
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Aggregator Functions</Field.Label>
                                    <VStack gap={2} align="stretch">
                                        {editableValue.aggregators.map((aggregator, index) => (
                                            <HStack key={index} gap={2}>
                                                <Select.Root
                                                    collection={aggregatorCollection.collection}
                                                    value={[aggregator]}
                                                    onValueChange={(details) => {
                                                        const newAggregators = [...editableValue.aggregators];
                                                        newAggregators[index] = details.value[0] || 'avg';
                                                        setEditableValue({ ...editableValue, aggregators: newAggregators });
                                                    }}
                                                    flex="1"
                                                >
                                                    <Select.HiddenSelect />
                                                    <Select.Control>
                                                        <Select.Trigger>
                                                            <Select.ValueText />
                                                        </Select.Trigger>
                                                        <Select.IndicatorGroup>
                                                            <Select.Indicator />
                                                        </Select.IndicatorGroup>
                                                    </Select.Control>
                                                    <Select.Positioner>
                                                        <Select.Content>
                                                            {aggregatorItems.map((item) => (
                                                                <Select.Item key={item.value} item={item}>
                                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                                </Select.Item>
                                                            ))}
                                                        </Select.Content>
                                                    </Select.Positioner>
                                                </Select.Root>
                                                <Button
                                                    colorScheme="red"
                                                    size="sm"
                                                    onClick={() => {
                                                        const newAggregators = [...editableValue.aggregators];
                                                        newAggregators.splice(index, 1);
                                                        setEditableValue({ ...editableValue, aggregators: newAggregators });
                                                    }}
                                                    disabled={editableValue.aggregators.length === 1}
                                                >
                                                    ×
                                                </Button>
                                            </HStack>
                                        ))}
                                        <Button
                                            colorScheme="green"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                const newAggregators = [...editableValue.aggregators, 'avg'];
                                                setEditableValue({ ...editableValue, aggregators: newAggregators });
                                            }}
                                        >
                                            + Add Aggregator
                                        </Button>
                                    </VStack>
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button colorScheme="blue" onClick={handleValueSave} width="100%">
                                        Save
                                    </Button>
                                    <Button onClick={onEditValueClose} width="100%">
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Edit Filter Modal */}
            <Dialog.Root open={isEditFilterOpen} onOpenChange={(details) => setIsEditFilterOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Edit Filter</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={6}>
                            <VStack gap={4}>
                                <Field.Root>
                                    <Field.Label>Field</Field.Label>
                                    <Input
                                        value={editableFilter.field}
                                        disabled
                                        bg={useColorModeValue('gray.100', 'gray.700')}
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Operator</Field.Label>
                                    <Select.Root
                                        collection={operatorCollection.collection}
                                        value={editableFilter.operator ? [editableFilter.operator] : []}
                                        onValueChange={(details) => setEditableFilter({ ...editableFilter, operator: details.value[0] || '==' })}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control>
                                            <Select.Trigger>
                                                <Select.ValueText />
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
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Value</Field.Label>
                                    <Input
                                        value={editableFilter.value}
                                        onChange={(e) => setEditableFilter({ ...editableFilter, value: e.target.value })}
                                        placeholder="Enter filter value"
                                    />
                                </Field.Root>
                                <HStack gap={4} width="100%">
                                    <Button colorScheme="blue" onClick={handleFilterSave} width="100%">
                                        Save
                                    </Button>
                                    <Button onClick={onEditFilterClose} width="100%">
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};