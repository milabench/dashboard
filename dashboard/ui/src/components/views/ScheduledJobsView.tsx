import React, { useState, useCallback, useEffect } from 'react';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Badge,
    Table,
    Spinner,
    Card,
    Grid,
    Code,
    Link,
    Dialog,
    Input,
    Field,
    NativeSelect,
    Textarea,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { LuPlay, LuTrash2, LuPower, LuChevronDown, LuChevronRight, LuCircleAlert, LuPencil, LuRefreshCw } from 'react-icons/lu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toaster } from '../ui/toaster-store';
import { Tooltip } from '../ui/tooltip';
import { MonacoEditor } from '../shared/MonacoEditor';
import {
    getScheduledJobs,
    deleteScheduledJob,
    toggleScheduledJob,
    runScheduledJobNow,
    getScheduledJobRuns,
    updateScheduledJob,
    getScheduledJobTemplateDiff,
    syncScheduledJobTemplate,
    getSlurmTemplates,
} from '../../services/api';
import type { ScheduledJob, ScheduledJobRun, ScheduledJobTemplateDiff } from '../../services/types';

const CRON_PRESETS: { label: string; cron: string }[] = [
    { label: 'Daily at midnight',      cron: '0 0 * * *' },
    { label: 'Weekly on Sunday at 2am', cron: '0 2 * * 0' },
    { label: 'Monthly on the 1st',     cron: '0 0 1 * *' },
    { label: 'Weekdays at midnight',   cron: '0 0 * * 1-5' },
];

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso + 'Z').toLocaleString();
}

function cronHumanLabel(cron: string): string {
    const match = CRON_PRESETS.find(p => p.cron === cron);
    return match ? match.label : cron;
}

// ─── Run history sub-component ──────────────────────────────────────

const RunHistory: React.FC<{ jobId: number }> = ({ jobId }) => {
    const { data: runs, isLoading } = useQuery<ScheduledJobRun[]>({
        queryKey: ['scheduled-runs', jobId],
        queryFn: () => getScheduledJobRuns(jobId),
        refetchInterval: 30_000,
    });

    if (isLoading) return <Spinner size="sm" />;
    if (!runs || runs.length === 0)
        return <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">No runs yet.</Text>;

    return (
        <Table.Root size="sm" variant="outline">
            <Table.Header>
                <Table.Row>
                    <Table.ColumnHeader>Submitted</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Job Runner ID</Table.ColumnHeader>
                    <Table.ColumnHeader>Error</Table.ColumnHeader>
                </Table.Row>
            </Table.Header>
            <Table.Body>
                {runs.map((r) => (
                    <Table.Row key={r._id}>
                        <Table.Cell>{formatDate(r.submitted_at)}</Table.Cell>
                        <Table.Cell>
                            <Badge colorPalette={r.status === 'submitted' ? 'green' : 'red'} variant="subtle">
                                {r.status}
                            </Badge>
                        </Table.Cell>
                        <Table.Cell fontSize="xs" fontFamily="mono">
                            {r.jr_job_id && r.slurm_job_id ? (
                                <Link asChild colorPalette="blue">
                                    <RouterLink to={`/joblogs/${r.slurm_job_id}/${r.jr_job_id}`}>
                                        {r.jr_job_id}
                                    </RouterLink>
                                </Link>
                            ) : (
                                r.jr_job_id || '—'
                            )}
                        </Table.Cell>
                        <Table.Cell>
                            {r.error ? (
                                <Tooltip
                                    content={
                                        <Box
                                            as="pre"
                                            fontSize="xs"
                                            fontFamily="mono"
                                            whiteSpace="pre-wrap"
                                            wordBreak="break-all"
                                            maxW="500px"
                                            maxH="300px"
                                            overflowY="auto"
                                        >
                                            {r.error}
                                        </Box>
                                    }
                                    showArrow
                                    openDelay={200}
                                >
                                    <Button variant="ghost" size="xs" colorPalette="red">
                                        <LuCircleAlert />
                                        Error
                                    </Button>
                                </Tooltip>
                            ) : '—'}
                        </Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table.Root>
    );
};

// ─── Template sync dialog ───────────────────────────────────────────
// Shown when a job's source template has changed on disk since it was
// last loaded, so the change can be reviewed before it's applied instead
// of silently overwriting a scheduled job's script.

const TemplateSyncDialog: React.FC<{
    job: ScheduledJob | null;
    onClose: () => void;
}> = ({ job, onClose }) => {
    const queryClient = useQueryClient();

    const { data: diff, isLoading, error } = useQuery<ScheduledJobTemplateDiff>({
        queryKey: ['scheduled-template-diff', job?._id],
        queryFn: () => getScheduledJobTemplateDiff(job!._id),
        enabled: job != null,
    });

    const syncMut = useMutation({
        mutationFn: () => syncScheduledJobTemplate(job!._id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
            toaster.create({ title: 'Script updated from template', type: 'success', duration: 3000 });
            onClose();
        },
        onError: (err: { message?: string }) => {
            toaster.create({
                title: 'Failed to update script',
                description: err?.message || 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        },
    });

    return (
        <Dialog.Root
            open={job != null}
            onOpenChange={(details) => { if (!details.open) onClose(); }}
            size="cover"
        >
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="95vw" maxH="95vh" overflow="hidden" display="flex" flexDirection="column">
                    <Dialog.Header>
                        <Dialog.Title>
                            Update "{job?.name}" from template {job?.source_template ? <Code>{job.source_template}</Code> : null}
                        </Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body flex="1" overflow="hidden" display="flex" flexDirection="column" gap={3}>
                        {isLoading && <Spinner />}
                        {error && (
                            <Text color="red.500">{(error as { message?: string })?.message || 'Failed to load diff'}</Text>
                        )}
                        {diff && (
                            <>
                                <Text fontSize="sm" color="var(--color-text-muted)">
                                    The template file has changed since this job's script was last loaded.
                                    Review the new content below, then update to apply it.
                                </Text>
                                <Grid templateColumns="1fr 1fr" gap={4} flex="1" minH="0">
                                    <Box display="flex" flexDirection="column" minH="0">
                                        <Text fontSize="sm" fontWeight="medium" mb={1}>Current (running) script</Text>
                                        <Box
                                            as="pre"
                                            flex="1"
                                            minH="0"
                                            fontSize="xs"
                                            fontFamily="mono"
                                            bg="var(--color-bg-page)"
                                            p={3}
                                            borderRadius="md"
                                            borderWidth="1px"
                                            borderColor="var(--color-border)"
                                            overflow="auto"
                                            whiteSpace="pre-wrap"
                                            wordBreak="break-all"
                                        >
                                            {diff.current_script}
                                        </Box>
                                    </Box>
                                    <Box display="flex" flexDirection="column" minH="0">
                                        <Text fontSize="sm" fontWeight="medium" mb={1}>Latest template content</Text>
                                        <Box
                                            as="pre"
                                            flex="1"
                                            minH="0"
                                            fontSize="xs"
                                            fontFamily="mono"
                                            bg="var(--color-bg-page)"
                                            p={3}
                                            borderRadius="md"
                                            borderWidth="1px"
                                            borderColor="green.500"
                                            overflow="auto"
                                            whiteSpace="pre-wrap"
                                            wordBreak="break-all"
                                        >
                                            {diff.latest_script}
                                        </Box>
                                    </Box>
                                </Grid>
                            </>
                        )}
                    </Dialog.Body>
                    <Dialog.Footer>
                        <HStack gap={3}>
                            <Button variant="outline" onClick={onClose}>Cancel</Button>
                            <Button
                                colorPalette="blue"
                                onClick={() => syncMut.mutate()}
                                loading={syncMut.isPending}
                                disabled={!diff}
                            >
                                <LuRefreshCw />
                                Update script from template
                            </Button>
                        </HStack>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    );
};

// ─── Edit dialog ────────────────────────────────────────────────────

const EditScheduledJobDialog: React.FC<{
    job: ScheduledJob | null;
    onClose: () => void;
}> = ({ job, onClose }) => {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [cronPreset, setCronPreset] = useState('');
    const [cronCustom, setCronCustom] = useState('');
    const [jobNamePrefix, setJobNamePrefix] = useState('');
    const [script, setScript] = useState('');
    const [sourceTemplate, setSourceTemplate] = useState('');
    const [sbatchArgsText, setSbatchArgsText] = useState('');

    const { data: templates } = useQuery<string[]>({
        queryKey: ['slurm-templates'],
        queryFn: getSlurmTemplates,
        enabled: job != null,
    });

    useEffect(() => {
        if (!job) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates the edit dialog's form fields from whichever job record was selected for editing; every one of these fields is also independently mutated by the user typing in the form below, so this can't be replaced by a plain render-time derivation.
        setName(job.name);
        const preset = CRON_PRESETS.find(p => p.cron === job.cron_expression);
        setCronPreset(preset ? job.cron_expression : '');
        setCronCustom(job.cron_expression);
        setJobNamePrefix(job.job_name_prefix || '');
        setScript(job.script);
        setSourceTemplate(job.source_template || '');
        setSbatchArgsText((job.sbatch_args || []).join('\n'));
    }, [job]);

    const cron = cronPreset || cronCustom;

    const saveMut = useMutation({
        mutationFn: (payload: Partial<ScheduledJob>) => updateScheduledJob(job!._id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
            toaster.create({ title: 'Scheduled job updated', type: 'success', duration: 3000 });
            onClose();
        },
        onError: (error: { message?: string }) => {
            toaster.create({
                title: 'Failed to update scheduled job',
                description: error?.message || 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        },
    });

    const handleSave = () => {
        if (!name.trim()) {
            toaster.create({ title: 'Name is required', type: 'warning', duration: 3000 });
            return;
        }
        if (!cron.trim()) {
            toaster.create({ title: 'Cron expression is required', type: 'warning', duration: 3000 });
            return;
        }
        if (!script.trim()) {
            toaster.create({ title: 'Script is required', type: 'warning', duration: 3000 });
            return;
        }
        const sbatch_args = sbatchArgsText
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        saveMut.mutate({
            name: name.trim(),
            cron_expression: cron.trim(),
            job_name_prefix: jobNamePrefix.trim() || null,
            script,
            source_template: sourceTemplate || null,
            sbatch_args,
        });
    };

    return (
        <Dialog.Root
            open={job != null}
            onOpenChange={(details) => { if (!details.open) onClose(); }}
            size="cover"
        >
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="95vw" maxH="95vh" overflow="hidden" display="flex" flexDirection="column">
                    <Dialog.Header>
                        <Dialog.Title>Edit scheduled job</Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body flex="1" overflow="hidden" display="flex" flexDirection="column" gap={4}>
                        <HStack gap={3} flexWrap="wrap" align="end">
                            <Field.Root flex="1" minW="180px">
                                <Field.Label>Name</Field.Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} />
                            </Field.Root>
                            <Field.Root w="200px">
                                <Field.Label>Schedule</Field.Label>
                                <NativeSelect.Root>
                                    <NativeSelect.Field
                                        value={cronPreset}
                                        onChange={(e) => {
                                            setCronPreset(e.target.value);
                                            if (e.target.value) setCronCustom(e.target.value);
                                        }}
                                    >
                                        <option value="">Custom</option>
                                        {CRON_PRESETS.map((p) => (
                                            <option key={p.cron} value={p.cron}>{p.label}</option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </Field.Root>
                            <Field.Root w="160px">
                                <Field.Label>Cron</Field.Label>
                                <Input
                                    fontFamily="mono"
                                    value={cronPreset || cronCustom}
                                    onChange={(e) => {
                                        setCronCustom(e.target.value);
                                        setCronPreset('');
                                    }}
                                    placeholder="0 0 * * *"
                                />
                            </Field.Root>
                            <Field.Root w="200px">
                                <Field.Label>Job name prefix</Field.Label>
                                <Input
                                    value={jobNamePrefix}
                                    onChange={(e) => setJobNamePrefix(e.target.value)}
                                    placeholder="optional"
                                />
                            </Field.Root>
                            <Field.Root w="220px">
                                <Field.Label>
                                    Source template
                                    {job?.template_missing && (
                                        <Badge colorPalette="red" variant="subtle" ml={2}>missing</Badge>
                                    )}
                                </Field.Label>
                                <NativeSelect.Root>
                                    <NativeSelect.Field
                                        value={sourceTemplate}
                                        onChange={(e) => setSourceTemplate(e.target.value)}
                                    >
                                        <option value="">— none (custom script) —</option>
                                        {sourceTemplate && !templates?.includes(sourceTemplate) && (
                                            <option value={sourceTemplate}>{sourceTemplate} (missing)</option>
                                        )}
                                        {templates?.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </Field.Root>
                        </HStack>
                        <Text fontSize="xs" color="var(--color-text-muted)" mt={-2}>
                            Setting or changing this only tracks which file the script came from
                            for drift detection -- it does not touch the script below.
                        </Text>
                        <Field.Root>
                            <Field.Label>
                                Sbatch arguments
                                <Text as="span" fontSize="xs" color="var(--color-text-muted)" fontWeight="normal" ml={2}>
                                    one per line, e.g. -w cn-d004 or --gpus-per-task=8
                                </Text>
                            </Field.Label>
                            <Textarea
                                fontFamily="mono"
                                fontSize="sm"
                                rows={4}
                                value={sbatchArgsText}
                                onChange={(e) => setSbatchArgsText(e.target.value)}
                                placeholder={'--partition=milabench\n--nodes=1\n-w cn-d004'}
                            />
                        </Field.Root>
                        <Box flex="1" minH="0" display="flex" flexDirection="column">
                            <Text fontSize="sm" fontWeight="medium" mb={1}>Script</Text>
                            <MonacoEditor value={script} onChange={setScript} height="100%" />
                        </Box>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <HStack gap={3}>
                            <Button variant="outline" onClick={onClose}>Cancel</Button>
                            <Button colorPalette="blue" onClick={handleSave} loading={saveMut.isPending}>
                                Save
                            </Button>
                        </HStack>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    );
};

// ─── Main View ──────────────────────────────────────────────────────

export const ScheduledJobsView: React.FC = () => {
    const queryClient = useQueryClient();
    const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
    const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
    const [syncingJob, setSyncingJob] = useState<ScheduledJob | null>(null);

    const { data: jobs, isLoading } = useQuery<ScheduledJob[]>({
        queryKey: ['scheduled-jobs'],
        queryFn: getScheduledJobs,
        refetchInterval: 30_000,
    });

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
    }, [queryClient]);

    const deleteMut = useMutation({
        mutationFn: deleteScheduledJob,
        onSuccess: invalidate,
    });

    const toggleMut = useMutation({
        mutationFn: toggleScheduledJob,
        onSuccess: invalidate,
    });

    const runNowMut = useMutation({
        mutationFn: runScheduledJobNow,
        onSuccess: (data) => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ['scheduled-runs'] });
            toaster.create({
                title: data.status === 'submitted' ? 'Job submitted' : 'Submission failed',
                type: data.status === 'submitted' ? 'success' : 'error',
                duration: 4000,
            });
        },
    });

    const toggleExpand = (id: number) => setExpandedJobId(prev => prev === id ? null : id);

    return (
        <Box p={6} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={5} maxW="1400px" mx="auto">
                <HStack justify="space-between" align="center">
                    <Heading size="lg" fontWeight="bold" color="var(--color-text)">Scheduled Slurm Jobs</Heading>
                    <Text fontSize="sm" color="var(--color-text-muted)">
                        Edit a job here, or create a new one from the <b>Submit Job</b> page.
                    </Text>
                </HStack>

                {isLoading && <Spinner />}

                {jobs && jobs.length === 0 && (
                    <Text color="var(--color-text-muted)" fontStyle="italic">
                        No scheduled jobs yet. Go to Submit Job and use "Save as Scheduled Job" to create one.
                    </Text>
                )}

                {jobs && jobs.length > 0 && (
                    <Table.Root variant="outline" size="md">
                        <Table.Header>
                            <Table.Row>
                                <Table.ColumnHeader w="30px"></Table.ColumnHeader>
                                <Table.ColumnHeader>Name</Table.ColumnHeader>
                                <Table.ColumnHeader>Schedule</Table.ColumnHeader>
                                <Table.ColumnHeader>Cluster</Table.ColumnHeader>
                                <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                                <Table.ColumnHeader>Last Run</Table.ColumnHeader>
                                <Table.ColumnHeader>Next Run</Table.ColumnHeader>
                                <Table.ColumnHeader textAlign="right">Actions</Table.ColumnHeader>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {jobs.map((job) => (
                                <React.Fragment key={job._id}>
                                    <Table.Row
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        cursor="pointer"
                                        onClick={() => toggleExpand(job._id)}
                                    >
                                        <Table.Cell>
                                            {expandedJobId === job._id ? <LuChevronDown /> : <LuChevronRight />}
                                        </Table.Cell>
                                        <Table.Cell fontWeight="medium">
                                            <HStack gap={2}>
                                                <Text>{job.name}</Text>
                                                {job.outdated && (
                                                    <Tooltip content={`Template "${job.source_template}" has changed since this job's script was loaded.`} showArrow>
                                                        <Badge colorPalette="orange" variant="solid">Outdated</Badge>
                                                    </Tooltip>
                                                )}
                                                {job.template_missing && (
                                                    <Tooltip content={`Source template "${job.source_template}" no longer exists.`} showArrow>
                                                        <Badge colorPalette="red" variant="subtle">Template missing</Badge>
                                                    </Tooltip>
                                                )}
                                            </HStack>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <VStack align="start" gap={0}>
                                                <Text fontSize="sm">{cronHumanLabel(job.cron_expression)}</Text>
                                                <Text fontSize="xs" color="var(--color-text-muted)" fontFamily="mono">{job.cron_expression}</Text>
                                            </VStack>
                                        </Table.Cell>
                                        <Table.Cell><Badge variant="outline">{job.cluster}</Badge></Table.Cell>
                                        <Table.Cell>
                                            <Badge colorPalette={job.enabled ? 'green' : 'gray'} variant="subtle">
                                                {job.enabled ? 'Enabled' : 'Disabled'}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell fontSize="sm">{formatDate(job.last_run_time)}</Table.Cell>
                                        <Table.Cell fontSize="sm">{job.enabled ? formatDate(job.next_run_time) : '—'}</Table.Cell>
                                        <Table.Cell textAlign="right">
                                            <HStack gap={1} justify="flex-end" onClick={e => e.stopPropagation()}>
                                                {job.outdated && (
                                                    <Button
                                                        variant="ghost"
                                                        size="xs"
                                                        colorPalette="orange"
                                                        title="Update script from template"
                                                        onClick={() => setSyncingJob(job)}
                                                    >
                                                        <LuRefreshCw />
                                                        Update
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    title="Edit script"
                                                    onClick={() => setEditingJob(job)}
                                                >
                                                    <LuPencil />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    title={job.enabled ? 'Disable' : 'Enable'}
                                                    onClick={() => toggleMut.mutate(job._id)}
                                                    loading={toggleMut.isPending}
                                                >
                                                    <LuPower />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    title="Run now"
                                                    onClick={() => runNowMut.mutate(job._id)}
                                                    loading={runNowMut.isPending}
                                                >
                                                    <LuPlay />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    colorPalette="red"
                                                    title="Delete"
                                                    onClick={() => { if (window.confirm(`Delete "${job.name}"?`)) deleteMut.mutate(job._id); }}
                                                    loading={deleteMut.isPending}
                                                >
                                                    <LuTrash2 />
                                                </Button>
                                            </HStack>
                                        </Table.Cell>
                                    </Table.Row>
                                    {expandedJobId === job._id && (
                                        <Table.Row>
                                            <Table.Cell colSpan={8} p={4} bg="var(--color-bg-header)">
                                                <Grid templateColumns="1fr 1fr" gap={4}>
                                                    {/* Left: Job Config */}
                                                    <Card.Root variant="outline" p={3} bg="var(--color-bg-card)">
                                                        <VStack align="stretch" gap={3}>
                                                            <Heading size="sm">Configuration</Heading>
                                                            <HStack gap={6} flexWrap="wrap">
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Cluster</Text>
                                                                    <Text fontSize="sm" fontWeight="medium">{job.cluster}</Text>
                                                                </VStack>
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Cron</Text>
                                                                    <Code fontSize="sm">{job.cron_expression}</Code>
                                                                </VStack>
                                                                {job.job_name_prefix && (
                                                                    <VStack align="start" gap={0}>
                                                                        <Text fontSize="xs" color="var(--color-text-muted)">Job Name Prefix</Text>
                                                                        <Text fontSize="sm" fontWeight="medium">{job.job_name_prefix}</Text>
                                                                    </VStack>
                                                                )}
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Source Template</Text>
                                                                    {job.source_template ? (
                                                                        <Code fontSize="sm">{job.source_template}</Code>
                                                                    ) : (
                                                                        <Text fontSize="sm" color="var(--color-text-muted)" fontStyle="italic">
                                                                            custom (not tracked)
                                                                        </Text>
                                                                    )}
                                                                </VStack>
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Created</Text>
                                                                    <Text fontSize="sm">{formatDate(job.created_time)}</Text>
                                                                </VStack>
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Modified</Text>
                                                                    <Text fontSize="sm">{formatDate(job.modified_time)}</Text>
                                                                </VStack>
                                                            </HStack>
                                                            {job.sbatch_args && job.sbatch_args.length > 0 && (
                                                                <VStack align="start" gap={1}>
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Sbatch Arguments</Text>
                                                                    <HStack gap={1} flexWrap="wrap">
                                                                        {job.sbatch_args.map((arg, i) => (
                                                                            <Badge key={i} variant="outline" fontFamily="mono" fontSize="xs">{arg}</Badge>
                                                                        ))}
                                                                    </HStack>
                                                                </VStack>
                                                            )}
                                                            <VStack align="start" gap={1}>
                                                                <HStack justify="space-between" w="100%">
                                                                    <Text fontSize="xs" color="var(--color-text-muted)">Script</Text>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="xs"
                                                                        onClick={() => setEditingJob(job)}
                                                                    >
                                                                        <LuPencil />
                                                                        Edit
                                                                    </Button>
                                                                </HStack>
                                                                <Box
                                                                    as="pre"
                                                                    fontSize="xs"
                                                                    fontFamily="mono"
                                                                    bg="var(--color-bg-page)"
                                                                    p={3}
                                                                    borderRadius="md"
                                                                    borderWidth="1px"
                                                                    borderColor="var(--color-border)"
                                                                    w="100%"
                                                                    maxH="300px"
                                                                    overflowY="auto"
                                                                    whiteSpace="pre-wrap"
                                                                    wordBreak="break-all"
                                                                >
                                                                    {job.script}
                                                                </Box>
                                                            </VStack>
                                                        </VStack>
                                                    </Card.Root>

                                                    {/* Right: Run History */}
                                                    <Card.Root variant="outline" p={3} bg="var(--color-bg-card)">
                                                        <VStack align="stretch" gap={3}>
                                                            <Heading size="sm">Run History</Heading>
                                                            <RunHistory jobId={job._id} />
                                                        </VStack>
                                                    </Card.Root>
                                                </Grid>
                                            </Table.Cell>
                                        </Table.Row>
                                    )}
                                </React.Fragment>
                            ))}
                        </Table.Body>
                    </Table.Root>
                )}
            </VStack>
            <EditScheduledJobDialog job={editingJob} onClose={() => setEditingJob(null)} />
            <TemplateSyncDialog job={syncingJob} onClose={() => setSyncingJob(null)} />
        </Box>
    );
};
