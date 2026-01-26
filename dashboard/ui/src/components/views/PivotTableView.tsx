import React, { useState, useEffect } from 'react';
import { Tooltip } from "../../components/ui/tooltip"
import {
    Box,
    Table,
    Text,
    VStack,
    HStack,
    IconButton,
    Alert,
    Select,
    useToken,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import { LuCopy, LuDownload } from 'react-icons/lu';
import axios from 'axios';

interface PivotField {
    field: string;
    type: 'row' | 'column' | 'value' | 'filter';
    operator?: string;
    value?: string;
    aggregators?: string[];  // For value fields - multiple aggregators
}

interface PivotTableViewProps {
    fields: PivotField[];
    isRelativePivot: boolean;
    triggerGeneration: boolean;
    setTriggerGeneration: (trigger: boolean) => void;
    setIsGenerating: (generating: boolean) => void;
    onGenerationComplete: () => void;
}

export const PivotTableView = ({ fields, isRelativePivot, triggerGeneration, setTriggerGeneration, setIsGenerating, onGenerationComplete }: PivotTableViewProps) => {
    const [pivotData, setPivotData] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedBaselineColumn, setSelectedBaselineColumn] = useState<string | null>(null);

    // Theme colors for cell styling
    const [blue500, green500, red500] = useToken('colors', ['blue.500', 'green.500', 'red.500']);
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

    const generatePivotFromFields = async (fieldsToUse: PivotField[]) => {
        try {
            setIsGenerating(true);
            setError(null);

            const params = new URLSearchParams();

            const rows = fieldsToUse.filter(f => f.type === 'row').map(f => f.field);
            const cols = fieldsToUse.filter(f => f.type === 'column').map(f => f.field);

            // Handle values with aggregator functions
            const valueFields = fieldsToUse.filter(f => f.type === 'value');
            const valuesMap: { [key: string]: string[] } = {};

            valueFields.forEach(field => {
                const aggregators = field.aggregators || ['avg'];
                if (!valuesMap[field.field]) {
                    valuesMap[field.field] = [];
                }
                valuesMap[field.field].push(...aggregators);
            });

            params.append('rows', rows.join(','));
            params.append('cols', cols.join(','));
            params.append('values', btoa(JSON.stringify(valuesMap)));

            const filters = fieldsToUse.filter(f => f.type === 'filter').map(f => ({
                field: f.field,
                operator: f.operator,
                value: f.value
            }));

            if (filters.length > 0) {
                params.append('filters', btoa(JSON.stringify(filters)));
            }

            const response = await axios.get(`/api/pivot?${params.toString()}`);

            if (Array.isArray(response.data)) {
                setPivotData(response.data);
            } else {
                setPivotData([]);
                setError('Invalid data format received from server');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setError(errorMessage);
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
            const headers = backendColumnNames.map(name => name.replace(/_/g, ':'));
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
                description: `${sortedData.length} rows copied as tab-separated values`,
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
            return value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        return value;
    };

    const getCellStyle = (value: any, columnName?: string) => {
        if (isRelativePivot && typeof value === 'number') {
            // Highlight baseline column
            if (columnName === selectedBaselineColumn) {
                return {
                    backgroundColor: hexToRgba(blue500, 0.2),
                    border: `2px solid ${hexToRgba(blue500, 0.6)}`,
                    fontWeight: 'bold'
                };
            }

            const intensity = Math.min(Math.abs(value - 1), 0.5) * 2;
            if (value > 1) {
                return { backgroundColor: hexToRgba(green500, intensity * 0.3) };
            } else if (value < 1) {
                return { backgroundColor: hexToRgba(red500, intensity * 0.3) };
            }
        }
        return {};
    };

    if (error) {
        return (
            <Box h="100%" display="flex" flexDirection="column">
                <HStack mb={4} justify="space-between">
                    {sortedData.length > 0 && (
                        <HStack gap={2}>
                            <Tooltip label="Copy JSON data to clipboard">
                                <IconButton
                                    icon={<LuCopy />}
                                    size="sm"
                                    colorScheme="blue"
                                    variant="outline"
                                    onClick={copyJsonToClipboard}
                                    aria-label="Copy JSON to clipboard"
                                />
                            </Tooltip>
                            <Tooltip label="Copy table data to clipboard">
                                <IconButton
                                    icon={<LuDownload />}
                                    size="sm"
                                    colorScheme="green"
                                    variant="outline"
                                    onClick={copyTableToClipboard}
                                    aria-label="Copy table to clipboard"
                                />
                            </Tooltip>
                        </HStack>
                    )}
                </HStack>
                <Alert.Root status="error">
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
                <Box mb={4} p={4} bg="blue.50" borderRadius="md" borderWidth={1} borderColor="blue.200">
                    <VStack gap={2} align="start">
                        <Text fontSize="sm" fontWeight="semibold" color="blue.800">
                            Select Baseline Column for Relative Values:
                        </Text>
                        <Tooltip
                            label="Select which column to use as the baseline (100%) for relative calculations. All other columns will be shown as ratios relative to this column."
                            placement="top"
                            hasArrow
                        >
                            <Select
                                size="sm"
                                value={selectedBaselineColumn || ''}
                                onChange={(e) => setSelectedBaselineColumn(e.target.value || null)}
                                placeholder="Auto-select first numeric column"
                                bg="white"
                                borderColor="blue.300"
                                _hover={{ borderColor: "blue.400" }}
                                maxW="400px"
                            >
                                {columnStructure.valueColumns.map((columnName, index) => (
                                    <option key={index} value={columnName}>
                                        {columnName.replace(/_/g, ':')}
                                    </option>
                                ))}
                            </Select>
                        </Tooltip>
                        <Text fontSize="xs" color="blue.600">
                            All values will be calculated relative to the selected column (baseline = 1.0)
                        </Text>
                    </VStack>
                </Box>
            )}

            {sortedData.length > 0 && (
                <Box
                    borderWidth={1}
                    borderColor="gray.200"
                    borderRadius="lg"
                    minH="400px"
                    height="100%"
                    width="100%"
                    bg="white"
                    boxShadow="sm"
                    _hover={{
                        boxShadow: "md"
                    }}
                    transition="box-shadow 0.2s"
                    position="relative"
                >
                    {/* Copy buttons */}
                    <Box
                        position="absolute"
                        top={3}
                        right={3}
                        zIndex={10}
                        display="flex"
                        gap={2}
                    >
                        <Tooltip label="Copy JSON data to clipboard" placement="left">
                            <IconButton
                                icon={<LuCopy />}
                                size="sm"
                                colorScheme="blue"
                                variant="outline"
                                onClick={copyJsonToClipboard}
                                aria-label="Copy JSON to clipboard"
                                bg="white"
                                _hover={{
                                    bg: "blue.50"
                                }}
                            />
                        </Tooltip>
                        <Tooltip label="Copy table data to clipboard" placement="left">
                            <IconButton
                                icon={<LuDownload />}
                                size="sm"
                                colorScheme="green"
                                variant="outline"
                                onClick={copyTableToClipboard}
                                aria-label="Copy table to clipboard"
                                bg="white"
                                _hover={{
                                    bg: "green.50"
                                }}
                            />
                        </Tooltip>
                    </Box>

                    <Table.ScrollArea>
                        <Table.Root variant="simple" size="sm" width="auto" height="100%">
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
                                                            borderColor="gray.200"
                                                            bg="blue.100"
                                                            color="blue.800"
                                                            fontWeight="semibold"
                                                            textAlign="left"
                                                        >
                                                            {columnName.replace(/_/g, ':')}
                                                        </Table.ColumnHeader>
                                                    ))}
                                                </Table.Row>
                                                {/* Separator row */}
                                                <Table.Row>
                                                    <Table.Cell
                                                        colSpan={backendColumnNames.length}
                                                        borderBottomWidth={3}
                                                        borderBottomColor="blue.300"
                                                        bg="blue.100"
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
                                    const fieldRows: Array<{ name: string, values: string[] }> = [];

                                    // Extract field names from first column to determine structure
                                    if (columnStructure.backendValueStructures.length > 0) {
                                        const firstCol = columnStructure.backendValueStructures[0];

                                        // Add rows for each column field
                                        firstCol.columnFields.forEach((field, index) => {
                                            fieldRows.push({
                                                name: field.field,
                                                values: columnStructure.backendValueStructures.map(col =>
                                                    col.columnFields[index]?.value || ''
                                                )
                                            });
                                        });

                                        // Add aggregator row last
                                        fieldRows.push({
                                            name: 'Aggregator',
                                            values: columnStructure.backendValueStructures.map(col =>
                                                col.aggregator.toUpperCase()
                                            )
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
                                                        borderColor="gray.200"
                                                        bg={fieldRow.name === 'Aggregator' ? 'purple.100' : 'green.100'}
                                                        color={fieldRow.name === 'Aggregator' ? 'purple.800' : 'green.800'}
                                                        fontWeight="semibold"
                                                        textAlign="left"
                                                        minW="140px"
                                                        borderRightWidth={2}
                                                        borderRightColor={fieldRow.name === 'Aggregator' ? 'purple.200' : 'green.200'}
                                                    >
                                                        {fieldRow.name}
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
                                                            borderColor="gray.200"
                                                            bg={
                                                                fieldRow.name === 'Aggregator' ? 'purple.50' :
                                                                    'green.50'
                                                            }
                                                            color={
                                                                fieldRow.name === 'Aggregator' ? 'purple.700' :
                                                                    'green.700'
                                                            }
                                                            fontWeight="medium"
                                                            _hover={{
                                                                bg: fieldRow.name === 'Aggregator' ? 'purple.100' : 'green.100'
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
                                                        borderColor="gray.200"
                                                        bg="blue.100"
                                                        color="blue.800"
                                                        fontWeight="semibold"
                                                        textAlign="left"
                                                        borderRightWidth={colIndex === columnStructure.rowColumns.length - 1 ? 2 : 1}
                                                        borderRightColor={colIndex === columnStructure.rowColumns.length - 1 ? "blue.200" : "gray.200"}
                                                    >
                                                        {rowColumn.replace(/_/g, ':')}
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
                                                        borderColor="gray.200"
                                                        bg={columnName === selectedBaselineColumn ? "blue.200" : "blue.50"}
                                                        position="relative"
                                                    >
                                                        {columnName === selectedBaselineColumn && (
                                                            <Box
                                                                position="absolute"
                                                                top={1}
                                                                right={1}
                                                                bg="blue.600"
                                                                color="white"
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
                                                    borderBottomColor="blue.300"
                                                    bg="blue.100"
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
                                            bg: 'gray.50'
                                        }}
                                        transition="background-color 0.2s"
                                        bg={rowIndex % 2 === 0 ? 'white' : 'gray.25'}
                                    >
                                        {/* Row column values */}
                                        {columnStructure.rowColumns.map((rowColumn, colIndex) => (
                                            <Table.Cell
                                                key={`row-${colIndex}`}
                                                fontSize="sm"
                                                fontWeight="semibold"
                                                borderWidth={1}
                                                borderColor="gray.200"
                                                borderRightWidth={colIndex === columnStructure.rowColumns.length - 1 ? 2 : 1}
                                                borderRightColor={colIndex === columnStructure.rowColumns.length - 1 ? "blue.200" : "gray.200"}
                                                bg="blue.25"
                                                textAlign="left"
                                                color="blue.800"
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
                                                style={getCellStyle(row[columnName], columnName)}
                                                fontWeight="medium"
                                                borderWidth={1}
                                                borderColor="gray.200"
                                                textAlign="center"
                                                px={4}
                                                py={3}
                                                _hover={{
                                                    bg: 'blue.50'
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
                    </Table.ScrollArea>
                </Box>
            )}

            {sortedData.length === 0 && !error && (
                <Box
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    h="300px"
                    color="gray.500"
                    bg="gray.50"
                    borderRadius="lg"
                    borderWidth={1}
                    borderColor="gray.200"
                    borderStyle="dashed"
                    flexDirection="column"
                    gap={4}
                >
                    <Text fontSize="lg" fontWeight="medium" color="gray.600">
                        No data available
                    </Text>
                    <Text fontSize="sm" color="gray.500" textAlign="center">
                        Configure your pivot fields and press execute
                    </Text>
                </Box>
            )}
        </Box>
    );
};