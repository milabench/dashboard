import { useMemo } from 'react';
import {
    Box,
    Table,
    Text,
} from '@chakra-ui/react';
import { buildPivotPreview, type PivotPreviewField } from '../../utils/pivotPreview';

interface PivotPreviewTableProps {
    fields: PivotPreviewField[];
}

function formatPreviewValue(value: string | number): string {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    return String(value);
}

export function PivotPreviewTable({ fields }: PivotPreviewTableProps) {
    const preview = useMemo(() => buildPivotPreview(fields), [fields]);

    if (!preview) {
        return (
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
                    Add row fields to see a layout preview
                </Text>
            </Box>
        );
    }

    const { rowColumns, rowColumnLabels, valueStructures, fieldRows, rows } = preview;
    const valueColumnNames = valueStructures.map((vs) => vs.columnName);

    return (
        <Box
            position="relative"
                borderWidth={2}
                borderColor="var(--color-pivot-value-border)"
                borderRadius="lg"
                overflow="hidden"
                bg="var(--color-bg-card)"
                borderStyle="dashed"
                minH="280px"
            >
                <Box
                    position="absolute"
                    inset={0}
                    zIndex={2}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    pointerEvents="none"
                    userSelect="none"
                    aria-hidden
                >
                    <Text
                        fontSize={{ base: '4xl', md: '6xl', lg: '7xl' }}
                        fontWeight="black"
                        letterSpacing="0.2em"
                        color="var(--color-pivot-value-heading)"
                        opacity={0.18}
                        transform="rotate(-24deg)"
                        whiteSpace="nowrap"
                        lineHeight={1}
                    >
                        PREVIEW
                    </Text>
                </Box>
                <Box
                    position="absolute"
                    inset={0}
                    zIndex={1}
                    pointerEvents="none"
                    bg="color-mix(in srgb, var(--color-pivot-value-bg) 35%, transparent)"
                />
                <Table.ScrollArea maxH="360px" position="relative" zIndex={0}>
                    <Table.Root variant="line" size="sm" width="auto">
                        <Table.Body>
                            {fieldRows.map((fieldRow, rowIndex) => (
                                <Table.Row key={`preview-header-${rowIndex}`}>
                                    <Table.ColumnHeader
                                        colSpan={rowColumns.length}
                                        fontSize="sm"
                                        px={4}
                                        py={2}
                                        borderWidth={1}
                                        borderColor="var(--color-border)"
                                        bg={fieldRow.isAggregator
                                            ? 'var(--color-table-agg-bg)'
                                            : fieldRow.isValueField
                                                ? 'var(--color-pivot-value-bg)'
                                                : 'var(--color-table-col-header-bg)'}
                                        color={fieldRow.isAggregator || fieldRow.isValueField
                                            ? 'var(--color-table-agg-text)'
                                            : 'var(--color-table-col-header-text)'}
                                        fontWeight="semibold"
                                        textAlign="left"
                                        minW="140px"
                                        borderRightWidth={2}
                                        borderRightColor={fieldRow.isAggregator || fieldRow.isValueField
                                            ? 'var(--color-pivot-value-border)'
                                            : 'var(--color-pivot-col-border)'}
                                        fontFamily="mono"
                                        title={fieldRow.sourceField && fieldRow.displayName !== fieldRow.sourceField
                                            ? fieldRow.sourceField
                                            : undefined}
                                    >
                                        <Text as="span" fontWeight="bold">
                                            {fieldRow.displayName}
                                        </Text>
                                    </Table.ColumnHeader>
                                    {fieldRow.values.map((value, colIndex) => (
                                        <Table.Cell
                                            key={`${rowIndex}-${colIndex}`}
                                            fontSize="sm"
                                            px={4}
                                            py={2}
                                            textAlign="center"
                                            borderWidth={1}
                                            borderColor="var(--color-border)"
                                            bg={fieldRow.isAggregator
                                                ? 'var(--color-pivot-value-bg)'
                                                : fieldRow.isValueField
                                                    ? 'var(--color-pivot-value-bg)'
                                                    : 'var(--color-pivot-col-bg)'}
                                            color={fieldRow.isAggregator || fieldRow.isValueField
                                                ? 'var(--color-table-agg-text)'
                                                : 'var(--color-table-col-header-text)'}
                                            fontWeight="medium"
                                            fontFamily="mono"
                                        >
                                            {value.replace(/_/g, ':')}
                                        </Table.Cell>
                                    ))}
                                </Table.Row>
                            ))}

                            <Table.Row>
                                {rowColumns.map((rowColumn, colIndex) => (
                                    <Table.ColumnHeader
                                        key={`row-header-${colIndex}`}
                                        fontSize="sm"
                                        px={4}
                                        py={2}
                                        borderWidth={1}
                                        borderColor="var(--color-border)"
                                        bg="var(--color-table-row-header-bg)"
                                        color="var(--color-table-row-header-text)"
                                        fontWeight="semibold"
                                        textAlign="left"
                                        borderRightWidth={colIndex === rowColumns.length - 1 ? 2 : 1}
                                        borderRightColor={colIndex === rowColumns.length - 1
                                            ? 'var(--color-pivot-row-border)'
                                            : 'var(--color-border)'}
                                        fontFamily="mono"
                                        title={rowColumnLabels[colIndex] !== rowColumn.replace(/_/g, ':')
                                            ? rowColumn.replace(/_/g, ':')
                                            : undefined}
                                    >
                                        <Text as="span" fontWeight="bold">
                                            {rowColumnLabels[colIndex]}
                                        </Text>
                                    </Table.ColumnHeader>
                                ))}
                                {valueColumnNames.map((columnName) => (
                                    <Table.ColumnHeader
                                        key={`value-spacer-${columnName}`}
                                        fontSize="sm"
                                        px={4}
                                        py={2}
                                        borderWidth={1}
                                        borderColor="var(--color-border)"
                                        bg="var(--color-table-baseline-bg)"
                                    />
                                ))}
                            </Table.Row>

                            <Table.Row>
                                <Table.Cell
                                    colSpan={rowColumns.length + valueColumnNames.length}
                                    borderBottomWidth={3}
                                    borderBottomColor="var(--color-info-border)"
                                    bg="var(--color-table-row-header-bg)"
                                    h="4px"
                                    p={0}
                                />
                            </Table.Row>

                            {rows.map((row, rowIndex) => (
                                <Table.Row key={`preview-row-${rowIndex}`}>
                                    {rowColumns.map((rowColumn, colIndex) => (
                                        <Table.Cell
                                            key={`row-${colIndex}`}
                                            fontSize="sm"
                                            fontWeight="semibold"
                                            borderWidth={1}
                                            borderColor="var(--color-border)"
                                            borderRightWidth={colIndex === rowColumns.length - 1 ? 2 : 1}
                                            borderRightColor={colIndex === rowColumns.length - 1
                                                ? 'var(--color-pivot-row-border)'
                                                : 'var(--color-border)'}
                                            bg="var(--color-table-baseline-bg)"
                                            textAlign="left"
                                            color="var(--color-table-row-header-text)"
                                            px={4}
                                            py={2}
                                            fontFamily="mono"
                                        >
                                            {formatPreviewValue(row[rowColumn])}
                                        </Table.Cell>
                                    ))}
                                    {valueColumnNames.map((columnName) => (
                                        <Table.Cell
                                            key={`val-${columnName}`}
                                            fontSize="sm"
                                            fontWeight="medium"
                                            borderWidth={1}
                                            borderColor="var(--color-border)"
                                            textAlign="center"
                                            px={4}
                                            py={2}
                                            color="var(--color-text-muted)"
                                            fontFamily="mono"
                                        >
                                            {formatPreviewValue(row[columnName])}
                                        </Table.Cell>
                                    ))}
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table.Root>
                </Table.ScrollArea>
            </Box>
    );
}
