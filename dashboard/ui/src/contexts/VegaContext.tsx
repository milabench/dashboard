import React, { useState, useEffect } from 'react';
import { VegaContext, type EmbedFn } from '../hooks/useVega';

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
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load vega-embed');
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
