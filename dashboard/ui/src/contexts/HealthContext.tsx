import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { getHealth } from '../services/api';

interface VersionInfo {
    dashboard: string;
    milabench: string;
}

interface HealthContextValue {
    isBackendOnline: boolean;
    lastChecked: Date | null;
    version: VersionInfo | null;
    devMode: boolean;
}

const HealthContext = createContext<HealthContextValue>({
    isBackendOnline: true,
    lastChecked: null,
    version: null,
    devMode: false,
});

export const useHealth = () => useContext(HealthContext);

const POLL_INTERVAL_MS = 30_000;

export const HealthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isBackendOnline, setIsBackendOnline] = useState(true);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const [version, setVersion] = useState<VersionInfo | null>(null);
    const [devMode, setDevMode] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const checkHealth = useCallback(async () => {
        try {
            const data = await getHealth();
            setIsBackendOnline(true);
            if (data?.version) {
                setVersion(data.version);
            }
            setDevMode(!!data?.dev_mode);
        } catch {
            setIsBackendOnline(false);
            setDevMode(false);
        }
        setLastChecked(new Date());
    }, []);

    useEffect(() => {
        checkHealth();
        timerRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [checkHealth]);

    return (
        <HealthContext.Provider value={{ isBackendOnline, lastChecked, version, devMode }}>
            {children}
        </HealthContext.Provider>
    );
};
