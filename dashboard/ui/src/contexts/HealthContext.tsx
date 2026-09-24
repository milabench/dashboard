import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getHealth } from '../services/api';
import { HealthContext } from '../hooks/useHealth';

const POLL_INTERVAL_MS = 30_000;

export const HealthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isBackendOnline, setIsBackendOnline] = useState(true);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const [version, setVersion] = useState<{ dashboard: string; milabench: string } | null>(null);
    const [devMode, setDevMode] = useState(false);
    const [previewAvailable, setPreviewAvailable] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const checkHealth = useCallback(async () => {
        try {
            const data = await getHealth();
            setIsBackendOnline(true);
            if (data?.version) {
                setVersion(data.version);
            }
            setDevMode(!!data?.dev_mode);
            setPreviewAvailable(!!data?.preview_available);
        } catch {
            setIsBackendOnline(false);
            setDevMode(false);
            setPreviewAvailable(false);
        }
        setLastChecked(new Date());
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async health-check request and a polling timer; not a pure derivation.
        checkHealth();
        timerRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [checkHealth]);

    return (
        <HealthContext.Provider value={{ isBackendOnline, lastChecked, version, devMode, previewAvailable }}>
            {children}
        </HealthContext.Provider>
    );
};
