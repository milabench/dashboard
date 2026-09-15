import React, { useState } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Textarea,
    Badge,
    Table,
    Spinner,
    Field,
} from '@chakra-ui/react';
import { Link } from 'react-router-dom';
import { toaster } from '../ui/toaster';
import { useViewMode } from '../../contexts/ViewModeContext';
import {
    createInvalidationRule,
    deleteInvalidationRule,
    getAdminRuns,
    getInvalidationBenchNames,
    getInvalidationRules,
    recomputeInvalidationRules,
    type AdminRunSummary,
} from '../../services/api';

function formatDate(iso: string | null): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
}

// Admin (DEV/PROD-target-aware, same pattern as Run Visibility): record a
// reason a run or benchmark's data is known-bad — e.g. a milabench bug that
// produced wrong results until it was fixed on a given date — and exclude
// it from every aggregate view (scaling, breakdown, composite reports, ...)
// via Exec.invalidated / Pack.invalidated. See
// dashboard/server/database/invalidation.py for how rules get materialized.
export const InvalidationRulesView: React.FC = () => {
    usePageTitle('Data Invalidation');
    const { dbTarget } = useViewMode();
    const queryClient = useQueryClient();

    const [runQuery, setRunQuery] = useState('');
    const [selectedRun, setSelectedRun] = useState<AdminRunSummary | null>(null);
    const [benchName, setBenchName] = useState('');
    const [before, setBefore] = useState('');
    const [after, setAfter] = useState('');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [recomputing, setRecomputing] = useState(false);

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['invalidationRules'] });
    };

    const { data: rules, isLoading } = useQuery({
        queryKey: ['invalidationRules', dbTarget],
        queryFn: () => getInvalidationRules(dbTarget),
    });

    const { data: runMatches } = useQuery({
        queryKey: ['invalidationRunSearch', dbTarget, runQuery],
        queryFn: () => getAdminRuns({ q: runQuery, limit: 8 }, dbTarget),
        enabled: runQuery.trim().length >= 2 && !selectedRun,
    });

    const { data: benchNames } = useQuery({
        queryKey: ['invalidationBenchNames', dbTarget],
        queryFn: () => getInvalidationBenchNames(dbTarget),
    });

    const resetForm = () => {
        setRunQuery('');
        setSelectedRun(null);
        setBenchName('');
        setBefore('');
        setAfter('');
        setReason('');
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRun && !benchName.trim()) {
            toaster.create({ title: 'Pick a run or a benchmark name', type: 'error', duration: 4000 });
            return;
        }
        if (!reason.trim()) {
            toaster.create({ title: 'A reason is required', type: 'error', duration: 4000 });
            return;
        }
        setSubmitting(true);
        try {
            const result = await createInvalidationRule({
                exec_id: selectedRun?._id ?? null,
                bench_name: benchName.trim() || null,
                before: before ? new Date(before).toISOString() : null,
                after: after ? new Date(after).toISOString() : null,
                reason: reason.trim(),
            }, dbTarget);

            if (result.error) {
                toaster.create({ title: 'Failed', description: result.error, type: 'error', duration: 5000 });
                return;
            }
            toaster.create({
                title: 'Rule applied',
                description: `${result.execs_invalidated} run(s), ${result.packs_invalidated} pack(s) invalidated`,
                type: 'success',
                duration: 4000,
            });
            resetForm();
            invalidateAll();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 5000 });
        } finally {
            setSubmitting(false);
        }
    };

    const revert = async (ruleId: number) => {
        try {
            const result = await deleteInvalidationRule(ruleId, dbTarget);
            toaster.create({
                title: 'Rule reverted',
                description: `${result.rules_applied} rule(s) still active`,
                type: 'success',
                duration: 3000,
            });
            invalidateAll();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        }
    };

    const reapplyAll = async () => {
        setRecomputing(true);
        try {
            const result = await recomputeInvalidationRules(dbTarget);
            toaster.create({
                title: 'Recomputed',
                description: `${result.rules_applied} active rule(s) — ${result.execs_invalidated} run(s), ${result.packs_invalidated} pack(s) invalidated`,
                type: 'success',
                duration: 4000,
            });
            invalidateAll();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setRecomputing(false);
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="1100px">
                <Heading color="var(--color-text)">Data Invalidation</Heading>
                <Box
                    borderWidth={2}
                    borderRadius="md"
                    borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-border)'}
                    bg={dbTarget === 'prod' ? 'red.500' : 'var(--color-bg-card)'}
                    p={3}
                >
                    <Text fontWeight="bold" color={dbTarget === 'prod' ? 'white' : 'var(--color-text)'}>
                        Target: {dbTarget === 'prod' ? '⚠ PROD' : 'DEV'} — invalidation rules below apply directly
                        to this database. Switch it with the toggle in the sidebar.
                    </Text>
                </Box>
                <Text color="var(--color-text-muted)">
                    Mark a run or a named benchmark as known-bad (e.g. a milabench bug that produced wrong
                    results until it was fixed) — invalidated runs/packs are excluded from every aggregate view
                    (scaling, breakdown scores, composite reports, performance history, ...) via a boolean flag
                    on Exec/Pack, not deleted. Scope to a run, a benchmark name (across all runs), or both;
                    narrow further with a date range — typically "before" the date the bug was fixed.
                </Text>

                <Box as="form" onSubmit={submit} borderWidth={1} borderRadius="md" borderColor="var(--color-border)" bg="var(--color-bg-card)" p={4}>
                    <VStack align="stretch" gap={3}>
                        <HStack gap={3} flexWrap="wrap" align="flex-start">
                            <Field.Root flex="1" minW="240px">
                                <Field.Label color="var(--color-text)">Run (optional — leave blank to scope by benchmark only)</Field.Label>
                                {selectedRun ? (
                                    <HStack>
                                        <Badge colorPalette="blue">#{selectedRun._id} {selectedRun.name}</Badge>
                                        <Button size="xs" variant="outline" onClick={() => setSelectedRun(null)}>Clear</Button>
                                    </HStack>
                                ) : (
                                    <Box position="relative">
                                        <Input
                                            placeholder="Search run name…"
                                            value={runQuery}
                                            onChange={(e) => setRunQuery(e.target.value)}
                                            bg="var(--color-input-bg)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        />
                                        {runMatches && runMatches.runs.length > 0 && (
                                            <Box
                                                position="absolute"
                                                top="100%"
                                                left={0}
                                                right={0}
                                                zIndex={10}
                                                bg="var(--color-bg-card)"
                                                borderWidth={1}
                                                borderColor="var(--color-border)"
                                                borderRadius="md"
                                                mt={1}
                                                maxH="220px"
                                                overflowY="auto"
                                                boxShadow="md"
                                            >
                                                {runMatches.runs.map((r) => (
                                                    <Box
                                                        key={r._id}
                                                        px={3}
                                                        py={2}
                                                        cursor="pointer"
                                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                                        onClick={() => { setSelectedRun(r); setRunQuery(''); }}
                                                    >
                                                        <Text fontSize="sm" color="var(--color-text)">#{r._id} {r.name}</Text>
                                                    </Box>
                                                ))}
                                            </Box>
                                        )}
                                    </Box>
                                )}
                            </Field.Root>

                            <Field.Root flex="1" minW="200px">
                                <Field.Label color="var(--color-text)">Benchmark name (optional)</Field.Label>
                                <Input
                                    list="invalidation-bench-names"
                                    placeholder="e.g. bf16"
                                    value={benchName}
                                    onChange={(e) => setBenchName(e.target.value)}
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                                <datalist id="invalidation-bench-names">
                                    {benchNames?.map((b) => <option key={b} value={b} />)}
                                </datalist>
                            </Field.Root>
                        </HStack>

                        <HStack gap={3} flexWrap="wrap">
                            <Field.Root flex="1" minW="200px">
                                <Field.Label color="var(--color-text)">Invalid before (usually the fix date)</Field.Label>
                                <Input
                                    type="datetime-local"
                                    value={before}
                                    onChange={(e) => setBefore(e.target.value)}
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                            <Field.Root flex="1" minW="200px">
                                <Field.Label color="var(--color-text)">Invalid after (bug introduced, optional)</Field.Label>
                                <Input
                                    type="datetime-local"
                                    value={after}
                                    onChange={(e) => setAfter(e.target.value)}
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                        </HStack>

                        <Field.Root>
                            <Field.Label color="var(--color-text)">Reason (required)</Field.Label>
                            <Textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g. milabench#1234 — sizer double-counted batch size on ROCm before the fix"
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                rows={2}
                            />
                        </Field.Root>

                        <HStack justify="flex-end">
                            <Button type="submit" colorPalette="orange" loading={submitting}>
                                Mark invalidated
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <HStack justify="space-between" align="center">
                    <Heading size="md" color="var(--color-text)">Active &amp; past rules</Heading>
                    <Button size="sm" variant="outline" loading={recomputing} onClick={reapplyAll}>
                        Reapply all rules
                    </Button>
                </HStack>

                {isLoading ? (
                    <Box p={6} textAlign="center"><Spinner /></Box>
                ) : !rules || rules.length === 0 ? (
                    <Text color="var(--color-text-muted)">No invalidation rules yet.</Text>
                ) : (
                    <Box borderWidth={1} borderRadius="md" borderColor="var(--color-border)" overflow="hidden">
                        <Table.ScrollArea>
                            <Table.Root variant="line" size="sm">
                                <Table.Header bg="var(--color-bg-header)">
                                    <Table.Row>
                                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Scope</Table.ColumnHeader>
                                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Window</Table.ColumnHeader>
                                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Reason</Table.ColumnHeader>
                                        <Table.ColumnHeader width="110px" color="var(--color-text)" borderColor="var(--color-border)">Status</Table.ColumnHeader>
                                        <Table.ColumnHeader width="170px" color="var(--color-text)" borderColor="var(--color-border)">Created</Table.ColumnHeader>
                                        <Table.ColumnHeader width="100px" color="var(--color-text)" borderColor="var(--color-border)">Actions</Table.ColumnHeader>
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {rules.map((rule) => (
                                        <Table.Row key={rule._id} borderColor="var(--color-border)">
                                            <Table.Cell borderColor="var(--color-border)">
                                                <VStack align="flex-start" gap={0.5}>
                                                    {rule.exec_id != null && (
                                                        <Link to={`/executions/${rule.exec_id}`}>
                                                            <Text color="blue.500" _hover={{ textDecoration: 'underline' }} fontSize="sm">
                                                                run #{rule.exec_id}
                                                            </Text>
                                                        </Link>
                                                    )}
                                                    {rule.bench_name && (
                                                        <Badge variant="outline" colorPalette="gray">{rule.bench_name}</Badge>
                                                    )}
                                                </VStack>
                                            </Table.Cell>
                                            <Table.Cell borderColor="var(--color-border)" fontSize="xs" color="var(--color-text-muted)">
                                                {rule.after && <Text>after {formatDate(rule.after)}</Text>}
                                                {rule.before && <Text>before {formatDate(rule.before)}</Text>}
                                                {!rule.after && !rule.before && <Text>any time</Text>}
                                            </Table.Cell>
                                            <Table.Cell borderColor="var(--color-border)" fontSize="sm" color="var(--color-text)" maxW="320px">
                                                {rule.reason}
                                            </Table.Cell>
                                            <Table.Cell borderColor="var(--color-border)">
                                                <Badge colorPalette={rule.active ? 'orange' : 'gray'} variant="subtle" size="sm">
                                                    {rule.active ? 'active' : 'reverted'}
                                                </Badge>
                                            </Table.Cell>
                                            <Table.Cell borderColor="var(--color-border)" fontSize="sm" color="var(--color-text-muted)">
                                                {formatDate(rule.created_at)}
                                            </Table.Cell>
                                            <Table.Cell borderColor="var(--color-border)">
                                                {rule.active && (
                                                    <Button size="xs" variant="outline" colorPalette="red" onClick={() => revert(rule._id)}>
                                                        Revert
                                                    </Button>
                                                )}
                                            </Table.Cell>
                                        </Table.Row>
                                    ))}
                                </Table.Body>
                            </Table.Root>
                        </Table.ScrollArea>
                    </Box>
                )}
            </VStack>
        </Box>
    );
};

export default InvalidationRulesView;
