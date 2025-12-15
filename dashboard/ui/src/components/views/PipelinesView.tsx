import React, { useState } from 'react';
import { useColorModeValue } from '../ui/color-mode';
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
    Textarea,
    Select,
    IconButton,
    Tooltip,
    Alert,
    Tabs,
    Card,
    Field,
    Flex,
    Spacer,
    Code,
    Separator
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
    PipelineTemplate,
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

    const getNodeColor = (nodeType: string) => {
        switch (nodeType) {
            case 'job': return 'orange';
            case 'sequential': return 'green';
            case 'parallel': return 'blue';
            default: return 'gray';
        }
    };



    const renderNodeHeader = () => {
        return (
            <HStack gap={3} justify="space-between">
                <HStack gap={3} flex={1}>
                    <Select
                        size="sm"
                        value={node.type}
                        onChange={(e) => handleTypeChange(e.target.value as any)}
                        w="120px"
                        bg={`${getNodeColor(node.type)}.50`}
                        borderColor={`${getNodeColor(node.type)}.200`}
                        fontWeight="semibold"
                    >
                        <option value="job">Job</option>
                        <option value="sequential">Sequential</option>
                        <option value="parallel">Parallel</option>
                    </Select>

                    {node.type === 'job' ? (
                        <>
                            <label>Script</label>
                            <Select
                                size="sm"
                                value={node.script || ''}
                                onChange={(e) => handleFieldChange('script', e.target.value)}
                                placeholder="Select template"
                                flex={1}
                            >
                                <option value="">Select template</option>
                                {templates.map((template) => (
                                    <option key={template} value={template}>
                                        {template}
                                    </option>
                                ))}
                            </Select>
                            <label>Resources</label>
                            <Select
                                size="sm"
                                value={node.profile || ''}
                                onChange={(e) => handleFieldChange('profile', e.target.value)}
                                w="300px"
                            >
                                <option value="">Select profile</option>
                                {profiles.map((profile) => (
                                    <option key={profile.name} value={profile.name}>
                                        {profile.name}
                                    </option>
                                ))}
                            </Select>
                        </>
                    ) : (
                        <Input
                            size="sm"
                            value={node.name || ''}
                            onChange={(e) => handleFieldChange('name', e.target.value)}
                            placeholder="Enter name"
                            flex={1}
                        />
                    )}
                </HStack>

                <HStack gap={2}>
                    {node.type !== 'job' && (
                        <Button size="sm" onClick={handleAddChild}>
                            +
                        </Button>
                    )}
                    {canDelete && (
                        <IconButton
                            aria-label="Delete"
                            icon={<LuTrash2 />}
                            size="sm"
                            colorScheme="red"
                            variant="ghost"
                            onClick={onDelete}
                        />
                    )}
                </HStack>
            </HStack>
        );
    };

    const renderChildren = () => {
        // Don't display children for job nodes at all
        if (node.type === 'job' || node.children.length === 0) return null;

        // Show children for sequential and parallel types only
        const ListComponent = node.type === 'sequential' ? 'ol' : 'ul';
        const listStyle = node.type === 'sequential' ? 'decimal' : 'disc';

        return (
            <Box
                as={ListComponent}
                pl={6}
                style={{ listStyleType: listStyle }}
            >
                {node.children.map((child, index) => (
                    <Box as="li" key={index} mb={2}>
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
            </Box>
        );
    };

    if (node.type === 'job') {
        return (
            <Box ml={depth * 1} bg="white">
                <Box p={0}>
                    {renderNodeHeader()}
                </Box>
                {renderChildren()}
            </Box>
        );
    }


    return (
        <Box ml={depth * 1} border="1px" borderColor="gray.200" borderRadius="md" mb={2} bg="white">
            <Box p={3}>
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
                <Box ml={indent} p={2} border="1px" borderColor="gray.200" borderRadius="md" mb={2}>
                    <HStack>
                        <Badge colorScheme="orange">Job</Badge>
                        <Text fontWeight="bold">{job.script}</Text>
                        <Badge variant="outline">{job.profile}</Badge>
                    </HStack>
                </Box>
            );
        }

        if (node.type === 'sequential') {
            const seq = node as PipelineSequential;
            return (
                <Box ml={indent}>
                    <HStack mb={2}>
                        <Badge colorScheme="green">Sequential</Badge>
                        <Text fontWeight="bold">{seq.name}</Text>
                    </HStack>
                    <Box as="ol" pl={6} style={{ listStyleType: 'decimal' }}>
                        {seq.jobs.map((job, index) => (
                            <Box as="li" key={index} mb={2}>
                                <PipelineNodeDisplay node={job} depth={depth + 1} />
                            </Box>
                        ))}
                    </Box>
                </Box>
            );
        }

        if (node.type === 'parallel') {
            const par = node as PipelineParallel;
            return (
                <Box ml={indent}>
                    <HStack mb={2}>
                        <Badge colorScheme="blue">Parallel</Badge>
                        <Text fontWeight="bold">{par.name}</Text>
                    </HStack>
                    <Box as="ul" pl={6} style={{ listStyleType: 'disc' }}>
                        {par.jobs.map((job, index) => (
                            <Box as="li" key={index} mb={2}>
                                <PipelineNodeDisplay node={job} depth={depth + 1} />
                            </Box>
                        ))}
                    </Box>
                </Box>
            );
        }

        return null;
    };

    return renderNode();
};

const PipelineBuilder: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    profiles: SlurmProfile[];
    templates: string[];
    pipelineTemplateFiles: string[];
    loadedTemplateData?: any;
    onSaveTemplate: (data: any) => void;
    onLoadTemplate: (fileName: string) => Promise<any>;
}> = ({ isOpen, onClose, profiles, templates, pipelineTemplateFiles, loadedTemplateData, onSaveTemplate, onLoadTemplate }) => {
    const [pipelineName, setPipelineName] = useState('');
    const [rootNode, setRootNode] = useState<JobNodeData>({
        type: 'sequential',
        name: 'Main Sequence',
        children: []
    });
    const [templateName, setTemplateName] = useState('');
    const [showTemplateSave, setShowTemplateSave] = useState(false);
    const [showTemplateLoad, setShowTemplateLoad] = useState(false);

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

        const pipeline: Pipeline = {
            type: 'pipeline',
            name: pipelineName,
            definition: convertNode(rootNode)
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

    const handleSaveTemplate = () => {
        if (!templateName) return;

        const templateData = {
            name: templateName,
            pipelineName: pipelineName || 'Untitled Pipeline',
            rootNode: rootNode
        };

        onSaveTemplate(templateData);
        setTemplateName('');
        setShowTemplateSave(false);
    };

    const handleLoadTemplate = async (fileName: string) => {
        try {
            const templateData = await onLoadTemplate(fileName);
            if (templateData) {
                setPipelineName(templateData.pipelineName || '');
                setRootNode(templateData.rootNode || {
                    type: 'sequential',
                    name: 'Main Sequence',
                    children: []
                });
                setShowTemplateLoad(false);
            }
        } catch (error) {
            console.error('Failed to load template:', error);
        }
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
                                    <Heading size="md">Pipeline Structure</Heading>
                                </HStack>

                                <Box border="1px" borderColor="gray.200" borderRadius="md" p={4} bg="gray.50">
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
                        <Button variant="ghost" mr={3} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            colorScheme="blue"
                            onClick={handleSavePipeline}
                            disabled={!pipelineName}
                        >
                            Save
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
        <Box p={6}>
            <VStack gap={6} align="stretch">
                <Flex align="center">
                    <Heading size="lg">Pipeline Management</Heading>
                    <Spacer />
                    <Button colorScheme="blue" onClick={onCreateOpen}>
                        <LuPlus /> New Pipeline
                    </Button>
                </Flex>

                <Text color="gray.600">
                    Manage and run SLURM job pipelines with dependencies and scheduling.
                </Text>

                <Tabs.Root defaultValue="templates">
                    <Tabs.List>
                        <Tabs.Trigger value="templates">Templates</Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="templates" p={0} pt={4}>
                        <Card.Root>
                            <Card.Header>
                                <Heading size="md">Pipeline Templates</Heading>
                            </Card.Header>
                            <Card.Body>
                                {pipelineTemplateFiles.length === 0 ? (
                                    <Alert.Root status="info">
                                        <Alert.Indicator />
                                        <Alert.Content>
                                            <Alert.Description>
                                                No pipeline templates saved yet. Create a pipeline and save it as a template to get started.
                                            </Alert.Description>
                                        </Alert.Content>
                                    </Alert.Root>
                                ) : (
                                    <VStack align="stretch" gap={3}>
                                        <Table.Root variant="simple">
                                            <Table.Header>
                                                <Table.Row>
                                                    <Table.ColumnHeader>Template Name</Table.ColumnHeader>
                                                    <Table.ColumnHeader>Actions</Table.ColumnHeader>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {pipelineTemplateFiles.map((fileName) => (
                                                    <Table.Row key={fileName}>
                                                        <Table.Cell fontWeight="bold">{fileName}</Table.Cell>
                                                        <Table.Cell>
                                                            <HStack gap={2}>
                                                                <Tooltip label="Load template to create new pipeline">
                                                                    <Button
                                                                        size="sm"
                                                                        colorScheme="blue"
                                                                        onClick={() => {
                                                                            loadPipelineTemplateMutation.mutateAsync(fileName).then((templateData) => {
                                                                                setLoadedTemplateData(templateData);
                                                                                onCreateOpen(); // Open the create modal
                                                                            });
                                                                        }}
                                                                        loading={loadPipelineTemplateMutation.isPending}
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
                                )}
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
                pipelineTemplateFiles={pipelineTemplateFiles}
                loadedTemplateData={loadedTemplateData}
                onSaveTemplate={(data) => savePipelineTemplateMutation.mutate(data)}
                onLoadTemplate={(fileName) => loadPipelineTemplateMutation.mutateAsync(fileName)}
            />

            {/* Pipeline Structure Modal */}
            <Dialog.Root open={!!selectedPipeline} onOpenChange={(details) => { if (!details.open) setSelectedPipeline(null); }} size="xl">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="xl">
                        <Dialog.Header>
                            <Dialog.Title>Pipeline Structure: {selectedPipeline?.name}</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            {selectedPipeline && (
                                <Box border="1px" borderColor="gray.200" borderRadius="md" p={4}>
                                    <PipelineNodeDisplay node={selectedPipeline.definition} />
                                </Box>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button onClick={() => setSelectedPipeline(null)}>Close</Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* Pipeline Run Details Modal */}
            <Dialog.Root open={!!selectedRun} onOpenChange={(details) => { if (!details.open) setSelectedRun(null); }} size="xl">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="xl">
                        <Dialog.Header>
                            <Dialog.Title>Pipeline Run Details: {selectedRun?.id}</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            {selectedRun && (
                                <VStack align="start" gap={4}>
                                    <HStack>
                                        <Text fontWeight="bold">Status:</Text>
                                        <Badge colorScheme={getStatusColor(selectedRun.status)}>
                                            {selectedRun.status}
                                        </Badge>
                                    </HStack>
                                    <HStack>
                                        <Text fontWeight="bold">Pipeline:</Text>
                                        <Text>{selectedRun.pipeline.name}</Text>
                                    </HStack>
                                    <HStack>
                                        <Text fontWeight="bold">Created:</Text>
                                        <Text>{new Date(selectedRun.created_at).toLocaleString()}</Text>
                                    </HStack>
                                    {selectedRun.jobs.length > 0 && (
                                        <Box width="100%">
                                            <Text fontWeight="bold" mb={2}>Jobs:</Text>
                                            <Table.Root size="sm" variant="simple">
                                                <Table.Header>
                                                    <Table.Row>
                                                        <Table.ColumnHeader>Job ID</Table.ColumnHeader>
                                                        <Table.ColumnHeader>Slurm ID</Table.ColumnHeader>
                                                        <Table.ColumnHeader>Status</Table.ColumnHeader>
                                                    </Table.Row>
                                                </Table.Header>
                                                <Table.Body>
                                                    {selectedRun.jobs.map((job) => (
                                                        <Table.Row key={job.job_id}>
                                                            <Table.Cell fontFamily="mono" fontSize="sm">{job.job_id}</Table.Cell>
                                                            <Table.Cell fontFamily="mono" fontSize="sm">
                                                                {job.slurm_jobid || '-'}
                                                            </Table.Cell>
                                                            <Table.Cell>
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
                            <Button onClick={() => setSelectedRun(null)}>Close</Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </Box>
    );
};