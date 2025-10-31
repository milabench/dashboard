import axios, { AxiosError } from 'axios';
import type { Execution, Pack, Metric, Summary, ApiError, Weight, SlurmJobsResponse, SlurmJob, SlurmJobSubmitRequest, SlurmJobSubmitResponse, SlurmJobLogs, SlurmJobLogResponse, SlurmJobData, SlurmJobAccounting, SlurmClusterInfo, SlurmTemplate, SlurmProfile, SlurmClusterStatus, PersitedJobInfo, PushZipResponse, PushFolderResponse, SlurmJobStatusResponse, EarlySyncResponse } from './types';




export interface ProfileCopyRequest {
    sourceProfile: string;
    newProfile: string;
}

export interface ExploreFilters {
    field: string;
    operator: string;
    value: any;
}

const api = axios.create({
    baseURL: '/api',
    timeout: 10000,
});

const handleError = (error: unknown): never => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        throw {
            message: (axiosError.response?.data as any)?.message || axiosError.message,
            status: axiosError.response?.status || 500,
        } as ApiError;
    }
    throw {
        message: 'An unexpected error occurred',
        status: 500,
    } as ApiError;
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



export const saveSlurmProfile = async (request: {
    name: string;
    description?: string;
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

// Push-related API functions
export const pushZipFile = async (file: File): Promise<PushZipResponse> => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await axios.post('/push/zip', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            timeout: 30000, // 30 seconds for file upload
        });
        return response.data;
    } catch (error) {
        return handleError(error);
    }
};

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