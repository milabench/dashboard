import React, { createContext, useContext, useState, useEffect } from 'react';

type EmbedFn = (
    el: HTMLElement,
    spec: Record<string, any>,
    opts?: Record<string, any>,
) => Promise<any>;

interface VegaContextValue {
    embed: EmbedFn | null;
    isLoaded: boolean;
    error: string | null;
}

const VegaContext = createContext<VegaContextValue>({
    embed: null,
    isLoaded: false,
    error: null,
});

export const useVega = () => useContext(VegaContext);

export const VegaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [embed, setEmbed] = useState<EmbedFn | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const vegaEmbed = await import('vega-embed');
                if (!cancelled) {
                    setEmbed(() => vegaEmbed.default);
                    setIsLoaded(true);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err.message ?? 'Failed to load vega-embed');
                }
            }
        })();

        return () => { cancelled = true; };
    }, []);

    return (
        <VegaContext.Provider value={{ embed, isLoaded, error }}>
            {children}
        </VegaContext.Provider>
    );
};
