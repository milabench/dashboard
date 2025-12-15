import {
    Table,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';

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
    return (
        <Table.ScrollArea>
            <Table.Root variant="simple">
                <Table.Header>
                    <Table.Row>
                        {columns.map((column, index) => (
                            <Table.ColumnHeader key={index} width={column.width}>
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
                            _hover={onRowClick ? { bg: 'gray.50' } : undefined}
                        >
                            {columns.map((column, colIndex) => (
                                <Table.Cell key={colIndex}>
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