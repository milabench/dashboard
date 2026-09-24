import React, { useState } from 'react';
import {
    Box,
    Text,
    HStack,
    Badge,
    Table,
    Spinner,
    Tabs,
    Button,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
    getRunGroups,
    getRunGroupMembers,
    getRunGroupCompositeReport,
    getRelatedRunGroups,
    backfillRunGroups,
    type RelatedRunGroup,
} from '../../services/api';
import type { RunGroup, Execution, FastReportRow } from '../../services/types';
import { usePageTitle } from '../../hooks/usePageTitle';
import { toaster } from '../ui/toaster-store';
import { useViewMode } from '../../hooks/useViewMode';

const STRATEGIES = ['hardware', 'config', 'software', 'milabench', 'platform', 'strict', 'manual'] as const;
type Strategy = typeof STRATEGIES[number];

const STRATEGY_COLORS: Record<Strategy, string> = {
    hardware:  'blue',
    config:    'purple',
    software:  'green',
    milabench: 'orange',
    platform:  'teal',
    strict:    'red',
    manual:    'gray',
};

// Every strategy can produce a plain, unscoped composite report (all of the
// group's runs combined, regardless of which hardware they ran on).
const COMPOSITE_STRATEGIES = new Set<Strategy>(STRATEGIES);

// Strategies that don't pin down hardware on their own (a "resized
// batch_size=1" or "software" group can span several machines) — for these,
// show which hardware profiles it actually shows up on, and let the report
// be scoped to one of them (config × hardware, not "all hardware mixed").
const RELATED_HARDWARE_STRATEGIES = new Set<Strategy>(['config', 'software', 'milabench', 'platform']);

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Composite report panel ────────────────────────────────────────────────────

const columnPriority: Record<string, number> = {
    bench: 0, fail: 1, n: 2, ngpu: 3, perf: 4,
    'std%': 5, 'sem%': 6, score: 7, log_score: 8, weight: 9, exec_id: 10,
};

function renderCell(value: unknown, col: string): string {
    if (value === null || value === undefined) return '-';
    if (col === 'enabled') return (value as number) > 0 ? 'Yes' : 'No';
    if (['fail', 'n', 'ngpu', 'weight', 'exec_id'].includes(col)) return (value as number).toFixed(0);
    if (typeof value === 'number') return value.toFixed(2);
    return String(value);
}

interface CompositeReportRow {
    bench: string;
    exec_id: number;
    fail: number;
    n: number;
    ngpu: number;
    perf: number;
    'std%': number;
    'sem%': number;
    score: number;
    log_score: number;
    weight: number;
    enabled: number;
}

type RowIssue = 'fail' | 'zero-perf';

// Reuse the app's existing theme-aware status colors (see theme.css) rather
// than inventing new ones — same red/yellow already used for run status.
const ROW_ISSUE_TINT: Record<RowIssue, string> = {
    fail: 'color-mix(in srgb, var(--color-status-failed) 18%, transparent)',
    'zero-perf': 'color-mix(in srgb, var(--color-status-pending) 20%, transparent)',
};

function rowIssue(row: CompositeReportRow): RowIssue | null {
    if ((row.fail ?? 0) > 0) return 'fail';
    if (!row.perf) return 'zero-perf'; // covers 0, null, and undefined
    return null;
}

function CompositeReportPanel({ group, intersectGroupId }: { group: RunGroup; intersectGroupId?: number }) {
    const [dropMinMax, setDropMinMax] = useState(true);

    const { data, isLoading, error } = useQuery<FastReportRow[]>({
        queryKey: ['compositeReport', group._id, intersectGroupId, dropMinMax],
        queryFn: () => getRunGroupCompositeReport(group._id, { dropMinMax, intersectGroupId }),
    });

    if (isLoading) return <Box p={4}><Spinner size="sm" /></Box>;
    if (error) return <Box p={4}><Text color="red.500">Failed to load composite report.</Text></Box>;

    const rows = (data ?? []).map(item => ({
        bench:     item.bench,
        exec_id:   item.exec_id,
        fail:      item.fail,
        n:         item.n,
        ngpu:      item.ngpu,
        perf:      item.perf,
        'std%':    item.perf > 0 ? item.std * 100 / item.perf : 0,
        'sem%':    item.perf > 0 ? item.sem * 100 / item.perf : 0,
        score:     item.score,
        log_score: item.log_score,
        weight:    item.weight,
        enabled:   item.enabled,
    }));

    const cols = Object.keys(rows[0] ?? {}).sort((a, b) => {
        const pa = columnPriority[a] ?? 99;
        const pb = columnPriority[b] ?? 99;
        return pa !== pb ? pa - pb : a.localeCompare(b);
    });

    const weightTotal = (data ?? [])[0]?.weight_total ?? 0;
    const logSum = (data ?? []).reduce((s, r) => s + (r.log_score ?? 0), 0);
    const score = weightTotal > 0 ? Math.exp(logSum / weightTotal) : 0;

    const issueCounts = rows.reduce(
        (acc, row) => {
            const issue = rowIssue(row);
            if (issue) acc[issue] += 1;
            return acc;
        },
        { fail: 0, 'zero-perf': 0 } as Record<RowIssue, number>,
    );

    return (
        <Box mt={2}>
            <HStack mb={2} gap={3} flexWrap="wrap">
                <Button
                    size="xs"
                    variant={dropMinMax ? 'solid' : 'outline'}
                    onClick={() => setDropMinMax(v => !v)}
                >
                    Drop min/max: {dropMinMax ? 'on' : 'off'}
                </Button>
                <Text fontSize="sm" color="var(--color-text-muted)">
                    Score: <strong>{score.toFixed(2)}</strong>
                    {' — '}exec_id column shows which run each benchmark was sourced from
                </Text>
                {issueCounts.fail > 0 && (
                    <HStack gap={1}>
                        <Box w="10px" h="10px" borderRadius="sm" bg={ROW_ISSUE_TINT.fail} borderWidth="1px" borderColor="var(--color-status-failed)" />
                        <Text fontSize="xs" color="var(--color-text-muted)">{issueCounts.fail} with failures</Text>
                    </HStack>
                )}
                {issueCounts['zero-perf'] > 0 && (
                    <HStack gap={1}>
                        <Box w="10px" h="10px" borderRadius="sm" bg={ROW_ISSUE_TINT['zero-perf']} borderWidth="1px" borderColor="var(--color-status-pending)" />
                        <Text fontSize="xs" color="var(--color-text-muted)">{issueCounts['zero-perf']} with no perf data</Text>
                    </HStack>
                )}
            </HStack>

            <Box
                borderWidth="1px"
                borderColor="var(--color-border)"
                borderRadius="md"
                overflow="hidden"
            >
                <Table.ScrollArea>
                    <Table.Root variant="line" size="sm">
                        <Table.Header bg="var(--color-bg-header)">
                            <Table.Row>
                                {cols.map(c => (
                                    <Table.ColumnHeader key={c} color="var(--color-text)" borderColor="var(--color-border)" fontSize="xs" px={2}>
                                        {c}
                                    </Table.ColumnHeader>
                                ))}
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {rows.map((row, i) => {
                                const issue = rowIssue(row);
                                return (
                                    <Table.Row
                                        key={i}
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        borderColor="var(--color-border)"
                                        bg={issue ? ROW_ISSUE_TINT[issue] : undefined}
                                    >
                                        {cols.map(c => (
                                            <Table.Cell key={c} fontSize="xs" px={2} py={1} borderColor="var(--color-border)"
                                                color={c === 'exec_id' ? 'var(--color-text-muted)' : 'var(--color-text)'}
                                                fontWeight={issue && (c === 'fail' || c === 'perf') ? 'bold' : undefined}
                                            >
                                                {renderCell(row[c as keyof CompositeReportRow], c)}
                                            </Table.Cell>
                                        ))}
                                    </Table.Row>
                                );
                            })}
                        </Table.Body>
                    </Table.Root>
                </Table.ScrollArea>
            </Box>
        </Box>
    );
}

// ── Members table ─────────────────────────────────────────────────────────────

function MembersTable({ group, intersectGroupId }: { group: RunGroup; intersectGroupId?: number }) {
    const { data, isLoading } = useQuery<Execution[]>({
        queryKey: ['runGroupMembers', group._id, intersectGroupId],
        queryFn: () => getRunGroupMembers(group._id, 200, 0, intersectGroupId),
    });

    if (isLoading) return <Box p={4}><Spinner size="sm" /></Box>;
    const rows = data ?? [];

    return (
        <Box borderWidth="1px" borderColor="var(--color-border)" borderRadius="md" overflow="hidden">
            <Box px={4} py={2} bg="var(--color-bg-header)" borderBottomWidth="1px" borderColor="var(--color-border)">
                <Text fontSize="sm" fontWeight="semibold" color="var(--color-text)">
                    {group.label} — {rows.length} run{rows.length !== 1 ? 's' : ''}
                </Text>
            </Box>
            {rows.length === 0 ? (
                <Box p={4}><Text fontSize="sm" color="var(--color-text-muted)">No members.</Text></Box>
            ) : (
                <Table.ScrollArea>
                    <Table.Root variant="line" size="sm">
                        <Table.Header bg="var(--color-bg-header)">
                            <Table.Row>
                                <Table.ColumnHeader width="70px"  color="var(--color-text)" borderColor="var(--color-border)">ID</Table.ColumnHeader>
                                <Table.ColumnHeader width="260px" color="var(--color-text)" borderColor="var(--color-border)">Run name</Table.ColumnHeader>
                                <Table.ColumnHeader width="130px" color="var(--color-text)" borderColor="var(--color-border)">Date</Table.ColumnHeader>
                                <Table.ColumnHeader width="110px" color="var(--color-text)" borderColor="var(--color-border)">Status</Table.ColumnHeader>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {rows.map(e => (
                                <Table.Row key={e._id} borderColor="var(--color-border)">
                                    <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)">{e._id}</Table.Cell>
                                    <Table.Cell borderColor="var(--color-border)">
                                        <Link to={`/executions/${e._id}`}>
                                            <Text color="blue.500" _hover={{ textDecoration: 'underline' }} cursor="pointer">
                                                {e.name ?? `#${e._id}`}
                                            </Text>
                                        </Link>
                                    </Table.Cell>
                                    <Table.Cell color="var(--color-text)"       borderColor="var(--color-border)">{formatDate(e.created_time)}</Table.Cell>
                                    <Table.Cell borderColor="var(--color-border)">
                                        <Badge colorPalette={e.status === 'done' ? 'green' : 'orange'} variant="subtle" size="sm">
                                            {e.status ?? '-'}
                                        </Badge>
                                    </Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table.Root>
                </Table.ScrollArea>
            )}
        </Box>
    );
}

// ── Related hardware panel (config/software/milabench/platform → hardware) ────

type HardwarePanelKind = 'report' | 'details';

function RelatedHardwarePanel({ group }: { group: RunGroup }) {
    const [open, setOpen] = useState<{ id: number; kind: HardwarePanelKind } | null>(null);

    const { data, isLoading, error } = useQuery<RelatedRunGroup[]>({
        queryKey: ['relatedGroups', group._id, 'hardware'],
        queryFn: () => getRelatedRunGroups(group._id, 'hardware'),
    });

    if (isLoading) return <Box p={2}><Spinner size="sm" /></Box>;
    if (error) return <Text fontSize="sm" color="red.500">Failed to load related hardware.</Text>;

    const rows = data ?? [];
    if (rows.length === 0) {
        return <Text fontSize="sm" color="var(--color-text-muted)">No hardware info for this group's runs.</Text>;
    }

    const toggle = (id: number, kind: HardwarePanelKind) =>
        setOpen(v => (v?.id === id && v.kind === kind ? null : { id, kind }));

    return (
        <Box mt={2}>
            <Text fontSize="sm" color="var(--color-text-muted)" mb={2}>
                Seen on {rows.length} hardware profile{rows.length !== 1 ? 's' : ''}. Composite report and run
                breakdown are scoped to that hardware only (never mixing benchmark results across runs).
            </Text>
            <Box borderWidth="1px" borderColor="var(--color-border)" borderRadius="md" overflow="hidden">
                <Table.ScrollArea>
                    <Table.Root variant="line" size="sm">
                        <Table.Header bg="var(--color-bg-header)">
                            <Table.Row>
                                <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Hardware</Table.ColumnHeader>
                                <Table.ColumnHeader width="80px" color="var(--color-text)" borderColor="var(--color-border)"># Runs</Table.ColumnHeader>
                                <Table.ColumnHeader width="220px" color="var(--color-text)" borderColor="var(--color-border)">Actions</Table.ColumnHeader>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {rows.map((hw) => (
                                <React.Fragment key={hw._id}>
                                    <Table.Row borderColor="var(--color-border)">
                                        <Table.Cell color="var(--color-text)" borderColor="var(--color-border)" fontWeight="medium">
                                            {hw.label}
                                        </Table.Cell>
                                        <Table.Cell color="var(--color-text)" borderColor="var(--color-border)">{hw.count}</Table.Cell>
                                        <Table.Cell borderColor="var(--color-border)">
                                            <HStack gap={2}>
                                                <Button
                                                    size="xs"
                                                    colorPalette="teal"
                                                    variant={open?.id === hw._id && open.kind === 'report' ? 'solid' : 'outline'}
                                                    onClick={() => toggle(hw._id, 'report')}
                                                >
                                                    {open?.id === hw._id && open.kind === 'report' ? 'Hide report' : 'Composite report'}
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant={open?.id === hw._id && open.kind === 'details' ? 'solid' : 'outline'}
                                                    onClick={() => toggle(hw._id, 'details')}
                                                >
                                                    {open?.id === hw._id && open.kind === 'details' ? 'Hide' : 'Details'}
                                                </Button>
                                            </HStack>
                                        </Table.Cell>
                                    </Table.Row>
                                    {open?.id === hw._id && (
                                        <Table.Row borderColor="var(--color-border)">
                                            <Table.Cell colSpan={3} borderColor="var(--color-border)" p={3}>
                                                {open.kind === 'report' ? (
                                                    <CompositeReportPanel group={group} intersectGroupId={hw._id} />
                                                ) : (
                                                    <MembersTable group={group} intersectGroupId={hw._id} />
                                                )}
                                            </Table.Cell>
                                        </Table.Row>
                                    )}
                                </React.Fragment>
                            ))}
                        </Table.Body>
                    </Table.Root>
                </Table.ScrollArea>
            </Box>
        </Box>
    );
}

// ── Group detail panel (members + optional composite report) ──────────────────

function GroupDetail({ group, strategy }: { group: RunGroup; strategy: Strategy }) {
    const [showReport, setShowReport] = useState(false);
    const canComposite = COMPOSITE_STRATEGIES.has(strategy);
    const showRelatedHardware = RELATED_HARDWARE_STRATEGIES.has(strategy);

    return (
        <Box mt={4} px={1}>
            <HStack mb={3} gap={3}>
                <Text fontSize="sm" fontWeight="semibold" color="var(--color-text)">
                    Group #{group._id} — {group.label}
                </Text>
                {canComposite && (
                    <Button
                        size="xs"
                        colorPalette="teal"
                        variant={showReport ? 'solid' : 'outline'}
                        onClick={() => setShowReport(v => !v)}
                    >
                        {showReport ? 'Hide composite report' : 'Composite report'}
                    </Button>
                )}
            </HStack>

            {showReport && canComposite && <CompositeReportPanel group={group} />}

            {showRelatedHardware ? (
                <RelatedHardwarePanel group={group} />
            ) : (
                <Box mt={3}>
                    <MembersTable group={group} />
                </Box>
            )}
        </Box>
    );
}

// ── Groups table ──────────────────────────────────────────────────────────────

function GroupsTable({
    strategy,
    selectedGroupId,
    onSelectGroup,
}: {
    strategy: Strategy;
    selectedGroupId?: number;
    onSelectGroup: (group: RunGroup | null) => void;
}) {
    const { data, isLoading, error } = useQuery<RunGroup[]>({
        queryKey: ['runGroups', strategy],
        queryFn: () => getRunGroups(strategy),
    });

    if (isLoading) return <Box p={6} textAlign="center"><Spinner /></Box>;
    if (error)     return <Box p={4}><Text color="red.500">Failed to load groups.</Text></Box>;

    const rows = data ?? [];
    if (rows.length === 0) {
        return <Box p={4}><Text color="var(--color-text-muted)">No {strategy} groups yet.</Text></Box>;
    }

    const selectedGroup = rows.find(g => g._id === selectedGroupId) ?? null;
    const hasGranularity = strategy === 'hardware' || strategy === 'platform' || strategy === 'strict';

    return (
        <>
            <Table.ScrollArea>
                <Table.Root variant="line">
                    <Table.Header bg="var(--color-bg-header)">
                        <Table.Row>
                            <Table.ColumnHeader width="60px"  color="var(--color-text)" borderColor="var(--color-border)">ID</Table.ColumnHeader>
                            <Table.ColumnHeader               color="var(--color-text)" borderColor="var(--color-border)">Label</Table.ColumnHeader>
                            {hasGranularity && (
                                <Table.ColumnHeader width="140px" color="var(--color-text)" borderColor="var(--color-border)">Granularity</Table.ColumnHeader>
                            )}
                            <Table.ColumnHeader width="80px"  color="var(--color-text)" borderColor="var(--color-border)"># Runs</Table.ColumnHeader>
                            <Table.ColumnHeader width="140px" color="var(--color-text)" borderColor="var(--color-border)">Last updated</Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {rows.map(g => (
                            <Table.Row
                                key={g._id}
                                cursor="pointer"
                                onClick={() => onSelectGroup(selectedGroupId === g._id ? null : g)}
                                bg={selectedGroupId === g._id ? 'var(--color-bg-hover)' : undefined}
                                _hover={{ bg: 'var(--color-bg-hover)' }}
                                borderColor="var(--color-border)"
                            >
                                <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)">{g._id}</Table.Cell>
                                <Table.Cell color="var(--color-text)"       borderColor="var(--color-border)" fontWeight="medium">{g.label}</Table.Cell>
                                {hasGranularity && (
                                    <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)" fontSize="sm">{g.granularity ?? '-'}</Table.Cell>
                                )}
                                <Table.Cell color="var(--color-text)"      borderColor="var(--color-border)">{g.member_count ?? 0}</Table.Cell>
                                <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)" fontSize="sm">{formatDate(g.updated_at)}</Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table.Root>
            </Table.ScrollArea>

            {selectedGroup && (
                <GroupDetail group={selectedGroup} strategy={strategy} />
            )}
        </>
    );
}

// ── Backfill toolbar ──────────────────────────────────────────────────────────

function BackfillButton({ strategy }: { strategy: string }) {
    const queryClient = useQueryClient();
    const { dbTarget } = useViewMode();
    const [busy, setBusy] = useState(false);

    const run = async () => {
        setBusy(true);
        try {
            const result = await backfillRunGroups(strategy, dbTarget);
            toaster.create({
                title: `Backfill done (${strategy})`,
                description: `${result.processed} runs processed, ${result.errors} errors`,
                type: result.errors > 0 ? 'warning' : 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['runGroups', strategy] });
        } catch {
            toaster.create({ title: 'Backfill failed', type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Button
            size="xs"
            variant="outline"
            colorPalette={dbTarget === 'prod' ? 'red' : undefined}
            loading={busy}
            onClick={run}
        >
            Backfill {strategy} ({dbTarget})
        </Button>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function isStrategy(value: string | undefined): value is Strategy {
    return !!value && (STRATEGIES as readonly string[]).includes(value);
}

export const RunGroupsView: React.FC = () => {
    usePageTitle('Run Groups');
    const { mode } = useViewMode();
    const navigate = useNavigate();
    const { strategy: strategyParam, groupId: groupIdParam } = useParams<{ strategy?: string; groupId?: string }>();

    // Canonicalize /groups and /groups/<bad-strategy> to a real, shareable URL.
    if (!isStrategy(strategyParam)) {
        return <Navigate to="/groups/hardware" replace />;
    }

    const strategy = strategyParam;
    const selectedGroupId = groupIdParam ? Number(groupIdParam) : undefined;

    return (
        <Box p={6}>
            <HStack mb={1} justify="space-between" align="flex-start">
                <Text fontSize="2xl" fontWeight="bold">Run Groups</Text>
                {mode === 'admin' && (
                    <HStack gap={2}>
                        <BackfillButton strategy="platform" />
                        <BackfillButton strategy="strict" />
                    </HStack>
                )}
            </HStack>
            <Text color="var(--color-text-muted)" mb={6}>
                Executions grouped by hardware profile, run config, software stack, and milabench version.
                The <Badge colorPalette="teal" variant="subtle" size="sm">platform</Badge> and{' '}
                <Badge colorPalette="red" variant="subtle" size="sm">strict</Badge> groups support composite reports.
                Click a row to see its runs — the URL updates so you can share a link straight to it.
            </Text>

            <Tabs.Root
                value={strategy}
                variant="enclosed"
                onValueChange={(e) => navigate(`/groups/${e.value}`)}
            >
                <Tabs.List mb={4}>
                    {STRATEGIES.map(s => (
                        <Tabs.Trigger key={s} value={s}>
                            <HStack gap={1}>
                                <Badge colorPalette={STRATEGY_COLORS[s]} variant="subtle" size="sm">{s}</Badge>
                            </HStack>
                        </Tabs.Trigger>
                    ))}
                </Tabs.List>
                {STRATEGIES.map(s => (
                    <Tabs.Content key={s} value={s} p={0}>
                        <GroupsTable
                            strategy={s}
                            selectedGroupId={s === strategy ? selectedGroupId : undefined}
                            onSelectGroup={(group) =>
                                navigate(group ? `/groups/${s}/${group._id}` : `/groups/${s}`)
                            }
                        />
                    </Tabs.Content>
                ))}
            </Tabs.Root>
        </Box>
    );
};
