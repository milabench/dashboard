import { createContext, useContext } from 'react';

export type ViewMode = 'public' | 'dev' | 'admin' | 'preview';
export type DbTarget = 'dev' | 'prod';

export interface ViewModeContextValue {
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

export const ViewModeContext = createContext<ViewModeContextValue>({
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
