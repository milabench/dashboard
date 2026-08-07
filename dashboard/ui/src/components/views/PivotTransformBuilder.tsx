import { useState } from 'react';
import {
    Badge,
    Box,
    Button,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    Stack,
    Text,
    VStack,
} from '@chakra-ui/react';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import type { ChartFieldMeta } from '../../utils/pivotToChartData';
import {
    AGGREGATE_OPS,
    aggregateOpLabel,
    createTransform,
    dimensionFields,
    fieldsAfterTransforms,
    FILTER_OPS,
    TRANSFORM_TYPE_OPTIONS,
    type PivotTransformStep,
    type TransformStepType,
} from '../../utils/pivotPlotTransforms';

export interface PivotTransformBuilderProps {
    transforms: PivotTransformStep[];
    fields: ChartFieldMeta[];
    onChange: (transforms: PivotTransformStep[]) => void;
    compact?: boolean;
}

function FieldSelect({
    value,
    onChange,
    fields,
    placeholder = 'Field',
    allowEmpty = true,
    flex,
    minW,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    fields: ChartFieldMeta[];
    placeholder?: string;
    allowEmpty?: boolean;
    flex?: number | string;
    minW?: string;
    disabled?: boolean;
}) {
    return (
        <NativeSelect.Root size="sm" flex={flex ?? '1'} minW={minW ?? '100px'}>
            <NativeSelect.Field
                value={value}
                onChange={(e) => onChange(e.target.value)}
                bg="var(--color-bg-card)"
                borderColor="var(--color-border)"
                color="var(--color-text)"
                disabled={disabled}
            >
                {allowEmpty && <option value="">{placeholder}</option>}
                {fields.map((f) => (
                    <option key={f.name} value={f.name}>{f.label || f.name}</option>
                ))}
            </NativeSelect.Field>
        </NativeSelect.Root>
    );
}

function updateStep(
    steps: PivotTransformStep[],
    id: string,
    patch: Partial<PivotTransformStep>,
): PivotTransformStep[] {
    return steps.map((step) => (step.id === id ? { ...step, ...patch } as PivotTransformStep : step));
}

function AggregateStepEditor({
    step,
    fields,
    onPatch,
}: {
    step: Extract<PivotTransformStep, { type: 'aggregate' }>;
    fields: ChartFieldMeta[];
    onPatch: (patch: Partial<PivotTransformStep>) => void;
}) {
    const measureFields = fields.filter((f) => f.vegaType === 'quantitative');
    const groupbyCandidates = dimensionFields(fields).filter((f) => !step.groupby.includes(f.name));
    const needsField = step.op !== 'count';
    const [addingGroupby, setAddingGroupby] = useState(false);

    return (
        <VStack align="stretch" gap={2} flex="1">
            <HStack gap={2} flexWrap="wrap" align="center">
                <HStack gap={2} flex="1" minW="min(100%, 220px)" flexWrap="wrap" align="center">
                    <NativeSelect.Root size="sm" w="104px" flexShrink={0}>
                        <NativeSelect.Field
                            value={step.op}
                            onChange={(e) => onPatch({ op: e.target.value })}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        >
                            {AGGREGATE_OPS.map((op) => (
                                <option key={op} value={op}>{aggregateOpLabel(op)}</option>
                            ))}
                        </NativeSelect.Field>
                    </NativeSelect.Root>
                    {needsField && (
                        <>
                            <Text fontSize="sm" color="var(--color-text-muted)" flexShrink={0} whiteSpace="nowrap">
                                of
                            </Text>
                            <FieldSelect
                                value={step.field}
                                onChange={(field) => onPatch({ field })}
                                fields={measureFields}
                                placeholder="field"
                                flex="1"
                                minW="88px"
                            />
                        </>
                    )}
                </HStack>
                <HStack gap={2} flex="1" minW="min(100%, 140px)" flexShrink={0}>
                    <Text fontSize="sm" color="var(--color-text-muted)" flexShrink={0} whiteSpace="nowrap">
                        as
                    </Text>
                    <Input
                        size="sm"
                        placeholder="target"
                        value={step.as}
                        onChange={(e) => onPatch({ as: e.target.value })}
                        bg="var(--color-bg-card)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        flex="1"
                        minW="88px"
                    />
                </HStack>
            </HStack>

            <HStack gap={2} flexWrap="wrap" align="center">
                <Text fontSize="sm" color="var(--color-text-muted)" flexShrink={0}>
                    Group by
                </Text>
                {step.groupby.map((name) => {
                    const label = fields.find((f) => f.name === name)?.label ?? name;
                    return (
                        <Badge
                            key={name}
                            fontSize="xs"
                            px={2}
                            py={0.5}
                            borderRadius="full"
                            bg="var(--color-bg-card)"
                            color="var(--color-text)"
                            cursor="pointer"
                            onClick={() => {
                                onPatch({ groupby: step.groupby.filter((g) => g !== name) });
                                setAddingGroupby(false);
                            }}
                        >
                            {label} ×
                        </Badge>
                    );
                })}
                {addingGroupby ? (
                    <FieldSelect
                        value=""
                        onChange={(field) => {
                            if (field && !step.groupby.includes(field)) {
                                onPatch({ groupby: [...step.groupby, field] });
                            }
                            setAddingGroupby(false);
                        }}
                        fields={groupbyCandidates}
                        placeholder="field"
                        flex="1"
                        minW="88px"
                    />
                ) : (
                    <IconButton
                        aria-label="Add group by field"
                        size="xs"
                        variant="outline"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        disabled={groupbyCandidates.length === 0}
                        onClick={() => setAddingGroupby(true)}
                    >
                        <LuPlus />
                    </IconButton>
                )}
            </HStack>
        </VStack>
    );
}

function renderStepEditor(
    step: PivotTransformStep,
    fields: ChartFieldMeta[],
    onPatch: (patch: Partial<PivotTransformStep>) => void,
    compact = false,
) {
    const rowProps = compact
        ? { direction: 'column' as const, align: 'stretch' as const, gap: 2 }
        : { gap: 2, flexWrap: 'wrap' as const, flex: '1' as const };

    switch (step.type) {
        case 'aggregate':
            return (
                <AggregateStepEditor
                    step={step}
                    fields={fields}
                    onPatch={onPatch}
                />
            );
        case 'filter':
            return (
                <Stack {...rowProps}>
                    <FieldSelect
                        value={step.field}
                        onChange={(field) => onPatch({ field })}
                        fields={fields}
                    />
                    <NativeSelect.Root size="sm" w="100px">
                        <NativeSelect.Field
                            value={step.op}
                            onChange={(e) => onPatch({ op: e.target.value as FilterTransformStep['op'] })}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        >
                            {FILTER_OPS.map((op) => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                        </NativeSelect.Field>
                    </NativeSelect.Root>
                    {step.op !== 'valid' && step.op !== 'invalid' && (
                        <Input
                            size="sm"
                            placeholder="Value"
                            value={step.value}
                            onChange={(e) => onPatch({ value: e.target.value })}
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            flex="1"
                            minW="100px"
                        />
                    )}
                </Stack>
            );
        case 'calculate':
            return (
                <Stack {...rowProps}>
                    <Input
                        size="sm"
                        placeholder="Output as"
                        value={step.as}
                        onChange={(e) => onPatch({ as: e.target.value })}
                        bg="var(--color-bg-card)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        w="140px"
                    />
                    <Input
                        size="sm"
                        placeholder="Expression e.g. datum.a / datum.b"
                        value={step.expr}
                        onChange={(e) => onPatch({ expr: e.target.value })}
                        bg="var(--color-bg-card)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        flex="1"
                        minW="180px"
                        fontFamily="mono"
                    />
                </Stack>
            );
    }
}

type FilterTransformStep = Extract<PivotTransformStep, { type: 'filter' }>;

export function PivotTransformBuilder({ transforms, fields, onChange, compact = false }: PivotTransformBuilderProps) {
    const addTransform = (type: TransformStepType) => {
        onChange([...transforms, createTransform(type)]);
    };

    const removeTransform = (id: string) => {
        onChange(transforms.filter((t) => t.id !== id));
    };

    return (
        <Box
            borderWidth="1px"
            borderColor="var(--color-border)"
            borderRadius="md"
            p={3}
            bg="var(--color-bg-card)"
        >
            <Stack
                direction={compact ? 'column' : 'row'}
                justify="space-between"
                align={compact ? 'stretch' : 'center'}
                gap={2}
                mb={transforms.length > 0 ? 2 : 0}
            >
                <Text fontSize="sm" fontWeight="semibold" color="var(--color-text)">
                    Transforms
                </Text>
                <Stack direction={compact ? 'column' : 'row'} gap={1} align={compact ? 'stretch' : 'center'}>
                    {TRANSFORM_TYPE_OPTIONS.map((opt) => (
                        <Button
                            key={opt.value}
                            size="xs"
                            variant="outline"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                            onClick={() => addTransform(opt.value)}
                            justifyContent={compact ? 'flex-start' : 'center'}
                        >
                            <LuPlus />
                            {opt.label}
                        </Button>
                    ))}
                </Stack>
            </Stack>

            {transforms.length === 0 ? (
                <Text fontSize="xs" color="var(--color-text-muted)">
                    Add aggregate, filter, or calculate steps to reshape data before plotting.
                </Text>
            ) : (
                <VStack align="stretch" gap={2}>
                    {transforms.map((step, index) => {
                        const stepFields = fieldsAfterTransforms(transforms, fields, index);
                        return (
                        <VStack
                            key={step.id}
                            gap={2}
                            align="stretch"
                            p={2}
                            borderWidth="1px"
                            borderColor="var(--color-border)"
                            borderRadius="md"
                            bg="var(--color-bg-hover)"
                        >
                            <HStack justify="space-between">
                                <Text
                                    fontSize="xs"
                                    fontWeight="bold"
                                    color="var(--color-text-muted)"
                                    textTransform="uppercase"
                                >
                                    {step.type}
                                </Text>
                                <IconButton
                                    aria-label="Remove transform"
                                    size="xs"
                                    variant="ghost"
                                    color="var(--color-text-muted)"
                                    onClick={() => removeTransform(step.id)}
                                >
                                    <LuTrash2 />
                                </IconButton>
                            </HStack>
                            {renderStepEditor(step, stepFields, (patch) => {
                                onChange(updateStep(transforms, step.id, patch));
                            }, compact)}
                        </VStack>
                        );
                    })}
                </VStack>
            )}
        </Box>
    );
}

export default PivotTransformBuilder;
