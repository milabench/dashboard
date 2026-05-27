import React, { useState, useRef } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useQuery } from '@tanstack/react-query';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Field,
    Separator,
} from '@chakra-ui/react';
import { LuDownload, LuUpload, LuDatabase, LuArrowRight, LuArrowUpRight } from 'react-icons/lu';
import { toaster } from '../ui/toaster';
import {
    getSyncRemoteInfo,
    downloadLocalBackup,
    backupRemoteDatabase,
    restoreBackup,
    pushToRemote,
} from '../../services/api';

export const DatabaseSyncView: React.FC = () => {
    usePageTitle('Database Sync');

    // Remote connection info
    const [remoteHost, setRemoteHost] = useState('');
    const [remotePort, setRemotePort] = useState('5432');
    const [remoteDbname, setRemoteDbname] = useState('milabench');
    const [remoteUser, setRemoteUser] = useState('');
    const [remotePassword, setRemotePassword] = useState('');
    const [remoteSslmode, setRemoteSslmode] = useState('require');

    // State
    const [isBackingUpLocal, setIsBackingUpLocal] = useState(false);
    const [isBackingUpRemote, setIsBackingUpRemote] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [isPushing, setIsPushing] = useState(false);
    const restoreFileRef = useRef<HTMLInputElement>(null);
    const [restoreFile, setRestoreFile] = useState<File | null>(null);

    const { data: remoteInfo } = useQuery({
        queryKey: ['syncRemoteInfo'],
        queryFn: getSyncRemoteInfo,
    });

    const triggerDownload = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleLocalBackup = async () => {
        setIsBackingUpLocal(true);
        try {
            const blob = await downloadLocalBackup();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            triggerDownload(blob, `milabench_local_${timestamp}.dump`);
            toaster.create({
                title: 'Backup downloaded',
                description: 'Local database backup saved successfully.',
                type: 'success',
                duration: 5000,
            });
        } catch (error: any) {
            toaster.create({
                title: 'Backup failed',
                description: error?.message || 'Failed to create local backup',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsBackingUpLocal(false);
        }
    };

    const handleRemoteBackup = async () => {
        if (!remoteHost || !remoteUser || !remotePassword) {
            toaster.create({
                title: 'Missing fields',
                description: 'Host, user, and password are required.',
                type: 'error',
                duration: 5000,
            });
            return;
        }

        setIsBackingUpRemote(true);
        try {
            const blob = await backupRemoteDatabase({
                host: remoteHost,
                port: remotePort,
                dbname: remoteDbname,
                user: remoteUser,
                password: remotePassword,
                sslmode: remoteSslmode,
            });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            triggerDownload(blob, `milabench_remote_${timestamp}.dump`);
            toaster.create({
                title: 'Remote backup downloaded',
                description: 'Deployed database backup saved successfully.',
                type: 'success',
                duration: 5000,
            });
        } catch (error: any) {
            toaster.create({
                title: 'Backup failed',
                description: error?.message || 'Failed to create remote backup',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsBackingUpRemote(false);
        }
    };

    const handleRestore = async () => {
        if (!restoreFile) return;

        setIsRestoring(true);
        try {
            const result = await restoreBackup(restoreFile);
            const isError = result.status === 'ERR';
            toaster.create({
                title: isError ? 'Restore failed' : 'Restore complete',
                description: result.message,
                type: isError ? 'error' : 'success',
                duration: 8000,
            });
            if (!isError) {
                setRestoreFile(null);
                if (restoreFileRef.current) restoreFileRef.current.value = '';
            }
        } catch (error: any) {
            toaster.create({
                title: 'Restore failed',
                description: error?.message || 'Failed to restore backup',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsRestoring(false);
        }
    };

    const handlePushToRemote = async () => {
        if (!remoteHost || !remoteUser || !remotePassword) {
            toaster.create({
                title: 'Missing fields',
                description: 'Host, user, and password are required.',
                type: 'error',
                duration: 5000,
            });
            return;
        }

        setIsPushing(true);
        try {
            const result = await pushToRemote({
                host: remoteHost,
                port: remotePort,
                dbname: remoteDbname,
                user: remoteUser,
                password: remotePassword,
                sslmode: remoteSslmode,
            });
            const isError = result.status === 'ERR';
            toaster.create({
                title: isError ? 'Push failed' : 'Push complete',
                description: result.message,
                type: isError ? 'error' : 'success',
                duration: 8000,
            });
        } catch (error: any) {
            toaster.create({
                title: 'Push failed',
                description: error?.message || 'Failed to push to remote',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsPushing(false);
        }
    };

    return (
        <Box p={4} bg="var(--color-bg-page)" h="100%" overflowY="auto">
            <VStack align="stretch" gap={6} maxW="900px">
                <Heading color="var(--color-text)">Database Sync</Heading>
                <Text color="var(--color-text-muted)">
                    Backup and restore databases between local dev and deployed environments.
                    {remoteInfo && (
                        <> Default remote: <strong>{remoteInfo.default_url}</strong></>
                    )}
                </Text>

                {/* Download Local Backup */}
                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <HStack>
                            <LuDatabase size={20} color="var(--color-text)" />
                            <Heading size="md" color="var(--color-text)">Local Database</Heading>
                        </HStack>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            Download a pg_dump of the local development database.
                        </Text>
                        <Button
                            onClick={handleLocalBackup}
                            disabled={isBackingUpLocal}
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            width="fit-content"
                        >
                            <LuDownload />
                            {isBackingUpLocal ? 'Creating backup…' : 'Download Local Backup'}
                        </Button>
                    </VStack>
                </Box>

                {/* Backup Remote Database */}
                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <HStack>
                            <LuArrowRight size={20} color="var(--color-text)" />
                            <Heading size="md" color="var(--color-text)">Remote Database</Heading>
                        </HStack>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            Connect to the deployed PostgreSQL database. You can download a backup from it,
                            or push your local database into it.
                        </Text>

                        <HStack gap={4} flexWrap="wrap">
                            <Field.Root flex="2" minW="200px">
                                <Field.Label color="var(--color-text)">Host</Field.Label>
                                <Input
                                    value={remoteHost}
                                    onChange={(e) => setRemoteHost(e.target.value)}
                                    placeholder="e.g. mydb.postgres.database.azure.com"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                            <Field.Root flex="1" minW="80px">
                                <Field.Label color="var(--color-text)">Port</Field.Label>
                                <Input
                                    value={remotePort}
                                    onChange={(e) => setRemotePort(e.target.value)}
                                    placeholder="5432"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                        </HStack>
                        <HStack gap={4} flexWrap="wrap">
                            <Field.Root flex="1" minW="150px">
                                <Field.Label color="var(--color-text)">Database</Field.Label>
                                <Input
                                    value={remoteDbname}
                                    onChange={(e) => setRemoteDbname(e.target.value)}
                                    placeholder="milabench"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                            <Field.Root flex="1" minW="150px">
                                <Field.Label color="var(--color-text)">User</Field.Label>
                                <Input
                                    value={remoteUser}
                                    onChange={(e) => setRemoteUser(e.target.value)}
                                    placeholder="username"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                        </HStack>
                        <HStack gap={4} flexWrap="wrap">
                            <Field.Root flex="2" minW="200px">
                                <Field.Label color="var(--color-text)">Password</Field.Label>
                                <Input
                                    type="password"
                                    value={remotePassword}
                                    onChange={(e) => setRemotePassword(e.target.value)}
                                    placeholder="password"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                            <Field.Root flex="1" minW="100px">
                                <Field.Label color="var(--color-text)">SSL Mode</Field.Label>
                                <Input
                                    value={remoteSslmode}
                                    onChange={(e) => setRemoteSslmode(e.target.value)}
                                    placeholder="require"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                />
                            </Field.Root>
                        </HStack>
                        <HStack gap={4} flexWrap="wrap">
                            <Button
                                onClick={handleRemoteBackup}
                                disabled={isBackingUpRemote || !remoteHost || !remoteUser || !remotePassword}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                <LuDownload />
                                {isBackingUpRemote ? 'Downloading…' : 'Download Remote Backup'}
                            </Button>
                            <Button
                                onClick={handlePushToRemote}
                                disabled={isPushing || !remoteHost || !remoteUser || !remotePassword}
                                bg="var(--color-btn-save-bg)"
                                color="var(--color-btn-save-text)"
                                _hover={{ bg: 'var(--color-btn-save-hover)' }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                <LuArrowUpRight />
                                {isPushing ? 'Pushing…' : 'Push Local DB to Remote'}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Separator borderColor="var(--color-border)" />

                {/* Restore Backup */}
                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <HStack>
                            <LuUpload size={20} color="var(--color-text)" />
                            <Heading size="md" color="var(--color-text)">Restore Backup to Local DB</Heading>
                        </HStack>
                        <Text color="var(--color-text-muted)" fontSize="sm">
                            Upload a .dump file (from pg_dump --format=custom) to restore into the local database.
                            This will replace existing data.
                        </Text>

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
                                    {restoreFile ? restoreFile.name : 'Select a .dump file'}
                                </Text>
                                {restoreFile && (
                                    <Text color="var(--color-text-muted)" fontSize="sm">
                                        {(restoreFile.size / (1024 * 1024)).toFixed(2)} MB
                                    </Text>
                                )}
                                <Input
                                    ref={restoreFileRef}
                                    type="file"
                                    accept=".dump"
                                    onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                                    display="none"
                                />
                                <HStack gap={4}>
                                    <Button
                                        onClick={() => restoreFileRef.current?.click()}
                                        variant="outline"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                    >
                                        Browse Files
                                    </Button>
                                    <Button
                                        onClick={handleRestore}
                                        disabled={!restoreFile || isRestoring}
                                        bg="var(--color-btn-save-bg)"
                                        color="var(--color-btn-save-text)"
                                        _hover={{ bg: 'var(--color-btn-save-hover)' }}
                                        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                                    >
                                        {isRestoring ? 'Restoring…' : 'Restore to Local DB'}
                                    </Button>
                                </HStack>
                            </VStack>
                        </Box>
                    </VStack>
                </Box>
            </VStack>
        </Box>
    );
};

export default DatabaseSyncView;
