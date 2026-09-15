import type { ReactNode } from 'react';
import { Box, Heading, Text, Badge, HStack, VStack, SimpleGrid, Link, Spinner } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    getMilabenchHealth,
    type MilabenchHealthGb10,
    type MilabenchHealthGb10Run,
    type MilabenchHealthRepo,
} from '../../services/api';

function gb10Label(gb10: MilabenchHealthGb10, repo: MilabenchHealthRepo): string {
    if (gb10.latest_on_main) {
        return `No run for latest main · last run had ${gb10.failures ?? '?'} failed`;
    }
    if (gb10.source === 'github_ci') {
        const failed = gb10.failures ?? repo.ci.bench_failed;
        if (failed === 0) {
            return 'CI ran on GB10 · no dashboard results yet';
        }
        return `CI ran on GB10 · ${failed} group(s) failed`;
    }
    return 'Has not run on GB10';
}

function formatWhen(iso: string | null | undefined): string {
    if (!iso) return 'unknown time';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
}

function shortSha(sha: string | null | undefined): string {
    return (sha || '').slice(0, 8) || 'unknown';
}

function StatusBadge({
    ok,
    label,
    stale,
}: {
    ok: boolean;
    label: string;
    stale?: boolean;
}) {
    const palette = stale ? 'orange' : ok ? 'green' : 'red';
    return (
        <Badge colorPalette={palette} variant="subtle">
            {label}
        </Badge>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Box>
            <Text fontSize="xs" color="fg.muted" mb={1} textTransform="uppercase" letterSpacing="wide">
                {label}
            </Text>
            {children}
        </Box>
    );
}

function Gb10Summary({ run }: { run: MilabenchHealthGb10Run }) {
    const failed = run.packs.failed;
    return (
        <VStack align="stretch" gap={1}>
            <HStack gap={2} flexWrap="wrap">
                <Link asChild>
                    <RouterLink to={`/executions/${run.exec_id}`}>
                        <Text color="blue.500" _hover={{ textDecoration: 'underline' }}>
                            {run.name || `#${run.exec_id}`}
                        </Text>
                    </RouterLink>
                </Link>
                {run.status && (
                    <Badge colorPalette={run.status === 'completed' || run.status === 'done' ? 'green' : 'yellow'} variant="subtle">
                        {run.status}
                    </Badge>
                )}
            </HStack>
            <Text fontSize="sm">
                {run.packs.passed}/{run.packs.total} benches passed
                {failed > 0 ? ` · ${failed} failed` : ''}
            </Text>
            <Text fontSize="xs" color="fg.muted">
                {formatWhen(run.created_time)}
                {run.commit ? ` · ${shortSha(run.commit)}` : ''}
            </Text>
        </VStack>
    );
}

function RepoCard({ repo }: { repo: MilabenchHealthRepo }) {
    const sha = repo.commit?.sha;
    const docker = repo.docker;
    const gb10 = repo.gb10;
    const dockerStale = docker.found && !docker.matches_latest_main && Boolean(docker.head_sha);

    return (
        <Box borderWidth="1px" borderRadius="lg" p={5} h="100%">
            <HStack justify="space-between" mb={4} align="start">
                <Box>
                    <Heading size="md">
                        <Link href={repo.html_url} target="_blank" rel="noopener noreferrer" color="blue.500">
                            {repo.label}
                        </Link>
                    </Heading>
                    <Text fontSize="sm" color="fg.muted">
                        branch main
                    </Text>
                </Box>
            </HStack>

            <VStack align="stretch" gap={5}>
                <Row label="Latest main">
                    {repo.commit ? (
                        <VStack align="stretch" gap={1}>
                            <Link href={repo.commit.html_url} target="_blank" rel="noopener noreferrer" fontFamily="mono" color="blue.500">
                                {shortSha(sha)}
                            </Link>
                            <Text fontSize="sm">{repo.commit.message || '—'}</Text>
                            <Text fontSize="xs" color="fg.muted">{formatWhen(repo.commit.date)}</Text>
                        </VStack>
                    ) : (
                        <Text color="red.500" fontSize="sm">
                            Could not load commit{repo.commit_error?.message ? `: ${repo.commit_error.message}` : ''}
                        </Text>
                    )}
                </Row>

                <Row label="Docker image">
                    {!docker.found ? (
                        <VStack align="stretch" gap={1}>
                            <StatusBadge ok={false} label="Not found" />
                            <Text fontSize="sm" color="fg.muted">
                                {docker.error?.status === 404
                                    ? 'No docker.yml workflow on this repo'
                                    : docker.error?.message || 'No recent docker.yml run on main'}
                            </Text>
                        </VStack>
                    ) : (
                        <VStack align="stretch" gap={1}>
                            <HStack gap={2} flexWrap="wrap">
                                <StatusBadge
                                    ok={docker.published}
                                    stale={dockerStale}
                                    label={
                                        docker.published
                                            ? 'Published for latest main'
                                            : dockerStale
                                              ? 'Published, not latest main'
                                              : docker.conclusion === 'success'
                                                ? 'Published'
                                                : docker.conclusion || docker.status || 'Unknown'
                                    }
                                />
                                {docker.cuda_published && <Badge colorPalette="green" variant="outline">cuda</Badge>}
                                {docker.rocm_published && <Badge colorPalette="green" variant="outline">rocm</Badge>}
                            </HStack>
                            {docker.html_url && (
                                <Link href={docker.html_url} target="_blank" rel="noopener noreferrer" fontSize="sm" color="blue.500">
                                    docker.yml · {shortSha(docker.head_sha)}
                                </Link>
                            )}
                            <Text fontSize="xs" color="fg.muted">{formatWhen(docker.updated_at)}</Text>
                        </VStack>
                    )}
                </Row>

                <Row label="GB10 (main)">
                    {gb10.ran && gb10.for_latest_main ? (
                        <VStack align="stretch" gap={2}>
                            <StatusBadge
                                ok={gb10.failures === 0}
                                label={gb10.failures === 0 ? 'Ran, all benches passed' : `Ran · ${gb10.failures} failed`}
                            />
                            <Gb10Summary run={gb10.for_latest_main} />
                        </VStack>
                    ) : (
                        <VStack align="stretch" gap={2}>
                            <StatusBadge
                                ok={gb10.source === 'github_ci' && (gb10.failures ?? 0) === 0}
                                stale={gb10.source === 'dashboard_stale' || (gb10.source === 'github_ci' && (gb10.failures ?? 0) > 0)}
                                label={gb10Label(gb10, repo)}
                            />
                            {gb10.latest_on_main && (
                                <Box>
                                    <Text fontSize="xs" color="fg.muted" mb={1}>
                                        Latest GB10 run on main (older commit)
                                    </Text>
                                    <Gb10Summary run={gb10.latest_on_main} />
                                </Box>
                            )}
                            {gb10.source === 'github_ci' && repo.ci.found && (
                                <Text fontSize="sm" color="fg.muted">
                                    {repo.ci.html_url ? (
                                        <Link href={repo.ci.html_url} target="_blank" rel="noopener noreferrer" color="blue.500">
                                            Latest CI
                                        </Link>
                                    ) : (
                                        'Latest CI'
                                    )}
                                    {`: ${repo.ci.conclusion || repo.ci.status || 'no run'} · ${shortSha(repo.ci.head_sha)}`}
                                    {repo.ci.bench_total > 0
                                        ? ` · ${repo.ci.bench_failed}/${repo.ci.bench_total} bench groups failed`
                                        : ''}
                                </Text>
                            )}
                        </VStack>
                    )}
                </Row>
            </VStack>
        </Box>
    );
}

export const HealthView = () => {
    usePageTitle('Milabench Health');

    const { data, isLoading, error } = useQuery({
        queryKey: ['milabenchHealth'],
        queryFn: getMilabenchHealth,
        refetchInterval: 60_000,
    });

    if (isLoading) {
        return (
            <Box p={8} textAlign="center">
                <Spinner size="xl" />
            </Box>
        );
    }

    if (error || !data) {
        return (
            <Box p={8}>
                <Text color="red.500">Failed to load milabench health.</Text>
            </Box>
        );
    }

    return (
        <Box p={6}>
            <Heading size="lg" mb={2}>
                Milabench Health
            </Heading>
            <Text color="fg.muted" mb={6}>
                Latest <Text as="span" fontFamily="mono">main</Text> Docker publish and GB10 runs,
                compared across both remotes. Checked {formatWhen(data.checked_at)}.
            </Text>

            <SimpleGrid columns={{ base: 1, lg: 2 }} gap={6}>
                {data.repos.map((repo) => (
                    <RepoCard key={repo.id} repo={repo} />
                ))}
            </SimpleGrid>
        </Box>
    );
};

export default HealthView;
