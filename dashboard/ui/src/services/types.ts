export interface Execution {
    _id: number;
    meta: {
        cpu: {
            brand: string;
            count: number;

        };
        accelerators: {
            gpus: Array<{
                product: string;
                memory: string;
                driver: string;
            }>;
            system: {
                CUDA_DRIVER: string;
                DRIVER_VERSION: string;
                HIC_DRIVER: string;
                NVML_VERSION: string;
            };
        };
        os: {
            machine: string;
            sysname: string;
            release: string;
        };
        pytorch: {
            torch: string;
            /** From torch.version.cuda — preferred over build_settings.CUDA_VERSION */
            cuda?: string | null;
            /** From torch.version.hip — preferred over build_settings.HIP_VERSION */
            hip?: string | null;
            build_settings: {
                TORCH_VERSION: string;
                CUDA_VERSION?: string;
                HIP_VERSION?: string;
                CUDNN_VERSION?: string;
            };
        };
        milabench: {
            tag: string;
            commit: string;
            date: string;
        };
        system: {
            hostname: string;
            os: string;
            python: string;
        };
        timestamp: string;
    };
    name: string;
    namespace: string;
    status: string;
    created_time: string;
    visibility?: number;
    release_at?: string | null;
}

export interface Pack {
    _id: number;
    exec_id: number;
    created_time: string;
    name: string;
    tag: string;
    config: [key: string],
    command: [key: string]
}

export interface Metric {
    _id: number;
    exec_id: number;
    pack_id: number;

    order: number;

    name: string;
    namespace: string;
    value: number;
    unit: string;

    gpu_id: string;
    job_id: string;

}

export type EventType = "config" | "meta" | "start" | "data" | "stop" | "line" | "error" | "end";
export type PipeType = "data" | "stderr" | "stdout";

export interface BenchLogEntry {
    event: EventType;
    data: unknown;
    pipe: PipeType;
    tag: string;
}

export interface Summary {
    [key: string]: {
        [key: string]: number | string;
    };
}

export interface ApiError {
    message: string;
    status: number;
}

export interface Weight {
    _id: number;
    profile: string;
    pack: string;
    weight: number;
    priority: number;
    enabled: boolean;
    group1?: string;
    group2?: string;
    group3?: string;
    group4?: string;
}

// Slurm-related types
export interface SlurmJob {
    job_id: string | null;
    jr_job_id?: string | null;
    created_at?: string;
    partition?: string;
    name?: string;
    job_name?: string;
    user?: string;
    user_name?: string;
    status?: string;
    state?: string;
    job_state?: string[];
    state_reason?: string;
    state_description?: string;
    time?: string;
    time_limit?: {
        number: number,
        set: boolean,
        infinite: boolean
    };
    elapsed?: string;
    nodes?: string;
    nodelist?: string;
    node_list?: string;
    account?: string;
    alloccpus?: string;
    exit_code?: string;
    raw_line?: string;
    start_time?: {
        number: number;
        set: boolean;
        infinite: boolean;
    };
    end_time?: {
        number: number;
        set: boolean;
        infinite: boolean;
    };
    submit_time?: {
        number: number;
        set: boolean;
        infinite: boolean;
    };
}

/** A Slurm numeric field as returned by the Slurm REST API (`scontrol`-style). */
export interface SlurmNumericField {
    number: number;
    set: boolean;
    infinite: boolean;
}

export interface SlurmJobResourceNode {
    memory_allocated?: number;
    [key: string]: unknown;
}

export interface SlurmJobResources {
    allocated_nodes?: SlurmJobResourceNode[];
    [key: string]: unknown;
}

/**
 * Detailed job info as returned by `getSlurmJobInfo` — a passthrough of the
 * Slurm REST API's `scontrol show job` response, richer than `SlurmJob`.
 */
export interface SlurmJobDetail {
    job_id?: string;
    name?: string;
    job_state?: string[];
    partition?: string;
    user_name?: string;
    account?: string;
    qos?: string;
    priority?: SlurmNumericField;
    node_count?: SlurmNumericField;
    nodes?: string;
    tasks?: SlurmNumericField;
    cpus?: SlurmNumericField;
    cpus_per_task?: SlurmNumericField;
    tasks_per_node?: SlurmNumericField;
    memory_per_node?: SlurmNumericField;
    tres_alloc_str?: string;
    submit_time?: SlurmNumericField;
    start_time?: SlurmNumericField;
    end_time?: SlurmNumericField;
    eligible_time?: SlurmNumericField;
    accrue_time?: SlurmNumericField;
    time_limit?: SlurmNumericField;
    command?: string;
    current_working_directory?: string;
    standard_output?: string;
    standard_error?: string;
    comment?: string;
    exit_code?: { return_code?: SlurmNumericField; [key: string]: unknown };
    restart_cnt?: number;
    state_reason?: string;
    elapsed?: string;
    time?: string;
    gres_detail?: string[] | string;
    job_resources?: SlurmJobResources;
    [key: string]: unknown;
}

export interface SlurmJobsResponse {
    active_jobs: SlurmJob[];
    completed_jobs: SlurmJob[];
}

export interface SlurmJobSubmitRequest {
    script: string;
    job_name?: string;
    sbatch_args?: string[];
    // Script arguments extracted from export statements
    script_args?: Record<string, string>;
    // Individual parameters for backward compatibility
    partition?: string;
    nodes?: number;
    ntasks?: number;
    cpus_per_task?: number;
    mem?: string;
    time_limit?: string;
    gpus_per_task?: string;
    ntasks_per_node?: number;
    exclusive?: boolean;
    export?: string;
    nodelist?: string;
    dependency?: [string, string][]
}

export interface SlurmJobSubmitResponse {
    success: boolean;
    job_id?: string;
    jr_job_id?: string;
    message?: string;
    error?: string;
}

export interface MetalJobSubmitResponse {
    status: "ok" | "no";
    job_id?: string;
    error?: string;
}

export interface SlurmJobLogs {
    job_info: Record<string, string>;
    stdout: string;
    stderr: string;
}

export interface SlurmJobLogResponse {
    data: string;
    size: number;
}

export interface SlurmJobData {
    job_id: string;
    work_dir: string;
    data_files: string[];
}

export interface SlurmClusterStatus {
    status: 'online' | 'offline';
    reason?: string;
}

export interface SlurmJobStatusResponse {
    status: string;
}

export interface SlurmJobAccounting {
    job_id: number;
    account: string;
    state: {
        current: string[];
        reason: string;
    };
    derived_exit_code: {
        status: string[];
        return_code: {
            set: boolean;
            infinite: boolean;
            number: number;
        };
        signal: {
            id: {
                set: boolean;
                infinite: boolean;
                number: number;
            };
            name: string;
        };
    };
    exit_code: {
        status: string[];
        return_code: {
            set: boolean;
            infinite: boolean;
            number: number;
        };
        signal: {
            id: {
                set: boolean;
                infinite: boolean;
                number: number;
            };
            name: string;
        };
    };
    time: {
        elapsed: number;
        eligible: number;
        end: number;
        start: number;
        submission: number;
        suspended: number;
        limit: {
            set: boolean;
            infinite: boolean;
            number: number;
        };
    };
    name: string;
    partition: string;
    nodes: string;
    user: string;
    [key: string]: unknown; // For additional fields that might be present
}

export interface PersitedJobInfo {
    name: string;
    cluster?: string;
    creation_time: string;
    last_modified: string;
    last_accessed: string;
    freshness: number;
    info: SlurmJob;
    acc: SlurmJobAccounting;
}

export interface SlurmPartition {
    partition: string;
    allocated: string;
    nodes: string;
    state: string;
    nodelist: string;
}

export interface SlurmNode {
    hostname: string;
    partition: string;
    state: string;
    cpus: string;
    memory: string;
    gres: string;
}

export interface SlurmClusterInfo {
    partitions: SlurmPartition[];
    nodes: SlurmNode[];
}

export interface SlurmTemplate {
    template: string;
    description: string;
}

export interface SlurmProfile {
    name: string;
    cluster?: string;
    description: string;
    sbatch_args: string[];
    parsed_args: {
        job_name?: string;
        partition?: string;
        nodes?: number;
        ntasks?: number;
        cpus_per_task?: number;
        mem?: string;
        time_limit?: string;
        gpus_per_task?: string;
        ntasks_per_node?: number;
        exclusive?: boolean;
        export?: string;
        nodelist?: string;
    };
}

export interface SlurmProfileSaveRequest {
    name: string;
    description?: string;
    sbatch_args: string[];
}

// Pipeline-related types
export interface PipelineJob {
    type: 'job';
    script: string;
    profile: string;
    job_id?: string;
    slurm_jobid?: string;
}

export interface PipelineSequential {
    type: 'sequential';
    name: string;
    jobs: PipelineNode[];
}

export interface PipelineParallel {
    type: 'parallel';
    name: string;
    jobs: PipelineNode[];
}

export interface Pipeline {
    type: 'pipeline';
    name: string;
    definition: PipelineNode;
    job_id?: string;
}

export type PipelineNode = PipelineJob | PipelineSequential | PipelineParallel;

export interface PipelineRun {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    created_at: string;
    started_at?: string;
    completed_at?: string;
    pipeline: Pipeline;
    jobs: PipelineJobStatus[];
}

export interface PipelineJobStatus {
    job_id: string;
    slurm_jobid?: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    started_at?: string;
    completed_at?: string;
    dependencies?: string[];
}

export interface PipelineTemplate {
    name: string;
    description: string;
    pipeline: Pipeline;
}

/** Payload sent to persist a pipeline as a reusable template file. */
export interface PipelineTemplatePayload {
    name: string;
    type: 'pipeline';
    definition: PipelineNode;
    job_id: string | null;
}

export interface PipelineCreateRequest {
    name: string;
    pipeline: Pipeline;
}

export interface PipelineRunRequest {
    pipeline_id: string;
    name?: string;
}

export interface PipelineListResponse {
    pipelines: Pipeline[];
}

export interface PipelineRunsResponse {
    runs: PipelineRun[];
}

// Push-related types
export interface PushZipResponse {
    status: "OK" | "ERR";
    message: string;
}

export interface PushFolderResponse {
    status: "OK";
    success: string[];
    failures: Array<[string, string]>;
}

export interface EarlySyncResponse {
    status: "ok" | "notok";
}

export interface MetalHost {
    name: string;
    url?: string;
    ssh?: string;
    remote_folder?: string;
    [key: string]: unknown;
}

export interface MetalJob extends SlurmJob {
    host: string;
}

// Scheduled Slurm Jobs
export interface ScheduledJob {
    _id: number;
    name: string;
    enabled: boolean;
    cron_expression: string;
    cluster: string;
    script: string;
    sbatch_args: string[];
    job_name_prefix: string | null;
    created_time: string | null;
    modified_time: string | null;
    last_run_time: string | null;
    last_job_id: string | null;
    next_run_time: string | null;
    // Which scripts/slurm template this job's script was loaded from, if
    // any, and whether that file has since changed (computed server-side).
    source_template: string | null;
    source_template_hash: string | null;
    outdated?: boolean;
    template_missing?: boolean;
}

export interface ScheduledJobTemplateDiff {
    source_template: string;
    current_script: string;
    latest_script: string;
    outdated: boolean;
}

export interface ScheduledJobRun {
    _id: number;
    scheduled_job_id: number;
    jr_job_id: string | null;
    slurm_job_id: string | null;
    submitted_at: string | null;
    status: string;
    error: string | null;
}

export interface SavedQueryPayload {
    url: string;
    parameters: Record<string, unknown>;
}

export interface SavedQuery {
    _id: number;
    name: string;
    query: SavedQueryPayload;
    created_time: string;
}

/** A row of the `/api/report/fast` (and run-group composite-report) benchmark report. */
export interface FastReportRow {
    exec_id: number;
    bench: string;
    total: number;
    fail: number;
    n: number;
    ngpu: number;
    perf: number;
    sem: number;
    std: number;
    score: number;
    weight: number;
    enabled: number;
    log_score: number;
    order: number;
    weight_total: number;
}

/**
 * One batch-size/memory observation for a benchmark on a GPU, as returned by
 * `/api/scaling` — either from the `scaling_observations` DB table
 * (`ScalingObservation.as_api_dict`) or, as a fallback, parsed directly from
 * milabench's `config/scaling/*.yaml` snapshots (which may carry additional
 * ad hoc fields beyond the ones listed here).
 */
export interface ScalingObservation {
    gpu: string;
    bench: string;
    batch_size?: number;
    cpu?: number | null;
    memory?: number | null;
    torchmem?: number | null;
    jaxmem?: number | null;
    perf?: number | null;
    torch?: string | null;
    backend?: string | null;
    backend_version?: string | null;
    revision?: string | null;
    time?: number;
    [key: string]: unknown;
}

export interface RunGroup {
    _id: number;
    strategy: 'hardware' | 'config' | 'software' | 'manual';
    granularity: string | null;
    fingerprint: string | null;
    label: string;
    meta: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
    member_count?: number;
}
