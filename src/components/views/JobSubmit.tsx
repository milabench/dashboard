import React, { useRef, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
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
} from '@chakra-ui/react';

import { MonacoEditor } from '../shared/MonacoEditor';

import type { SlurmJobSubmitRequest, SlurmProfile, SlurmJob } from '../../services/types';

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
    form: SlurmJobSubmitRequest;
    setForm: (form: SlurmJobSubmitRequest) => void;
    template?: string;
    templates?: string[];
    profiles: SlurmProfile[];
    selectedProfile: string;
    onProfileSelect: (profileName: string) => void;
    selectedTemplate: string;
    onTemplateSelect: (templateName: string) => void;
    onSaveProfile: () => void;
    saveProfileMutation: {
        isPending: boolean;
    };
    onSaveTemplate: () => void;
    saveTemplateMutation: {
        isPending: boolean;
    };
    activeJobs?: SlurmJob[];
    onFormAssemble?: (assembleForm: () => SlurmJobSubmitRequest) => void;
}

export const JobSubmissionForm: React.FC<JobSubmissionFormProps> = ({
    form,
    setForm,
    template,
    templates,
    profiles,
    selectedProfile,
    onProfileSelect,
    selectedTemplate,
    onTemplateSelect,
    onSaveProfile,
    saveProfileMutation,
    onSaveTemplate,
    saveTemplateMutation,
    activeJobs = [],
    onFormAssemble
}) => {
    // Refs for uncontrolled inputs - much more performant
    const editorRef = useRef<any>(null);
    const jobNameRef = useRef<HTMLInputElement>(null);
    const partitionRef = useRef<HTMLInputElement>(null);
    const nodesRef = useRef<HTMLInputElement>(null);
    const ntasksRef = useRef<HTMLInputElement>(null);
    const cpusPerTaskRef = useRef<HTMLInputElement>(null);
    const memRef = useRef<HTMLInputElement>(null);
    const timeLimitRef = useRef<HTMLInputElement>(null);
    const gpusPerTaskRef = useRef<HTMLInputElement>(null);
    const ntasksPerNodeRef = useRef<HTMLInputElement>(null);
    const exclusiveRef = useRef<HTMLInputElement>(null);
    const exportVarsRef = useRef<HTMLInputElement>(null);
    const nodelistRef = useRef<HTMLInputElement>(null);
    const dependencyEventRef = useRef<HTMLSelectElement>(null);
    const dependencyJobRef = useRef<HTMLSelectElement>(null);
    
    // Minimal state only for displaying script args section (not for values)
    const [scriptArgsDisplay, setScriptArgsDisplay] = React.useState<Record<string, string>>(() => form.script_args || {});
    
    // No more state for editor content - completely uncontrolled!
    // We'll read script args from DOM and editor content from Monaco editor directly

    // Sync refs when form changes externally (e.g., template loading, profile loading)
    useEffect(() => {
        // Update Monaco editor
        if (editorRef.current) {
            editorRef.current.setValue(form.script || '');
        }
        
        // Update all refs with form values
        if (jobNameRef.current) jobNameRef.current.value = form.job_name || 'milabench_job';
        if (partitionRef.current) partitionRef.current.value = form.partition || '';
        if (nodesRef.current) nodesRef.current.value = String(form.nodes || 1);
        if (ntasksRef.current) ntasksRef.current.value = String(form.ntasks || 1);
        if (cpusPerTaskRef.current) cpusPerTaskRef.current.value = String(form.cpus_per_task || 4);
        if (memRef.current) memRef.current.value = form.mem || '8G';
        if (timeLimitRef.current) timeLimitRef.current.value = form.time_limit || '02:00:00';
        if (gpusPerTaskRef.current) gpusPerTaskRef.current.value = form.gpus_per_task || '1';
        if (ntasksPerNodeRef.current) ntasksPerNodeRef.current.value = String(form.ntasks_per_node || 1);
        if (exclusiveRef.current) exclusiveRef.current.checked = form.exclusive || false;
        if (exportVarsRef.current) exportVarsRef.current.value = form.export || 'ALL';
        if (nodelistRef.current) nodelistRef.current.value = form.nodelist || '';
        
        // Handle dependency
        if (form.dependency && form.dependency.length > 0) {
            const [event, jobId] = form.dependency[0];
            if (dependencyEventRef.current) dependencyEventRef.current.value = event || '';
            if (dependencyJobRef.current) dependencyJobRef.current.value = jobId || '';
        } else {
            if (dependencyEventRef.current) dependencyEventRef.current.value = '';
            if (dependencyJobRef.current) dependencyJobRef.current.value = '';
        }
        
        // Update script arguments section when script is loaded from template
        if (form.script) {
            const newScriptArgs = parseExportVariables(form.script, true);
            // We'll trigger a re-render to show the new script args by using a minimal state
            setScriptArgsDisplay(newScriptArgs);
        }
    }, [form]);

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
        
        // Also update the form script so that future operations work correctly
        setForm({ ...form, script: updatedScript });
    };

    // No more handleScriptArgChange - script args are now uncontrolled!

    // Note: We no longer need currentDependency since we're using uncontrolled inputs

    // Function to assemble all form data from refs - no state dependencies!
    const assembleForm = useCallback((): SlurmJobSubmitRequest => {
        // Read current dependency values
        const dependencyEvent = dependencyEventRef.current?.value || '';
        const dependencyJobId = dependencyJobRef.current?.value || '';
        const dependency: [string, string][] | undefined = (dependencyEvent && dependencyJobId) ? [[dependencyEvent, dependencyJobId] as [string, string]] : undefined;
        
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
        
        return {
            script: editorRef.current?.getValue() || '',
            job_name: jobNameRef.current?.value || 'milabench_job',
            script_args: currentScriptArgs,
            partition: partitionRef.current?.value || '',
            nodes: parseInt(nodesRef.current?.value || '1'),
            ntasks: parseInt(ntasksRef.current?.value || '1'),
            cpus_per_task: parseInt(cpusPerTaskRef.current?.value || '4'),
            mem: memRef.current?.value || '8G',
            time_limit: timeLimitRef.current?.value || '02:00:00',
            gpus_per_task: gpusPerTaskRef.current?.value || '1',
            ntasks_per_node: parseInt(ntasksPerNodeRef.current?.value || '1'),
            exclusive: exclusiveRef.current?.checked || false,
            export: exportVarsRef.current?.value || 'ALL',
            nodelist: nodelistRef.current?.value || '',
            dependency: dependency
        };
    }, [scriptArgsDisplay]); // Only depend on scriptArgsDisplay for re-renders

    // Expose the assembleForm function to parent component
    useEffect(() => {
        if (onFormAssemble) {
            onFormAssemble(assembleForm);
        }
    }, [onFormAssemble, assembleForm]);

    // Filter jobs to only show running and pending jobs for dependencies
    const dependencyJobs = useMemo(() => {
        return activeJobs.filter(job =>
        job.job_state?.[0]?.toLowerCase() === 'running' ||
        job.job_state?.[0]?.toLowerCase() === 'pending'
    );
    }, [activeJobs]);

    return (
        <Grid templateColumns="repeat(2, 1fr)" gap={4} width={"100%"} height={"100%"} className="column-container">
            <VStack align="stretch" className="column-1 slurm-options">
                <FormControl paddingBottom="10px">
                    <HStack spacing={3} align="center">
                        <FormLabel minW="120px" mb={0}>Slurm Profile</FormLabel>
                        <VStack align="stretch" flex={1} spacing={2}>
                            <HStack spacing={3}>
                                <Input
                                    value={selectedProfile}
                                    onChange={(e) => onProfileSelect(e.target.value)}
                                    placeholder="Select a profile or enter custom name"
                                    list="profile-list"
                                    flex={1}
                                />
                                <Button
                                    variant="outline"
                                    onClick={onSaveProfile}
                                    isLoading={saveProfileMutation.isPending}
                                    size="md"
                                >
                                    Save Profile
                                </Button>
                            </HStack>
                            <datalist id="profile-list">
                                {profiles.map((profile) => (
                                    <option key={profile.name} value={profile.name}>
                                        {profile.name} - {profile.description}
                                    </option>
                                ))}
                            </datalist>

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
                            defaultValue={form.job_name || 'milabench_job'}
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
                                defaultValue={form.partition || ''}
                                placeholder="Leave empty for default"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Nodes</FormLabel>
                            <NumberInput
                                ref={nodesRef}
                                defaultValue={form.nodes || 1}
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
                                ref={ntasksRef}
                                defaultValue={form.ntasks || 1}
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
                                ref={cpusPerTaskRef}
                                defaultValue={form.cpus_per_task || 4}
                                min={1}
                                max={64}
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
                                defaultValue={form.gpus_per_task || '1'}
                                placeholder="1"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Tasks per Node</FormLabel>
                            <NumberInput
                                ref={ntasksPerNodeRef}
                                defaultValue={form.ntasks_per_node || 1}
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
                                defaultValue={form.mem || '8G'}
                                placeholder="8G"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Time Limit</FormLabel>
                            <Input
                                ref={timeLimitRef}
                                defaultValue={form.time_limit || '02:00:00'}
                                placeholder="02:00:00"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Export</FormLabel>
                            <Input
                                ref={exportVarsRef}
                                defaultValue={form.export || 'ALL'}
                                placeholder="ALL"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Node List</FormLabel>
                            <Input
                                ref={nodelistRef}
                                defaultValue={form.nodelist || ''}
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
                            defaultChecked={form.exclusive || false}
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
                            defaultValue={form.dependency?.[0]?.[0] || ''}
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
                            defaultValue={form.dependency?.[0]?.[1] || ''}
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
                                <Input
                                    value={selectedTemplate}
                                    onChange={(e) => onTemplateSelect(e.target.value)}
                                    placeholder="Select a template or enter custom name"
                                    list="template-list"
                                    flex={1}
                                />
                                <Button
                                    variant="outline"
                                    onClick={onSaveTemplate}
                                    isLoading={saveTemplateMutation.isPending}
                                    size="md"
                                >
                                    Save Template
                                </Button>
                            </HStack>
                            <datalist id="template-list">
                                {templates?.map((templateName) => (
                                    <option key={templateName} value={templateName}>
                                        {templateName}
                                    </option>
                                ))}
                            </datalist>
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
                            value={form.script || ''}
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
    );
};