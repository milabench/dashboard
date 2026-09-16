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
    Badge,
    Table,
    Spinner,
} from '@chakra-ui/react';
import { Link } from 'react-router-dom';
import { toaster } from '../ui/toaster';
import { useViewMode } from '../../contexts/ViewModeContext';
import { getAdminRuns, setRunVisibility, type AdminRunSummary } from '../../services/api';
import { copyTextToClipboard } from '../../utils/download';

const PAGE_SIZE = 50;

function formatDate(iso: string | null): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
}

function RunRow({ run, target }: { run: AdminRunSummary; target: 'dev' | 'prod' }) {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [releaseAt, setReleaseAt] = useState('');

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['adminRuns'] });

    const makePublic = async () => {
        setBusy(true);
        try {
            await setRunVisibility(run._id, 'public', {}, target);
            toaster.create({ title: `#${run._id} is now public`, type: 'success', duration: 3000 });
            invalidate();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    const makePrivate = async () => {
        setBusy(true);
        try {
            await setRunVisibility(run._id, 'private', { releaseAt: releaseAt || null }, target);
            toaster.create({ title: `#${run._id} is now private`, type: 'success', duration: 3000 });
            invalidate();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    const copyShareLink = async () => {
        if (!run.share_path) return;
        const url = `${window.location.origin}${run.share_path}`;
        try {
            await copyTextToClipboard(url);
            toaster.create({ title: 'Share link copied', type: 'success', duration: 3000 });
        } catch {
            // Clipboard access can be blocked entirely (insecure context, no
            // permission, embedded browser) — the link is still shown next to
            // the button so it can always be copied by hand.
            toaster.create({
                title: 'Could not copy automatically',
                description: url,
                type: 'error',
                duration: 8000,
            });
        }
    };

    // A share token is only ever minted as a side effect of setting
    // visibility to "private" — this works whether the run is already
    // private (no-op on visibility, just fills in the missing token) or
    // still public (also flips it private, since a share link only makes
    // sense for a run that isn't otherwise publicly listed).
    const generateShareLink = async () => {
        setBusy(true);
        try {
            const result = await setRunVisibility(run._id, 'private', {}, target);
            if (result.share_path) {
                const url = `${window.location.origin}${result.share_path}`;
                try {
                    await copyTextToClipboard(url);
                    toaster.create({ title: 'Share link generated and copied', type: 'success', duration: 3000 });
                } catch {
                    toaster.create({
                        title: 'Share link generated',
                        description: url,
                        type: 'success',
                        duration: 8000,
                    });
                }
            } else {
                toaster.create({ title: 'Share link generated', type: 'success', duration: 3000 });
            }
            invalidate();
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Table.Row borderColor="var(--color-border)">
            <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)">{run._id}</Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                <Link to={`/executions/${run._id}`}>
                    <Text color="blue.500" _hover={{ textDecoration: 'underline' }} cursor="pointer">
                        {run.name}
                    </Text>
                </Link>
            </Table.Cell>
            <Table.Cell color="var(--color-text-muted)" borderColor="var(--color-border)" fontSize="sm">
                {formatDate(run.created_time)}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                <Badge colorPalette={run.visibility === 'public' ? 'green' : 'orange'} variant="subtle" size="sm">
                    {run.visibility}
                </Badge>
                {run.release_at && (
                    <Text fontSize="xs" color="var(--color-text-muted)" mt={1}>
                        releases {formatDate(run.release_at)}
                    </Text>
                )}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                {run.share_path ? (
                    <HStack gap={2}>
                        <Button size="xs" variant="outline" onClick={copyShareLink}>
                            Copy link
                        </Button>
                        <a
                            href={`${window.location.origin}${run.share_path}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`${window.location.origin}${run.share_path}`}
                            style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}
                        >
                            Open link
                        </a>
                    </HStack>
                ) : (
                    <Button size="xs" variant="outline" loading={busy} onClick={generateShareLink}>
                        Generate link
                    </Button>
                )}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                <HStack gap={2}>
                    {run.visibility === 'public' ? (
                        <Button size="xs" colorPalette="orange" variant="outline" loading={busy} onClick={makePrivate}>
                            Make private
                        </Button>
                    ) : (
                        <Button size="xs" colorPalette="green" variant="outline" loading={busy} onClick={makePublic}>
                            Make public
                        </Button>
                    )}
                    {run.visibility === 'public' && (
                        <Input
                            type="datetime-local"
                            size="xs"
                            width="180px"
                            value={releaseAt}
                            onChange={(e) => setReleaseAt(e.target.value)}
                            title="Optional: schedule auto-release after making private"
                            bg="var(--color-input-bg)"
                            borderColor="var(--color-border)"
                            color="var(--color-text)"
                        />
                    )}
                </HStack>
            </Table.Cell>
        </Table.Row>
    );
}

export const RunVisibilityView: React.FC = () => {
    usePageTitle('Run Visibility');
    const { dbTarget } = useViewMode();
    const [q, setQ] = useState('');
    const [queryText, setQueryText] = useState('');
    const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
    const [offset, setOffset] = useState(0);

    const { data, isLoading } = useQuery({
        queryKey: ['adminRuns', dbTarget, queryText, visibility, offset],
        queryFn: () => getAdminRuns({
            q: queryText || undefined,
            visibility: visibility === 'all' ? undefined : visibility,
            limit: PAGE_SIZE,
            offset,
        }, dbTarget),
    });

    const runs = data?.runs ?? [];
    const total = data?.total ?? 0;

    const submitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setOffset(0);
        setQueryText(q.trim());
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="1100px">
                <Heading color="var(--color-text)">Run Visibility</Heading>
                <Box
                    borderWidth={2}
                    borderRadius="md"
                    borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-border)'}
                    bg={dbTarget === 'prod' ? 'red.500' : 'var(--color-bg-card)'}
                    p={3}
                >
                    <Text fontWeight="bold" color={dbTarget === 'prod' ? 'white' : 'var(--color-text)'}>
                        Target: {dbTarget === 'prod' ? '⚠ PROD' : 'DEV'} — visibility changes below apply directly
                        to this database. Switch it with the toggle in the sidebar.
                    </Text>
                </Box>
                <Text color="var(--color-text-muted)">
                    Make a run public (visible on the public site) or private (only reachable via its share link).
                    Marking a run private generates a share link you can hand out before it goes public.
                </Text>

                <HStack as="form" onSubmit={submitSearch} gap={3}>
                    <Input
                        placeholder="Search by run name…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        bg="var(--color-input-bg)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                        maxW="320px"
                    />
                    <Button type="submit" size="sm" variant="outline">Search</Button>
                    <HStack gap={1}>
                        {(['all', 'public', 'private'] as const).map((v) => (
                            <Button
                                key={v}
                                size="sm"
                                variant={visibility === v ? 'solid' : 'outline'}
                                onClick={() => { setVisibility(v); setOffset(0); }}
                            >
                                {v}
                            </Button>
                        ))}
                    </HStack>
                </HStack>

                {isLoading ? (
                    <Box p={6} textAlign="center"><Spinner /></Box>
                ) : runs.length === 0 ? (
                    <Text color="var(--color-text-muted)">No runs found.</Text>
                ) : (
                    <Box borderWidth={1} borderRadius="md" borderColor="var(--color-border)" overflow="hidden">
                        <Table.ScrollArea>
                            <Table.Root variant="line" size="sm">
                                <Table.Header bg="var(--color-bg-header)">
                                    <Table.Row>
                                        <Table.ColumnHeader width="70px" color="var(--color-text)" borderColor="var(--color-border)">ID</Table.ColumnHeader>
                                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Run name</Table.ColumnHeader>
                                        <Table.ColumnHeader width="170px" color="var(--color-text)" borderColor="var(--color-border)">Created</Table.ColumnHeader>
                                        <Table.ColumnHeader width="140px" color="var(--color-text)" borderColor="var(--color-border)">Visibility</Table.ColumnHeader>
                                        <Table.ColumnHeader width="140px" color="var(--color-text)" borderColor="var(--color-border)">Share link</Table.ColumnHeader>
                                        <Table.ColumnHeader width="260px" color="var(--color-text)" borderColor="var(--color-border)">Actions</Table.ColumnHeader>
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {runs.map((run) => (
                                        <RunRow key={run._id} run={run} target={dbTarget} />
                                    ))}
                                </Table.Body>
                            </Table.Root>
                        </Table.ScrollArea>
                    </Box>
                )}

                <HStack justify="space-between">
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        {total} run{total !== 1 ? 's' : ''} — showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)}
                    </Text>
                    <HStack gap={2}>
                        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                            Previous
                        </Button>
                        <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                            Next
                        </Button>
                    </HStack>
                </HStack>
            </VStack>
        </Box>
    );
};

export default RunVisibilityView;
