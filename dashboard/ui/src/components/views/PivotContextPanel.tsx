import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Box,
    Button,
    Input,
    Portal,
    Select,
    Text,
    VStack,
    useListCollection,
} from '@chakra-ui/react';

export type PivotValueContextPanel = {
    kind: 'value';
    field: string;
    fieldIndex?: number;
    selectedAggregator?: string;
    label: string;
    x: number;
    y: number;
};

export type PivotFilterContextPanel = {
    kind: 'filter';
    field: string;
    fieldIndex?: number;
    operator: string;
    value: string;
    x: number;
    y: number;
};

export type PivotFieldLabelContextPanel = {
    kind: 'fieldLabel';
    field: string;
    fieldIndex: number;
    zoneType: 'row' | 'column';
    label: string;
    x: number;
    y: number;
};

export type PivotContextPanelState =
    | PivotValueContextPanel
    | PivotFilterContextPanel
    | PivotFieldLabelContextPanel;

const PANEL_MARGIN = 8;

function isInsidePanelOrSelectMenu(target: Node | null, panelRoot: HTMLElement | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }
    if (panelRoot?.contains(target)) {
        return true;
    }
    // Chakra Select renders its menu in a portal outside the panel.
    return Boolean(
        target.closest('[data-scope="select"]')
        || target.closest('[role="listbox"]')
        || target.closest('[data-part="content"]')
        || target.closest('[data-pivot-field-picker]'),
    );
}

function clampPosition(x: number, y: number, width: number, height: number) {
    const maxX = window.innerWidth - width - PANEL_MARGIN;
    const maxY = window.innerHeight - height - PANEL_MARGIN;
    return {
        left: Math.max(PANEL_MARGIN, Math.min(x, maxX)),
        top: Math.max(PANEL_MARGIN, Math.min(y, maxY)),
    };
}

interface PivotContextPanelProps {
    panel: PivotContextPanelState | null;
    aggregatorItems: { label: string; value: string }[];
    operatorItems: { label: string; value: string }[];
    onClose: () => void;
    onValueSelect: (aggregator: string, displayLabel: string) => void;
    onFilterApply: (operator: string, value: string) => void;
    onFieldLabelApply: (displayLabel: string) => void;
}

export function PivotContextPanel({
    panel,
    aggregatorItems,
    operatorItems,
    onClose,
    onValueSelect,
    onFilterApply,
    onFieldLabelApply,
}: PivotContextPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const [filterOperator, setFilterOperator] = useState('==');
    const [filterValue, setFilterValue] = useState('');
    const [displayLabel, setDisplayLabel] = useState('');
    const operatorCollection = useListCollection({ initialItems: operatorItems });

    useEffect(() => {
        if (!panel) {
            return;
        }
        if (panel.kind === 'filter') {
            setFilterOperator(panel.operator || '==');
            setFilterValue(panel.value || '');
        }
        if (panel.kind === 'value' || panel.kind === 'fieldLabel') {
            setDisplayLabel(panel.label || '');
        }
    }, [panel]);

    useLayoutEffect(() => {
        if (!panel || !panelRef.current) {
            return;
        }
        const rect = panelRef.current.getBoundingClientRect();
        setPosition(clampPosition(panel.x, panel.y, rect.width, rect.height));
    }, [panel, filterOperator, filterValue, displayLabel]);

    useEffect(() => {
        if (!panel) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        const onMouseDown = (event: MouseEvent) => {
            if (isInsidePanelOrSelectMenu(event.target as Node, panelRef.current)) {
                return;
            }
            onClose();
        };

        // Defer so the same click that opened the panel does not immediately close it.
        const listenerId = window.setTimeout(() => {
            document.addEventListener('mousedown', onMouseDown);
        }, 0);

        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.clearTimeout(listenerId);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [panel, onClose]);

    if (!panel) {
        return null;
    }

    const selectedAggregator = panel.kind === 'value'
        ? (panel.selectedAggregator || 'avg')
        : undefined;

    return (
        <Portal>
            <Box
                ref={panelRef}
                data-pivot-context-panel
                position="fixed"
                left={`${position.left}px`}
                top={`${position.top}px`}
                zIndex={2000}
                minW="200px"
                maxW="280px"
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
                    mb={1}
                    fontSize="xs"
                    fontFamily="mono"
                    fontWeight="bold"
                    color="var(--color-text-muted)"
                    borderBottomWidth="1px"
                    borderColor="var(--color-border)"
                >
                    {panel.field}
                </Text>

                {panel.kind === 'fieldLabel' ? (
                    <VStack align="stretch" gap={2} p={1}>
                        <Text fontSize="xs" color="var(--color-text-muted)">
                            Display name
                        </Text>
                        <Input
                            size="sm"
                            value={displayLabel}
                            bg="var(--color-bg-card)"
                            onChange={(event) => setDisplayLabel(event.target.value)}
                            placeholder={panel.field}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    onFieldLabelApply(displayLabel);
                                }
                            }}
                        />
                        <Button
                            size="sm"
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            onClick={() => onFieldLabelApply(displayLabel)}
                        >
                            Apply
                        </Button>
                        {displayLabel.trim() ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onFieldLabelApply('')}
                            >
                                Reset to field name
                            </Button>
                        ) : null}
                    </VStack>
                ) : panel.kind === 'value' ? (
                    <VStack align="stretch" gap={2}>
                        <Box px={1}>
                            <Text fontSize="xs" color="var(--color-text-muted)" mb={1}>
                                Display name
                            </Text>
                            <Input
                                size="sm"
                                value={displayLabel}
                                bg="var(--color-bg-card)"
                                onChange={(event) => setDisplayLabel(event.target.value)}
                                placeholder={panel.field}
                            />
                        </Box>
                        <VStack align="stretch" gap={0}>
                            {aggregatorItems.map((item) => {
                                const isSelected = item.value === selectedAggregator;
                                return (
                                    <Button
                                        key={item.value}
                                        size="sm"
                                        justifyContent="flex-start"
                                        variant="ghost"
                                        fontWeight={isSelected ? 'semibold' : 'normal'}
                                        bg={isSelected ? 'var(--color-bg-hover)' : 'var(--color-bg-card)'}
                                        color="var(--color-text)"
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        onClick={() => onValueSelect(item.value, displayLabel)}
                                    >
                                        {item.label}
                                    </Button>
                                );
                            })}
                        </VStack>
                    </VStack>
                ) : (
                    <VStack align="stretch" gap={2} p={1}>
                        <Select.Root
                            collection={operatorCollection.collection}
                            value={filterOperator ? [filterOperator] : []}
                            onValueChange={(details) => setFilterOperator(details.value[0] || '==')}
                            size="sm"
                        >
                            <Select.HiddenSelect />
                            <Select.Control>
                                <Select.Trigger>
                                    <Select.ValueText placeholder="Operator" />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Select.Positioner>
                                <Select.Content zIndex={2100} bg="var(--color-bg-card)">
                                    {operatorItems.map((item) => (
                                        <Select.Item key={item.value} item={item}>
                                            <Select.ItemText>{item.label}</Select.ItemText>
                                        </Select.Item>
                                    ))}
                                </Select.Content>
                            </Select.Positioner>
                        </Select.Root>
                        <Input
                            size="sm"
                            value={filterValue}
                            bg="var(--color-bg-card)"
                            onChange={(event) => setFilterValue(event.target.value)}
                            placeholder="Filter value"
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && filterOperator && filterValue) {
                                    onFilterApply(filterOperator, filterValue);
                                }
                            }}
                        />
                        <Button
                            size="sm"
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            disabled={!filterOperator || !filterValue}
                            onClick={() => onFilterApply(filterOperator, filterValue)}
                        >
                            Apply
                        </Button>
                    </VStack>
                )}
            </Box>
        </Portal>
    );
}
