import { createContext, useContext } from 'react';

interface VersionInfo {
    dashboard: string;
    milabench: string;
}

export interface HealthContextValue {
    isBackendOnline: boolean;
    lastChecked: Date | null;
    version: VersionInfo | null;
    devMode: boolean;
    previewAvailable: boolean;
}

export const HealthContext = createContext<HealthContextValue>({
    isBackendOnline: true,
    lastChecked: null,
    version: null,
    devMode: false,
    previewAvailable: false,
});

export const useHealth = () => useContext(HealthContext);
