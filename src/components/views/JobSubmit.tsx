import React, { useRef, useMemo, Suspense, useState } from 'react';
import {
    Grid,
    VStack,
    HStack,
    FormControl,
    FormLabel,
    Input,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    NumberIncrementStepper,
    NumberDecrementStepper,
    Text,
    Button,
    Checkbox,
    Spacer,
    Box,
    Select,
    useToast,
} from '@chakra-ui/react';

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
    const toast = useToast();
    const queryClient = useQueryClient();

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
            toast({
                title: 'Job Submitted',
                description: `Job ${data.job_id} submitted successfully`,
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['slurm-persisted-jobs'] });
            if (onClose) onClose();
        },
        onError: (error: any) => {
            toast({
                title: 'Submission Failed',
                description: error.message || 'Failed to submit job',
                status: 'error',
                duration: 5000,
                isClosable: true,
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
            toast({
                title: 'Template Loading Failed',
                description: error.message || 'Failed to load template content',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const saveProfileMutation = useMutation({
        mutationFn: saveSlurmProfile,
        onSuccess: (data) => {
            toast({
                title: 'Profile Saved',
                description: data.message || 'Profile saved successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-profiles'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Profile Save Failed',
                description: error.message || 'Failed to save profile',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        },
    });

    const saveTemplateMutation = useMutation({
        mutationFn: saveSlurmTemplate,
        onSuccess: (data) => {
            toast({
                title: 'Template Saved',
                description: data.message || 'Template saved successfully',
                status: 'success',
                duration: 5000,
                isClosable: true,
            });
            queryClient.invalidateQueries({ queryKey: ['slurm-templates'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Template Save Failed',
                description: error.message || 'Failed to save template',
                status: 'error',
                duration: 5000,
                isClosable: true,
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
            toast({
                title: 'Profile Name Required',
                description: 'Please select or enter a profile name to save the current configuration.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        const sbatch_args = [];
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
            toast({
                title: 'Template Name Required',
                description: 'Please select or enter a template name to save the current script.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
            });
            return;
        }

        const scriptContent = editorRef.current?.getValue() || '';
        if (!scriptContent.trim()) {
            toast({
                title: 'Script Content Required',
                description: 'Please enter script content before saving as template.',
                status: 'warning',
                duration: 5000,
                isClosable: true,
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
        const sbatch_args = [];
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
        <Box width="100%" height="100%">
            <Grid templateColumns="repeat(2, 1fr)" gap={4} width={"100%"} height={"100%"} className="column-container">
                <VStack align="stretch" className="column-1 slurm-options">
                    <FormControl paddingBottom="10px">
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Slurm Profile</FormLabel>
                            <VStack align="stretch" flex={1} spacing={2}>
                                <HStack spacing={3}>
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
                                                <VStack align="start" spacing={0}>
                                                    <Text fontWeight="medium">{suggestion}</Text>
                                                    {profile?.description && (
                                                        <Text fontSize="xs" color="gray.500">
                                                            {profile.description}
                                                        </Text>
                                                    )}
                                                </VStack>
                                            );
                                        }}
                                    />
                                    <Button
                                        variant="outline"
                                        onClick={handleSaveProfile}
                                        isLoading={saveProfileMutation.isPending}
                                        size="md"
                                    >
                                        Save Profile
                                    </Button>
                                </HStack>
                            </VStack>
                        </HStack>
                        <Text fontSize="sm" color="gray.600">
                            Select an existing profile or enter a new name to create a new profile
                        </Text>
                    </FormControl>

                    <FormLabel minW="120px" mb={0} paddingTop="10px" fontWeight={"bold"}>Slurm Arguments</FormLabel>
                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Job Name</FormLabel>
                            <Input
                                ref={jobNameRef}
                                defaultValue="milabench_job"
                                placeholder="milabench_job"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Partition</FormLabel>
                                <Input
                                    ref={partitionRef}
                                    defaultValue=""
                                    placeholder="Leave empty for default"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Nodes</FormLabel>
                                <NumberInput
                                    value={nodes}
                                    onChange={(valueString) => setNodes(valueString)}
                                    min={1}
                                    max={100}
                                    flex={1}
                                >
                                    <NumberInputField />
                                    <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                    </NumberInputStepper>
                                </NumberInput>
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Tasks</FormLabel>
                                <NumberInput
                                    value={ntasks}
                                    onChange={(valueString) => setNtasks(valueString)}
                                    min={1}
                                    max={100}
                                    flex={1}
                                >
                                    <NumberInputField />
                                    <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                    </NumberInputStepper>
                                </NumberInput>
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>CPUs per Task</FormLabel>
                                <NumberInput
                                    value={cpusPerTask}
                                    onChange={(valueString) => setCpusPerTask(valueString)}
                                    min={1}
                                    max={1024}
                                    flex={1}
                                >
                                    <NumberInputField />
                                    <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                    </NumberInputStepper>
                                </NumberInput>
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>GPUs per Task</FormLabel>
                                <Input
                                    ref={gpusPerTaskRef}
                                    placeholder="e.g. 1, 2"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Tasks per Node</FormLabel>
                                <NumberInput
                                    value={ntasksPerNode}
                                    onChange={(valueString) => setNtasksPerNode(valueString)}
                                    min={1}
                                    max={100}
                                    flex={1}
                                >
                                    <NumberInputField />
                                    <NumberInputStepper>
                                        <NumberIncrementStepper />
                                        <NumberDecrementStepper />
                                    </NumberInputStepper>
                                </NumberInput>
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Memory</FormLabel>
                                <Input
                                    ref={memRef}
                                    placeholder="e.g. 8G, 16GB"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Time Limit</FormLabel>
                                <Input
                                    ref={timeLimitRef}
                                    placeholder="e.g. 02:00:00, 1-12:00:00"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Export</FormLabel>
                                <Input
                                    ref={exportVarsRef}
                                    placeholder="e.g. ALL, NONE, VAR1,VAR2"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>

                        <FormControl>
                            <HStack spacing={3} align="center">
                                <FormLabel minW="120px" mb={0}>Node List</FormLabel>
                                <Input
                                    ref={nodelistRef}
                                    defaultValue=""
                                    placeholder="e.g., cn-d[003-004]"
                                    flex={1}
                                />
                            </HStack>
                        </FormControl>
                    </Grid>

                    <FormControl paddingTop="10px">
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Exclusive</FormLabel>
                            <Checkbox
                                ref={exclusiveRef}
                                defaultChecked={false}
                            >
                                Request exclusive access to nodes
                            </Checkbox>
                        </HStack>
                    </FormControl>

                    <FormControl paddingTop="20px">
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" fontWeight={"bold"} mb={0}>Dependency</FormLabel>
                            <Select
                                ref={dependencyEventRef}
                                defaultValue=""
                                placeholder="Select event"
                                flex={1}
                            >
                                <option value="after">After</option>
                                <option value="afterok">After Ok</option>
                                <option value="afterany">After Any</option>
                                <option value="afterburstbuffer">After Burst Buffer</option>
                                <option value="aftercorr">After Corr</option>
                                <option value="afternotok">After Not Ok</option>
                                <option value="singleton">Singleton</option>
                            </Select>
                            <Select
                                ref={dependencyJobRef}
                                defaultValue=""
                                placeholder="Select job"
                                flex={1}
                            >
                                {dependencyJobs.map((job) => (
                                    <option key={job.job_id} value={job.job_id || ''}>
                                        {job.job_id} - {job.name || job.job_name || 'Unnamed'} ({job.job_state?.[0] || 'Unknown'})
                                    </option>
                                ))}
                            </Select>
                        </HStack>
                    </FormControl>

                    {/* Script Arguments Section */}
                    <FormControl>
                        <VStack align="stretch" spacing={3}>
                            <HStack justify="space-between" align="center">
                                <FormLabel minW="120px" mb={0} paddingTop="10px" fontWeight={"bold"}>Script Arguments</FormLabel>
                                <HStack spacing={2}>
                                    {/* <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={refreshScriptArgs}
                                    colorScheme="blue"
                                >
                                    Refresh
                                </Button> */}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={applyScriptArgs}
                                        colorScheme="green"
                                        isDisabled={!scriptArgsDisplay || Object.keys(scriptArgsDisplay).length === 0}
                                    >
                                        Apply to Script
                                    </Button>
                                </HStack>
                            </HStack>

                            {scriptArgsDisplay && Object.keys(scriptArgsDisplay).length > 0 ? (
                                <Box pl={3} borderLeft="2px solid" borderColor="gray.200" id="script-args-container" key={JSON.stringify(scriptArgsDisplay)}>
                                    <VStack align="stretch" spacing={2}>
                                        {Object.entries(scriptArgsDisplay).map(([varName, varValue]) => (
                                            <HStack key={varName} spacing={2}>
                                                <Text minW="150px" fontSize="sm" fontWeight="medium">
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
                                <Box pl={3} borderLeft="2px solid" borderColor="gray.200">
                                    <Text fontSize="sm" color="gray.500" fontStyle="italic">
                                        No export variables found. Click "Refresh" to extract variables from your script.
                                    </Text>
                                </Box>
                            )}

                            <Text fontSize="xs" color="gray.500">
                                Use "Refresh" to extract export variables from your script, then "Apply to Script" to update the script with your changes.
                            </Text>
                        </VStack>
                    </FormControl>

                    <Spacer />
                </VStack>
                <VStack align="stretch" className="column-2 slurm-script" height="100%">
                    <FormControl paddingBottom="10px">
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Script Template</FormLabel>
                            <VStack align="stretch" flex={1} spacing={2}>
                                <HStack spacing={3}>
                                    <AutocompleteInput
                                        value={selectedTemplate}
                                        onChange={setSelectedTemplate}
                                        onSelect={handleTemplateSelect}
                                        suggestions={templates || []}
                                        placeholder="Select a template or enter custom name"
                                        size="md"
                                        width="100%"
                                    />
                                    <Button
                                        variant="outline"
                                        onClick={handleSaveTemplate}
                                        isLoading={saveTemplateMutation.isPending}
                                        size="md"
                                    >
                                        Save Template
                                    </Button>
                                </HStack>
                            </VStack>
                        </HStack>
                        {selectedTemplate && (
                            <Text fontSize="sm" color="gray.600">
                                Template loaded: {selectedTemplate}
                            </Text>
                        )}
                    </FormControl>

                    <FormControl height="100%">
                        <Suspense fallback={<Box height="calc(100vh - 17em)" display="flex" alignItems="center" justifyContent="center" border="1px solid" borderColor="gray.200" borderRadius="md">
                            <Text>Loading editor...</Text>
                        </Box>}>
                            <MonacoEditor
                                height="calc(100vh - 17em)"
                                value=""
                                onChange={() => refreshScriptArgs()} // No-op - completely uncontrolled
                                onMount={(editor: any) => {
                                    console.log('Editor mounted', editor);
                                    editorRef.current = editor;
                                }}
                            />
                        </Suspense>
                    </FormControl>
                </VStack>
            </Grid>

            {/* Submit and Cancel buttons */}
            <HStack spacing={3} justify="flex-end" pt={4} borderTop="1px solid" borderColor="gray.200">
                <Button variant="ghost" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    colorScheme="blue"
                    onClick={handleSubmitJob}
                    isLoading={submitJobMutation.isPending}
                >
                    Submit Job
                </Button>
            </HStack>
        </Box>
    );
};