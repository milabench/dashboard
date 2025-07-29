import axios, { AxiosError } from 'axios';
import type { Execution, Pack, Metric, Summary, ApiError, Weight } from './types';


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