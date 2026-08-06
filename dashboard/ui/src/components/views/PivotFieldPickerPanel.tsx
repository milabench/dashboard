import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Input,
    Portal,
    Text,
    VStack,
} from '@chakra-ui/react';

export type PivotFieldPickerState = {
    zoneType: 'row' | 'column' | 'value' | 'filter';
    x: number;
    y: number;
};

const PANEL_MARGIN = 8;

const ZONE_LABELS: Record<PivotFieldPickerState['zoneType'], string> = {
    row: 'Add row field',
    column: 'Add column field',
    value: 'Add value field',
    filter: 'Add filter field',
};

function clampPosition(x: number, y: number, width: number, height: number) {
    const maxX = window.innerWidth - width - PANEL_MARGIN;
    const maxY = window.innerHeight - height - PANEL_MARGIN;
    return {
        left: Math.max(PANEL_MARGIN, Math.min(x, maxX)),
        top: Math.max(PANEL_MARGIN, Math.min(y, maxY)),
    };
}

function isInsidePickerOrRelatedMenu(target: Node | null, panelRoot: HTMLElement | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }
    if (panelRoot?.contains(target)) {
        return true;
    }
    return Boolean(target.closest('[data-pivot-context-panel]'));
}

interface PivotFieldPickerPanelProps {
    picker: PivotFieldPickerState | null;
    availableFields: string[];
    onClose: () => void;
    onSelect: (field: string) => void;
}

export function PivotFieldPickerPanel({
    picker,
    availableFields,
    onClose,
    onSelect,
}: PivotFieldPickerPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!picker) {
            setSearch('');
            return;
        }
        const focusId = window.setTimeout(() => searchRef.current?.focus(), 0);
        return () => window.clearTimeout(focusId);
    }, [picker]);

    const filteredFields = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) {
            return availableFields;
        }
        return availableFields.filter((field) => field.toLowerCase().includes(query));
    }, [availableFields, search]);

    useLayoutEffect(() => {
        if (!picker || !panelRef.current) {
            return;
        }
        const rect = panelRef.current.getBoundingClientRect();
        setPosition(clampPosition(picker.x, picker.y, rect.width, rect.height));
    }, [picker, search, filteredFields.length]);

    useEffect(() => {
        if (!picker) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        const onMouseDown = (event: MouseEvent) => {
            if (isInsidePickerOrRelatedMenu(event.target as Node, panelRef.current)) {
                return;
            }
            onClose();
        };

        const listenerId = window.setTimeout(() => {
            document.addEventListener('mousedown', onMouseDown);
        }, 0);

        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.clearTimeout(listenerId);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [picker, onClose]);

    if (!picker) {
        return null;
    }

    return (
        <Portal>
            <Box
                ref={panelRef}
                data-pivot-field-picker
                position="fixed"
                left={`${position.left}px`}
                top={`${position.top}px`}
                zIndex={1999}
                minW="260px"
                maxW="320px"
                bg="var(--color-bg-card)"
                borderWidth="1px"
                borderColor="var(--color-border)"
                borderRadius="md"
                boxShadow="lg"
                p={2}
            >
                <Text
                    px={2}
                    py={1}
                    mb={2}
                    fontSize="sm"
                    fontWeight="semibold"
                    color="var(--color-text)"
                    borderBottomWidth="1px"
                    borderColor="var(--color-border)"
                >
                    {ZONE_LABELS[picker.zoneType]}
                </Text>
                <Input
                    ref={searchRef}
                    size="sm"
                    mb={2}
                    value={search}
                    bg="var(--color-bg-card)"
                    placeholder="Search fields…"
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && filteredFields.length === 1) {
                            onSelect(filteredFields[0]);
                        }
                    }}
                />
                <VStack
                    align="stretch"
                    gap={0}
                    maxH="280px"
                    overflowY="auto"
                >
                    {filteredFields.length === 0 ? (
                        <Text px={2} py={3} fontSize="sm" color="var(--color-text-muted)" textAlign="center">
                            No matching fields
                        </Text>
                    ) : (
                        filteredFields.map((field) => (
                            <Button
                                key={field}
                                size="sm"
                                justifyContent="flex-start"
                                variant="ghost"
                                fontFamily="mono"
                                fontSize="xs"
                                fontWeight="medium"
                                color="var(--color-text)"
                                bg="var(--color-bg-card)"
                                _hover={{ bg: 'var(--color-bg-hover)' }}
                                onClick={() => onSelect(field)}
                            >
                                {field}
                            </Button>
                        ))
                    )}
                </VStack>
            </Box>
        </Portal>
    );
}
