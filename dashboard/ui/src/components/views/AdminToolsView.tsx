import React, { useState } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Code,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useViewMode } from '../../contexts/ViewModeContext';
import {
    getMigrationStatus,
    runMigrationUpgrade,
    getViewsStatus,
    refreshViews,
    recreateViews,
    backfillRunGroups,
    type AdminToolResult,
} from '../../services/api';

const AUTO_STRATEGIES = ['hardware', 'config', 'software', 'milabench', 'platform', 'strict'] as const;

function LogPanel({ log }: { log?: string }) {
    if (!log) return null;
    return (
        <Code
            as="pre"
            display="block"
            whiteSpace="pre-wrap"
            p={3}
            mt={2}
            fontSize="xs"
            bg="var(--color-code-bg)"
            color="var(--color-text)"
            borderRadius="md"
            maxH="320px"
            overflowY="auto"
        >
            {log}
        </Code>
    );
}

function ToolSection({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
            <VStack align="stretch" gap={3}>
                <Heading size="md" color="var(--color-text)">{title}</Heading>
                <Text color="var(--color-text-muted)" fontSize="sm">{description}</Text>
                {children}
            </VStack>
        </Box>
    );
}

export const AdminToolsView: React.FC = () => {
    usePageTitle('Admin Tools');
    const { dbTarget } = useViewMode();

    const [migrateResult, setMigrateResult] = useState<AdminToolResult | null>(null);
    const [migrateBusy, setMigrateBusy] = useState(false);

    const [viewsResult, setViewsResult] = useState<AdminToolResult | null>(null);
    const [viewsBusy, setViewsBusy] = useState(false);

    const [backfillBusy, setBackfillBusy] = useState<string | null>(null);

    const runAction = async (
        setBusy: (b: boolean) => void,
        setResult: (r: AdminToolResult) => void,
        action: () => Promise<AdminToolResult>,
        successTitle: string,
    ) => {
        setBusy(true);
        try {
            const result = await action();
            setResult(result);
            const isError = result.status === 'ERR';
            toaster.create({
                title: isError ? 'Failed' : successTitle,
                description: isError ? result.message : undefined,
                type: isError ? 'error' : 'success',
                duration: isError ? 6000 : 3000,
            });
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 6000 });
        } finally {
            setBusy(false);
        }
    };

    const runBackfill = async (strategy: string) => {
        setBackfillBusy(strategy);
        try {
            const result = await backfillRunGroups(strategy, dbTarget);
            toaster.create({
                title: `Backfill done (${strategy})`,
                description: `${result.processed} runs processed, ${result.errors} errors`,
                type: result.errors > 0 ? 'warning' : 'success',
                duration: 5000,
            });
        } catch (error: any) {
            toaster.create({ title: 'Backfill failed', description: error?.message, type: 'error', duration: 5000 });
        } finally {
            setBackfillBusy(null);
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Admin Tools</Heading>
                <Box
                    borderWidth={2}
                    borderRadius="md"
                    borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-border)'}
                    bg={dbTarget === 'prod' ? 'red.500' : 'var(--color-bg-card)'}
                    p={3}
                >
                    <Text fontWeight="bold" color={dbTarget === 'prod' ? 'white' : 'var(--color-text)'}>
                        Target: {dbTarget === 'prod' ? '⚠ PROD' : 'DEV'} — every action below runs directly against
                        this database. Switch it with the toggle in the sidebar.
                    </Text>
                </Box>
                <Text color="var(--color-text-muted)">
                    Mirrors <Code>dashboard db migrate</Code> / <Code>dashboard db views</Code> / <Code>dashboard db groups backfill</Code>.
                </Text>

                <ToolSection
                    title="Database Migrations"
                    description="Runs Alembic against the target's admin role. Check the pending revisions before upgrading, especially on prod."
                >
                    <HStack gap={3}>
                        <Button
                            size="sm"
                            variant="outline"
                            loading={migrateBusy}
                            onClick={() => runAction(setMigrateBusy, setMigrateResult, () => getMigrationStatus(dbTarget), 'Status fetched')}
                        >
                            Check status
                        </Button>
                        <Button
                            size="sm"
                            colorPalette={dbTarget === 'prod' ? 'red' : 'blue'}
                            loading={migrateBusy}
                            onClick={() => runAction(setMigrateBusy, setMigrateResult, () => runMigrationUpgrade(dbTarget), 'Upgraded to head')}
                        >
                            Upgrade to head ({dbTarget})
                        </Button>
                    </HStack>
                    <LogPanel log={migrateResult?.log} />
                </ToolSection>

                <ToolSection
                    title="Materialized Views"
                    description="Refreshes gpu_summary_mv (the Supported GPUs / Latest GPU runs table). Refresh only updates the data — if the view's own SQL (e.g. a filter) changed, use Recreate instead."
                >
                    <HStack gap={3}>
                        <Button
                            size="sm"
                            variant="outline"
                            loading={viewsBusy}
                            onClick={() => runAction(setViewsBusy, setViewsResult, () => getViewsStatus(dbTarget), 'Status fetched')}
                        >
                            Check status
                        </Button>
                        <Button
                            size="sm"
                            colorPalette={dbTarget === 'prod' ? 'red' : 'blue'}
                            loading={viewsBusy}
                            onClick={() => runAction(setViewsBusy, setViewsResult, () => refreshViews(dbTarget), 'Views refreshed')}
                        >
                            Refresh views ({dbTarget})
                        </Button>
                        <Button
                            size="sm"
                            colorPalette="red"
                            variant="outline"
                            loading={viewsBusy}
                            onClick={() => {
                                if (!window.confirm(
                                    `Drop and recreate materialized views on ${dbTarget}? This picks up any SQL/definition changes (e.g. visibility filters), not just fresh data.`
                                )) return;
                                runAction(setViewsBusy, setViewsResult, () => recreateViews(dbTarget), 'Views recreated');
                            }}
                        >
                            Recreate views ({dbTarget})
                        </Button>
                    </HStack>
                    <LogPanel log={viewsResult?.log} />
                </ToolSection>

                <ToolSection
                    title="Run Group Backfill"
                    description="Re-assigns groups for execs missing membership in a given strategy. Use after fixing a grouping bug so historical runs pick up the new classification."
                >
                    <HStack gap={2} flexWrap="wrap">
                        {AUTO_STRATEGIES.map((s) => (
                            <Button
                                key={s}
                                size="xs"
                                variant="outline"
                                colorPalette={dbTarget === 'prod' ? 'red' : undefined}
                                loading={backfillBusy === s}
                                onClick={() => runBackfill(s)}
                            >
                                {s}
                            </Button>
                        ))}
                    </HStack>
                </ToolSection>
            </VStack>
        </Box>
    );
};

export default AdminToolsView;
