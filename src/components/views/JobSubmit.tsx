import React, { useEffect, useMemo } from 'react';
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
        /export\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^$\n\r]+)\n/gi :
        /export\s+([A-Z_][A-Z0-9_]*)\s*=\s*([^\n\r]+)\n/gi;

    const variables: Record<string, string> = {};
    let match;

    while ((match = exportRegex.exec(script)) !== null) {
        const [, varName, varValue] = match;
        // Clean up the value by removing quotes and trimming
        const cleanValue = varValue.replace(/^["']|["']$/g, '').trim();
        variables[varName] = cleanValue;
    }

    return variables;
};

// Utility function to update script with new export variable values
const updateScriptWithExportVars = (script: string, scriptArgs: Record<string, string>): string => {
    let updatedScript = script;

    Object.entries(scriptArgs).forEach(([varName, varValue]) => {
        const exportRegex = new RegExp(`(export\\s+${varName}\\s*=\\s*)([^\\n\\r]+)`, 'gi');
        const replacement = `$1${varValue}`;
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
    activeJobs = []
}) => {
    // Parse export variables from script (only constant values, not derived)
    const parsedScriptArgs = useMemo(() => {
        return parseExportVariables(form.script || '', true);
    }, [form.script]);

    // Update form with parsed script arguments
    useEffect(() => {
        if (Object.keys(parsedScriptArgs).length > 0 &&
            JSON.stringify(parsedScriptArgs) !== JSON.stringify(form.script_args)) {
            setForm({
                ...form,
                script_args: parsedScriptArgs
            });
        }
    }, [parsedScriptArgs, form, setForm]);

    // Handle script argument changes
    const handleScriptArgChange = (varName: string, varValue: string) => {
        const updatedScriptArgs = {
            ...form.script_args,
            [varName]: varValue
        };

        // Update script with new values
        const updatedScript = updateScriptWithExportVars(form.script, updatedScriptArgs);

        setForm({
            ...form,
            script_args: updatedScriptArgs,
            script: updatedScript
        });
    };

    // Handle dependency changes
    const handleDependencyEventChange = (event: string) => {
        const currentJobId = currentDependency.jobId;
        if (event && currentJobId) {
            setForm({
                ...form,
                dependency: [[event, currentJobId]]
            });
        } else if (event) {
            // Keep the event selection even if no job is selected yet
            setForm({
                ...form,
                dependency: [[event, ""]]
            });
        } else {
            setForm({
                ...form,
                dependency: undefined
            });
        }
    };

    const handleDependencyJobChange = (jobId: string) => {
        const currentEvent = currentDependency.event;
        if (currentEvent && jobId) {
            setForm({
                ...form,
                dependency: [[currentEvent, jobId]]
            });
        } else if (jobId) {
            // Keep the job selection even if no event is selected yet
            setForm({
                ...form,
                dependency: [["", jobId]]
            });
        } else if (currentEvent) {
            // Keep the event if job is cleared
            setForm({
                ...form,
                dependency: [[currentEvent, ""]]
            });
        } else {
            setForm({
                ...form,
                dependency: undefined
            });
        }
    };

    // Get current dependency values for display
    const getCurrentDependency = () => {
        if (form.dependency && form.dependency.length > 0) {
            const dep = form.dependency[0];
            return { event: dep[0], jobId: dep[1] };
        }
        return { event: '', jobId: '' };
    };

    const currentDependency = getCurrentDependency();

    // Filter jobs to only show running and pending jobs for dependencies
    const dependencyJobs = activeJobs.filter(job =>
        job.job_state?.[0]?.toLowerCase() === 'running' ||
        job.job_state?.[0]?.toLowerCase() === 'pending'
    );

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
                            value={form.job_name}
                            onChange={(e) => setForm({ ...form, job_name: e.target.value })}
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
                                value={form.partition}
                                onChange={(e) => setForm({ ...form, partition: e.target.value })}
                                placeholder="Leave empty for default"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Nodes</FormLabel>
                            <NumberInput
                                value={form.nodes}
                                onChange={(_, value) => setForm({ ...form, nodes: value })}
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
                                value={form.ntasks}
                                onChange={(_, value) => setForm({ ...form, ntasks: value })}
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
                                value={form.cpus_per_task}
                                onChange={(_, value) => setForm({ ...form, cpus_per_task: value })}
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
                                value={form.gpus_per_task}
                                onChange={(e) => setForm({ ...form, gpus_per_task: e.target.value })}
                                placeholder="1"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Tasks per Node</FormLabel>
                            <NumberInput
                                value={form.ntasks_per_node}
                                onChange={(_, value) => setForm({ ...form, ntasks_per_node: value })}
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
                                value={form.mem}
                                onChange={(e) => setForm({ ...form, mem: e.target.value })}
                                placeholder="8G"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Time Limit</FormLabel>
                            <Input
                                value={form.time_limit}
                                onChange={(e) => setForm({ ...form, time_limit: e.target.value })}
                                placeholder="02:00:00"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Export</FormLabel>
                            <Input
                                value={form.export}
                                onChange={(e) => setForm({ ...form, export: e.target.value })}
                                placeholder="ALL"
                                flex={1}
                            />
                        </HStack>
                    </FormControl>

                    <FormControl>
                        <HStack spacing={3} align="center">
                            <FormLabel minW="120px" mb={0}>Node List</FormLabel>
                            <Input
                                value={form.nodelist}
                                onChange={(e) => setForm({ ...form, nodelist: e.target.value })}
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
                            
                            isChecked={form.exclusive}
                            onChange={(e) => setForm({ ...form, exclusive: e.target.checked })}
                        >
                            Request exclusive access to nodes
                        </Checkbox>
                    </HStack>
                </FormControl>

                <FormControl paddingTop="20px">
                    <HStack spacing={3} align="center">
                        <FormLabel minW="120px" fontWeight={"bold"} mb={0}>Dependency</FormLabel>
                        <Select
                            value={currentDependency.event}
                            onChange={(e) => handleDependencyEventChange(e.target.value)}
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
                            value={currentDependency.jobId}
                            onChange={(e) => handleDependencyJobChange(e.target.value)}
                            placeholder="Select job"
                            flex={1}
                        >
                            {dependencyJobs.map((job) => (
                                <option key={job.job_id} value={job.job_id || ''}>
                                    {job.job_id} - {job.name || job.job_name || 'Unnamed'} ({job.job_state?.[0]})
                                </option>
                            ))}
                        </Select>
                    </HStack>
                </FormControl>

                {/* Script Arguments Section */}
                {form.script_args && Object.keys(form.script_args).length > 0 && (
                    <FormControl>
                        <VStack align="stretch" spacing={3}>
                            <FormLabel minW="120px" mb={0} paddingTop="10px" fontWeight={"bold"}>Script Arguments</FormLabel>
                            <Box pl={3} borderLeft="2px solid" borderColor="gray.200">
                                <VStack align="stretch" spacing={2}>
                                    {Object.entries(form.script_args).map(([varName, varValue]) => (
                                        <HStack key={varName} spacing={2}>
                                            <Text minW="150px" fontSize="sm" fontWeight="medium">
                                                {varName}
                                            </Text>
                                            <Input
                                                value={varValue}
                                                onChange={(e) => handleScriptArgChange(varName, e.target.value)}
                                                size="sm"
                                                flex={1}
                                            />
                                        </HStack>
                                    ))}
                                </VStack>
                            </Box>
                            <Text fontSize="xs" color="gray.500">
                                These export variables are automatically extracted from your script and can be modified here.
                            </Text>
                        </VStack>
                    </FormControl>
                )}

                <Spacer />
            </VStack>
            <VStack align="stretch" className="column-2 slurm-script" >
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

                <FormControl>
                    <MonacoEditor
                        height="calc(100vh - 17em)"
                        value={form.script}
                        onChange={(value) => setForm({ ...form, script: value })}
                    />
                </FormControl>
            </VStack>
        </Grid>
    );
};