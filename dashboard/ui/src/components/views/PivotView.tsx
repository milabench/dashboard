import { useState, useEffect, useRef, useCallback, Fragment, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Text,
    Heading,
    Button,
    Dialog,
    Input,
    Badge,
    Grid,
    GridItem,
    IconButton,
    useDisclosure,
    Field,
    Progress,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { api, getAllSavedQueries, saveQuery, PIVOT_TIMEOUT_MS, fetchLatestDistinctGPURunIds } from '../../services/api';
import { PivotTableView } from './PivotTableView';
import { PivotContextPanel, type PivotContextPanelState } from './PivotContextPanel';
import { PivotFieldPickerPanel, type PivotFieldPickerState } from './PivotFieldPickerPanel';
import { LuX } from 'react-icons/lu';
import {
    hasPivotUrlConfig,
    parsePivotFieldsFromSearchParams,
    encodePivotValuesForApi,
    type PivotField,
} from '../../utils/pivotUrlParams';

type PivotZoneType = PivotField['type'];
type PivotLayout = 'sidebar' | 'classic';

const PIVOT_LAYOUT_STORAGE_KEY = 'pivot-view-layout';

function buildDefaultPivotFields(execIds?: string): PivotField[] {
    const fields: PivotField[] = [
        { field: 'Weight:priority', type: 'row' },
        { field: 'Pack:name', type: 'row' },
        { field: 'Exec:meta.accelerators.gpus.0.product', type: 'column' },
        { field: 'Metric:name', type: 'column' },
        { field: 'Metric:value', type: 'value', aggregators: ['median'] },
        { field: 'Metric:name', type: 'filter', operator: 'in', value: 'rate' },
    ];
    if (execIds) {
        fields.push({ field: 'Exec:_id', type: 'filter', operator: 'in', value: execIds });
    }
    return fields;
}

const PIVOT_ZONE_WRAP_PROPS = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    alignContent: 'flex-start',
} as const;

const PIVOT_BADGE_FONT = {
    fontFamily: 'mono',
    fontSize: 'xs',
} as const;

function pivotBoldFieldName(name: string) {
    return <Box as="span" fontWeight="bold">{name}</Box>;
}

function renderSimplePivotBadge(fieldName: string) {
    return (
        <Box as="span" {...PIVOT_BADGE_FONT}>
            {pivotBoldFieldName(fieldName)}
        </Box>
    );
}

function renderValuePivotBadge(field: PivotField) {
    const aggregator = field.aggregators?.[0] || 'avg';
    return (
        <Box as="span" {...PIVOT_BADGE_FONT}>
            {aggregator}({pivotBoldFieldName(field.field)})
        </Box>
    );
}

function renderFilterPivotBadge(field: PivotField) {
    return (
        <Box as="span" {...PIVOT_BADGE_FONT}>
            {pivotBoldFieldName(field.field)}
            {field.operator ? ` ${field.operator}` : ''}
            {field.value ? ` ${field.value}` : ''}
        </Box>
    );
}

export const PivotView = () => {
    usePageTitle('Pivot View');

    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const hasUrlConfig = hasPivotUrlConfig(searchParams);

    const { data: defaultExecIds, isFetched: defaultExecIdsFetched } = useQuery({
        queryKey: ['latestDistinctGpuRunIds'],
        queryFn: fetchLatestDistinctGPURunIds,
        enabled: !hasUrlConfig,
        staleTime: 5 * 60 * 1000,
    });

    const [contextPanel, setContextPanel] = useState<PivotContextPanelState | null>(null);
    const [fieldPicker, setFieldPicker] = useState<PivotFieldPickerState | null>(null);
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const [isRelativePivot, setIsRelativePivot] = useState(() => {
        const relative = searchParams.get('relative');
        return relative === 'true';
    });
    const [fields, setFields] = useState<PivotField[]>(() => {
        const fromUrl = parsePivotFieldsFromSearchParams(searchParams);
        if (fromUrl) {
            return fromUrl;
        }
        const cachedExecIds = queryClient.getQueryData<string>(['latestDistinctGpuRunIds']);
        if (cachedExecIds) {
            return buildDefaultPivotFields(cachedExecIds);
        }
        return [];
    });
    const dropZonesRef = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const [triggerGeneration, setTriggerGeneration] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [executionTime, setExecutionTime] = useState<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewEnabled, setPreviewEnabled] = useState(true);
    const [hasQueryResults, setHasQueryResults] = useState(false);
    const [clearResultsToken, setClearResultsToken] = useState(0);
    const generationStartRef = useRef<number | null>(null);
    const [hasInitialized, setHasInitialized] = useState(false);
    const [pivotLayout, setPivotLayout] = useState<PivotLayout>(() => {
        try {
            const stored = localStorage.getItem(PIVOT_LAYOUT_STORAGE_KEY);
            if (stored === 'classic' || stored === 'sidebar') {
                return stored;
            }
        } catch {
            // ignore storage errors
        }
        return 'sidebar';
    });

    // Operator and aggregator options for context panels
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
    // Save/Load modal state
    const { open: isSaveModalOpen, onOpen: onSaveModalOpen, onClose: onSaveModalClose, setOpen: setSaveModalOpen } = useDisclosure();
    const { open: isLoadModalOpen, onOpen: onLoadModalOpen, onClose: onLoadModalClose, setOpen: setLoadModalOpen } = useDisclosure();
    const [saveQueryName, setSaveQueryName] = useState<string>('');

    // Fetch available fields from /api/keys
    const { data: availableFields } = useQuery({
        queryKey: ['pivotFields'],
        queryFn: async () => {
            const response = await api.get('/keys');
            return response.data;
        },
    });

    // Fetch saved queries for load functionality
    const { data: savedQueries } = useQuery({
        queryKey: ['savedQueries'],
        queryFn: getAllSavedQueries,
    });

    // Load defaults from URL or wait for latest GPU exec ids before first URL sync.
    useEffect(() => {
        const fromUrl = parsePivotFieldsFromSearchParams(searchParams);
        if (fromUrl) {
            setFields(fromUrl);
            setHasInitialized(true);
            return;
        }

        if (!defaultExecIdsFetched) {
            return;
        }

        setFields(buildDefaultPivotFields(defaultExecIds));
        setHasInitialized(true);
    }, [searchParams, defaultExecIdsFetched, defaultExecIds]);

    // Auto-update URL when fields change (but not on initial load)
    useEffect(() => {
        if (hasInitialized) {
            updateURLParams();
        }
    }, [fields, isRelativePivot, hasInitialized]);

    const rememberPointer = (event: React.DragEvent | React.MouseEvent) => {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const getPointerPosition = (event?: React.DragEvent | React.MouseEvent) => {
        if (event) {
            rememberPointer(event);
        }
        return lastPointerRef.current;
    };

    const openValuePanel = (
        field: string,
        event?: React.DragEvent | React.MouseEvent,
        fieldIndex?: number,
        selectedAggregator?: string,
    ) => {
        setFieldPicker(null);
        const { x, y } = getPointerPosition(event);
        setContextPanel({
            kind: 'value',
            field,
            fieldIndex,
            selectedAggregator: selectedAggregator || 'avg',
            x,
            y,
        });
    };

    const openFilterPanel = (
        field: string,
        event?: React.DragEvent | React.MouseEvent,
        fieldIndex?: number,
        operator = '==',
        value = '',
    ) => {
        setFieldPicker(null);
        const { x, y } = getPointerPosition(event);
        setContextPanel({
            kind: 'filter',
            field,
            fieldIndex,
            operator,
            value,
            x,
            y,
        });
    };

    const handleFieldDrop = (type: 'row' | 'column' | 'value' | 'filter', field: string, event: React.DragEvent) => {
        if (type === 'filter') {
            openFilterPanel(field, event);
        } else if (type === 'value') {
            openValuePanel(field, event);
        } else {
            setFields([...fields, { field, type }]);
        }
    };

    const handleValueSelect = (aggregator: string) => {
        if (!contextPanel || contextPanel.kind !== 'value') {
            return;
        }

        if (contextPanel.fieldIndex !== undefined) {
            const newFields = [...fields];
            newFields[contextPanel.fieldIndex] = {
                ...newFields[contextPanel.fieldIndex],
                aggregators: [aggregator],
            };
            setFields(newFields);
        } else {
            setFields([...fields, {
                field: contextPanel.field,
                type: 'value',
                aggregators: [aggregator],
            }]);
        }
        setContextPanel(null);
    };

    const handleFilterApply = (operator: string, value: string) => {
        if (!contextPanel || contextPanel.kind !== 'filter') {
            return;
        }

        if (contextPanel.fieldIndex !== undefined) {
            const newFields = [...fields];
            newFields[contextPanel.fieldIndex] = {
                ...newFields[contextPanel.fieldIndex],
                operator,
                value,
            };
            setFields(newFields);
        } else {
            setFields([...fields, {
                field: contextPanel.field,
                type: 'filter',
                operator,
                value,
            }]);
        }
        setContextPanel(null);
    };

    const handleEditValue = (index: number, event: React.MouseEvent) => {
        const field = fields[index];
        openValuePanel(field.field, event, index, field.aggregators?.[0] || 'avg');
    };

    const handleEditFilter = (index: number, event: React.MouseEvent) => {
        const field = fields[index];
        openFilterPanel(
            field.field,
            event,
            index,
            field.operator || '==',
            field.value || '',
        );
    };

    const openFieldPicker = (zoneType: PivotZoneType, event: React.MouseEvent) => {
        setContextPanel(null);
        rememberPointer(event);
        setFieldPicker({
            zoneType,
            x: event.clientX,
            y: event.clientY,
        });
    };

    const handleZoneClick = (zoneType: PivotZoneType, event: React.MouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-pivot-badge]') || target.closest('[data-pivot-gap]')) {
            return;
        }
        openFieldPicker(zoneType, event);
    };

    const handleFieldPickerSelect = (field: string) => {
        if (!fieldPicker) {
            return;
        }

        const { zoneType, x, y } = fieldPicker;
        setFieldPicker(null);

        if (zoneType === 'row' || zoneType === 'column') {
            setFields((prev) => [...prev, { field, type: zoneType }]);
            return;
        }

        lastPointerRef.current = { x, y };
        window.requestAnimationFrame(() => {
            if (zoneType === 'value') {
                openValuePanel(field);
            } else {
                openFilterPanel(field);
            }
        });
    };

    const togglePivotLayout = () => {
        setPivotLayout((current) => {
            const next: PivotLayout = current === 'sidebar' ? 'classic' : 'sidebar';
            try {
                localStorage.setItem(PIVOT_LAYOUT_STORAGE_KEY, next);
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    const openPlotView = () => {
        const query = searchParams.toString();
        navigate(query ? `/pivot/plot?${query}` : '/pivot/plot');
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

        params.append('rows', rows.join(','));
        params.append('cols', cols.join(','));
        params.append('values', encodePivotValuesForApi(fields));

        const filters = fields.filter(f => f.type === 'filter').map(f => ({
            field: f.field,
            operator: f.operator,
            value: f.value
        }));

        if (filters.length > 0) {
            params.append('filters', btoa(JSON.stringify(filters)));
        }

        if (isRelativePivot) {
            params.append('relative', 'true');
        }

        const plot = searchParams.get('plot');
        if (plot) {
            params.set('plot', plot);
        }

        setSearchParams(params);
    }, [fields, isRelativePivot, searchParams, setSearchParams]);

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

    const resetPivot = async () => {
        let execIds = '';
        try {
            execIds = await queryClient.fetchQuery({
                queryKey: ['latestDistinctGpuRunIds'],
                queryFn: fetchLatestDistinctGPURunIds,
                staleTime: 0,
            });
        } catch {
            // Keep defaults without exec filter if gpu summary is unavailable.
        }
        setFields(buildDefaultPivotFields(execIds));
        setIsRelativePivot(false);
        setPreviewEnabled(true);
        setHasQueryResults(false);
        setClearResultsToken((token) => token + 1);
        setSearchParams(new URLSearchParams());
    };

    const handleQueryResults = (rowCount: number) => {
        const hasResults = rowCount > 0;
        setHasQueryResults(hasResults);
        if (hasResults) {
            setPreviewEnabled(false);
        }
    };

    const generatePivot = () => {
        generationStartRef.current = performance.now();
        setElapsedMs(0);
        setExecutionTime(null);
        setTriggerGeneration(true);
    };

    useEffect(() => {
        if (!isGenerating) return;
        const id = window.setInterval(() => {
            if (generationStartRef.current != null) {
                setElapsedMs(performance.now() - generationStartRef.current);
            }
        }, 100);
        return () => window.clearInterval(id);
    }, [isGenerating]);

    const handleGenerationComplete = () => {
        if (generationStartRef.current != null) {
            setExecutionTime(performance.now() - generationStartRef.current);
            generationStartRef.current = null;
        }
        setElapsedMs(0);
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
        rememberPointer(e);
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
            handleFieldDrop(type, draggedData, e);
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
                newFields.splice(sourceIndex, 1);
                setFields(newFields);
                openFilterPanel(
                    updatedField.field,
                    undefined,
                    undefined,
                    updatedField.operator || '==',
                    updatedField.value || '',
                );
                return;
            }

            if (targetType === 'value' && sourceType !== 'value') {
                newFields.splice(sourceIndex, 1);
                setFields(newFields);
                openValuePanel(updatedField.field);
                return;
            }

            if (targetType === 'value' && !updatedField.aggregators?.length) {
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
        rememberPointer(e);

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
        target.style.backgroundColor = "color-mix(in srgb, var(--color-primary) 10%, transparent)";
        target.style.borderTop = "2px solid var(--color-primary)";
    };

    const handleFieldDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        target.style.backgroundColor = '';
        target.style.borderTop = '';
    };

    const renderPivotZoneGap = (zoneIndex: number, zoneType: PivotZoneType) => (
        <Box
            data-pivot-gap
            w={2}
            h="20px"
            flexShrink={0}
            onDragOver={handleFieldDragOver}
            onDragLeave={handleFieldDragLeave}
            onDrop={(e) => handleFieldDropZone(e, zoneIndex, zoneType)}
            cursor="pointer"
        />
    );

    const renderPivotZoneFields = (
        zoneType: PivotZoneType,
        emptyText: string,
        emptyColor: string,
        badgeStyle: { bg: string; color: string; hoverBg: string },
        renderBadge: (field: PivotField, fieldIndex: number) => ReactNode,
        compact = false,
    ) => {
        const zoneFields = fields.filter((f) => f.type === zoneType);
        if (zoneFields.length === 0) {
            return (
                <Text color={emptyColor} fontSize="sm" textAlign="center" mt={compact ? 2 : 8} w="100%">
                    {emptyText}
                </Text>
            );
        }

        return (
            <>
                {zoneFields.map((field, index) => {
                    const fieldIndex = fields.findIndex((f) => f === field);
                    return (
                        <Fragment key={`${zoneType}-${fieldIndex}`}>
                            {index > 0 && renderPivotZoneGap(index, zoneType)}
                            <Badge
                                data-pivot-badge
                                m={1}
                                p={1.5}
                                pl={3}
                                pr={1.5}
                                bg={badgeStyle.bg}
                                color={badgeStyle.color}
                                cursor="move"
                                draggable
                                fontFamily="mono"
                                fontSize="xs"
                                _hover={{
                                    bg: badgeStyle.hoverBg,
                                    transform: 'scale(1.05)',
                                }}
                                transition="all 0.2s"
                                borderRadius="full"
                                onDragStart={(e) => handleFieldDragStart(e, fieldIndex, zoneType)}
                                onDragEnd={handleFieldDragEnd}
                            >
                                <HStack as="span" gap={1} align="center">
                                    {renderBadge(field, fieldIndex)}
                                    <IconButton
                                        aria-label="Remove field"
                                        size="2xs"
                                        variant="subtle"
                                        minW="16px"
                                        w="16px"
                                        h="16px"
                                        p={0}
                                        color="currentColor"
                                        bg="color-mix(in srgb, currentColor 15%, transparent)"
                                        borderRadius="full"
                                        _hover={{
                                            bg: 'color-mix(in srgb, currentColor 30%, transparent)',
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeField(fieldIndex);
                                        }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                    >
                                        <LuX size={10} />
                                    </IconButton>
                                </HStack>
                            </Badge>
                        </Fragment>
                    );
                })}
                {renderPivotZoneGap(zoneFields.length, zoneType)}
            </>
        );
    };

    const renderPivotZone = (zoneType: PivotZoneType, layout: PivotLayout) => {
        const isSidebar = layout === 'sidebar';
        const emptyAction = isSidebar ? 'Click to add' : 'Click or drop';
        const zoneProps = {
            row: {
                title: 'Rows',
                titleColor: 'var(--color-pivot-row-heading)',
                emptyText: `${emptyAction} row fields${isSidebar ? '' : ' here'}`,
                emptyColor: 'var(--color-pivot-row-text)',
                bg: 'var(--color-pivot-row-bg)',
                borderColor: 'var(--color-pivot-row-border)',
                borderHover: 'var(--color-pivot-row-border-hover)',
                badgeStyle: {
                    bg: 'var(--color-pivot-row-badge-bg)',
                    color: 'var(--color-pivot-row-badge-text)',
                    hoverBg: 'var(--color-pivot-row-heading)',
                },
            },
            column: {
                title: 'Columns',
                titleColor: 'var(--color-pivot-col-heading)',
                emptyText: `${emptyAction} column fields${isSidebar ? '' : ' here'}`,
                emptyColor: 'var(--color-pivot-col-text)',
                bg: 'var(--color-pivot-col-bg)',
                borderColor: 'var(--color-pivot-col-border)',
                borderHover: 'var(--color-pivot-col-border-hover)',
                badgeStyle: {
                    bg: 'var(--color-pivot-col-badge-bg)',
                    color: 'var(--color-pivot-col-badge-text)',
                    hoverBg: 'var(--color-pivot-col-heading)',
                },
            },
            value: {
                title: 'Values',
                titleColor: 'var(--color-pivot-value-heading)',
                emptyText: `${emptyAction} value fields${isSidebar ? '' : ' here'}`,
                emptyColor: 'var(--color-pivot-value-text)',
                bg: 'var(--color-pivot-value-bg)',
                borderColor: 'var(--color-pivot-value-border)',
                borderHover: 'var(--color-pivot-value-border-hover)',
                badgeStyle: {
                    bg: 'var(--color-pivot-value-badge-bg)',
                    color: 'var(--color-pivot-value-badge-text)',
                    hoverBg: 'var(--color-pivot-value-heading)',
                },
            },
            filter: {
                title: 'Filters',
                titleColor: 'var(--color-pivot-filter-heading)',
                emptyText: `${emptyAction} filter fields${isSidebar ? '' : ' here'}`,
                emptyColor: 'var(--color-pivot-filter-text)',
                bg: 'var(--color-pivot-filter-bg)',
                borderColor: 'var(--color-pivot-filter-border)',
                borderHover: 'var(--color-pivot-filter-border-hover)',
                badgeStyle: {
                    bg: 'var(--color-pivot-filter-badge-bg)',
                    color: 'var(--color-pivot-filter-badge-text)',
                    hoverBg: 'var(--color-pivot-filter-heading)',
                },
            },
        } as const;

        const config = zoneProps[zoneType];
        const renderBadge = (field: PivotField, fieldIndex: number) => {
            if (zoneType === 'value') {
                return (
                    <Box
                        as="span"
                        cursor="pointer"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEditValue(fieldIndex, e);
                        }}
                        title="Change aggregation"
                    >
                        {renderValuePivotBadge(field)}
                    </Box>
                );
            }
            if (zoneType === 'filter') {
                return (
                    <Box
                        as="span"
                        cursor="pointer"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEditFilter(fieldIndex, e);
                        }}
                        title="Edit filter"
                    >
                        {renderFilterPivotBadge(field)}
                    </Box>
                );
            }
            return renderSimplePivotBadge(field.field);
        };

        return (
            <VStack
                key={zoneType}
                align="stretch"
                flex={isSidebar ? '1' : '1'}
                gap={2}
                minH={isSidebar ? '100px' : undefined}
            >
                <Heading size="sm" color={config.titleColor}>{config.title}</Heading>
                <Box
                    ref={(el: HTMLDivElement | null) => { dropZonesRef.current[zoneType] = el; }}
                    {...PIVOT_ZONE_WRAP_PROPS}
                    flex={isSidebar ? '1' : undefined}
                    p={isSidebar ? 3 : 4}
                    bg={config.bg}
                    borderWidth={2}
                    borderStyle="dashed"
                    borderColor={config.borderColor}
                    borderRadius="md"
                    minH={isSidebar ? '100px' : '150px'}
                    cursor="pointer"
                    onClick={(e) => handleZoneClick(zoneType, e)}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, zoneType)}
                    _hover={{ borderColor: config.borderHover }}
                    transition="all 0.2s"
                    data-drop-zone={zoneType}
                >
                    {renderPivotZoneFields(
                        zoneType,
                        config.emptyText,
                        config.emptyColor,
                        config.badgeStyle,
                        renderBadge,
                        isSidebar,
                    )}
                </Box>
            </VStack>
        );
    };

    const renderPivotBuilder = (layout: PivotLayout) => {
        const zoneTypes: PivotZoneType[] = ['row', 'column', 'value', 'filter'];
        if (layout === 'sidebar') {
            return (
                <VStack align="stretch" gap={3} h="100%" minH="0">
                    {zoneTypes.map((zoneType) => renderPivotZone(zoneType, layout))}
                </VStack>
            );
        }
        return (
            <HStack align="stretch" gap={4}>
                {zoneTypes.map((zoneType) => renderPivotZone(zoneType, layout))}
            </HStack>
        );
    };

    const renderQueryActions = () => (
        <VStack align="stretch" gap={2} w="100%">
            <HStack gap={2} w="100%">
                {import.meta.env.DEV && (
                    <Button
                        flex="1"
                        size="sm"
                        onClick={onSaveModalOpen}
                        bg="var(--color-btn-save-bg)"
                        color="var(--color-btn-save-text)"
                        _hover={{ bg: 'var(--color-btn-save-hover)' }}
                    >
                        Save Query
                    </Button>
                )}
                <Button
                    flex="1"
                    size="sm"
                    onClick={onLoadModalOpen}
                    bg="var(--color-btn-load-bg)"
                    color="var(--color-btn-load-text)"
                    _hover={{ bg: 'var(--color-btn-load-hover)' }}
                >
                    Load Query
                </Button>
                <Button
                    flex="1"
                    size="sm"
                    onClick={generatePivot}
                    loading={isGenerating}
                    variant="solid"
                    bg="var(--color-primary)"
                    color="var(--color-primary-text)"
                    _hover={{ bg: 'var(--color-primary-hover)', color: 'var(--color-primary-text)' }}
                >
                    Execute
                </Button>
            </HStack>
            {isGenerating && (
                <VStack align="stretch" gap={1}>
                    <HStack justify="space-between" gap={3}>
                        <Text fontSize="xs" color="var(--color-text-info)" fontWeight="medium">
                            Running query…
                        </Text>
                        <Text fontSize="xs" color="var(--color-text-muted)" fontFamily="mono" whiteSpace="nowrap">
                            {(elapsedMs / 1000).toFixed(1)}s / {PIVOT_TIMEOUT_MS / 1000}s timeout
                        </Text>
                    </HStack>
                    <Progress.Root
                        value={Math.min(100, (elapsedMs / PIVOT_TIMEOUT_MS) * 100)}
                        size="sm"
                        colorPalette={elapsedMs / PIVOT_TIMEOUT_MS > 0.8 ? 'orange' : 'blue'}
                    >
                        <Progress.Track>
                            <Progress.Range />
                        </Progress.Track>
                    </Progress.Root>
                </VStack>
            )}
            {executionTime !== null && !isGenerating && (
                <HStack gap={1}>
                    <Text fontSize="xs" color="var(--color-text-success)" fontWeight="semibold">
                        ✓
                    </Text>
                    <Text fontSize="xs" color="var(--color-text-muted)" fontWeight="medium">
                        {executionTime < 1000 ? `${executionTime.toFixed(0)}ms` : `${(executionTime / 1000).toFixed(2)}s`}
                    </Text>
                </HStack>
            )}
        </VStack>
    );

    const renderAvailableFieldsPanel = () => (
        <VStack align="stretch" gap={4} h="calc(100vh - 170px)">
            <Heading size="md" color="var(--color-text-muted)">Available Fields</Heading>
            <Box
                flex="1"
                minH="0"
                overflowY="auto"
                bg="var(--color-bg-header)"
                borderRadius="md"
                p={3}
                borderWidth={1}
                borderColor="var(--color-border)"
            >
                <VStack align="stretch" gap={2}>
                    {availableFields?.map((field: string) => (
                        <Box
                            key={field}
                            p={3}
                            bg="var(--color-input-bg)"
                            borderWidth={1}
                            borderColor="var(--color-border)"
                            borderRadius="md"
                            cursor="move"
                            _hover={{
                                bg: 'var(--color-bg-hover)',
                                borderColor: 'var(--color-input-border)',
                                transform: 'translateY(-1px)',
                                boxShadow: 'sm',
                            }}
                            transition="all 0.2s"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', field)}
                            overflowX="hidden"
                            textOverflow="ellipsis"
                            whiteSpace="nowrap"
                            fontSize="sm"
                            fontWeight="medium"
                            color="var(--color-text)"
                        >
                            {field}
                        </Box>
                    ))}
                </VStack>
            </Box>
        </VStack>
    );

    const renderBuilderPanel = (layout: PivotLayout) => (
        <VStack align="stretch" gap={3} h={layout === 'sidebar' ? 'calc(100vh - 170px)' : undefined}>
            {renderQueryActions()}
            <Box flex={layout === 'sidebar' ? '1' : undefined} minH={layout === 'sidebar' ? '0' : undefined} overflow="hidden" display="flex" flexDirection="column">
                {renderPivotBuilder(layout)}
            </Box>
        </VStack>
    );


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
                                    aggregators: [value.aggregators?.[0] || 'avg'],
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
        <Box p={4} h="100vh" display="flex" flexDirection="column" bg="var(--color-bg-page)">
            <HStack justify="space-between" mb={6} gap={3} flexWrap="wrap">
                <Heading color="var(--color-text)">Pivot View</Heading>
                <HStack gap={2} flexWrap="wrap">
                    <Button
                        size="sm"
                        onClick={resetPivot}
                        variant="outline"
                        color="var(--color-text)"
                        borderColor="var(--color-border)"
                        _hover={{ bg: 'var(--color-bg-hover)' }}
                    >
                        Reset
                    </Button>
                    <Button
                        size="sm"
                        variant={isRelativePivot ? 'solid' : 'outline'}
                        onClick={() => handleRelativePivotChange(!isRelativePivot)}
                        bg={isRelativePivot ? 'var(--color-btn-success)' : undefined}
                        color={isRelativePivot ? 'var(--color-text-on-dark)' : 'var(--color-text)'}
                        borderColor={isRelativePivot ? 'var(--color-btn-success)' : 'var(--color-border)'}
                        _hover={{ bg: isRelativePivot ? 'var(--color-btn-success-hover)' : 'var(--color-bg-hover)' }}
                    >
                        {!isRelativePivot ? 'Relative View' : 'Normal View'}
                    </Button>
                    <Button
                        size="sm"
                        variant={previewEnabled ? 'solid' : 'outline'}
                        onClick={() => setPreviewEnabled((enabled) => !enabled)}
                        disabled={hasQueryResults}
                        bg={previewEnabled ? 'var(--color-btn-success)' : undefined}
                        color={previewEnabled ? 'var(--color-text-on-dark)' : 'var(--color-text)'}
                        borderColor={previewEnabled ? 'var(--color-btn-success)' : 'var(--color-border)'}
                        _hover={{
                            bg: previewEnabled ? 'var(--color-btn-success-hover)' : 'var(--color-bg-hover)',
                        }}
                        title={
                            hasQueryResults
                                ? 'Preview is hidden while query results are displayed'
                                : previewEnabled
                                    ? 'Hide layout preview'
                                    : 'Show layout preview'
                        }
                    >
                        {previewEnabled ? 'Preview On' : 'Preview Off'}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        color="var(--color-text)"
                        borderColor="var(--color-border)"
                        _hover={{ bg: 'var(--color-bg-hover)' }}
                        onClick={togglePivotLayout}
                        title={pivotLayout === 'sidebar' ? 'Switch to classic layout with field list' : 'Switch to sidebar layout'}
                    >
                        {pivotLayout === 'sidebar' ? 'Classic Layout' : 'Sidebar Layout'}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        color="var(--color-text)"
                        borderColor="var(--color-border)"
                        _hover={{ bg: 'var(--color-bg-hover)' }}
                        onClick={openPlotView}
                        disabled={!hasQueryResults}
                        title={
                            !hasQueryResults
                                ? 'Run a pivot query first, then open the Vega-Lite plot builder'
                                : 'Open Vega-Lite plot builder in a separate view'
                        }
                    >
                        Plot
                    </Button>
                </HStack>
            </HStack>

            <Grid
                templateColumns="360px 1fr"
                templateRows={pivotLayout === 'classic' ? 'auto 1fr' : '1fr'}
                gap={6}
                flex="1"
                minH="0"
                className="pivot-view-grid"
                width="99%"
            >
                <GridItem rowSpan={pivotLayout === 'classic' ? 2 : 1} colSpan={1} className="pivot-sidebar">
                    {pivotLayout === 'classic' ? renderAvailableFieldsPanel() : renderBuilderPanel('sidebar')}
                </GridItem>

                {pivotLayout === 'classic' && (
                    <GridItem colStart={2} rowSpan={1} className="pivot-builder">
                        {renderBuilderPanel('classic')}
                    </GridItem>
                )}

                <GridItem colStart={2} rowSpan={1} className="pivot-result" overflow="auto" minH="0">
                    <PivotTableView
                        fields={fields}
                        isRelativePivot={isRelativePivot}
                        triggerGeneration={triggerGeneration}
                        setTriggerGeneration={setTriggerGeneration}
                        setIsGenerating={setIsGenerating}
                        onGenerationComplete={handleGenerationComplete}
                        previewEnabled={previewEnabled}
                        onQueryResults={handleQueryResults}
                        clearResultsToken={clearResultsToken}
                    />
                </GridItem>
            </Grid>

            <PivotFieldPickerPanel
                picker={fieldPicker}
                availableFields={availableFields ?? []}
                onClose={() => setFieldPicker(null)}
                onSelect={handleFieldPickerSelect}
            />

            <PivotContextPanel
                panel={contextPanel}
                aggregatorItems={aggregatorItems}
                operatorItems={operatorItems}
                onClose={() => setContextPanel(null)}
                onValueSelect={handleValueSelect}
                onFilterApply={handleFilterApply}
            />

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
                                    <Button bg="var(--color-primary)" color="var(--color-primary-text)" _hover={{ bg: 'var(--color-primary-hover)' }} onClick={handleSaveQuery} width="100%">
                                        Save
                                    </Button>
                                    <Button variant="outline" color="var(--color-text)" borderColor="var(--color-border)" _hover={{ bg: 'var(--color-bg-hover)' }} onClick={onSaveModalClose} width="100%">
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
                                                _hover={{ bg: "var(--color-bg-hover)" }}
                                                onClick={() => handleLoadQuery(query)}
                                            >
                                                <HStack justify="space-between">
                                                    <VStack align="start" gap={1}>
                                                        <Text fontWeight="medium">{query.name}</Text>
                                                        <Text fontSize="sm" color={"var(--color-text-muted)"}>
                                                            Pivot View
                                                        </Text>
                                                        <Text fontSize="sm" color={"var(--color-text-muted)"}>
                                                            Created: {new Date(query.created_time).toLocaleString()}
                                                        </Text>
                                                    </VStack>
                                                    <Button size="sm" bg="var(--color-btn-load-bg)" color="var(--color-btn-load-text)" _hover={{ bg: 'var(--color-btn-load-hover)' }}>
                                                        Load
                                                    </Button>
                                                </HStack>
                                            </Box>
                                        ))
                                ) : (
                                    <Text color={"var(--color-text-muted)"} textAlign="center">
                                        No saved queries found
                                    </Text>
                                )}
                                {savedQueries && savedQueries.filter((query: any) => query.query.url === '/pivot').length === 0 && savedQueries.length > 0 && (
                                    <Text color={"var(--color-text-muted)"} textAlign="center">
                                        No saved pivot queries found. Save queries from this view to see them here.
                                    </Text>
                                )}
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Save Query Modal */}
        </Box>
    );
};