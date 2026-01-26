import React, { useState, useMemo } from 'react';
import { useColorModeValue } from '../ui/color-mode';
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
    Textarea,
    Select,
    IconButton,
    Alert,
    Tabs,
    Card,
    Field,
    Flex,
    Spacer,
    Code,
    Separator,
    useToken,
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
    // Theme-aware colors
    const nodeBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const [orange50, orange200] = useToken('colors', ['orange.50', 'orange.200']);
    const [green50, green200] = useToken('colors', ['green.50', 'green.200']);
    const [blue50, blue200] = useToken('colors', ['blue.50', 'blue.200']);

    // Pre-compute theme-aware node colors
    const jobBg = useColorModeValue(orange50, 'gray.800');
    const sequentialBg = useColorModeValue(green50, 'gray.800');
    const parallelBg = useColorModeValue(blue50, 'gray.800');
    const jobBorder = useColorModeValue(orange200, 'gray.600');
    const sequentialBorder = useColorModeValue(green200, 'gray.600');
    const parallelBorder = useColorModeValue(blue200, 'gray.600');

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

    const getNodeBgColor = (nodeType: string) => {
        switch (nodeType) {
            case 'job': return jobBg;
            case 'sequential': return sequentialBg;
            case 'parallel': return parallelBg;
            default: return nodeBg;
        }
    };

    const getNodeBorderColor = (nodeType: string) => {
        switch (nodeType) {
            case 'job': return jobBorder;
            case 'sequential': return sequentialBorder;
            case 'parallel': return parallelBorder;
            default: return borderColor;
        }
    };



    const inputBg = useColorModeValue('white', 'gray.700');
    const inputBorderColor = useColorModeValue('gray.300', 'gray.600');
    const inputFocusBorderColor = useColorModeValue('blue.500', 'blue.400');
    const labelColor = useColorModeValue('gray.700', 'gray.300');
    const buttonBg = useColorModeValue('blue.500', 'blue.600');
    const buttonHoverBg = useColorModeValue('blue.600', 'blue.500');

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
                            <Text fontSize="xs" fontWeight="medium" color={labelColor} visibility="hidden">Type</Text>
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
                                        <Select.ValueText fontWeight="semibold" color={textColor} />
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
                                    <Text fontSize="xs" fontWeight="medium" color={labelColor}>Script</Text>
                                    <Select.Root
                                        size="sm"
                                        collection={templatesCollection.collection}
                                        value={node.script ? [node.script] : []}
                                        onValueChange={(details) => handleFieldChange('script', details.value[0] || '')}
                                        flex={1}
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control
                                            bg={inputBg}
                                            borderColor={inputBorderColor}
                                            borderRadius="md"
                                            _focus={{ borderColor: inputFocusBorderColor }}
                                            h="32px"
                                        >
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select template" color={textColor} />
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
                                    <Text fontSize="xs" fontWeight="medium" color={labelColor}>Resources</Text>
                                    <Select.Root
                                        size="sm"
                                        collection={profilesCollection.collection}
                                        value={node.profile ? [node.profile] : []}
                                        onValueChange={(details) => handleFieldChange('profile', details.value[0] || '')}
                                        w="100%"
                                    >
                                        <Select.HiddenSelect />
                                        <Select.Control
                                            bg={inputBg}
                                            borderColor={inputBorderColor}
                                            borderRadius="md"
                                            _focus={{ borderColor: inputFocusBorderColor }}
                                            h="32px"
                                        >
                                            <Select.Trigger>
                                                <Select.ValueText placeholder="Select profile" color={textColor} />
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
                                <Text fontSize="xs" fontWeight="medium" color={labelColor}>Name</Text>
                                <Input
                                    pl="10px"
                                    size="sm"
                                    value={node.name || ''}
                                    onChange={(e) => handleFieldChange('name', e.target.value)}
                                    placeholder="Enter name"
                                    w="100%"
                                    bg={inputBg}
                                    borderColor={inputBorderColor}
                                    color={textColor}
                                    _focus={{ borderColor: inputFocusBorderColor }}
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
                                bg={buttonBg}
                                color="white"
                                _hover={{ bg: buttonHoverBg }}
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
            <Box ml={depth * 2} bg={nodeBg} padding="2px" borderRadius="md" border="1px" borderColor={borderColor} mb={1}>
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
            borderColor={borderColor}
            borderRadius="lg"
            mb={1}
            bg={nodeBg}
            boxShadow={useColorModeValue('sm', 'dark-lg')}
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

    // Theme-aware colors
    const nodeBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');

    const renderNode = () => {
        if (node.type === 'job') {
            const job = node as PipelineJob;
            return (
                    <HStack>
                        <Badge colorScheme="orange">Job</Badge>
                        <Text fontWeight="bold" color={textColor}>{job.script}</Text>
                        <Badge variant="outline">{job.profile}</Badge>
                    </HStack>
            );
        }

        if (node.type === 'sequential') {
            const seq = node as PipelineSequential;
            return (<>
                    <HStack>
                        <Badge colorScheme="green">Sequential</Badge>
                        <Text fontWeight="bold" color={textColor}>{seq.name}</Text>
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
                        <Text fontWeight="bold" color={textColor}>{par.name}</Text>
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

    // Theme-aware colors for PipelineBuilder
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const structureBg = useColorModeValue('gray.50', 'gray.900');
    const textColor = useColorModeValue('gray.900', 'gray.100');

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
                                    <Heading size="md" color={textColor}>Pipeline Structure</Heading>
                                </HStack>

                                <Box
                                    border="1px"
                                    borderColor={borderColor}
                                    borderRadius="lg"
                                    p={6}
                                    bg={structureBg}
                                    boxShadow={useColorModeValue('sm', 'dark-lg')}
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
                            color={textColor}
                            _hover={{ bg: useColorModeValue('gray.100', 'gray.700') }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSavePipeline}
                            disabled={!pipelineName}
                            bg={useColorModeValue('blue.500', 'blue.600')}
                            color="white"
                            _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
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
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const mutedTextColor = useColorModeValue('gray.600', 'gray.400');

    return (
        <>
            <Flex align="center" flexWrap="wrap" gap={4}>
                <Heading size="lg" color={textColor}>Pipeline Management</Heading>
                <Spacer />
                <Button
                    onClick={onCreateOpen}
                    leftIcon={<LuPlus />}
                    bg={useColorModeValue('blue.500', 'blue.600')}
                    color="white"
                    _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
                    fontWeight="medium"
                    borderRadius="md"
                >
                    New Pipeline
                </Button>
            </Flex>

            <Text color={mutedTextColor}>
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
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.800');
    const headerBg = useColorModeValue('gray.50', 'gray.800');
    const headerTextColor = useColorModeValue('gray.700', 'gray.300');
    const buttonBg = useColorModeValue('blue.500', 'blue.600');
    const buttonHoverBg = useColorModeValue('blue.600', 'blue.500');

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
                <Table.Header bg={headerBg}>
                    <Table.Row>
                        <Table.ColumnHeader color={headerTextColor} borderColor={borderColor} fontWeight="semibold" pl={4}>Template Name</Table.ColumnHeader>
                        <Table.ColumnHeader color={headerTextColor} borderColor={borderColor} fontWeight="semibold" pr={4}>Actions</Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {pipelineTemplateFiles.map((fileName) => (
                        <Table.Row
                            key={fileName}
                            _hover={{ bg: rowHoverBg }}
                            borderColor={borderColor}
                            transition="background-color 0.2s"
                        >
                            <Table.Cell fontWeight="medium" color={textColor} borderColor={borderColor} py={3} pl={4}>
                                {fileName}
                            </Table.Cell>
                            <Table.Cell borderColor={borderColor} py={3} pr={4}>
                                <HStack gap={2}>
                                    <Tooltip label="Load template to create new pipeline">
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                onLoadTemplate(fileName).then((templateData) => {
                                                    onTemplateLoaded(templateData);
                                                });
                                            }}
                                            loading={isLoading}
                                            bg={buttonBg}
                                            color="white"
                                            _hover={{ bg: buttonHoverBg }}
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
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const cardBg = useColorModeValue('white', 'gray.800');

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
                            <Box border="1px" borderColor={borderColor} borderRadius="md" p={4} bg={cardBg}>
                                <PipelineNodeDisplay node={pipeline.definition} />
                            </Box>
                        )}
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button
                            onClick={onClose}
                            bg={useColorModeValue('blue.500', 'blue.600')}
                            color="white"
                            _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
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
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');
    const rowHoverBg = useColorModeValue('gray.50', 'gray.800');
    const headerBg = useColorModeValue('gray.50', 'gray.800');
    const headerTextColor = useColorModeValue('gray.700', 'gray.300');

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
                                    <Text fontWeight="bold" color={textColor}>Status:</Text>
                                    <Badge colorScheme={getStatusColor(run.status)}>
                                        {run.status}
                                    </Badge>
                                </HStack>
                                <HStack>
                                    <Text fontWeight="bold" color={textColor}>Pipeline:</Text>
                                    <Text color={textColor}>{run.pipeline.name}</Text>
                                </HStack>
                                <HStack>
                                    <Text fontWeight="bold" color={textColor}>Created:</Text>
                                    <Text color={textColor}>{new Date(run.created_at).toLocaleString()}</Text>
                                </HStack>
                                {run.jobs.length > 0 && (
                                    <Box width="100%">
                                        <Text fontWeight="bold" mb={2} color={textColor}>Jobs:</Text>
                                        <Table.Root size="sm" variant="simple">
                                            <Table.Header bg={headerBg}>
                                                <Table.Row>
                                                    <Table.ColumnHeader color={headerTextColor} borderColor={borderColor}>Job ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader color={headerTextColor} borderColor={borderColor}>Slurm ID</Table.ColumnHeader>
                                                    <Table.ColumnHeader color={headerTextColor} borderColor={borderColor}>Status</Table.ColumnHeader>
                                                </Table.Row>
                                            </Table.Header>
                                            <Table.Body>
                                                {run.jobs.map((job) => (
                                                    <Table.Row
                                                        key={job.job_id}
                                                        _hover={{ bg: rowHoverBg }}
                                                        borderColor={borderColor}
                                                    >
                                                        <Table.Cell fontFamily="mono" fontSize="sm" color={textColor} borderColor={borderColor}>{job.job_id}</Table.Cell>
                                                        <Table.Cell fontFamily="mono" fontSize="sm" color={textColor} borderColor={borderColor}>
                                                            {job.slurm_jobid || '-'}
                                                        </Table.Cell>
                                                        <Table.Cell borderColor={borderColor}>
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
                            bg={useColorModeValue('blue.500', 'blue.600')}
                            color="white"
                            _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
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

    // Theme-aware colors
    const pageBg = useColorModeValue('gray.50', 'gray.900');
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const textColor = useColorModeValue('gray.900', 'gray.100');

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
        <Box p={6} bg={pageBg} minH="100vh">
            <VStack gap={6} align="stretch">
                <PipelinesHeader onCreateOpen={onCreateOpen} />

                <Tabs.Root defaultValue="templates">
                    <Tabs.List>
                        <Tabs.Trigger value="templates">Templates</Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="templates" p={0} pt={4}>
                        <Card.Root
                            bg={cardBg}
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={useColorModeValue('sm', 'dark-lg')}
                        >
                            <Card.Header borderBottom="1px" borderColor={borderColor}>
                                <Heading size="md" color={textColor}>Pipeline Templates</Heading>
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
                pipelineTemplateFiles={pipelineTemplateFiles}
                loadedTemplateData={loadedTemplateData}
                onSaveTemplate={(data) => savePipelineTemplateMutation.mutate(data)}
                onLoadTemplate={(fileName) => loadPipelineTemplateMutation.mutateAsync(fileName)}
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