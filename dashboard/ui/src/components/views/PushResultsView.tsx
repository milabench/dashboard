import React, { useState, useRef } from 'react';
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
    Textarea,
} from '@chakra-ui/react';
import { LuUpload } from 'react-icons/lu';
import { toaster } from '../ui/toaster-store';
import { pushZipStream } from '../../services/api';

export const PushResultsView: React.FC = () => {
    usePageTitle('Push Results');

    const [pushKey, setPushKey] = useState<string>('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [metadataText, setMetadataText] = useState<string>('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (file && !file.name.endsWith('.zip')) {
            toaster.create({
                title: 'Invalid file type',
                description: 'Please select a .zip file',
                type: 'error',
                duration: 5000,
            });
            return;
        }
        setSelectedFile(file);
    };

    const handleUpload = async () => {
        if (!selectedFile || !pushKey.trim()) return;

        setIsUploading(true);
        setUploadProgress('Uploading file…');
        try {
            let metadata: Record<string, unknown> | undefined;
            if (metadataText.trim()) {
                try {
                    const parsed = JSON.parse(metadataText.trim());
                    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('not an object');
                    }
                    metadata = parsed;
                } catch {
                    toaster.create({
                        title: 'Invalid metadata',
                        description: 'Metadata must be a JSON object (e.g. {"key": "value"})',
                        type: 'error',
                        duration: 5000,
                    });
                    setIsUploading(false);
                    return;
                }
            }
            const result = await pushZipStream(
                selectedFile,
                pushKey.trim(),
                metadata,
                ({ event, data }) => {
                    if (data.message) {
                        setUploadProgress(data.message);
                    } else if (event === 'run') {
                        setUploadProgress(`Processing run ${data.name}`);
                    } else if (event === 'bench') {
                        setUploadProgress(`Processing benchmark ${data.name}`);
                    }
                },
            );
            if (result.status === 'OK') {
                toaster.create({
                    title: 'Upload successful',
                    description: result.message || 'Results have been pushed to the database',
                    type: 'success',
                    duration: 5000,
                });
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
            } else {
                toaster.create({
                    title: 'Upload failed',
                    description: result.message || 'An error occurred during upload',
                    type: 'error',
                    duration: 5000,
                });
            }
        } catch (error) {
            toaster.create({
                title: 'Upload failed',
                description: error instanceof Error ? error.message : 'An error occurred during upload',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsUploading(false);
            setUploadProgress('');
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Push Results</Heading>

                {/* Upload Results */}
                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color="var(--color-text)">Upload Results</Heading>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            Upload a zipped milabench run using your push key.
                        </Text>

                        <Field.Root>
                            <Field.Label color="var(--color-text)">Push Key</Field.Label>
                            <Input
                                type="password"
                                value={pushKey}
                                onChange={(e) => setPushKey(e.target.value)}
                                placeholder="Enter your push key"
                                fontFamily="mono"
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _focus={{ borderColor: 'var(--color-primary)' }}
                            />
                        </Field.Root>

                        <Field.Root>
                            <Field.Label color="var(--color-text)">Extra Metadata (optional)</Field.Label>
                            <Textarea
                                value={metadataText}
                                onChange={(e) => setMetadataText(e.target.value)}
                                placeholder='{"description": "8xH100 run", "cluster": "my-lab"}'
                                fontFamily="mono"
                                fontSize="sm"
                                rows={3}
                                bg="var(--color-input-bg)"
                                borderColor="var(--color-border)"
                                color="var(--color-text)"
                                _focus={{ borderColor: 'var(--color-primary)' }}
                            />
                            <Field.HelperText color="var(--color-text-muted)" fontSize="xs">
                                JSON object merged into run metadata for this upload only. Push-key metadata and
                                "contributor" always override conflicting fields.
                            </Field.HelperText>
                        </Field.Root>

                        <Box
                            borderWidth={2}
                            borderStyle="dashed"
                            borderColor="var(--color-border)"
                            borderRadius="md"
                            p={6}
                            textAlign="center"
                        >
                            <VStack gap={3}>
                                <LuUpload size={36} color="var(--color-text-muted)" />
                                <Text color="var(--color-text)" fontWeight="medium">
                                    {selectedFile ? selectedFile.name : 'Select a .zip file to upload'}
                                </Text>
                                {selectedFile && (
                                    <Text color="var(--color-text-muted)" fontSize="sm">
                                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                                    </Text>
                                )}
                                <Input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".zip"
                                    onChange={handleFileChange}
                                    display="none"
                                />
                                <HStack gap={4}>
                                    <Button
                                        onClick={() => fileInputRef.current?.click()}
                                        variant="outline"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                    >
                                        Browse Files
                                    </Button>
                                    <Button
                                        onClick={handleUpload}
                                        disabled={!selectedFile || !pushKey.trim() || isUploading}
                                        bg="var(--color-primary)"
                                        color="var(--color-primary-text)"
                                        _hover={{ bg: 'var(--color-primary-hover)' }}
                                        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                                    >
                                        {isUploading ? 'Uploading…' : 'Upload'}
                                    </Button>
                                </HStack>
                                {isUploading && uploadProgress && (
                                    <Text color="var(--color-text-muted)" fontSize="sm">
                                        {uploadProgress}
                                    </Text>
                                )}
                            </VStack>
                        </Box>
                    </VStack>
                </Box>
            </VStack>
        </Box>
    );
};

export default PushResultsView;
