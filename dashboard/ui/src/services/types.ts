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
            build_settings: {
                TORCH_VERSION: string;
                CUDA_VERSION: string;
                CUDNN_VERSION: string;
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
    data: any;
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
    [key: string]: any; // For additional fields that might be present
}

export interface PersitedJobInfo {
    name: string;
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
    success: any[];
    failures: Array<[any, string]>;
}

export interface EarlySyncResponse {
    status: "ok" | "notok";
}


