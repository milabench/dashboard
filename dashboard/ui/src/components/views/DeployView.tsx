import React, { useState } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Field,
    Code,
    Link as ChakraLink,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { triggerDeploy, type AdminToolResult, type DeployTarget } from '../../services/api';

const DEPLOY_REPO_URL = 'https://github.com/milabench/deploy/actions';

function DeployButton({
    target,
    label,
    description,
    dashboardRef,
}: {
    target: DeployTarget;
    label: string;
    description: string;
    dashboardRef: string;
}) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<AdminToolResult | null>(null);

    const run = async () => {
        if (!window.confirm(`Trigger the "${label}" deploy workflow for dashboard_ref="${dashboardRef}"?`)) {
            return;
        }
        setBusy(true);
        try {
            const r = await triggerDeploy(target, dashboardRef);
            setResult(r);
            const isError = r.status === 'ERR';
            toaster.create({
                title: isError ? 'Failed to trigger deploy' : `${label} deploy triggered`,
                description: isError ? r.message : r.message,
                type: isError ? 'error' : 'success',
                duration: isError ? 8000 : 5000,
            });
        } catch (error: any) {
            toaster.create({ title: 'Failed to trigger deploy', description: error?.message, type: 'error', duration: 6000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
            <VStack align="stretch" gap={3}>
                <Heading size="md" color="var(--color-text)">{label}</Heading>
                <Text color="var(--color-text-muted)" fontSize="sm">{description}</Text>
                <HStack>
                    <Button size="sm" colorPalette="blue" loading={busy} onClick={run}>
                        Deploy {label}
                    </Button>
                    {result?.actions_url && (
                        <ChakraLink href={result.actions_url} target="_blank" rel="noreferrer" fontSize="sm">
                            View run on GitHub →
                        </ChakraLink>
                    )}
                </HStack>
                {result?.status === 'ERR' && (
                    <Code as="pre" whiteSpace="pre-wrap" p={2} fontSize="xs" bg="var(--color-code-bg)" color="var(--color-text)" borderRadius="md">
                        {result.message}
                    </Code>
                )}
            </VStack>
        </Box>
    );
}

export const DeployView: React.FC = () => {
    usePageTitle('Deploy');
    const [dashboardRef, setDashboardRef] = useState('main');

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Deploy</Heading>
                <Text color="var(--color-text-muted)">
                    Triggers the deploy workflows in{' '}
                    <ChakraLink href={DEPLOY_REPO_URL} target="_blank" rel="noreferrer">
                        milabench/deploy
                    </ChakraLink>
                    , which build and ship this dashboard's backend (Azure App Service) and
                    frontend (Azure Static Web App) from the given <Code>dashboard</Code> repo
                    ref. Requires <Code>GITHUB_DEPLOY_TOKEN</Code> to be configured on the server.
                </Text>

                <Field.Root maxW="360px">
                    <Field.Label color="var(--color-text)">Dashboard ref</Field.Label>
                    <Input
                        value={dashboardRef}
                        onChange={(e) => setDashboardRef(e.target.value)}
                        placeholder="main"
                        bg="var(--color-input-bg)"
                        borderColor="var(--color-border)"
                        color="var(--color-text)"
                    />
                    <Field.HelperText color="var(--color-text-muted)">
                        Branch, tag, or commit SHA of milabench/dashboard to deploy.
                    </Field.HelperText>
                </Field.Root>

                <VStack align="stretch" gap={4}>
                    <DeployButton
                        target="backend"
                        label="Backend"
                        description="Rebuilds and deploys the Flask API to the Azure App Service (deploy-backend.yml)."
                        dashboardRef={dashboardRef}
                    />
                    <DeployButton
                        target="frontend"
                        label="Frontend"
                        description="Rebuilds and deploys the React UI to the Azure Static Web App (deploy-frontend.yml)."
                        dashboardRef={dashboardRef}
                    />
                </VStack>
            </VStack>
        </Box>
    );
};

export default DeployView;
