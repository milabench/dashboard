import { api } from './api';

const PREVIEW_TOKEN_KEY = 'milabench.previewToken';

export function readPreviewToken(): string | null {
    try {
        return sessionStorage.getItem(PREVIEW_TOKEN_KEY);
    } catch {
        return null;
    }
}

export function storePreviewToken(token: string): void {
    sessionStorage.setItem(PREVIEW_TOKEN_KEY, token);
}

export function clearPreviewToken(): void {
    sessionStorage.removeItem(PREVIEW_TOKEN_KEY);
}

export async function verifyPreviewToken(token: string): Promise<void> {
    await api.post('/preview/verify', { token });
}

export function installPreviewAuthInterceptor(): void {
    api.interceptors.request.use((config) => {
        const token = readPreviewToken();
        if (token) {
            config.headers = config.headers ?? {};
            config.headers['X-Preview-Token'] = token;
        }
        return config;
    });
}
