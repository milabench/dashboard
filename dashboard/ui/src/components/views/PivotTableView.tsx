import { useState, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tooltip } from "../../components/ui/tooltip"
import {
    Box,
    Table,
    Text,
    VStack,
    Button,
    Alert,
    NativeSelect,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { getPivot } from '../../services/api';
import { PivotPreviewTable } from './PivotPreviewTable';
import {
    buildPivotApiParamsFromFields,
    findPivotField,
    pivotResultHeaderLabel,
    pivotTableQueryKey,
    type PivotField,
} from '../../utils/pivotUrlParams';

interface PivotTableViewProps {
    fields: PivotField[];
    isRelativePivot: boolean;
    triggerGeneration: boolean;
    setTriggerGeneration: (trigger: boolean) => void;
    setIsGenerating: (generating: boolean) => void;
    onGenerationComplete: () => void;
    previewEnabled?: boolean;
    onQueryResults?: (rowCount: number) => void;
    onPivotDataChange?: (rows: Record<string, unknown>[]) => void;
    clearResultsToken?: number;
    /** Read-only share page: no card chrome or nested scroll areas. */
    shareView?: boolean;
}

const COPY_JSON_TOOLTIP = 'Copy raw pivot rows as JSON';
const COPY_CSV_TOOLTIP = 'Copy the table as tab-separated values (TSV) with headers — paste into Excel or Google Sheets';

const copyLinkStyle = {
    variant: 'ghost' as const,
    size: 'xs' as const,
    height: 'auto',
    minH: 0,
    px: 1,
    py: 0,
    fontSize: 'xs',
    fontWeight: 'medium',
    color: 'var(--color-primary)',
    _hover: { bg: 'transparent', textDecoration: 'underline' },
};

export const PivotTableView = ({
    fields,
    isRelativePivot,
    triggerGeneration,
    setTriggerGeneration,
    setIsGenerating,
    onGenerationComplete,
    previewEnabled = true,
    onQueryResults,
    onPivotDataChange,
    clearResultsToken = 0,
    shareView = false,
}: PivotTableViewProps) => {
    const queryClient = useQueryClient();
    const [pivotData, setPivotData] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedBaselineColumn, setSelectedBaselineColumn] = useState<string | null>(null);

    useEffect(() => {
        setPivotData([]);
        setError(null);
        onPivotDataChange?.([]);
    }, [clearResultsToken, onPivotDataChange]);

    // Restore cached table rows when remounting (e.g. pivot → plot → pivot).
    useEffect(() => {
        if (fields.length === 0) return;

        const params = buildPivotApiParamsFromFields(fields);
        if (!params.get('filters')) return;

        const cached = queryClient.getQueryData<Record<string, unknown>[]>(pivotTableQueryKey(fields));
        if (!cached) return;

        setPivotData(cached);
        onPivotDataChange?.(cached);
        onQueryResults?.(cached.length);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- restore once on mount

    const generatePivotFromFields = async (fieldsToUse: PivotField[]) => {
        try {
            setIsGenerating(true);
            setError(null);

            const params = buildPivotApiParamsFromFields(fieldsToUse);

            const response = await getPivot(params);
            queryClient.setQueryData(pivotTableQueryKey(fieldsToUse), response);
            setPivotData(response);
            onPivotDataChange?.(response);
            onQueryResults?.(response.length);
            if (response.length === 0 && !params.get('filters')) {
                setError('Pivot query requires at least one filter');
            }
        } catch (error) {
            const err = error as { message?: string };
            const errorMessage = err?.message || (error instanceof Error ? error.message : 'Unknown error');
            setError(errorMessage);
            onQueryResults?.(0);
            toaster.create({
                title: 'Error generating pivot',
                description: errorMessage,
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsGenerating(false);
            // Call the completion callback if provided
            if (onGenerationComplete) {
                onGenerationComplete();
            }
        }
    };

    // Respond to trigger from parent component
    useEffect(() => {
        if (triggerGeneration && fields.length > 0) {
            // Use fields directly since they are already PivotField[]
            const pivotFields: PivotField[] = fields;
            generatePivotFromFields(pivotFields);
            // Reset trigger after generation
            setTriggerGeneration(false);
        }
    }, [triggerGeneration, fields, isRelativePivot]);

    // Reset selected baseline column when data changes or relative pivot is disabled
    useEffect(() => {
        if (!isRelativePivot) {
            setSelectedBaselineColumn(null);
        }
    }, [isRelativePivot, pivotData]);



    // Get column names from the first row - use backend order
    const columnNames = pivotData.length > 0 ? Object.keys(pivotData[0]) : [];

    // Analyze column structure for multi-level headers
    const columnStructure = (() => {
        if (columnNames.length === 0) return { rowColumns: [], valueColumns: [], headerLevels: [], backendValueStructures: [] };

        // Get row fields in the order they appear in the fields array
        const rowFields = fields.filter(f => f.type === 'row').map(f => f.field);
        const valueFields = fields.filter(f => f.type === 'value');
        const columnFields = fields.filter(f => f.type === 'column');

        // Separate row columns from value columns - maintain fields array order
        const rowColumns: string[] = [];
        const valueColumns: string[] = [];

        // First, add row columns in the order they appear in the fields array
        rowFields.forEach(rowField => {
            const matchingColumn = columnNames.find(colName => {
                if (colName.includes('/')) return false; // Skip structured columns
                const transformedRowField = rowField.replace(/:/g, '_');
                return colName === transformedRowField ||
                    colName === rowField ||
                    colName.includes(transformedRowField) ||
                    transformedRowField.includes(colName);
            });
            if (matchingColumn) {
                rowColumns.push(matchingColumn);
            }
        });

        // Then, add any remaining non-structured columns that weren't matched
        columnNames.forEach(colName => {
            if (!colName.includes('/') && !rowColumns.includes(colName)) {
                rowColumns.push(colName);
            } else if (colName.includes('/')) {
                valueColumns.push(colName);
            }
        });

        // Parse value columns to create multi-level header structure - maintain backend order
        const headerLevels: Array<Array<{ label: string, colspan: number, level: string }>> = [];
        let backendValueStructures: Array<{
            columnName: string;
            columnFields: Array<{ field: string; value: string; originalField: string }>;
            valueField: string;
            aggregator: string;
            fieldName: string;
            originalFieldName: string;
        }> = [];

        if (valueColumns.length > 0) {
            // Parse the new structured column format
            const columnStructures = valueColumns.map(colName => {
                // Parse the structured column name: "Exec__id=42/Metric_name=gpu.memory/Metric_value/avg"
                const parts = colName.split('/');

                // Handle case where there might be only value field and aggregator
                let columnFieldParts: string[] = [];
                let valueField: string;
                let aggregator: string;

                if (parts.length >= 2) {
                    columnFieldParts = parts.slice(0, -2); // Remove value field and aggregator
                    valueField = parts[parts.length - 2]; // Second to last part is the value field
                    aggregator = parts[parts.length - 1]; // Last part is the aggregator
                } else {
                    // Fallback for unexpected format
                    valueField = parts[0] || colName;
                    aggregator = 'value';
                }

                // Parse column field assignments
                const columnFieldAssignments = columnFieldParts.map(part => {
                    const equalIndex = part.indexOf('=');
                    if (equalIndex > 0) {
                        const field = part.substring(0, equalIndex);
                        const value = part.substring(equalIndex + 1);
                        return {
                            field: field.replace(/_/g, ':'),
                            value: value,
                            originalField: field // Keep original for data access
                        };
                    } else {
                        // Handle case where there's no equal sign
                        return {
                            field: part.replace(/_/g, ':'),
                            value: '',
                            originalField: part
                        };
                    }
                });

                // Find matching value field from the pivot configuration
                const matchingValueField = valueFields.find(vf =>
                    valueField.includes(vf.field.replace(/:/g, '_')) ||
                    valueField.includes(vf.field)
                );

                return {
                    columnName: colName,
                    columnFields: columnFieldAssignments,
                    valueField: valueField.replace(/_/g, ':'),
                    aggregator: aggregator,
                    fieldName: matchingValueField?.field || valueField.replace(/_/g, ':'),
                    originalFieldName: matchingValueField?.field || valueField.replace(/_/g, ':')
                };
            });

            // Use backend order - no sorting
            backendValueStructures = columnStructures;

            // Create header levels using the new structured format
            const createHeaderLevels = () => {
                const levels: Array<Array<{ label: string, colspan: number, level: string }>> = [];

                // Helper function to group consecutive columns
                const groupConsecutive = (cols: any[], groupBy: (col: any) => string, levelType: string) => {
                    const groups: Array<{ label: string, colspan: number, level: string }> = [];
                    let currentLabel = '';
                    let currentCount = 0;

                    cols.forEach((col, index) => {
                        const label = groupBy(col);
                        if (label !== currentLabel) {
                            if (currentCount > 0) {
                                groups.push({ label: currentLabel, colspan: currentCount, level: levelType });
                            }
                            currentLabel = label;
                            currentCount = 1;
                        } else {
                            currentCount++;
                        }

                        // Handle last group
                        if (index === cols.length - 1) {
                            groups.push({ label: currentLabel, colspan: currentCount, level: levelType });
                        }
                    });

                    return groups;
                };

                // Level 1: Value Field Names (Metric_value, etc.)
                levels.push(groupConsecutive(backendValueStructures, col => col.valueField, 'field'));

                // Dynamic levels for each column field (if any column fields exist)
                if (columnFields.length > 0 && backendValueStructures.length > 0) {
                    // Determine the number of column field levels from the first column structure
                    const maxColumnFields = Math.max(...backendValueStructures.map(col => col.columnFields.length));

                    // Create a level for each column field position
                    for (let i = 0; i < maxColumnFields; i++) {
                        levels.push(groupConsecutive(backendValueStructures, col => {
                            const columnField = col.columnFields[i];
                            if (columnField) {
                                return `${columnField.field}=${columnField.value}`;
                            }
                            return 'N/A';
                        }, `column-${i}`));
                    }
                }

                // Final level: Aggregators
                levels.push(groupConsecutive(backendValueStructures, col => col.aggregator.toUpperCase(), 'aggregator'));

                return levels;
            };

            headerLevels.push(...createHeaderLevels());
        }

        return { rowColumns, valueColumns, headerLevels, backendValueStructures: backendValueStructures || [] };
    })();

    const resultHeaderLabel = (
        type: 'row' | 'column' | 'value',
        apiKeyOrField: string,
        fallback?: string,
        aggregator?: string,
    ) => pivotResultHeaderLabel(fields, type, apiKeyOrField, fallback, aggregator);

    const resultColumnLabel = (apiColumnName: string) => {
        if (columnStructure.rowColumns.includes(apiColumnName)) {
            return resultHeaderLabel('row', apiColumnName, apiColumnName.replace(/_/g, ':'));
        }
        const structure = columnStructure.backendValueStructures.find((col) => col.columnName === apiColumnName);
        if (structure) {
            const match = findPivotField(fields, 'value', structure.fieldName, structure.aggregator);
            if (match?.label?.trim()) {
                const agg = structure.aggregator?.trim();
                return agg && agg !== 'value' ? `${match.label.trim()} (${agg})` : match.label.trim();
            }
            const agg = structure.aggregator?.trim();
            if (agg && agg !== 'value') {
                return `${structure.valueField} (${agg})`;
            }
            return structure.valueField;
        }
        return apiColumnName.replace(/_/g, ':');
    };

    // Process data for relative pivot
    const processedData = isRelativePivot && pivotData.length > 0 ?
        pivotData.map((row) => {
            const processedRow = { ...row };

            // Use selected baseline column or fall back to first numeric value column
            let baselineKey = selectedBaselineColumn;
            if (!baselineKey) {
                const firstNumericValueKey = columnStructure.valueColumns.find(key =>
                    typeof row[key] === 'number'
                );
                baselineKey = firstNumericValueKey || null;
            }

            if (baselineKey && typeof row[baselineKey] === 'number') {
                const baseline = row[baselineKey];
                // Only normalize value columns, not row columns
                columnStructure.valueColumns.forEach(key => {
                    if (typeof row[key] === 'number' && key !== baselineKey) {
                        processedRow[key] = baseline !== 0 ? row[key] / baseline : 0;
                    }
                });
                // Set baseline column to 1.0 (100%)
                processedRow[baselineKey] = 1.0;
            }

            return processedRow;
        }) : pivotData;

    // Sort data by row columns in reverse order (last row column first, first row column last)
    const sortedData = [...processedData]
    // Use backend column order
    const backendColumnNames = [
        ...columnStructure.rowColumns,
        ...columnStructure.backendValueStructures.map((col: any) => col.columnName)
    ];

    const copyJsonToClipboard = async () => {
        try {
            const jsonData = JSON.stringify(sortedData, null, 2);

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
                description: `${sortedData.length} rows copied as JSON`,
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

    const copyTableToClipboard = async () => {
        try {
            if (sortedData.length === 0) {
                toaster.create({
                    title: 'No data to copy',
                    description: 'Generate pivot data first',
                    type: 'warning',
                    duration: 3000,
                });
                return;
            }

            // Create CSV format
            const headers = backendColumnNames.map((name) => resultColumnLabel(name));
            const csvContent = [
                headers.join('\t'), // Use tabs for better Excel compatibility
                ...sortedData.map(row =>
                    backendColumnNames.map(col => {
                        const value = row[col];
                        // Handle numbers and strings appropriately
                        if (typeof value === 'number') {
                            return value.toString();
                        }
                        // Escape any tabs or quotes in text
                        return String(value || '').replace(/\t/g, ' ').replace(/"/g, '""');
                    }).join('\t')
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
                title: 'Table copied to clipboard',
                description: `${sortedData.length} rows copied as tab-separated values — paste into Excel or Google Sheets`,
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Failed to copy table',
                description: 'Could not copy table to clipboard',
                type: 'error',
                duration: 3000,
            });
        }
    };

    const formatValue = (value: any) => {
        if (typeof value === 'number') {
            if (isRelativePivot) {
                return value.toFixed(2);
            }
            return value.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        return value;
    };

    const getCellStyle = (value: any) => {
        if (isRelativePivot && typeof value === 'number') {
            const intensity = Math.min(Math.abs(value - 1), 0.5) * 2;
            if (value > 1) {
                return { backgroundColor: `rgba(34, 197, 94, ${intensity * 0.3})` };
            } else if (value < 1) {
                return { backgroundColor: `rgba(239, 68, 68, ${intensity * 0.3})` };
            }
        }
        return {};
    };

    const TableScrollWrapper = shareView
        ? ({ children }: { children: ReactNode }) => <>{children}</>
        : Table.ScrollArea;

    const renderCopyButtons = () => (
        <Box
            position="absolute"
            top={2}
            right={2}
            zIndex={10}
            display="flex"
            alignItems="center"
            gap={1}
            px={2}
            py={1}
            borderRadius="md"
            bg="var(--color-bg-card)"
            boxShadow="sm"
            borderWidth="1px"
            borderColor="var(--color-border)"
        >
            <Tooltip content={COPY_JSON_TOOLTIP}>
                <Button
                    {...copyLinkStyle}
                    onClick={copyJsonToClipboard}
                    aria-label="Copy JSON"
                >
                    Copy JSON
                </Button>
            </Tooltip>
            <Text fontSize="xs" color="var(--color-text-muted)" userSelect="none" aria-hidden>
                |
            </Text>
            <Tooltip content={COPY_CSV_TOOLTIP}>
                <Button
                    {...copyLinkStyle}
                    onClick={copyTableToClipboard}
                    aria-label="Copy CSV"
                >
                    Copy CSV
                </Button>
            </Tooltip>
        </Box>
    );

    if (error) {
        return (
            <Box h="100%" display="flex" flexDirection="column" position="relative">
                {sortedData.length > 0 && renderCopyButtons()}
                <Alert.Root status="error" mt={sortedData.length > 0 ? 10 : 0}>
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                </Alert.Root>
            </Box>
        );
    }

    return (
        <Box>
            {/* isGenerating is now managed by the parent component */}
            {/* {isGenerating && (
                <Box display="flex" justifyContent="center" alignItems="center" h="200px">
                    <Spinner size="xl" />
                </Box>
            )} */}

            {/* Baseline column selector for relative pivot */}
            {isRelativePivot && sortedData.length > 0 && (
                <Box mb={4} p={4} bg="var(--color-info-bg)" borderRadius="md" borderWidth={1} borderColor="var(--color-info-border)">
                    <VStack gap={2} align="start">
                        <Text fontSize="sm" fontWeight="semibold" color="var(--color-info-text)">
                            Select Baseline Column for Relative Values:
                        </Text>
                        <Tooltip
                            content="Select which column to use as the baseline (100%) for relative calculations. All other columns will be shown as ratios relative to this column."
                        >
                            <NativeSelect.Root
                                size="sm"
                                maxW="400px"
                            >
                                <NativeSelect.Field
                                    value={selectedBaselineColumn || ''}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedBaselineColumn(e.currentTarget.value || null)}
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-info-border)"
                                    _hover={{ borderColor: "var(--color-primary)" }}
                                >
                                    <option value="">Auto-select first numeric column</option>
                                    {columnStructure.valueColumns.map((columnName, index) => (
                                        <option key={index} value={columnName}>
                                            {resultColumnLabel(columnName)}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        </Tooltip>
                        <Text fontSize="xs" color="var(--color-text-info)">
                            All values will be calculated relative to the selected column (baseline = 1.0)
                        </Text>
                    </VStack>
                </Box>
            )}

            {sortedData.length > 0 && (
                <Box
                    width="100%"
                    position="relative"
                    {...(shareView ? {} : {
                        borderWidth: 1,
                        borderColor: 'var(--color-border)',
                        borderRadius: 'lg',
                        minH: '400px',
                        height: '100%',
                        bg: 'var(--color-bg-card)',
                        boxShadow: 'sm',
                        _hover: {
                            boxShadow: 'md',
                        },
                        transition: 'box-shadow 0.2s',
                    })}
                >
                    {/* Copy buttons */}
                    {renderCopyButtons()}

                    <TableScrollWrapper>
                        <Box pt={shareView ? 8 : 10}>
                        <Table.Root variant="line" size="sm" width="auto" height={shareView ? undefined : '100%'}>
                            <Table.Body>
                                {/* Create transposed header rows for column fields */}
                                {(() => {
                                    if (columnStructure.backendValueStructures.length === 0) {
                                        // Simple table without structured columns
                                        return (
                                            <>
                                                <Table.Row>
                                                    {backendColumnNames.map((columnName, index) => (
                                                        <Table.ColumnHeader
                                                            key={index}
                                                            fontSize="sm"
                                                            px={4}
                                                            py={3}
                                                            borderWidth={1}
                                                            borderColor="var(--color-border)"
                                                            bg="var(--color-table-row-header-bg)"
                                                            color="var(--color-table-row-header-text)"
                                                            fontWeight="semibold"
                                                            textAlign="left"
                                                        >
                                                            {resultColumnLabel(columnName)}
                                                        </Table.ColumnHeader>
                                                    ))}
                                                </Table.Row>
                                                {/* Separator row */}
                                                <Table.Row>
                                                    <Table.Cell
                                                        colSpan={backendColumnNames.length}
                                                        borderBottomWidth={3}
                                                        borderBottomColor="var(--color-info-border)"
                                                        bg="var(--color-table-row-header-bg)"
                                                        h="4px"
                                                        p={0}
                                                        position="relative"
                                                    />
                                                </Table.Row>
                                            </>
                                        );
                                    }

                                    // Create rows for each field type in the structured columns
                                    // First collect all unique field names from column structures
                                    const fieldRows: Array<{
                                        name: string;
                                        displayName: string;
                                        values: string[];
                                        isAggregator?: boolean;
                                        isValueField?: boolean;
                                    }> = [];

                                    // Extract field names from first column to determine structure
                                    if (columnStructure.backendValueStructures.length > 0) {
                                        const firstCol = columnStructure.backendValueStructures[0];

                                        // Add rows for each column field
                                        firstCol.columnFields.forEach((field, index) => {
                                            fieldRows.push({
                                                name: field.field,
                                                displayName: resultHeaderLabel('column', field.field, field.field),
                                                values: columnStructure.backendValueStructures.map(col =>
                                                    col.columnFields[index]?.value || ''
                                                ),
                                            });
                                        });

                                        const valueFieldNames = [
                                            ...new Set(columnStructure.backendValueStructures.map((col) => col.fieldName)),
                                        ];
                                        const showValueRow = firstCol.columnFields.length === 0
                                            || valueFieldNames.some((name) =>
                                                Boolean(findPivotField(fields, 'value', name)?.label?.trim()),
                                            );
                                        if (showValueRow) {
                                            const valueRowTitle = valueFieldNames.length === 1
                                                ? resultHeaderLabel('value', valueFieldNames[0], valueFieldNames[0])
                                                : 'Value';
                                            fieldRows.push({
                                                name: '__value__',
                                                displayName: valueRowTitle,
                                                isValueField: true,
                                                values: valueFieldNames.length === 1
                                                    ? columnStructure.backendValueStructures.map(() => '')
                                                    : columnStructure.backendValueStructures.map((col) =>
                                                        resultHeaderLabel(
                                                            'value',
                                                            col.fieldName,
                                                            col.valueField,
                                                            col.aggregator,
                                                        ),
                                                    ),
                                            });
                                        }

                                        // Add aggregator row last
                                        fieldRows.push({
                                            name: 'Aggregator',
                                            displayName: 'Aggregator',
                                            isAggregator: true,
                                            values: columnStructure.backendValueStructures.map(col =>
                                                col.aggregator.toUpperCase()
                                            ),
                                        });
                                    }

                                    return (
                                        <>
                                            {fieldRows.map((fieldRow, rowIndex) => (
                                                <Table.Row key={`header-${rowIndex}`}>
                                                    {/* Field name label spanning row columns only */}
                                                    <Table.ColumnHeader
                                                        colSpan={columnStructure.rowColumns.length}
                                                        fontSize="sm"
                                                        px={4}
                                                        py={3}
                                                        borderWidth={1}
                                                        borderColor="var(--color-border)"
                                                        bg={fieldRow.isAggregator ? 'var(--color-table-agg-bg)' : fieldRow.isValueField ? 'var(--color-pivot-value-bg)' : 'var(--color-table-col-header-bg)'}
                                                        color={fieldRow.isAggregator ? 'var(--color-table-agg-text)' : fieldRow.isValueField ? 'var(--color-table-agg-text)' : 'var(--color-table-col-header-text)'}
                                                        fontWeight="semibold"
                                                        textAlign="left"
                                                        minW="140px"
                                                        borderRightWidth={2}
                                                        borderRightColor={fieldRow.isAggregator ? 'var(--color-pivot-value-border)' : fieldRow.isValueField ? 'var(--color-pivot-value-border)' : 'var(--color-pivot-col-border)'}
                                                        title={fieldRow.displayName !== fieldRow.name ? fieldRow.name : undefined}
                                                    >
                                                        {fieldRow.displayName}
                                                    </Table.ColumnHeader>

                                                    {/* Values for this field across all columns */}
                                                    {fieldRow.values.map((value, colIndex) => (
                                                        <Table.Cell
                                                            key={colIndex}
                                                            fontSize="sm"
                                                            px={4}
                                                            py={3}
                                                            textAlign="center"
                                                            borderWidth={1}
                                                            borderColor="var(--color-border)"
                                                            bg={
                                                                fieldRow.isAggregator ? 'var(--color-pivot-value-bg)' :
                                                                    fieldRow.isValueField ? 'var(--color-pivot-value-bg)' :
                                                                    'var(--color-pivot-col-bg)'
                                                            }
                                                            color={
                                                                fieldRow.isAggregator ? 'var(--color-table-agg-text)' :
                                                                    fieldRow.isValueField ? 'var(--color-table-agg-text)' :
                                                                    'var(--color-table-col-header-text)'
                                                            }
                                                            fontWeight="medium"
                                                            _hover={{
                                                                bg: fieldRow.isAggregator || fieldRow.isValueField ? 'var(--color-table-agg-bg)' : 'var(--color-table-col-header-bg)'
                                                            }}
                                                            transition="background-color 0.2s"
                                                        >
                                                            {value.replace(/_/g, ':')}
                                                        </Table.Cell>
                                                    ))}
                                                </Table.Row>
                                            ))}

                                            {/* Row column headers row */}
                                            <Table.Row>
                                                {/* Row column headers */}
                                                {columnStructure.rowColumns.map((rowColumn, colIndex) => (
                                                    <Table.ColumnHeader
                                                        key={`row-header-${colIndex}`}
                                                        fontSize="sm"
                                                        px={4}
                                                        py={3}
                                                        borderWidth={1}
                                                        borderColor="var(--color-border)"
                                                        bg="var(--color-table-row-header-bg)"
                                                        color="var(--color-table-row-header-text)"
                                                        fontWeight="semibold"
                                                        textAlign="left"
                                                        borderRightWidth={colIndex === columnStructure.rowColumns.length - 1 ? 2 : 1}
                                                        borderRightColor={colIndex === columnStructure.rowColumns.length - 1 ? "var(--color-pivot-row-border)" : "var(--color-border)"}
                                                        title={(() => {
                                                            const rowField = fields.find((f) =>
                                                                f.type === 'row'
                                                                && (f.field.replace(/:/g, '_') === rowColumn || f.field === rowColumn),
                                                            );
                                                            return rowField?.label?.trim() ? rowField.field : undefined;
                                                        })()}
                                                    >
                                                        {resultHeaderLabel('row', rowColumn, rowColumn.replace(/_/g, ':'))}
                                                    </Table.ColumnHeader>
                                                ))}

                                                {/* Empty cells for value columns */}
                                                {columnStructure.valueColumns.map((columnName, colIndex) => (
                                                    <Table.ColumnHeader
                                                        key={`empty-value-${colIndex}`}
                                                        fontSize="sm"
                                                        px={4}
                                                        py={3}
                                                        borderWidth={1}
                                                        borderColor="var(--color-border)"
                                                        bg="var(--color-table-baseline-bg)"
                                                        position="relative"
                                                    >
                                                        {columnName === selectedBaselineColumn && (
                                                            <Box
                                                                position="absolute"
                                                                top={1}
                                                                right={1}
                                                                bg="var(--color-table-baseline-badge)"
                                                                color="var(--color-primary-text)"
                                                                fontSize="xs"
                                                                px={1}
                                                                py={0.5}
                                                                borderRadius="sm"
                                                                fontWeight="bold"
                                                            >
                                                                BASELINE
                                                            </Box>
                                                        )}
                                                    </Table.ColumnHeader>
                                                ))}
                                            </Table.Row>

                                            {/* Separator row */}
                                            <Table.Row>
                                                <Table.Cell
                                                    colSpan={columnStructure.rowColumns.length + columnStructure.valueColumns.length}
                                                    borderBottomWidth={3}
                                                    borderBottomColor="var(--color-info-border)"
                                                    bg="var(--color-table-row-header-bg)"
                                                    h="4px"
                                                    p={0}
                                                    position="relative"
                                                />
                                            </Table.Row>
                                        </>
                                    );
                                })()}

                                {/* Data rows */}
                                {sortedData.map((row, rowIndex) => (
                                    <Table.Row
                                        key={rowIndex}
                                        _hover={{
                                            bg: 'var(--color-bg-stripe)'
                                        }}
                                        transition="background-color 0.2s"
                                        bg={rowIndex % 2 === 0 ? 'var(--color-bg-card)' : 'var(--color-bg-card)'}
                                    >
                                        {/* Row column values */}
                                        {columnStructure.rowColumns.map((rowColumn, colIndex) => (
                                            <Table.Cell
                                                key={`row-${colIndex}`}
                                                fontSize="sm"
                                                fontFamily={typeof row[rowColumn] === 'number' ? 'mono' : undefined}
                                                fontWeight="semibold"
                                                borderWidth={1}
                                                borderColor="var(--color-border)"
                                                borderRightWidth={colIndex === columnStructure.rowColumns.length - 1 ? 2 : 1}
                                                borderRightColor={colIndex === columnStructure.rowColumns.length - 1 ? "var(--color-pivot-row-border)" : "var(--color-border)"}
                                                bg="var(--color-table-baseline-bg)"
                                                textAlign="left"
                                                color="var(--color-table-row-header-text)"
                                                px={4}
                                                py={3}
                                            >
                                                {formatValue(row[rowColumn])}
                                            </Table.Cell>
                                        ))}

                                        {/* Value columns */}
                                        {columnStructure.valueColumns.map((columnName, colIndex) => (
                                            <Table.Cell
                                                key={colIndex}
                                                fontSize="sm"
                                                fontFamily="mono"
                                                style={getCellStyle(row[columnName])}
                                                fontWeight="medium"
                                                borderWidth={1}
                                                borderColor="var(--color-border)"
                                                textAlign="center"
                                                px={4}
                                                py={3}
                                                _hover={{
                                                    bg: 'var(--color-table-baseline-bg)'
                                                }}
                                                transition="background-color 0.2s"
                                            >
                                                {formatValue(row[columnName])}
                                            </Table.Cell>
                                        ))}
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                        </Box>
                    </TableScrollWrapper>
                </Box>
            )}

            {sortedData.length === 0 && !error && previewEnabled && (
                <PivotPreviewTable fields={fields} />
            )}

            {sortedData.length === 0 && !error && !previewEnabled && (
                <Box
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    h="200px"
                    color="var(--color-table-empty-text)"
                    bg="var(--color-table-empty-bg)"
                    borderRadius="lg"
                    borderWidth={1}
                    borderColor="var(--color-border)"
                    borderStyle="dashed"
                >
                    <Text fontSize="sm" color="var(--color-text-muted)" textAlign="center" px={4}>
                        Preview hidden — enable Preview or execute query
                    </Text>
                </Box>
            )}
        </Box>
    );
};