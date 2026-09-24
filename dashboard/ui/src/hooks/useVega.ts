import { createContext, useContext } from 'react';
import type { VisualizationSpec, EmbedOptions, Result } from 'vega-embed';

export type EmbedFn = (
    el: HTMLElement,
    spec: VisualizationSpec,
    opts?: EmbedOptions,
) => Promise<Result>;

export interface VegaContextValue {
    embed: EmbedFn | null;
    isLoaded: boolean;
    error: string | null;
}

export const VegaContext = createContext<VegaContextValue>({
    embed: null,
    isLoaded: false,
    error: null,
});

export const useVega = () => useContext(VegaContext);
