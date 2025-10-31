import {
    TableContainer,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
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
        <TableContainer overflowX="auto">
            <Table variant="simple">
                <Thead>
                    <Tr>
                        {columns.map((column, index) => (
                            <Th key={index} width={column.width}>
                                {column.header}
                            </Th>
                        ))}
                    </Tr>
                </Thead>
                <Tbody>
                    {data.map((item, rowIndex) => (
                        <Tr
                            key={rowIndex}
                            onClick={() => onRowClick?.(item)}
                            cursor={onRowClick ? 'pointer' : 'default'}
                            _hover={onRowClick ? { bg: 'gray.50' } : undefined}
                        >
                            {columns.map((column, colIndex) => (
                                <Td key={colIndex}>
                                    {typeof column.accessor === 'function'
                                        ? column.accessor(item)
                                        : String(item[column.accessor])}
                                </Td>
                            ))}
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        </TableContainer>
    );
}