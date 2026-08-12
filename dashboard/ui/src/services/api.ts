import axios, { AxiosError } from 'axios';
import type { Execution, Pack, Metric, Summary, ApiError, Weight, SlurmJob, SlurmJobSubmitResponse, SlurmJobLogResponse, SlurmJobAccounting, SlurmClusterInfo, SlurmProfile, SlurmClusterStatus, PersitedJobInfo, PushZipResponse, PushFolderResponse, SlurmJobStatusResponse, EarlySyncResponse, MetalHost, MetalJobSubmitResponse } from './types';
import { meltPivotRows } from '../utils/pivotToChartData';
import {
    parsePivotFieldsFromSearchParams,
    pivotApiSearchParams,
    pivotMeltApiSearchParams,
} from '../utils/pivotUrlParams';




export interface ProfileCopyRequest {
    sourceProfile: string;
    newProfile: string;
}

export interface ExploreFilters {
    field: string;
    operator: string;
    value: any;
}

export const api = axios.create({
    baseURL: '/api',
    timeout: 10000,
});

const handleError = (error: unknown): never => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const data = axiosError.response?.data as any;
        throw {
            message: data?.error || data?.message || axiosError.message,
            status: axiosError.response?.status || 500,
        } as ApiError;
    }
    throw {
        message: 'An unexpected error occurred',
        status: 500,
    } as ApiError;
};

export const getHealth = async (): Promise<{ status: string; version?: { dashboard: string; milabench: string } }> => {
    const response = await api.get('/status', { timeout: 5000 });
    return response.data;
};

export const getMetalHosts = async (): Promise<MetalHost[]> => {
    try {
        const response = await api.get('/metal/list');
        const data: Record<string, MetalHost> = response.data || {};
        return Object.entries(data).map(([name, info]) => ({
            ...info,
            name,
        }));
    } catch (error) {
        return handleError(error);
    }
};

export const registerMetalHost = async (request: {
    address: string;
    port: number;
    name?: string;
}): Promise<{ status: string; error?: string }> => {
    try {
        const { address, port, name } = request;
        const path = name
            ? `/metal/register/${address}/${port}/${encodeURIComponent(name)}`
            : `/metal/register/${address}/${port}`;
        const response = await api.post(path);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getMetalJobs = async (hostName: string): Promise<SlurmJob[]> => {
    try {
        const response = await api.get(`/metal/${encodeURIComponent(hostName)}/jobs/list`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const submitMetalJob = async (hostName: string, request: {
    script: string;
    job_name?: string;
    working_dir?: string;
    env?: Record<string, string>;
}): Promise<MetalJobSubmitResponse> => {
    try {
        const response = await api.post(`/metal/${encodeURIComponent(hostName)}/jobs/submit`, request);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getExecutions = async (): Promise<Execution[]> => {
    try {
        const response = await api.get('/exec/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getExecution = async (id: number): Promise<Execution> => {
    try {
        const response = await api.get(`/exec/${id}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSharedExecution = async (shareToken: string): Promise<Execution> => {
    try {
        const response = await api.get(`/share/${shareToken}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSharedPacks = async (shareToken: string): Promise<Pack[]> => {
    try {
        const response = await api.get(`/share/${shareToken}/packs`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getPacks = async (execId: number): Promise<Pack[]> => {
    try {
        const response = await api.get(`/exec/${execId}/packs`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getPackMetrics = async (execId: number, packId: number): Promise<Metric[]> => {
    try {
        const response = await api.get(`/exec/${execId}/packs/${packId}/metrics`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSummary = async (runame: string): Promise<Summary> => {
    try {
        const response = await api.get(`/summary/${runame}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getGpuList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/gpu/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface GpuSummary {
    gpu: string;
    cpu_arch: string;
    exec_id: number;
    latest_date: string;
    run_name: string;
    pytorch: string | null;
    arch: string | null;
    accel_version: string | null;
    milabench_tag: string | null;
    milabench_commit: string | null;
    contributor: string | null;
    gpu_count: number;
    gpu_memory: number | null;
    total: number;
    passed: number;
    pass_rate: number;
}

export const getGpuSummary = async (): Promise<GpuSummary[]> => {
    try {
        const response = await api.get('/gpu/summary');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface BreakdownWorkload {
    pack: string;
    group1: string | null;
    group2: string | null;
    group3: string | null;
    group4: string | null;
    weight: number;
    enabled: boolean;
    priority: number;
}

export interface BreakdownGpuScore {
    gpu: string;
    exec_id: number;
    run_name: string | null;
    latest_date: string | null;
    score: number;
    bench_count: number;
    pytorch: string | null;
    accel_version: string | null;
}

export const getBreakdownWorkloads = async (): Promise<BreakdownWorkload[]> => {
    try {
        const response = await api.get('/breakdown/workloads');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getBreakdownScores = async (
    benches: string[],
    perfAgg: string = 'median',
): Promise<BreakdownGpuScore[]> => {
    try {
        const response = await api.get('/gpu/scores', {
            params: {
                benches: benches.join(','),
                perf_agg: perfAgg,
            },
            timeout: 120000,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface BreakdownMatrixGpu {
    key: string;
    gpu: string;
    exec_id: number;
    total_score: number;
}

export interface BreakdownMatrixBench {
    bench: string;
    weight: number;
    scores: Record<string, number>;
}

export interface BreakdownMatrix {
    gpus: BreakdownMatrixGpu[];
    benches: BreakdownMatrixBench[];
}

export const getBreakdownMatrix = async (
    benches: string[],
    perfAgg: string = 'median',
): Promise<BreakdownMatrix> => {
    try {
        const response = await api.get('/breakdown/matrix', {
            params: {
                benches: benches.join(','),
                perf_agg: perfAgg,
            },
            timeout: 120000,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface ReportScore {
    exec_id: number;
    score: number;
    bench_count: number;
}

export const getReportScore = async (
    execIds: string | number | Array<string | number>,
    benches: string[],
): Promise<ReportScore | ReportScore[]> => {
    const exec_ids = (Array.isArray(execIds) ? execIds : [execIds])
        .map(String)
        .join(',');
    try {
        const response = await api.get('/report/score', {
            params: { exec_ids, benches: benches.join(',') },
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

/** Latest exec_id per distinct GPU — comma-separated for pivot `in` filters. */
export const fetchLatestDistinctGPURunIds = async (): Promise<string> => {
    const summary = await getGpuSummary();
    return summary.map((row) => String(row.exec_id)).join(',');
};

export const getMetricsList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/metrics/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getPytorchList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/pytorch/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getMilabenchList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/milabench/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getPackMetricsPlot = async (execId: number, packId: number): Promise<string> => {
    try {
        const response = await axios.get(`/html/exec/${execId}/packs/${packId}/metrics`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getProfileList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/profile/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getProfileDetails = async (profile: string): Promise<Weight[]> => {
    try {
        const response = await api.get(`/profile/show/${profile}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const saveProfile = async (profile: string, weights: Weight[]): Promise<{ status: string }> => {
    try {
        const response = await api.post(`/profile/save/${profile}`, weights);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const copyProfile = async (request: ProfileCopyRequest): Promise<{ status: string }> => {
    try {
        const response = await api.post('/profile/copy', request);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSavedQueries = async (): Promise<string[]> => {
    try {
        const response = await api.get('/query/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getAllSavedQueries = async (): Promise<any[]> => {
    try {
        const response = await api.get('/query/all');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSavedQuery = async (name: string): Promise<any> => {
    try {
        const response = await api.get(`/query/${name}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const deleteSavedQuery = async (name: string): Promise<{ status: string }> => {
    try {
        const response = await api.delete(`/query/delete/${name}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const saveQuery = async (name: string, query: any): Promise<{ status: string }> => {
    try {
        const response = await api.post('/query/save', { name, query });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const exploreExecutions = async (filters?: ExploreFilters[]): Promise<any[]> => {
    try {
        const params = filters ? { filters: btoa(JSON.stringify(filters)) } : {};
        const response = await api.get('/exec/explore', { params });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

/** Authoritative pivot limit (matches server statement_timeout). Shown in the UI. */
export const PIVOT_TIMEOUT_MS = 30000;
/** Client wait slightly longer so a server 408 can be received before axios aborts. */
const PIVOT_CLIENT_TIMEOUT_MS = PIVOT_TIMEOUT_MS + 5000;

export function normalizePivotResponse(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data)) {
        return data as Record<string, unknown>[];
    }
    if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if (typeof obj.error === 'string') {
            throw {
                message: obj.error,
                status: 408,
            } as ApiError;
        }
        // Server returns `{}` when no filters are provided.
        if (Object.keys(obj).length === 0) {
            return [];
        }
    }
    return [];
}

export const getPivot = async (params: URLSearchParams): Promise<Record<string, unknown>[]> => {
    const apiParams = pivotApiSearchParams(params);
    const query = apiParams.toString();
    const paths = query ? [`/pivot/table?${query}`, `/pivot?${query}`] : ['/pivot/table', '/pivot'];

    try {
        let lastError: unknown;
        for (const path of paths) {
            try {
                const response = await api.get(path, {
                    timeout: PIVOT_CLIENT_TIMEOUT_MS,
                });
                return normalizePivotResponse(response.data);
            } catch (error) {
                lastError = error;
                if (axios.isAxiosError(error) && error.response?.status === 404) {
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const data = error.response?.data as { error?: string } | undefined;
            if (error.response?.status === 408 || data?.error) {
                throw {
                    message: data?.error || `Pivot query timed out after ${PIVOT_TIMEOUT_MS / 1000}s`,
                    status: error.response?.status || 408,
                } as ApiError;
            }
            if (error.code === 'ECONNABORTED') {
                throw {
                    message: `Pivot query timed out after ${PIVOT_TIMEOUT_MS / 1000}s`,
                    status: 408,
                } as ApiError;
            }
        }
        return handleError(error);
    }
};

export type PivotMeltRows = Record<string, unknown>[];

export interface PivotSpecResponse {
    spec: Record<string, unknown>;
    dataUrl: string;
    plot: Record<string, unknown>;
}

function normalizePivotMeltResponse(data: unknown): PivotMeltRows {
    if (Array.isArray(data)) {
        return data as PivotMeltRows;
    }
    if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
        return (data as { rows: PivotMeltRows }).rows;
    }
    return [];
}

export const getPivotMelt = async (params: URLSearchParams): Promise<PivotMeltRows> => {
    const apiParams = pivotMeltApiSearchParams(params);
    try {
        const response = await api.get(`/pivot/melt?${apiParams.toString()}`, {
            timeout: PIVOT_CLIENT_TIMEOUT_MS,
        });
        return normalizePivotMeltResponse(response.data);
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            const tableParams = pivotApiSearchParams(params);
            const rows = await getPivot(tableParams);
            return meltPivotRows(rows, parsePivotFieldsFromSearchParams(params) ?? []);
        }
        if (axios.isAxiosError(error)) {
            const data = error.response?.data as { error?: string } | undefined;
            if (error.response?.status === 408 || data?.error) {
                throw {
                    message: data?.error || `Pivot query timed out after ${PIVOT_TIMEOUT_MS / 1000}s`,
                    status: error.response?.status || 408,
                } as ApiError;
            }
        }
        return handleError(error);
    }
};

export const getPivotSpec = async (params: URLSearchParams): Promise<PivotSpecResponse> => {
    const apiParams = pivotMeltApiSearchParams(params);
    try {
        const response = await api.get(`/pivot/spec?${apiParams.toString()}`, {
            timeout: PIVOT_CLIENT_TIMEOUT_MS,
        });
        return response.data as PivotSpecResponse;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const data = error.response?.data as { error?: string } | undefined;
            throw {
                message: data?.error || 'Failed to build pivot plot spec',
                status: error.response?.status || 500,
            } as ApiError;
        }
        return handleError(error);
    }
};

// Slurm-related API functions
export const getSlurmJobs = async (): Promise<SlurmJob[]> => {
    try {
        const response = await api.get('/slurm/jobs');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmPersistedJobs = async (): Promise<PersitedJobInfo[]> => {
    try {
        const response = await api.get('/slurm/jobs/persited');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmClusterStatus = async (): Promise<SlurmClusterStatus> => {
    try {
        const response = await api.get('/slurm/status');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};


export const cancelSlurmJob = async (jobId: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
        const response = await api.post(`/slurm/cancel/${jobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobInfo = async (jrJobId: string, jobId?: string): Promise<any> => {
    try {
        const url = jobId
            ? `/slurm/jobs/${jrJobId}/info/${jobId}`
            : `/slurm/jobs/${jrJobId}/info`;
        const response = await api.get(url);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStdout = async (jrJobId: string): Promise<string> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/stdout/tail`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStderr = async (jrJobId: string): Promise<string> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/stderr/tail`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStdoutSize = async (jrJobId: string): Promise<number> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/stdout/size`);
        const size = typeof response.data === 'object' && response.data.size !== undefined
            ? response.data.size
            : typeof response.data === 'number'
                ? response.data
                : parseInt(response.data, 10);
        if (isNaN(size)) {
            throw new Error('Invalid size response from server');
        }
        return size;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStderrSize = async (jrJobId: string): Promise<number> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/stderr/size`);
        const size = typeof response.data === 'object' && response.data.size !== undefined
            ? response.data.size
            : typeof response.data === 'number'
                ? response.data
                : parseInt(response.data, 10);
        if (isNaN(size)) {
            throw new Error('Invalid size response from server');
        }
        return size;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStdoutFull = async (jrJobId: string, start?: number, end?: number): Promise<string> => {
    try {
        let url = `/slurm/jobs/${jrJobId}/stdout`;
        if (start !== undefined && end !== undefined) {
            url += `/${start}/${end}`;
        }
        const response = await api.get<SlurmJobLogResponse>(url);

        // Handle new JSON response format
        if (typeof response.data === 'object' && 'data' in response.data) {
            return response.data.data;
        }

        // Fallback for old string response format
        return response.data as unknown as string;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStderrFull = async (jrJobId: string, start?: number, end?: number): Promise<string> => {
    try {
        let url = `/slurm/jobs/${jrJobId}/stderr`;
        if (start !== undefined && end !== undefined) {
            url += `/${start}/${end}`;
        }
        const response = await api.get<SlurmJobLogResponse>(url);

        // Handle new JSON response format
        if (typeof response.data === 'object' && 'data' in response.data) {
            return response.data.data;
        }

        // Fallback for old string response format
        return response.data as unknown as string;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStatus = async (jobId: string): Promise<SlurmJob> => {
    try {
        const response = await api.get(`/slurm/jobs/${jobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobAccounting = async (jrJobId: string, jobId: string): Promise<SlurmJobAccounting> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/acc/${jobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmClusterInfo = async (): Promise<SlurmClusterInfo> => {
    try {
        const response = await api.get('/slurm/cluster');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};



export const getSlurmTemplates = async (): Promise<string[]> => {
    try {
        const response = await api.get('/slurm/templates');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmTemplateContent = async (templateName: string): Promise<string> => {
    try {
        const response = await api.get(`/slurm/templates/${templateName}`);
        return response.data.content;
    } catch (error) {
        return handleError(error);
    }
};

export const saveSlurmTemplate = async (request: {
    name: string;
    content: string;
}): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
        const response = await api.post('/slurm/save-template', request);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmProfiles = async (): Promise<SlurmProfile[]> => {
    try {
        const response = await api.get('/slurm/profiles');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface SlurmCluster {
    name: string;
    ssh: string;
}

export const getSlurmClusters = async (): Promise<SlurmCluster[]> => {
    try {
        const response = await api.get('/slurm/clusters');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};



export const saveSlurmProfile = async (request: {
    name: string;
    description?: string;
    cluster?: string;
    sbatch_args: string[];
}): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
        const response = await api.post('/slurm/save-profile', request);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const submitSlurmJob = async (request: {
    script: string;
    job_name?: string;
    cluster?: string;
    sbatch_args?: string[];
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
    dependency?: [string, string][];
}): Promise<SlurmJobSubmitResponse> => {
    try {
        const response = await api.post('/slurm/submit', request);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobScript = async (jrJobId: string): Promise<{
    script: string;
    sbatch_args: string[];
    job_name: string;
    error?: string;
}> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/script`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const rerunSlurmJob = async (jrJobId: string): Promise<SlurmJobSubmitResponse> => {
    try {
        const response = await api.get(`/slurm/rerun/${jrJobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const saveSlurmJob = async (jrJobId: string, message: string): Promise<{ success?: boolean; error?: string }> => {
    try {
        const response = await api.get(`/slurm/job/save/${jrJobId}/${encodeURIComponent(message)}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

// Secrets-related API functions
export const testSlurmSecret = async (name: string): Promise<{ name: string; masked: string } | null> => {
    try {
        const response = await api.get(`/slurm/secrets/test/${name}`);
        return response.data;
    } catch {
        return null;
    }
};

export const listSlurmSecrets = async (): Promise<string[]> => {
    try {
        const response = await api.get('/slurm/secrets/list');
        return response.data;
    } catch {
        return [];
    }
};

// Push-related API functions
export const requestPushKey = async (
    name: string,
    metadata?: Record<string, unknown>,
): Promise<{
    status: string;
    name?: string;
    key?: string;
    metadata?: Record<string, unknown>;
    message: string;
}> => {
    try {
        const payload: { name: string; metadata?: Record<string, unknown> } = { name };
        if (metadata && Object.keys(metadata).length > 0) {
            payload.metadata = metadata;
        }
        const response = await api.post('/push/key/request', payload);
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data) {
            return error.response.data;
        }
        return handleError(error);
    }
};

export const listPushKeys = async (): Promise<{ name: string; metadata?: Record<string, unknown> }[]> => {
    try {
        const response = await api.get('/push/key/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface PushStreamEvent {
    event: string;
    data: Record<string, any>;
}

export const pushZipStream = async (
    file: File,
    pushKey?: string,
    metadata?: Record<string, unknown>,
    onEvent?: (event: PushStreamEvent) => void,
): Promise<PushZipResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (pushKey) formData.append('key', pushKey);
    if (metadata && Object.keys(metadata).length > 0) {
        formData.append('metadata', JSON.stringify(metadata));
    }

    // Axios buffers the whole body in browsers, so streaming needs fetch.
    const baseURL = api.defaults.baseURL || '/api';
    const response = await fetch(`${baseURL}/push/zip/stream`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({
            message: `Upload failed with status ${response.status}`,
        }));
        return { status: 'ERR', message: error.message || error.error };
    }
    if (!response.body) {
        return { status: 'ERR', message: 'Streaming is not supported by this browser' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: PushZipResponse = {
        status: 'ERR',
        message: 'Upload stream ended before completion',
    };

    const processBlock = (block: string) => {
        let event = 'message';
        const dataLines: string[] = [];

        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) return;

        const data = JSON.parse(dataLines.join('\n'));
        onEvent?.({ event, data });

        if (event === 'done') result = data as PushZipResponse;
        if (event === 'error') {
            result = {
                status: 'ERR',
                message: data.message || 'Upload failed',
            };
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        blocks.forEach(processBlock);

        if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);

    return result;
};

/** @deprecated Use pushZipStream to receive upload progress. */
export const pushZipFile = pushZipStream;

export const pushJobFolder = async (jrJobId: string): Promise<PushFolderResponse> => {
    try {
        const response = await api.get(`/push/folder/${jrJobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

// Pipeline template file management (matching server endpoints)
export const getPipelineTemplatesList = async (): Promise<string[]> => {
    try {
        const response = await api.get('/slurm/pipeline/template/list');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const savePipelineToFile = async (pipelineData: any): Promise<{ success?: boolean; error?: string }> => {
    try {
        const response = await api.post('/slurm/pipeline/template/save', pipelineData);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const loadPipelineFromFile = async (name: string): Promise<any> => {
    try {
        const response = await api.get(`/slurm/pipeline/template/load/${name}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getSlurmJobStatusSimple = async (jrJobId: string, jobId: string): Promise<SlurmJobStatusResponse> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/status/${jobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const earlySyncJob = async (jrJobId: string, jobId: string): Promise<EarlySyncResponse> => {
    try {
        const response = await api.get(`/slurm/jobs/${jrJobId}/earlysync/${jobId}`);
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

// Datafile-related API functions
export interface DatafileLogEntry {
    text: string;
    [key: string]: any;
}

export interface DatafileMetricsPreview {
    full_length: number;
    metrics: any[];
}

export const getDatafileBenchmarks = async (): Promise<string[]> => {
    try {
        const response = await api.get('/datafile/list/benchmark', {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileConfig = async (bench: string): Promise<any> => {
    try {
        const response = await api.get(`/datafile/config/${bench}`, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileMeta = async (bench: string): Promise<any> => {
    try {
        const response = await api.get(`/datafile/meta/${bench}`, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileStdout = async (bench: string): Promise<DatafileLogEntry[]> => {
    try {
        const response = await api.get(`/datafile/stdout/${bench}`, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileStderr = async (bench: string): Promise<DatafileLogEntry[]> => {
    try {
        const response = await api.get(`/datafile/stderr/${bench}`, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileMetricsPreview = async (bench: string): Promise<DatafileMetricsPreview> => {
    try {
        const response = await api.get(`/datafile/metrics/preview/${bench}`, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface DatafileFields {
    [fieldName: string]: any[];
}

export const getDatafileFields = async (): Promise<DatafileFields> => {
    try {
        const response = await api.get('/datafile/select/fields', {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export interface SelectedFields {
    [fieldName: string]: string; // field name -> pattern
}

export const previewDatafileSelection = async (selectedFields: SelectedFields): Promise<any[]> => {
    try {
        const response = await api.post('/datafile/select/benchmark', selectedFields, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const getDatafileSelectedMetrics = async (selectedFields: SelectedFields): Promise<any[]> => {
    try {
        const response = await api.post('/datafile/select/metrics', selectedFields, {
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

// Database sync API functions
export const getSyncRemoteInfo = async (): Promise<{ default_url: string }> => {
    try {
        const response = await api.get('/sync/remote-info');
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

export const downloadLocalBackup = async (): Promise<Blob> => {
    const response = await api.get('/sync/local-backup', {
        responseType: 'blob',
        timeout: 600000,
    });
    return response.data;
};

export const backupRemoteDatabase = async (connInfo: {
    host: string;
    port: string;
    dbname: string;
    user: string;
    password: string;
    sslmode?: string;
}): Promise<Blob> => {
    const response = await api.post('/sync/backup', connInfo, {
        responseType: 'blob',
        timeout: 600000,
    });
    return response.data;
};

export const pushToRemote = async (connInfo: {
    host: string;
    port: string;
    dbname: string;
    user: string;
    password: string;
    sslmode?: string;
}): Promise<{ status: string; message: string }> => {
    try {
        const response = await api.post('/sync/push-to-remote', connInfo, {
            timeout: 600000,
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data) {
            return error.response.data;
        }
        return handleError(error);
    }
};

// ── Scheduled Slurm Jobs ────────────────────────────────────────────

import type { ScheduledJob, ScheduledJobRun } from './types';

export const getScheduledJobs = async (): Promise<ScheduledJob[]> => {
    try {
        const response = await api.get('/slurm/scheduled/list');
        return response.data;
    } catch (error) { return handleError(error); }
};

export const createScheduledJob = async (data: Partial<ScheduledJob>): Promise<ScheduledJob> => {
    try {
        const response = await api.post('/slurm/scheduled/create', data);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const updateScheduledJob = async (id: number, data: Partial<ScheduledJob>): Promise<ScheduledJob> => {
    try {
        const response = await api.put(`/slurm/scheduled/${id}`, data);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const deleteScheduledJob = async (id: number): Promise<{ status: string }> => {
    try {
        const response = await api.delete(`/slurm/scheduled/${id}`);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const toggleScheduledJob = async (id: number): Promise<ScheduledJob> => {
    try {
        const response = await api.post(`/slurm/scheduled/${id}/toggle`);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const runScheduledJobNow = async (id: number): Promise<ScheduledJobRun> => {
    try {
        const response = await api.post(`/slurm/scheduled/${id}/run-now`);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const getScheduledJobRuns = async (id: number): Promise<ScheduledJobRun[]> => {
    try {
        const response = await api.get(`/slurm/scheduled/${id}/runs`);
        return response.data;
    } catch (error) { return handleError(error); }
};

export const restoreBackup = async (file: File): Promise<{ status: string; message: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await api.post('/sync/restore', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 600000,
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data) {
            if (error.response.data instanceof Blob) {
                const text = await error.response.data.text();
                try { return JSON.parse(text); } catch { return { status: 'ERR', message: text }; }
            }
            return error.response.data;
        }
        return handleError(error);
    }
};