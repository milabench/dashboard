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
    Switch,
    Table,
    Spinner,
    Field,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useViewMode } from '../../contexts/ViewModeContext';
import {
    getFeatureFlags,
    createFeatureFlag,
    updateFeatureFlag,
    deleteFeatureFlag,
    type FeatureFlag,
} from '../../services/api';

function formatDate(iso: string | null): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
}

function FlagRow({ flag, target }: { flag: FeatureFlag; target: 'dev' | 'prod' }) {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['featureFlags', target] });

    const toggle = async () => {
        setBusy(true);
        try {
            await updateFeatureFlag(flag.name, { enabled: !flag.enabled }, target);
            invalidate();
            toaster.create({
                title: `${flag.name} is now ${flag.enabled ? 'disabled' : 'enabled'}`,
                type: 'success',
                duration: 3000,
            });
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!window.confirm(`Delete feature flag "${flag.name}"? Code checking this flag will fall back to its own default.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteFeatureFlag(flag.name, target);
            invalidate();
            toaster.create({ title: `${flag.name} deleted`, type: 'success', duration: 3000 });
        } catch (error: any) {
            toaster.create({ title: 'Failed', description: error?.message, type: 'error', duration: 4000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Table.Row borderColor="var(--color-border)">
            <Table.Cell borderColor="var(--color-border)" fontFamily="mono" fontSize="sm">
                {flag.name}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                <Switch.Root checked={flag.enabled} disabled={busy} onCheckedChange={() => toggle()}>
                    <Switch.HiddenInput />
                    <Switch.Control>
                        <Switch.Thumb />
                    </Switch.Control>
                </Switch.Root>
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)" color="var(--color-text-muted)" fontSize="sm">
                {flag.description || '-'}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)" color="var(--color-text-muted)" fontSize="xs">
                {formatDate(flag.updated_at)}
            </Table.Cell>
            <Table.Cell borderColor="var(--color-border)">
                <Button size="xs" colorPalette="red" variant="outline" loading={busy} onClick={remove}>
                    Delete
                </Button>
            </Table.Cell>
        </Table.Row>
    );
}

export const FeatureFlagsView: React.FC = () => {
    usePageTitle('Feature Flags');
    const { dbTarget } = useViewMode();
    const queryClient = useQueryClient();

    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [creating, setCreating] = useState(false);

    const { data: flags = [], isLoading } = useQuery({
        queryKey: ['featureFlags', dbTarget],
        queryFn: () => getFeatureFlags(dbTarget),
    });

    const createFlag = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;

        setCreating(true);
        try {
            await createFeatureFlag(name, false, newDescription.trim(), dbTarget);
            setNewName('');
            setNewDescription('');
            queryClient.invalidateQueries({ queryKey: ['featureFlags', dbTarget] });
            toaster.create({ title: `${name} created`, type: 'success', duration: 3000 });
        } catch (error: any) {
            toaster.create({
                title: 'Failed to create flag',
                description: error?.response?.data?.error ?? error?.message,
                type: 'error',
                duration: 4000,
            });
        } finally {
            setCreating(false);
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Feature Flags</Heading>
                <Box
                    borderWidth={2}
                    borderRadius="md"
                    borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-border)'}
                    bg={dbTarget === 'prod' ? 'red.500' : 'var(--color-bg-card)'}
                    p={3}
                >
                    <Text fontWeight="bold" color={dbTarget === 'prod' ? 'white' : 'var(--color-text)'}>
                        Target: {dbTarget === 'prod' ? '⚠ PROD' : 'DEV'} — toggling a flag below takes
                        effect immediately on that database. Switch it with the toggle in the sidebar.
                    </Text>
                </Box>
                <Text color="var(--color-text-muted)">
                    Named on/off switches code can check at runtime via{' '}
                    <code>feature_flags.is_enabled(session, name)</code> — a kill switch for a risky
                    path, or a gradual rollout gate, flippable here without a deploy. A name with no
                    row yet falls back to whatever default the calling code passes.
                </Text>

                <Box
                    as="form"
                    onSubmit={createFlag}
                    borderWidth={1}
                    borderRadius="md"
                    borderColor="var(--color-border)"
                    bg="var(--color-bg-card)"
                    p={4}
                >
                    <HStack gap={3} align="end" wrap="wrap">
                        <Field.Root maxW="240px">
                            <Field.Label color="var(--color-text)">Name</Field.Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. new-breakdown-ui"
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            />
                        </Field.Root>
                        <Field.Root maxW="360px">
                            <Field.Label color="var(--color-text)">Description</Field.Label>
                            <Input
                                value={newDescription}
                                onChange={(e) => setNewDescription(e.target.value)}
                                placeholder="optional"
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                            />
                        </Field.Root>
                        <Button type="submit" size="sm" colorPalette="blue" loading={creating} disabled={!newName.trim()}>
                            Add flag
                        </Button>
                    </HStack>
                </Box>

                {isLoading ? (
                    <Box p={6} textAlign="center"><Spinner /></Box>
                ) : flags.length === 0 ? (
                    <Text color="var(--color-text-muted)">No feature flags yet.</Text>
                ) : (
                    <Box borderWidth={1} borderRadius="md" borderColor="var(--color-border)" overflow="hidden">
                        <Table.Root variant="line" size="sm">
                            <Table.Header bg="var(--color-bg-header)">
                                <Table.Row>
                                    <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Name</Table.ColumnHeader>
                                    <Table.ColumnHeader width="80px" color="var(--color-text)" borderColor="var(--color-border)">Enabled</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Description</Table.ColumnHeader>
                                    <Table.ColumnHeader width="170px" color="var(--color-text)" borderColor="var(--color-border)">Updated</Table.ColumnHeader>
                                    <Table.ColumnHeader width="90px" color="var(--color-text)" borderColor="var(--color-border)">Actions</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {flags.map((flag) => (
                                    <FlagRow key={flag._id} flag={flag} target={dbTarget} />
                                ))}
                            </Table.Body>
                        </Table.Root>
                    </Box>
                )}
            </VStack>
        </Box>
    );
};

export default FeatureFlagsView;
