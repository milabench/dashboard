import {
    Table,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useColorModeValue } from '../ui/color-mode';

export interface Column<T> {
    header: string;
    accessor: keyof T | ((item: T) => string | number | ReactNode);
    width?: string;
}

interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    onRowClick?: (item: T) => void;
}

export function DataTable<T>({ data, columns, onRowClick }: TableProps<T>) {
    // Theme-aware colors
    const rowHoverBg = useColorModeValue('gray.50', 'gray.800');
    const headerBg = useColorModeValue('gray.50', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const headerTextColor = useColorModeValue('gray.700', 'gray.300');

    return (
        <Table.ScrollArea>
            <Table.Root variant="simple">
                <Table.Header bg={headerBg}>
                    <Table.Row>
                        {columns.map((column, index) => (
                            <Table.ColumnHeader
                                key={index}
                                width={column.width}
                                color={headerTextColor}
                                borderColor={borderColor}
                            >
                                {column.header}
                            </Table.ColumnHeader>
                        ))}
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {data.map((item, rowIndex) => (
                        <Table.Row
                            key={rowIndex}
                            onClick={() => onRowClick?.(item)}
                            cursor={onRowClick ? 'pointer' : 'default'}
                            _hover={onRowClick ? { bg: rowHoverBg } : undefined}
                            borderColor={borderColor}
                        >
                            {columns.map((column, colIndex) => (
                                <Table.Cell
                                    key={colIndex}
                                    color={textColor}
                                    borderColor={borderColor}
                                >
                                    {typeof column.accessor === 'function'
                                        ? column.accessor(item)
                                        : String(item[column.accessor])}
                                </Table.Cell>
                            ))}
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>
        </Table.ScrollArea>
    );
}