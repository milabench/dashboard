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
            <Table.Root variant="line">
                <Table.Header bg="var(--color-bg-header)">
                    <Table.Row>
                        {columns.map((column, index) => (
                            <Table.ColumnHeader
                                key={index}
                                width={column.width}
                                color="var(--color-text)"
                                borderColor="var(--color-border)"
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
                            _hover={onRowClick ? { bg: 'var(--color-bg-hover)' } : undefined}
                            borderColor="var(--color-border)"
                        >
                            {columns.map((column, colIndex) => (
                                <Table.Cell
                                    key={colIndex}
                                    color="var(--color-text)"
                                    borderColor="var(--color-border)"
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
