import React, { useRef, useMemo, Suspense, useState } from 'react';
import {
    Grid,
    VStack,
    HStack,
    Field,
    Input,
    NumberInput,
    Text,
    Button,
    Checkbox,
    Box,
    NativeSelect,
    Heading,
    Card,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { useColorModeValue } from '../ui/color-mode';
import { MonacoEditor } from '../shared/MonacoEditor';
import AutocompleteInput from '../shared/AutocompleteInput';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    submitSlurmJob,
    getSlurmTemplateContent,
    saveSlurmProfile,
    saveSlurmTemplate
} from '../../services/api';
import type { SlurmProfile, SlurmJob } from '../../services/types';

// Utility function to parse export variables from script content
// if only_constant=true then ignores exported variables that are derived
const parseExportVariables = (script: string, only_constant: boolean = true): Record<string, string> => {

    const exportRegex = only_constant ?
        /export\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^$\n\r]*)\n/gi :
        /export\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^\n\r]*)\n/gi;

    const variables: Record<string, string> = {};
    let match;

    while ((match = exportRegex.exec(script)) !== null) {
        const [, varName, varValue] = match;
        // Clean up the value by removing outer quotes but preserve intentional spaces
        let cleanValue = varValue;

        // Check if the value is wrapped in quotes and remove them, preserving content inside
        if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
            cleanValue = cleanValue.slice(1, -1);
        } else {
            // Only trim if not quoted to avoid removing intentional spaces
            cleanValue = cleanValue.trim();
        }

        variables[varName] = cleanValue;
    }

    return variables;
};

// Utility function to update script with new export variable values
const updateScriptWithExportVars = (script: string, scriptArgs: Record<string, string>): string => {
    let updatedScript = script;

    Object.entries(scriptArgs).forEach(([varName, varValue]) => {
        const exportRegex = new RegExp(`(export\\s+${varName}\\s*=\\s*)([^\\n\\r]*)`, 'gi');

        // Quote the value if it contains spaces or special characters, or if it's empty
        let quotedValue = varValue;
        if (varValue === '' || /\s/.test(varValue) || /[|&;<>(){}[\]$`"']/.test(varValue)) {
            quotedValue = `"${varValue.replace(/"/g, '\\"')}"`;
        }

        const replacement = `$1${quotedValue}`;
        updatedScript = updatedScript.replace(exportRegex, replacement);
    });

    return updatedScript;
};

interface JobSubmissionFormProps {
    templates?: string[];
    profiles: SlurmProfile[];
    activeJobs?: SlurmJob[];
    onClose?: () => void;
}

export const JobSubmissionForm: React.FC<JobSubmissionFormProps> = ({
    templates = [],
    profiles = [],
    activeJobs = [],
    onClose
}) => {
    const queryClient = useQueryClient();

    // Theme-friendly colors (matching Dashboard)
    const cardBg = useColorModeValue('white', 'gray.800');
    const borderColor = useColorModeValue('gray.200', 'gray.700');
    const headerBg = useColorModeValue('gray.50', 'gray.750');
    const textColor = useColorModeValue('gray.700', 'gray.300');
    const mutedTextColor = useColorModeValue('gray.500', 'gray.400');
    const shadow = useColorModeValue('sm', 'dark-lg');

    // No form state needed - we'll build the data on-demand from refs

    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');

    // Controlled state for NumberInput components
    const [nodes, setNodes] = useState<string>('');
    const [ntasks, setNtasks] = useState<string>('');
    const [cpusPerTask, setCpusPerTask] = useState<string>('');
    const [ntasksPerNode, setNtasksPerNode] = useState<string>('');

    // Mutations
    const submitJobMutation = useMutation({
        mutationFn: submitSlurmJob,
        onSuccess: (data) => {
            toaster.create({
                title: 'Job Submitted',
                description: `Job ${data.job_id} submitted successfully`,
                type: 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
            if (onClose) onClose();
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Submission Failed',
                description: error.message || 'Failed to submit job',
                type: 'error',
                duration: 5000,
            });
        },
    });

    const loadTemplateMutation = useMutation({
        mutationFn: getSlurmTemplateContent,
        onSuccess: (content) => {
            // Update the Monaco editor directly
            if (editorRef.current) {
                editorRef.current.setValue(content);
            }
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Template Loading Failed',
                description: error.message || 'Failed to load template content',
                type: 'error',
                duration: 5000,
            });
        },
    });

    const saveProfileMutation = useMutation({
        mutationFn: saveSlurmProfile,
        onSuccess: (data) => {
            toaster.create({
                title: 'Profile Saved',
                description: data.message || 'Profile saved successfully',
                type: 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-profiles'] });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Profile Save Failed',
                description: error.message || 'Failed to save profile',
                type: 'error',
                duration: 5000,
            });
        },
    });

    const saveTemplateMutation = useMutation({
        mutationFn: saveSlurmTemplate,
        onSuccess: (data) => {
            toaster.create({
                title: 'Template Saved',
                description: data.message || 'Template saved successfully',
                type: 'success',
                duration: 5000,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-templates'] });
        },
        onError: (error: any) => {
            toaster.create({
                title: 'Template Save Failed',
                description: error.message || 'Failed to save template',
                type: 'error',
                duration: 5000,
            });
        },
    });

    // Handler functions
    const handleProfileSelect = (profileName: string) => {
        setSelectedProfile(profileName);
        const selectedProfileData = profiles?.find(p => p.name === profileName);
        if (selectedProfileData) {
            // Clear all fields first, then set values from profile
            if (jobNameRef.current) {
                jobNameRef.current.value = selectedProfileData.parsed_args.job_name || '';
            }
            if (partitionRef.current) {
                partitionRef.current.value = selectedProfileData.parsed_args.partition || '';
            }
            setNodes(selectedProfileData.parsed_args.nodes?.toString() || '');
            setNtasks(selectedProfileData.parsed_args.ntasks?.toString() || '');
            setCpusPerTask(selectedProfileData.parsed_args.cpus_per_task?.toString() || '');
            setNtasksPerNode(selectedProfileData.parsed_args.ntasks_per_node?.toString() || '');
            if (memRef.current) {
                memRef.current.value = selectedProfileData.parsed_args.mem || '';
            }
            if (timeLimitRef.current) {
                timeLimitRef.current.value = selectedProfileData.parsed_args.time_limit || '';
            }
            if (gpusPerTaskRef.current) {
                gpusPerTaskRef.current.value = selectedProfileData.parsed_args.gpus_per_task || '';
            }
            if (exclusiveRef.current) {
                exclusiveRef.current.checked = selectedProfileData.parsed_args.exclusive || false;
            }
            if (exportVarsRef.current) {
                exportVarsRef.current.value = selectedProfileData.parsed_args.export || '';
            }
            if (nodelistRef.current) {
                nodelistRef.current.value = selectedProfileData.parsed_args.nodelist || '';
            }
        }
    };

    const handleTemplateSelect = (templateName: string) => {
        setSelectedTemplate(templateName);
        if (templateName && templates?.includes(templateName)) {
            loadTemplateMutation.mutate(templateName);
        }
    };

    const handleSaveProfile = () => {
        const profileName = selectedProfile.trim();
        if (!profileName) {
            toaster.create({
                title: 'Profile Name Required',
                description: 'Please select or enter a profile name to save the current configuration.',
                type: 'warning',
                duration: 5000,
            });
            return;
        }

        const sbatch_args: string[] = [];
        const jobName = jobNameRef.current?.value;
        const partition = partitionRef.current?.value;
        const nodesValue = nodes;
        const ntasksValue = ntasks;
        const cpusPerTaskValue = cpusPerTask;
        const mem = memRef.current?.value;
        const timeLimit = timeLimitRef.current?.value;
        const gpusPerTask = gpusPerTaskRef.current?.value;
        const ntasksPerNodeValue = ntasksPerNode;
        const exclusive = exclusiveRef.current?.checked;
        const exportVars = exportVarsRef.current?.value;
        const nodelist = nodelistRef.current?.value;

        if (jobName) sbatch_args.push(`--job-name=${jobName}`);
        if (partition) sbatch_args.push(`--partition=${partition}`);
        if (nodesValue) sbatch_args.push(`--nodes=${nodesValue}`);
        if (ntasksValue) sbatch_args.push(`--ntasks=${ntasksValue}`);
        if (cpusPerTaskValue) sbatch_args.push(`--cpus-per-task=${cpusPerTaskValue}`);
        if (mem) sbatch_args.push(`--mem=${mem}`);
        if (timeLimit) sbatch_args.push(`--time=${timeLimit}`);
        if (gpusPerTask) sbatch_args.push(`--gpus-per-task=${gpusPerTask}`);
        if (ntasksPerNodeValue) sbatch_args.push(`--ntasks-per-node=${ntasksPerNodeValue}`);
        if (exclusive) sbatch_args.push('--exclusive');
        if (exportVars) sbatch_args.push(`--export=${exportVars}`);
        if (nodelist) sbatch_args.push(`-w ${nodelist}`);

        const filteredArgs = sbatch_args.filter(arg => !arg.startsWith('--dependency'));

        saveProfileMutation.mutate({
            name: profileName,
            description: '',
            sbatch_args: filteredArgs
        });
    };

    const handleSaveTemplate = () => {
        const templateName = selectedTemplate.trim();
        if (!templateName) {
            toaster.create({
                title: 'Template Name Required',
                description: 'Please select or enter a template name to save the current script.',
                type: 'warning',
                duration: 5000,
            });
            return;
        }

        const scriptContent = editorRef.current?.getValue() || '';
        if (!scriptContent.trim()) {
            toaster.create({
                title: 'Script Content Required',
                description: 'Please enter script content before saving as template.',
                type: 'warning',
                duration: 5000,
            });
            return;
        }

        saveTemplateMutation.mutate({
            name: templateName,
            content: scriptContent
        });
    };

    const handleSubmitJob = () => {
        // Build sbatch arguments from form fields
        const sbatch_args: string[] = [];
        const partition = partitionRef.current?.value;
        const nodesValue = nodes;
        const ntasksValue = ntasks;
        const cpusPerTaskValue = cpusPerTask;
        const mem = memRef.current?.value;
        const timeLimit = timeLimitRef.current?.value;
        const gpusPerTask = gpusPerTaskRef.current?.value;
        const ntasksPerNodeValue = ntasksPerNode;
        const exclusive = exclusiveRef.current?.checked;
        const exportVars = exportVarsRef.current?.value;
        const nodelist = nodelistRef.current?.value;
        const dependencyEvent = dependencyEventRef.current?.value;
        const dependencyJobId = dependencyJobRef.current?.value;

        if (partition && partition.trim() !== '') sbatch_args.push(`--partition=${partition}`);
        if (nodesValue && nodesValue.trim() !== '') sbatch_args.push(`--nodes=${nodesValue}`);
        if (ntasksValue && ntasksValue.trim() !== '') sbatch_args.push(`--ntasks=${ntasksValue}`);
        if (cpusPerTaskValue && cpusPerTaskValue.trim() !== '') sbatch_args.push(`--cpus-per-task=${cpusPerTaskValue}`);
        if (mem && mem.trim() !== '') sbatch_args.push(`--mem=${mem}`);
        if (timeLimit && timeLimit.trim() !== '') sbatch_args.push(`--time=${timeLimit}`);
        if (gpusPerTask && gpusPerTask.trim() !== '') sbatch_args.push(`--gpus-per-task=${gpusPerTask}`);
        if (ntasksPerNodeValue && ntasksPerNodeValue.trim() !== '') sbatch_args.push(`--ntasks-per-node=${ntasksPerNodeValue}`);
        if (exclusive) sbatch_args.push('--exclusive');
        if (exportVars && exportVars.trim() !== '') sbatch_args.push(`--export=${exportVars}`);
        if (nodelist && nodelist.trim() !== '') sbatch_args.push(`-w ${nodelist}`);
        if (dependencyEvent && dependencyJobId) {
            sbatch_args.push(`--dependency=${dependencyEvent}:${dependencyJobId}`);
        }

        // Read script args from DOM
        const currentScriptArgs: Record<string, string> = {};
        const scriptArgsContainer = document.getElementById('script-args-container');
        if (scriptArgsContainer) {
            const inputs = scriptArgsContainer.querySelectorAll('input[data-arg-name]');
            inputs.forEach((input) => {
                const argName = input.getAttribute('data-arg-name');
                const value = (input as HTMLInputElement).value;
                if (argName) {
                    currentScriptArgs[argName] = value;
                }
            });
        }

        // Use the unified submit endpoint
        submitJobMutation.mutate({
            script: editorRef.current?.getValue() || '',
            job_name: jobNameRef.current?.value || 'milabench_job',
            sbatch_args: sbatch_args,
            script_args: currentScriptArgs
        });
    };
    // Refs for uncontrolled inputs - much more performant
    const editorRef = useRef<any>(null);
    const jobNameRef = useRef<HTMLInputElement>(null);
    const partitionRef = useRef<HTMLInputElement>(null);

    const memRef = useRef<HTMLInputElement>(null);
    const timeLimitRef = useRef<HTMLInputElement>(null);
    const gpusPerTaskRef = useRef<HTMLInputElement>(null);

    const exclusiveRef = useRef<HTMLInputElement>(null);
    const exportVarsRef = useRef<HTMLInputElement>(null);
    const nodelistRef = useRef<HTMLInputElement>(null);
    const dependencyEventRef = useRef<HTMLSelectElement>(null);
    const dependencyJobRef = useRef<HTMLSelectElement>(null);

    // Minimal state only for displaying script args section (not for values)
    const [scriptArgsDisplay, setScriptArgsDisplay] = React.useState<Record<string, string>>({});

    // No more state for editor content - completely uncontrolled!
    // We'll read script args from DOM and editor content from Monaco editor directly

    // Function to refresh/extract arguments from script
    const refreshScriptArgs = () => {
        // Get current content from the editor (this should have the latest changes)
        const currentScript = editorRef.current?.getValue() || '';

        const newScriptArgs = parseExportVariables(currentScript, true);

        // Is this still necessary
        setScriptArgsDisplay(newScriptArgs);

        // Update the input field values directly
        const scriptArgsContainer = document.getElementById('script-args-container');
        if (scriptArgsContainer) {
            const inputs = scriptArgsContainer.querySelectorAll('input[data-arg-name]');
            inputs.forEach((input) => {
                const argName = input.getAttribute('data-arg-name');
                if (argName && newScriptArgs[argName] !== undefined) {
                    (input as HTMLInputElement).value = newScriptArgs[argName];
                }
            });
        }
    };

    // Function to apply arguments back to script
    const applyScriptArgs = () => {
        // Get current script args from DOM inputs
        const currentScriptArgs: Record<string, string> = {};
        const scriptArgsContainer = document.getElementById('script-args-container');
        if (scriptArgsContainer) {
            const inputs = scriptArgsContainer.querySelectorAll('input[data-arg-name]');
            inputs.forEach((input) => {
                const argName = input.getAttribute('data-arg-name');
                const value = (input as HTMLInputElement).value;
                if (argName) {
                    currentScriptArgs[argName] = value;
                }
            });
        }

        const currentScript = editorRef.current?.getValue() || '';
        const updatedScript = updateScriptWithExportVars(currentScript, currentScriptArgs);

        if (editorRef.current) {
            editorRef.current.setValue(updatedScript);
        }

        // No need to update form state - we don't have any
    };

    // No more handleScriptArgChange - script args are now uncontrolled!

    // Note: We no longer need currentDependency since we're using uncontrolled inputs





    // Filter jobs to only show running and pending jobs for dependencies
    const dependencyJobs = useMemo(() => {
        return activeJobs.filter(job =>
            job.job_state?.[0]?.toLowerCase() === 'running' ||
            job.job_state?.[0]?.toLowerCase() === 'pending'
        );
    }, [activeJobs]);

    return (
        <Box width="100%" height="100%" p={6} bg={useColorModeValue('gray.50', 'gray.900')}>
            <VStack align="stretch" gap={6} height="100%">
                <Heading size="lg" fontWeight="bold" color={textColor} mb={2}>
                    Submit New Job
                </Heading>

                <Grid templateColumns="repeat(2, 1fr)" gap={6} width="100%" flex="1" overflow="hidden">
                    {/* Left Column - Slurm Options */}
                    <VStack align="stretch" gap={4} overflowY="auto" pr={2}>
                        {/* Profile Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            p={4}
                        >
                            <VStack align="stretch" gap={3}>
                                <Heading size="sm" fontWeight="semibold" color={textColor}>
                                    Slurm Profile
                                </Heading>
                                <Field.Root>
                                    <HStack gap={3} align="center">
                                        <Field.Label minW="100px" mb={0} color={textColor}>Profile</Field.Label>
                                        <VStack align="stretch" flex={1} gap={2}>
                                            <HStack gap={2}>
                                                <Box flex={1} minW={0}>
                                                    <AutocompleteInput
                                                        value={selectedProfile}
                                                        onChange={setSelectedProfile}
                                                        onSelect={handleProfileSelect}
                                                        suggestions={profiles.map(p => p.name)}
                                                        placeholder="Select a profile or enter custom name"
                                                        size="md"
                                                        width="100%"
                                                        renderSuggestion={(suggestion) => {
                                                            const profile = profiles.find(p => p.name === suggestion);
                                                            return (
                                                                <VStack align="start" gap={0}>
                                                                    <Text fontWeight="medium" color={textColor}>{suggestion}</Text>
                                                                    {profile?.description && (
                                                                        <Text fontSize="xs" color={mutedTextColor}>
                                                                            {profile.description}
                                                                        </Text>
                                                                    )}
                                                                </VStack>
                                                            );
                                                        }}
                                                    />
                                                </Box>
                                                <Button
                                                    variant="outline"
                                                    onClick={handleSaveProfile}
                                                    loading={saveProfileMutation.isPending}
                                                    size="md"
                                                    fontWeight="medium"
                                                    flexShrink={0}
                                                >
                                                    Save Profile
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </HStack>
                                    <Text fontSize="sm" color={mutedTextColor} mt={1}>
                                        Select an existing profile or enter a new name to create a new profile
                                    </Text>
                                </Field.Root>
                            </VStack>
                        </Card.Root>

                        {/* Slurm Arguments Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            p={4}
                        >
                            <VStack align="stretch" gap={4}>
                                <Heading size="sm" fontWeight="semibold" color={textColor}>
                                    Slurm Arguments
                                </Heading>

                                <Field.Root>
                                    <HStack gap={3} align="center">
                                        <Field.Label minW="120px" mb={0} color={textColor}>Job Name</Field.Label>
                                        <Input
                                            ref={jobNameRef}
                                            defaultValue="milabench_job"
                                            placeholder="milabench_job"
                                            flex={1}
                                        />
                                    </HStack>
                                </Field.Root>

                                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Partition</Field.Label>
                                            <Input
                                                ref={partitionRef}
                                                defaultValue=""
                                                placeholder="Leave empty for default"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Nodes</Field.Label>
                                            <NumberInput.Root
                                                value={nodes}
                                                onValueChange={(details) => setNodes(details.value)}
                                                min={1}
                                                max={100}
                                                flex={1}
                                            >
                                                <NumberInput.Input />
                                            </NumberInput.Root>
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Tasks</Field.Label>
                                            <NumberInput.Root
                                                value={ntasks}
                                                onValueChange={(details) => setNtasks(details.value)}
                                                min={1}
                                                max={100}
                                                flex={1}
                                            >
                                                <NumberInput.Input />
                                            </NumberInput.Root>
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>CPUs per Task</Field.Label>
                                            <NumberInput.Root
                                                value={cpusPerTask}
                                                onValueChange={(details) => setCpusPerTask(details.value)}
                                                min={1}
                                                max={1024}
                                                flex={1}
                                            >
                                                <NumberInput.Input />
                                            </NumberInput.Root>
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>GPUs per Task</Field.Label>
                                            <Input
                                                ref={gpusPerTaskRef}
                                                placeholder="e.g. 1, 2"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Tasks per Node</Field.Label>
                                            <NumberInput.Root
                                                value={ntasksPerNode}
                                                onValueChange={(details) => setNtasksPerNode(details.value)}
                                                min={1}
                                                max={100}
                                                flex={1}
                                            >
                                                <NumberInput.Input />
                                            </NumberInput.Root>
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Memory</Field.Label>
                                            <Input
                                                ref={memRef}
                                                placeholder="e.g. 8G, 16GB"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Time Limit</Field.Label>
                                            <Input
                                                ref={timeLimitRef}
                                                placeholder="e.g. 02:00:00, 1-12:00:00"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Export</Field.Label>
                                            <Input
                                                ref={exportVarsRef}
                                                placeholder="e.g. ALL, NONE, VAR1,VAR2"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>

                                    <Field.Root>
                                        <HStack gap={3} align="center">
                                            <Field.Label minW="120px" mb={0} color={textColor}>Node List</Field.Label>
                                            <Input
                                                ref={nodelistRef}
                                                defaultValue=""
                                                placeholder="e.g., cn-d[003-004]"
                                                flex={1}
                                            />
                                        </HStack>
                                    </Field.Root>
                                </Grid>
                            </VStack>
                        </Card.Root>

                        {/* Exclusive and Dependency Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            p={4}
                        >
                            <VStack align="stretch" gap={4}>
                                <Field.Root>
                                    <HStack gap={3} align="center">
                                        <Field.Label minW="120px" mb={0} color={textColor}>Exclusive</Field.Label>
                                        <Checkbox.Root>
                                            <Checkbox.HiddenInput />
                                            <Checkbox.Control ref={exclusiveRef} defaultChecked={false} />
                                            <Checkbox.Label color={textColor}>Request exclusive access to nodes</Checkbox.Label>
                                        </Checkbox.Root>
                                    </HStack>
                                </Field.Root>

                                <Field.Root>
                                    <HStack gap={3} align="center">
                                        <Field.Label minW="120px" fontWeight="semibold" mb={0} color={textColor}>Dependency</Field.Label>
                                        <NativeSelect.Root flex={1}>
                                            <NativeSelect.Field ref={dependencyEventRef}
                                                defaultValue=""
                                                placeholder="Select event"
                                            >
                                                <option value="after">After</option>
                                                <option value="afterok">After Ok</option>
                                                <option value="afterany">After Any</option>
                                                <option value="afterburstbuffer">After Burst Buffer</option>
                                                <option value="aftercorr">After Corr</option>
                                                <option value="afternotok">After Not Ok</option>
                                                <option value="singleton">Singleton</option>
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                        <NativeSelect.Root flex={1}>
                                            <NativeSelect.Field
                                                ref={dependencyJobRef}
                                                defaultValue=""
                                                placeholder="Select job"
                                            >
                                                {dependencyJobs.map((job) => (
                                                    <option key={job.job_id} value={job.job_id || ''}>
                                                        {job.job_id} - {job.name || job.job_name || 'Unnamed'} ({job.job_state?.[0] || 'Unknown'})
                                                    </option>
                                                ))}
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                    </HStack>
                                </Field.Root>
                            </VStack>
                        </Card.Root>

                        {/* Script Arguments Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            p={4}
                        >
                            <VStack align="stretch" gap={3}>
                                <HStack justify="space-between" align="center">
                                    <Heading size="sm" fontWeight="semibold" color={textColor}>
                                        Script Arguments
                                    </Heading>
                                    <HStack gap={2}>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={applyScriptArgs}
                                            colorScheme="green"
                                            disabled={!scriptArgsDisplay || Object.keys(scriptArgsDisplay).length === 0}
                                            fontWeight="medium"
                                        >
                                            Apply to Script
                                        </Button>
                                    </HStack>
                                </HStack>

                                {scriptArgsDisplay && Object.keys(scriptArgsDisplay).length > 0 ? (
                                    <Box pl={3} borderLeft="2px solid" borderColor={borderColor} id="script-args-container" key={JSON.stringify(scriptArgsDisplay)}>
                                        <VStack align="stretch" gap={2}>
                                            {Object.entries(scriptArgsDisplay).map(([varName, varValue]) => (
                                                <HStack key={varName} gap={2}>
                                                    <Text minW="150px" fontSize="sm" fontWeight="medium" color={textColor}>
                                                        {varName}
                                                    </Text>
                                                    <Input
                                                        data-arg-name={varName}
                                                        defaultValue={varValue}
                                                        size="sm"
                                                        flex={1}
                                                    />
                                                </HStack>
                                            ))}
                                        </VStack>
                                    </Box>
                                ) : (
                                    <Box pl={3} borderLeft="2px solid" borderColor={borderColor}>
                                        <Text fontSize="sm" color={mutedTextColor} fontStyle="italic">
                                            No export variables found. Variables will be extracted automatically from your script.
                                        </Text>
                                    </Box>
                                )}

                                <Text fontSize="xs" color={mutedTextColor}>
                                    Export variables are extracted automatically. Use "Apply to Script" to update the script with your changes.
                                </Text>
                            </VStack>
                        </Card.Root>
                    </VStack>

                    {/* Right Column - Script Editor */}
                    <VStack align="stretch" gap={4} height="100%" overflow="hidden">
                        {/* Template Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            p={4}
                        >
                            <VStack align="stretch" gap={3}>
                                <Heading size="sm" fontWeight="semibold" color={textColor}>
                                    Script Template
                                </Heading>
                                <Field.Root>
                                    <HStack gap={3} align="center">
                                        <Field.Label minW="100px" mb={0} color={textColor}>Template</Field.Label>
                                        <VStack align="stretch" flex={1} gap={2}>
                                            <HStack gap={2}>
                                                <Box flex={1} minW={0}>
                                                    <AutocompleteInput
                                                        value={selectedTemplate}
                                                        onChange={setSelectedTemplate}
                                                        onSelect={handleTemplateSelect}
                                                        suggestions={templates || []}
                                                        placeholder="Select a template or enter custom name"
                                                        size="md"
                                                        width="100%"
                                                    />
                                                </Box>
                                                <Button
                                                    variant="outline"
                                                    onClick={handleSaveTemplate}
                                                    loading={saveTemplateMutation.isPending}
                                                    size="md"
                                                    fontWeight="medium"
                                                    flexShrink={0}
                                                >
                                                    Save Template
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </HStack>
                                    {selectedTemplate && (
                                        <Text fontSize="sm" color={mutedTextColor} mt={1}>
                                            Template loaded: {selectedTemplate}
                                        </Text>
                                    )}
                                </Field.Root>
                            </VStack>
                        </Card.Root>

                        {/* Editor Section */}
                        <Card.Root
                            bg={cardBg}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="lg"
                            boxShadow={shadow}
                            flex="1"
                            overflow="hidden"
                            display="flex"
                            flexDirection="column"
                            minH={0}
                        >
                            <Box flex="1" display="flex" flexDirection="column" minH={0} overflow="hidden">
                                <Suspense fallback={
                                    <Box
                                        flex="1"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        borderWidth="1px"
                                        borderColor={borderColor}
                                        borderRadius="md"
                                        bg={headerBg}
                                        minH="400px"
                                    >
                                        <Text color={textColor}>Loading editor...</Text>
                                    </Box>
                                }>
                                    <Box flex="1" minH={0} overflow="hidden" display="flex" flexDirection="column">
                                        <MonacoEditor
                                            height="100%"
                                            value=""
                                            onChange={() => refreshScriptArgs()}
                                            onMount={(editor: any) => {
                                                console.log('Editor mounted', editor);
                                                editorRef.current = editor;
                                            }}
                                        />
                                    </Box>
                                </Suspense>
                            </Box>
                        </Card.Root>
                    </VStack>
                </Grid>

                {/* Submit and Cancel buttons */}
                <HStack
                    gap={3}
                    justify="flex-end"
                    pt={4}
                    borderTopWidth="1px"
                    borderTopColor={borderColor}
                >
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        fontWeight="medium"
                        color={textColor}
                        _hover={{ bg: useColorModeValue('gray.100', 'gray.700') }}
                    >
                        Cancel
                    </Button>
                    <Button
                        colorScheme="blue"
                        onClick={handleSubmitJob}
                        loading={submitJobMutation.isPending}
                        fontWeight="medium"
                        size="md"
                        bg={useColorModeValue('blue.500', 'blue.600')}
                        color="white"
                        _hover={{ bg: useColorModeValue('blue.600', 'blue.500') }}
                    >
                        Submit Job
                    </Button>
                </HStack>
            </VStack>
        </Box>
    );
};