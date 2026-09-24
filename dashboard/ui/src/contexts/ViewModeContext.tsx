import React, { useState, useEffect, useCallback } from 'react';
import { useHealth } from '../hooks/useHealth';
import { ViewModeContext, type ViewMode, type DbTarget } from '../hooks/useViewMode';
import { clearPreviewToken, readPreviewToken, storePreviewToken, verifyPreviewToken } from '../services/previewAuth';

const STORAGE_KEY = 'milabench.viewMode';

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
    const [previewUnlocked, setPreviewUnlocked] = useState<boolean>(() => !!readPreviewToken());
    const [dbTarget, setDbTargetState] = useState<DbTarget>('dev');

    useEffect(() => {
        if (devMode) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- devMode/previewAvailable are sourced from an async health poll (useHealth), so this reacts to that async result rather than deriving purely from render-time values.
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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- resets dbTarget to 'dev' whenever mode leaves admin; dbTarget is independently owned by setDbTarget while in admin mode, so it can't be reduced to a pure derivation.
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
