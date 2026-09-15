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
    Field,
    Textarea,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { requestPushKey, listPushKeys } from '../../services/api';
import { useViewMode } from '../../contexts/ViewModeContext';

export const PushKeysView: React.FC = () => {
    usePageTitle('Push Keys');
    const queryClient = useQueryClient();
    const { dbTarget } = useViewMode();

    const [requestName, setRequestName] = useState<string>('');
    const [keyMetadataText, setKeyMetadataText] = useState<string>('');
    const [isRequesting, setIsRequesting] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    const { data: pushKeys } = useQuery({
        queryKey: ['pushKeys', dbTarget],
        queryFn: () => listPushKeys(dbTarget),
    });

    const handleRequestKey = async () => {
        if (!requestName.trim()) return;

        let keyMetadata: Record<string, unknown> | undefined;
        if (keyMetadataText.trim()) {
            try {
                const parsed = JSON.parse(keyMetadataText.trim());
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('not an object');
                }
                keyMetadata = parsed;
            } catch {
                toaster.create({
                    title: 'Invalid key metadata',
                    description: 'Key metadata must be a JSON object (e.g. {"source": "ci"})',
                    type: 'error',
                    duration: 5000,
                });
                return;
            }
        }

        setIsRequesting(true);
        try {
            const result = await requestPushKey(requestName.trim(), keyMetadata, dbTarget);
            if (result.status === 'OK' && result.key) {
                setGeneratedKey(result.key);
                toaster.create({
                    title: 'Key generated',
                    description: 'Save your key now - it will not be shown again.',
                    type: 'success',
                    duration: 10000,
                });
                setRequestName('');
                setKeyMetadataText('');
                queryClient.invalidateQueries({ queryKey: ['pushKeys'] });
            } else {
                toaster.create({
                    title: 'Failed to generate key',
                    description: result.message,
                    type: 'error',
                    duration: 5000,
                });
            }
        } catch (error: any) {
            toaster.create({
                title: 'Error',
                description: error?.message || 'Failed to request push key',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsRequesting(false);
        }
    };

    const copyKeyToClipboard = async () => {
        if (!generatedKey) return;
        try {
            await navigator.clipboard.writeText(generatedKey);
            toaster.create({
                title: 'Key copied',
                description: 'Push key copied to clipboard',
                type: 'success',
                duration: 3000,
            });
        } catch {
            toaster.create({
                title: 'Failed to copy',
                description: 'Could not copy key to clipboard',
                type: 'error',
                duration: 3000,
            });
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Push Keys</Heading>
                <Box
                    borderWidth={2}
                    borderRadius="md"
                    borderColor={dbTarget === 'prod' ? 'red.500' : 'var(--color-border)'}
                    bg={dbTarget === 'prod' ? 'red.500' : 'var(--color-bg-card)'}
                    p={3}
                >
                    <Text fontWeight="bold" color={dbTarget === 'prod' ? 'white' : 'var(--color-text)'}>
                        Target: {dbTarget === 'prod' ? '⚠ PROD' : 'DEV'} — keys minted here are written directly
                        into that database. Switch it with the toggle in the sidebar.
                    </Text>
                </Box>

                {/* Request a Key */}
                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color="var(--color-text)">Request a Push Key</Heading>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            Enter the name you want associated with a contributor's results. This name will be
                            publicly visible. Optional metadata is stored on the key and applied to every run
                            pushed with it.
                        </Text>
                        <Field.Root>
                            <Field.Label color="var(--color-text)">Contributor name</Field.Label>
                            <Input
                                value={requestName}
                                onChange={(e) => setRequestName(e.target.value)}
                                placeholder="Contributor name or organization"
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _focus={{ borderColor: 'var(--color-primary)' }}
                            />
                        </Field.Root>
                        <Field.Root>
                            <Field.Label color="var(--color-text)">Key Metadata (optional)</Field.Label>
                            <Textarea
                                value={keyMetadataText}
                                onChange={(e) => setKeyMetadataText(e.target.value)}
                                placeholder='{"source": "ci", "ignore": true}'
                                fontFamily="mono"
                                fontSize="sm"
                                rows={3}
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _focus={{ borderColor: 'var(--color-primary)' }}
                            />
                            <Field.HelperText color="var(--color-text-muted)" fontSize="xs">
                                JSON object attached to the push key. These fields override run and per-upload metadata
                                and cannot be spoofed by uploaded archives.
                            </Field.HelperText>
                        </Field.Root>
                        <HStack gap={4}>
                            <Button
                                onClick={handleRequestKey}
                                disabled={!requestName.trim() || isRequesting}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                {isRequesting ? 'Generating…' : 'Generate Key'}
                            </Button>
                        </HStack>

                        {generatedKey && (
                            <Box bg="var(--color-info-bg)" borderWidth={1} borderColor="var(--color-info-border)" borderRadius="md" p={4}>
                                <VStack align="stretch" gap={2}>
                                    <Text color="var(--color-info-text)" fontWeight="bold" fontSize="sm">
                                        Push key (save it now - it will not be shown again):
                                    </Text>
                                    <HStack>
                                        <Input
                                            value={generatedKey}
                                            readOnly
                                            fontFamily="mono"
                                            fontSize="sm"
                                            bg="var(--color-code-bg)"
                                            color="var(--color-text)"
                                            borderColor="var(--color-border)"
                                        />
                                        <Button
                                            onClick={copyKeyToClipboard}
                                            variant="outline"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                            _hover={{ bg: 'var(--color-bg-hover)' }}
                                        >
                                            Copy
                                        </Button>
                                    </HStack>
                                </VStack>
                            </Box>
                        )}
                    </VStack>
                </Box>

                {/* Registered Contributors */}
                {pushKeys && pushKeys.length > 0 && (
                    <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                        <VStack align="stretch" gap={4}>
                            <Heading size="md" color="var(--color-text)">Registered Contributors</Heading>
                            <VStack align="stretch" gap={2}>
                                {pushKeys.map((pk) => (
                                    <HStack key={pk.name} gap={2} align="flex-start" flexWrap="wrap">
                                        <Badge bg="var(--color-primary)" color="var(--color-primary-text)">
                                            {pk.name}
                                        </Badge>
                                        {pk.metadata && Object.keys(pk.metadata).length > 0 && (
                                            <Text
                                                as="code"
                                                fontSize="xs"
                                                color="var(--color-text-muted)"
                                                fontFamily="mono"
                                            >
                                                {JSON.stringify(pk.metadata)}
                                            </Text>
                                        )}
                                    </HStack>
                                ))}
                            </VStack>
                        </VStack>
                    </Box>
                )}
            </VStack>
        </Box>
    );
};

export default PushKeysView;
