import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useHealth } from './HealthContext';

export type ViewMode = 'public' | 'dev' | 'admin';
export type DbTarget = 'dev' | 'prod';

const STORAGE_KEY = 'milabench.viewMode';

interface ViewModeContextValue {
    mode: ViewMode;
    setMode: (mode: ViewMode) => void;
    devMode: boolean;
    dbTarget: DbTarget;
    setDbTarget: (target: DbTarget) => void;
}

const ViewModeContext = createContext<ViewModeContextValue>({
    mode: 'public',
    setMode: () => {},
    devMode: false,
    dbTarget: 'dev',
    setDbTarget: () => {},
});

export const useViewMode = () => useContext(ViewModeContext);

function readStoredMode(): ViewMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'public' || stored === 'dev' || stored === 'admin') {
            return stored;
        }
    } catch {
        // localStorage unavailable — fall through to default
    }
    return 'public';
}

export const ViewModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { devMode } = useHealth();
    const [mode, setModeState] = useState<ViewMode>('public');
    // Deliberately NOT persisted (no localStorage): every fresh load or
    // mode switch away from admin resets to 'dev' so a browser tab never
    // silently stays pointed at prod across a reload.
    const [dbTarget, setDbTargetState] = useState<DbTarget>('dev');

    useEffect(() => {
        if (devMode) {
            setModeState(readStoredMode());
        } else {
            setModeState('public');
        }
    }, [devMode]);

    useEffect(() => {
        if (mode !== 'admin') {
            setDbTargetState('dev');
        }
    }, [mode]);

    const setMode = useCallback((next: ViewMode) => {
        if (!devMode) return;
        setModeState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // best-effort persistence only
        }
    }, [devMode]);

    const setDbTarget = useCallback((target: DbTarget) => {
        setDbTargetState(target);
    }, []);

    return (
        <ViewModeContext.Provider value={{ mode, setMode, devMode, dbTarget, setDbTarget }}>
            {children}
        </ViewModeContext.Provider>
    );
};
