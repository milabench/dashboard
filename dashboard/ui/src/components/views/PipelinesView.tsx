import React, { useState, useMemo } from 'react';
import { Tooltip } from "../../components/ui/tooltip"
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Button,
    Table,
    Badge,
    Dialog,
    Input,
    Select,
    IconButton,
    Alert,
    Tabs,
    Card,
    Field,
    Flex,
    Spacer,
    Separator,
    useListCollection
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import {
    LuPlus,
    LuTrash2,
} from 'react-icons/lu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getSlurmProfiles,
    getSlurmTemplates,
    getPipelineTemplatesList,
    savePipelineToFile,
    loadPipelineFromFile
} from '../../services/api';
import type {
    Pipeline,
    PipelineRun,
    PipelineNode,
    PipelineJob,
    PipelineSequential,
    PipelineParallel,
    SlurmProfile
} from '../../services/types';
import { usePageTitle } from '../../hooks/usePageTitle';

const getStatusColor = (status: string) => {
    switch (status) {
        case 'completed': return 'green';
        case 'running': return 'blue';
        case 'failed': return 'red';
        case 'cancelled': return 'gray';
        case 'pending': return 'yellow';
        default: return 'gray';
    }
};

interface JobNodeData {
    type: 'job' | 'sequential' | 'parallel';
    script?: string;
    profile?: string;
    name?: string;
    children: JobNodeData[];
}

const JobNode: React.FC<{
    node: JobNodeData;
    onUpdate: (node: JobNodeData) => void;
    onDelete: () => void;
    profiles: SlurmProfile[];
    templates: string[];
    depth?: number;
    canDelete?: boolean;
}> = ({ node, onUpdate, onDelete, profiles, templates, depth = 0, canDelete = true }) => {
    const handleTypeChange = (newType: 'job' | 'sequential' | 'parallel') => {
        const updatedNode = {
            ...node,
            type: newType,
            // Set default values based on type but keep children for UX
            script: newType === 'job' ? (node.script || templates[0] || '') : undefined,
            profile: newType === 'job' ? (node.profile || profiles[0]?.name || 'default') : undefined,
            name: newType !== 'job' ? (node.name || `New ${newType}`) : undefined
        };
        onUpdate(updatedNode);
    };

    const handleFieldChange = (field: string, value: string) => {
        const updatedNode = { ...node, [field]: value };
        onUpdate(updatedNode);
    };

    const handleAddChild = () => {
        const newChild: JobNodeData = {
            type: 'job',
            script: templates[0] || '',
            profile: profiles[0]?.name || 'default',
            children: []
        };

        const updatedNode = {
            ...node,
            children: [...node.children, newChild]
        };
        onUpdate(updatedNode);
    };

    const handleChildUpdate = (index: number, updatedChild: JobNodeData) => {
        const updatedNode = {
            ...node,
            children: node.children.map((child, i) => i === index ? updatedChild : child)
        };
        onUpdate(updatedNode);
    };

    const handleChildDelete = (index: number) => {
        const updatedNode = {
            ...node,
            children: node.children.filter((_, i) => i !== index)
        };
        onUpdate(updatedNode);
    };

    const getNodeBgColor = (nodeType: string) => {
        switch (nodeType) {
            case 'job': return 'var(--color-pipeline-job-bg)';
            case 'sequential': return 'var(--color-pipeline-seq-bg)';
            case 'parallel': return 'var(--color-pipeline-par-bg)';
            default: return 'var(--color-bg-card)';
        }
    };

    const getNodeBorderColor = (nodeType: string) => {
        switch (nodeType) {
            case 'job': return 'var(--color-pipeline-job-border)';
            case 'sequential': return 'var(--color-pipeline-seq-border)';
            case 'parallel': return 'var(--color-pipeline-par-border)';
            default: return 'var(--color-border)';
        }
    };

    // Collections for Select components
    const nodeTypeItems = useMemo(() => [
        { label: 'Job', value: 'job' },
        { label: 'Sequential', value: 'sequential' },
        { label: 'Parallel', value: 'parallel' }
    ], []);

    const templatesItems = useMemo(() =>
        templates.map(template => ({ label: template, value: template })),
        [templates]
    );

    const profilesItems = useMemo(() =>
        profiles.map(profile => ({ label: profile.name, value: profile.name })),
        [profiles]
    );

    const nodeTypeCollection = useListCollection({ initialItems: nodeTypeItems });
    const templatesCollection = useListCollection({ initialItems: templatesItems });
    const profilesCollection = useListCollection({ initialItems: profilesItems });

    const renderNodeHeader = () => {
        return (
            <VStack gap={3} align="stretch">
                <HStack gap={3} justify="space-between" flexWrap="wrap" align="flex-end">
                    <HStack gap={3} flex={1} minW="300px" align="flex-end">
                        <VStack align="start" gap={1} w="140px">
                            <Text fontSize="xs" fontWeight="medium" color="var(--color-text)" visibility="hidden">Type</Text>
                            <Select.Root
                                size="sm"
                                collection={nodeTypeCollection.collection}
                                value={[node.type]}
                                onValueChange={(details) => handleTypeChange(details.value[0] as any)}
                                w="100%"
                            >
                                <Select.HiddenSelect />
                                <Select.Control
                                    bg={getNodeBgColor(node.type)}
                                    borderColor={getNodeBorderColor(node.type)}
                                    borderRadius="md"
                                    h="32px"
                                >
                                    <Select.Trigger>
                                        <Select.ValueText fontWeight="semibold" color="var(--color-text)" />
                                    </Select.Trigger>
                                    <Select.IndicatorGroup>
                                        <Select.Indicator />
                                    </Select.IndicatorGroup>
                                </Select.Control>
                                <Select.Positioner>
                                    <Select.Content>
                                        {nodeTypeItems.map((item) => (
                                            <Select.Item key={item.value} item={item}>
                                                <Select.ItemText>{item.label}</Select.ItemText>
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Select.Root>
                        </VStack>

                        {node.type === 'job' ? (
                            <>
                                <VStack align="start" gap={1} flex={1}>
                                    <Text fontSize="xs" fontWeight="medium" color="var(--color-text)">Script</Text>
                                    <Select.Root
                                        size="sm"
                                        collection={templatesCollection.collection}
                                        value={node.script ? [node.script] : []}
                                        onValueChange={(details) => handleFieldChange('script', details.value[0] || '')}
                                        flex={1}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control
                                            bg="var(--color-input-bg)"
                                            borderColor="var(--color-input-border)"
                                            borderRadius="md"
                                            _focus={{ borderColor: 'var(--color-primary)' }}
                                            h="32px"
                                        >
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select template" color="var(--color-text)" />
                                            </Select.Trigger>
                                            <Select.IndicatorGroup>
                                                <Select.Indicator />
                                            </Select.IndicatorGroup>
                                        </Select.Control>
                                        <Select.Positioner>
                                            <Select.Content>
                                                {templatesItems.map((item) => (
                                                    <Select.Item key={item.value} item={item}>
                                                        <Select.ItemText>{item.label}</Select.ItemText>
                                                    </Select.Item>
                                                ))}
                                            </Select.Content>
                                        </Select.Positioner>
                                    </Select.Root>
                                </VStack>
                                <VStack align="start" gap={1} w="300px">
                                    <Text fontSize="xs" fontWeight="medium" color="var(--color-text)">Resources</Text>
                                    <Select.Root
                                        size="sm"
                                        collection={profilesCollection.collection}
                                        value={node.profile ? [node.profile] : []}
                                        onValueChange={(details) => handleFieldChange('profile', details.value[0] || '')}
                                        w="100%"
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control
                                            bg="var(--color-input-bg)"
                                            borderColor="var(--color-input-border)"
                                            borderRadius="md"
                                            _focus={{ borderColor: 'var(--color-primary)' }}
                                            h="32px"
                                        >
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select profile" color="var(--color-text)" />
                                            </Select.Trigger>
                                            <Select.IndicatorGroup>
                                                <Select.Indicator />
                                            </Select.IndicatorGroup>
                                        </Select.Control>
                                        <Select.Positioner>
                                            <Select.Content>
                                                {profilesItems.map((item) => (
                                                    <Select.Item key={item.value} item={item}>
                                                        <Select.ItemText>{item.label}</Select.ItemText>
                                                    </Select.Item>
                                                ))}
                                            </Select.Content>
                                        </Select.Positioner>
                                    </Select.Root>
                                </VStack>
                            </>
                        ) : (
                            <VStack align="start" gap={1} flex={1}>
                                <Text fontSize="xs" fontWeight="medium" color="var(--color-text)">Name</Text>
                                <Input
                                    pl="10px"
                                    size="sm"
                                    value={node.name || ''}
                                    onChange={(e) => handleFieldChange('name', e.target.value)}
                                    placeholder="Enter name"
                                    w="100%"
                                    bg="var(--color-input-bg)"
                                    borderColor="var(--color-input-border)"
                                    color="var(--color-text)"
                                    _focus={{ borderColor: 'var(--color-primary)' }}
                                    borderRadius="md"
                                    h="32px"
                                />
                            </VStack>
                        )}
                    </HStack>

                    <HStack gap={2}>
                        {node.type !== 'job' && (
                            <Button
                                size="sm"
                                onClick={handleAddChild}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                                borderRadius="md"
                            >
                                + Add
                            </Button>
                        )}
                        {canDelete && (
                            <IconButton
                                aria-label="Delete"
                                size="sm"
                                colorScheme="red"
                                variant="ghost"
                                onClick={onDelete}
                                borderRadius="md"
                            >
                                <LuTrash2 />
                            </IconButton>
                        )}
                    </HStack>
                </HStack>
            </VStack>
        );
    };

    const renderChildren = () => {
        // Don't display children for job nodes at all
        if (node.type === 'job' || node.children.length === 0) return null;

        // Show children for sequential and parallel types only
        return (
            <VStack align="stretch" pl={6} gap={1}>
                {node.children.map((child, index) => (
                    <Box key={index}>
                        <JobNode
                            node={child}
                            onUpdate={(updatedChild) => handleChildUpdate(index, updatedChild)}
                            onDelete={() => handleChildDelete(index)}
                            profiles={profiles}
                            templates={templates}
                            depth={depth + 1}
                            canDelete={true}
                        />
                    </Box>
                ))}
            </VStack>
        );
    };

    if (node.type === 'job') {
        return (
            <Box ml={depth * 2} bg="var(--color-bg-card)" padding="2px" borderRadius="md" border="1px" borderColor="var(--color-border)" mb={1}>
                {renderNodeHeader()}
                {renderChildren()}
            </Box>
        );
    }

    return (
        <Box
            ml={depth * 2}
            padding="10px"
            border="1px"
            borderColor="var(--color-border)"
            borderRadius="lg"
            mb={1}
            bg="var(--color-bg-card)"
            boxShadow="sm"
        >
            <Box p={4}>
                {renderNodeHeader()}
            </Box>
            {renderChildren()}
        </Box>
    );
};

const PipelineNodeDisplay: React.FC<{ node: PipelineNode; depth?: number }> = ({ node, depth = 0 }) => {
    const indent = depth * 20;

    const renderNode = () => {
        if (node.type === 'job') {
            const job = node as PipelineJob;
            return (
                <HStack>
                    <Badge colorScheme="orange">Job</Badge>
                    <Text fontWeight="bold" color="var(--color-text)">{job.script}</Text>
                    <Badge variant="outline">{job.profile}</Badge>
                </HStack>
            );
        }

        if (node.type === 'sequential') {
            const seq = node as PipelineSequential;
            return (<>
                <HStack>
                    <Badge colorScheme="green">Sequential</Badge>
                    <Text fontWeight="bold" color="var(--color-text)">{seq.name}</Text>
                </HStack>
                <VStack align="stretch" pl={6} gap={1}>
                    {seq.jobs.map((job, index) => (
                        <Box key={index}>
                            <PipelineNodeDisplay node={job} depth={depth + 1} />
                        </Box>
                    ))}
                </VStack>
            </>
            );
        }

        if (node.type === 'parallel') {
            const par = node as PipelineParallel;
            return (<>
                <HStack>
                    <Badge colorScheme="blue">Parallel</Badge>
                    <Text fontWeight="bold" color="var(--color-text)">{par.name}</Text>
                </HStack>
                <VStack align="stretch" pl={6} gap={1}>
                    {par.jobs.map((job, index) => (
                        <Box key={index}>
                            <PipelineNodeDisplay node={job} depth={depth + 1} />
                        </Box>
                    ))}
                </VStack>
            </>);
        }

        return null;
    };

    return (
        <Box ml={indent} padding="0px" margin="0px" className="here">
            {renderNode()}
        </Box>
    )
};

const PipelineBuilder: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    profiles: SlurmProfile[];
    templates: string[];
    loadedTemplateData?: any;
    onSaveTemplate: (data: any) => void;
}> = ({ isOpen, onClose, profiles, templates, loadedTemplateData, onSaveTemplate }) => {
    const [pipelineName, setPipelineName] = useState('');
    const [rootNode, setRootNode] = useState<JobNodeData>({
        type: 'sequential',
        name: 'Main Sequence',
        children: []
    });

    // Convert backend PipelineNode format to frontend JobNodeData format
    const convertFromBackendFormat = (node: PipelineNode): JobNodeData => {
        if (node.type === 'job') {
            return {
                type: 'job',
                script: node.script || '',
                profile: node.profile || '',
                children: [] // Jobs can have children in UI for UX
            };
        } else if (node.type === 'sequential') {
            return {
                type: 'sequential',
                name: node.name || 'Unnamed Sequential',
                children: (node.jobs || []).map(convertFromBackendFormat)
            };
        } else {
            return {
                type: 'parallel',
                name: node.name || 'Unnamed Parallel',
                children: (node.jobs || []).map(convertFromBackendFormat)
            };
        }
    };

    // Load template data when provided
    React.useEffect(() => {
        if (loadedTemplateData) {
            // Handle server format: { type: 'pipeline', name: '...', definition: {...}, job_id: null }
            if (loadedTemplateData.type === 'pipeline') {
                setPipelineName(loadedTemplateData.name || '');
                if (loadedTemplateData.definition) {
                    setRootNode(convertFromBackendFormat(loadedTemplateData.definition));
                }
            } else {
                // Fallback for old format (if any)
                setPipelineName(loadedTemplateData.pipelineName || '');
                setRootNode(loadedTemplateData.rootNode || {
                    type: 'sequential',
                    name: 'Main Sequence',
                    children: []
                });
            }
        }
    }, [loadedTemplateData]);

    const handleSavePipeline = () => {
        if (!pipelineName) return;

        // Convert JobNodeData to PipelineNode, filtering out job children
        const convertNode = (node: JobNodeData): PipelineNode => {
            if (node.type === 'job') {
                return {
                    type: 'job',
                    script: node.script || '',
                    profile: node.profile || ''
                };
            } else if (node.type === 'sequential') {
                return {
                    type: 'sequential',
                    name: node.name || 'Unnamed Sequential',
                    jobs: node.children.map(convertNode)
                };
            } else {
                return {
                    type: 'parallel',
                    name: node.name || 'Unnamed Parallel',
                    jobs: node.children.map(convertNode)
                };
            }
        };

        // Save as template file - format expected by server
        const templateData = {
            name: pipelineName,            // used for filename
            type: 'pipeline',              // required by JobNode.from_json
            definition: convertNode(rootNode), // the actual pipeline structure
            job_id: null                   // optional field
        };

        onSaveTemplate(templateData);

        // Reset form
        setPipelineName('');
        setRootNode({
            type: 'sequential',
            name: 'Main Sequence',
            children: []
        });
        onClose();
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={(details) => { if (!details.open) onClose(); }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="6xl" maxH="90vh">
                    <Dialog.Header>
                        <Dialog.Title>Pipeline</Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body overflowY="auto">
                        <VStack gap={6} align="stretch">
                            <Field.Root required>
                                <Field.Label>Pipeline Name</Field.Label>
                                <Input
                                    value={pipelineName}
                                    onChange={(e) => setPipelineName(e.target.value)}
                                    placeholder="Enter pipeline name"
                                />
                            </Field.Root>

                            <Separator />

                            <Box>
                                <HStack mb={4}>
                                    <Heading size="md" color="var(--color-text)">Pipeline Structure</Heading>
                                </HStack>

                                <Box
                                    border="1px"
                                    borderColor="var(--color-border)"
                                    borderRadius="lg"
                                    p={6}
                                    bg="var(--color-bg-page)"
                                    boxShadow="sm"
                                >
                                    <JobNode
                                        node={rootNode}
                                        onUpdate={setRootNode}
                                        onDelete={() => { }} // Root can't be deleted
                                        profiles={profiles}
                                        templates={templates}
                                        canDelete={false}
                                    />
                                </Box>
                            </Box>
                        </VStack>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button
                            variant="ghost"
                            mr={3}
                            onClick={onClose}
                            color="var(--color-text)"
                            _hover={{ bg: 'var(--color-bg-hover)' }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSavePipeline}
                            disabled={!pipelineName}
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            fontWeight="medium"
                        >
                            Save Pipeline
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    );
};

// PipelinesHeader Component
const PipelinesHeader: React.FC<{
    onCreateOpen: () => void;
}> = ({ onCreateOpen }) => {
    return (
        <>
            <Flex align="center" flexWrap="wrap" gap={4}>
                <Heading size="lg" color="var(--color-text)">Pipeline Management</Heading>
                <Spacer />
                <Button
                    onClick={onCreateOpen}
                    bg="var(--color-primary)"
                    color="var(--color-primary-text)"
                    _hover={{ bg: 'var(--color-primary-hover)' }}
                    fontWeight="medium"
                    borderRadius="md"
                >
                    <HStack gap={2} as="span">
                        <LuPlus />
                        <Text>New Pipeline</Text>
                    </HStack>
                </Button>
            </Flex>

            <Text color="var(--color-text-muted)">
                Manage and run SLURM job pipelines with dependencies and scheduling.
            </Text>
        </>
    );
};

// PipelineTemplatesTable Component
const PipelineTemplatesTable: React.FC<{
    pipelineTemplateFiles: string[];
    onLoadTemplate: (fileName: string) => Promise<any>;
    onTemplateLoaded: (templateData: any) => void;
    isLoading: boolean;
}> = ({ pipelineTemplateFiles, onLoadTemplate, onTemplateLoaded, isLoading }) => {
    if (pipelineTemplateFiles.length === 0) {
        return (
            <Alert.Root status="info">
                <Alert.Indicator />
                <Alert.Content>
                    <Alert.Description>
                        No pipeline templates saved yet. Create a pipeline and save it as a template to get started.
                    </Alert.Description>
                </Alert.Content>
            </Alert.Root>
        );
    }

    return (
        <VStack align="stretch" gap={3}>
            <Table.Root>
                <Table.Header bg="var(--color-bg-header)">
                    <Table.Row>
                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)" fontWeight="semibold" pl={4}>Template Name</Table.ColumnHeader>
                        <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)" fontWeight="semibold" pr={4}>Actions</Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {pipelineTemplateFiles.map((fileName) => (
                        <Table.Row
                            key={fileName}
                            _hover={{ bg: 'var(--color-bg-hover)' }}
                            borderColor="var(--color-border)"
                            transition="background-color 0.2s"
                        >
                            <Table.Cell fontWeight="medium" color="var(--color-text)" borderColor="var(--color-border)" py={3} pl={4}>
                                {fileName}
                            </Table.Cell>
                            <Table.Cell borderColor="var(--color-border)" py={3} pr={4}>
                                <HStack gap={2}>
                                    <Tooltip content="Load template to create new pipeline">
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                onLoadTemplate(fileName).then((templateData) => {
                                                    onTemplateLoaded(templateData);
                                                });
                                            }}
                                            loading={isLoading}
                                            bg="var(--color-primary)"
                                            color="var(--color-primary-text)"
                                            _hover={{ bg: 'var(--color-primary-hover)' }}
                                            fontWeight="medium"
                                        >
                                            Open
                                        </Button>
                                    </Tooltip>
                                </HStack>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>
        </VStack>
    );
};

// PipelineStructureModal Component
const PipelineStructureModal: React.FC<{
    pipeline: Pipeline | null;
    onClose: () => void;
}> = ({ pipeline, onClose }) => {
    return (
        <Dialog.Root open={!!pipeline} onOpenChange={(details) => { if (!details.open) onClose(); }} size="xl">
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="xl">
                    <Dialog.Header>
                        <Dialog.Title>Pipeline Structure: {pipeline?.name}</Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body>
                        {pipeline && (
                            <Box border="1px" borderColor="var(--color-border)" borderRadius="md" p={4} bg="var(--color-bg-card)">
                                <PipelineNodeDisplay node={pipeline.definition} />
                            </Box>
                        )}
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button
                            onClick={onClose}
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            fontWeight="medium"
                        >
                            Close
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    );
};

// PipelineRunDetailsModal Component
const PipelineRunDetailsModal: React.FC<{
    run: PipelineRun | null;
    onClose: () => void;
}> = ({ run, onClose }) => {
    return (
        <Dialog.Root open={!!run} onOpenChange={(details) => { if (!details.open) onClose(); }} size="xl">
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="xl">
                    <Dialog.Header>
                        <Dialog.Title>Pipeline Run Details: {run?.id}</Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body>
                        {run && (
                            <VStack align="start" gap={4}>
                                <HStack>
                                    <Text fontWeight="bold" color="var(--color-text)">Status:</Text>
                                    <Badge colorScheme={getStatusColor(run.status)}>
                                        {run.status}
                                    </Badge>
                                </HStack>
                                <HStack>
                                    <Text fontWeight="bold" color="var(--color-text)">Pipeline:</Text>
                                    <Text color="var(--color-text)">{run.pipeline.name}</Text>
                                </HStack>
                                <HStack>
                                    <Text fontWeight="bold" color="var(--color-text)">Created:</Text>
                                    <Text color="var(--color-text)">{new Date(run.created_at).toLocaleString()}</Text>
                                </HStack>
                                {run.jobs.length > 0 && (
                                    <Box width="100%">
                                        <Text fontWeight="bold" mb={2} color="var(--color-text)">Jobs:</Text>
                                        <Table.Root size="sm" variant="line">
                                            <Table.Header bg="var(--color-bg-header)">
                                                <Table.Row>
                                                    <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Job ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Slurm ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader color="var(--color-text)" borderColor="var(--color-border)">Status</Table.ColumnHeader>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {run.jobs.map((job) => (
                                                    <Table.Row
                                                        key={job.job_id}
                                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                                        borderColor="var(--color-border)"
                                                    >
                                                        <Table.Cell fontFamily="mono" fontSize="sm" color="var(--color-text)" borderColor="var(--color-border)">{job.job_id}</Table.Cell>
                                                        <Table.Cell fontFamily="mono" fontSize="sm" color="var(--color-text)" borderColor="var(--color-border)">
                                                            {job.slurm_jobid || '-'}
                                                        </Table.Cell>
                                                        <Table.Cell borderColor="var(--color-border)">
                                                            <Badge colorScheme={getStatusColor(job.status)} size="sm">
                                                                {job.status}
                                                            </Badge>
                                                        </Table.Cell>
                                                    </Table.Row>
                                                ))}
                                            </Table.Body>
                                        </Table.Root>
                                    </Box>
                                )}
                            </VStack>
                        )}
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button
                            onClick={onClose}
                            bg="var(--color-primary)"
                            color="var(--color-primary-text)"
                            _hover={{ bg: 'var(--color-primary-hover)' }}
                            fontWeight="medium"
                        >
                            Close
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    );
};

export const PipelinesView: React.FC = () => {
    usePageTitle('Pipelines');
    const queryClient = useQueryClient();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const onCreateOpen = () => setIsCreateOpen(true);
    const onCreateClose = () => setIsCreateOpen(false);
    const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
    const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
    const [loadedTemplateData, setLoadedTemplateData] = useState<any>(null);

    // Queries
    const { data: profiles = [] } = useQuery({
        queryKey: ['slurm-profiles'],
        queryFn: getSlurmProfiles
    });

    const { data: templates = [] } = useQuery({
        queryKey: ['slurm-templates'],
        queryFn: getSlurmTemplates
    });

    const { data: pipelineTemplateFiles = [] } = useQuery({
        queryKey: ['pipeline-template-files'],
        queryFn: getPipelineTemplatesList
    });

    // Mutations
    const savePipelineTemplateMutation = useMutation({
        mutationFn: savePipelineToFile,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['pipeline-template-files'] });
            toaster.create({
                title: 'Pipeline template saved',
                type: 'success',
                duration: 3000
            });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Failed to save pipeline template',
                description: error.message,
                type: 'error',
                duration: 5000
            });
        }
    });

    const loadPipelineTemplateMutation = useMutation({
        mutationFn: loadPipelineFromFile,
        onSuccess: () => {
            toaster.create({
                title: 'Pipeline template loaded',
                type: 'success',
                duration: 3000
            });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Failed to load pipeline template',
                description: error.message,
                type: 'error',
                duration: 5000
            });
        }
    });

    return (
        <Box p={6} bg="var(--color-bg-page)" minH="100vh">
            <VStack gap={6} align="stretch">
                <PipelinesHeader onCreateOpen={onCreateOpen} />

                <Tabs.Root defaultValue="templates">
                    <Tabs.List>
                        <Tabs.Trigger value="templates">Templates</Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="templates" p={0} pt={4}>
                        <Card.Root
                            bg="var(--color-bg-card)"
                            borderColor="var(--color-border)"
                            borderRadius="lg"
                            boxShadow="sm"
                        >
                            <Card.Header borderBottom="1px" borderColor="var(--color-border)">
                                <Heading size="md" color="var(--color-text)">Pipeline Templates</Heading>
                            </Card.Header>
                            <Card.Body pt={4}>
                                <PipelineTemplatesTable
                                    pipelineTemplateFiles={pipelineTemplateFiles}
                                    onLoadTemplate={(fileName) => loadPipelineTemplateMutation.mutateAsync(fileName)}
                                    onTemplateLoaded={(templateData) => {
                                        setLoadedTemplateData(templateData);
                                        onCreateOpen();
                                    }}
                                    isLoading={loadPipelineTemplateMutation.isPending}
                                />
                            </Card.Body>
                        </Card.Root>
                    </Tabs.Content>
                </Tabs.Root>
            </VStack>

            <PipelineBuilder
                isOpen={isCreateOpen}
                onClose={() => {
                    setLoadedTemplateData(null);
                    onCreateClose();
                }}
                profiles={profiles}
                templates={templates}
                loadedTemplateData={loadedTemplateData}
                onSaveTemplate={(data) => savePipelineTemplateMutation.mutate(data)}
            />

            <PipelineStructureModal
                pipeline={selectedPipeline}
                onClose={() => setSelectedPipeline(null)}
            />

            <PipelineRunDetailsModal
                run={selectedRun}
                onClose={() => setSelectedRun(null)}
            />
        </Box>
    );
};