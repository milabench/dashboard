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
    job_id: string;
    partition?: string;
    name?: string;
    job_name?: string;
    user?: string;
    user_name?: string;
    status?: string;
    state?: string;
    job_state?: string;
    time?: string;
    time_limit?: string;
    elapsed?: string;
    nodes?: string;
    nodelist?: string;
    node_list?: string;
    account?: string;
    alloccpus?: string;
    exit_code?: string;
    raw_line?: string;
}

export interface SlurmJobsResponse {
    active_jobs: SlurmJob[];
    completed_jobs: SlurmJob[];
}

export interface SlurmJobSubmitRequest {
    script: string;
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
}

export interface SlurmJobSubmitResponse {
    success: boolean;
    job_id?: string;
    message?: string;
    error?: string;
}

export interface SlurmJobLogs {
    job_info: Record<string, string>;
    stdout: string;
    stderr: string;
}

export interface SlurmJobData {
    job_id: string;
    work_dir: string;
    data_files: string[];
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

export interface SlurmScriptGenerationRequest {
    profile: string;
    script?: string;
    job_name?: string;
}

export interface SlurmScriptGenerationResponse {
    script: string;
    profile: string;
    sbatch_args: string[];
    parsed_args: {
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

export interface SlurmJobSubmitWithArgsRequest {
    script: string;
    job_name?: string;
    sbatch_args: string[];
}
