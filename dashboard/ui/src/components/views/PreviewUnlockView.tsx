import { useEffect, useState } from 'react';
import { Box, Button, Heading, Input, Text, VStack } from '@chakra-ui/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { usePreview } from '../../hooks/useViewMode';
import { usePageTitle } from '../../hooks/usePageTitle';

export default function PreviewUnlockView() {
    usePageTitle('Preview access');
    const { previewAvailable, previewUnlocked, unlockPreview } = usePreview();
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/health';

    useEffect(() => {
        if (previewUnlocked) {
            navigate(redirectTo, { replace: true });
        }
    }, [previewUnlocked, navigate, redirectTo]);

    useEffect(() => {
        const urlToken = searchParams.get('preview_token')?.trim();
        if (!urlToken || previewUnlocked || busy) {
            return;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async token-unlock request triggered by a URL param; busy state gates the in-flight request, not a pure derivation.
        setBusy(true);
        unlockPreview(urlToken)
            .catch((err: unknown) => {
                const message = err && typeof err === 'object' && 'message' in err
                    ? String((err as { message: string }).message)
                    : 'Invalid preview token';
                setError(message);
            })
            .finally(() => setBusy(false));
    }, [searchParams, previewUnlocked, busy, unlockPreview]);

    const onSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await unlockPreview(token.trim());
        } catch (err: unknown) {
            const message = err && typeof err === 'object' && 'message' in err
                ? String((err as { message: string }).message)
                : 'Invalid preview token';
            setError(message);
        } finally {
            setBusy(false);
        }
    };

    if (!previewAvailable) {
        return (
            <Box p={8} maxW="480px">
                <Heading size="md" mb={3}>Preview unavailable</Heading>
                <Text color="fg.muted">
                    Experimental preview access is not enabled on this deployment.
                </Text>
            </Box>
        );
    }

    return (
        <Box p={8} maxW="480px">
            <Heading size="md" mb={2}>Experimental preview</Heading>
            <Text color="fg.muted" mb={6}>
                Enter the preview token to test experimental views against production data.
                This area is not linked from the public dashboard.
            </Text>
            <form onSubmit={onSubmit}>
                <VStack align="stretch" gap={4}>
                    <Input
                        type="password"
                        placeholder="Preview token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoComplete="off"
                    />
                    {error && <Text color="red.500" fontSize="sm">{error}</Text>}
                    <Button type="submit" colorScheme="blue" loading={busy} disabled={!token.trim()}>
                        Unlock preview
                    </Button>
                </VStack>
            </form>
        </Box>
    );
}
