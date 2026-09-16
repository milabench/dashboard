import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useHealth } from './HealthContext';
import { clearPreviewToken, readPreviewToken, storePreviewToken, verifyPreviewToken } from '../services/previewAuth';

export type ViewMode = 'public' | 'dev' | 'admin' | 'preview';
export type DbTarget = 'dev' | 'prod';

const STORAGE_KEY = 'milabench.viewMode';

interface ViewModeContextValue {
    mode: ViewMode;
    setMode: (mode: ViewMode) => void;
    devMode: boolean;
    dbTarget: DbTarget;
    setDbTarget: (target: DbTarget) => void;
    previewAvailable: boolean;
    previewUnlocked: boolean;
    unlockPreview: (token: string) => Promise<void>;
    lockPreview: () => void;
}

const ViewModeContext = createContext<ViewModeContextValue>({
    mode: 'public',
    setMode: () => {},
    devMode: false,
    dbTarget: 'dev',
    setDbTarget: () => {},
    previewAvailable: false,
    previewUnlocked: false,
    unlockPreview: async () => {},
    lockPreview: () => {},
});

export const useViewMode = () => useContext(ViewModeContext);
export const usePreview = () => {
    const ctx = useContext(ViewModeContext);
    return {
        previewAvailable: ctx.previewAvailable,
        previewUnlocked: ctx.previewUnlocked,
        unlockPreview: ctx.unlockPreview,
        lockPreview: ctx.lockPreview,
    };
};

function readStoredMode(): ViewMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'public' || stored === 'dev' || stored === 'admin' || stored === 'preview') {
            return stored;
        }
    } catch {
        // localStorage unavailable — fall through to default
    }
    return 'public';
}

export const ViewModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { devMode, previewAvailable } = useHealth();
    const [mode, setModeState] = useState<ViewMode>('public');
    const [previewUnlocked, setPreviewUnlocked] = useState(false);
    const [dbTarget, setDbTargetState] = useState<DbTarget>('dev');

    useEffect(() => {
        setPreviewUnlocked(!!readPreviewToken());
    }, []);

    useEffect(() => {
        if (devMode) {
            setModeState(readStoredMode());
            return;
        }
        if (previewUnlocked && previewAvailable) {
            setModeState('preview');
            return;
        }
        setModeState('public');
    }, [devMode, previewUnlocked, previewAvailable]);

    useEffect(() => {
        if (mode !== 'admin') {
            setDbTargetState('dev');
        }
    }, [mode]);

    const setMode = useCallback((next: ViewMode) => {
        if (devMode) {
            if (next === 'preview') return;
            setModeState(next);
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                // best-effort persistence only
            }
            return;
        }
        if (next === 'preview' && previewUnlocked && previewAvailable) {
            setModeState('preview');
        } else if (next === 'public') {
            setModeState('public');
        }
    }, [devMode, previewUnlocked, previewAvailable]);

    const unlockPreview = useCallback(async (token: string) => {
        await verifyPreviewToken(token);
        storePreviewToken(token);
        setPreviewUnlocked(true);
        if (!devMode) {
            setModeState('preview');
        }
    }, [devMode]);

    const lockPreview = useCallback(() => {
        clearPreviewToken();
        setPreviewUnlocked(false);
        if (!devMode) {
            setModeState('public');
        }
    }, [devMode]);

    const setDbTarget = useCallback((target: DbTarget) => {
        setDbTargetState(target);
    }, []);

    return (
        <ViewModeContext.Provider value={{
            mode,
            setMode,
            devMode,
            dbTarget,
            setDbTarget,
            previewAvailable,
            previewUnlocked,
            unlockPreview,
            lockPreview,
        }}>
            {children}
        </ViewModeContext.Provider>
    );
};
