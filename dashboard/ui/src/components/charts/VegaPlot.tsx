import React, {
    useEffect,
    useRef,
    useState,
    useMemo,
    useImperativeHandle,
    forwardRef,
} from 'react';
import { Box, Text, Spinner } from '@chakra-ui/react';
import { useVega } from '../../contexts/VegaContext';
import { useColorMode } from '../ui/color-mode';
import { exportVegaViewPng } from '../../utils/download';

export type SpecBuilder = (width: number, height: number) => Record<string, any> | null;

export interface VegaPlotProps {
    spec: Record<string, any> | SpecBuilder;
    height?: string;
    configOverrides?: Record<string, any>;
    /** Plot container overflow (dynamic specs default to hidden). */
    overflow?: 'hidden' | 'visible' | 'auto';
}

export type VegaPlotHandle = {
    /** Export the current plot as a PNG download. */
    exportPng: (filename: string) => Promise<void>;
    /** True when a Vega view is ready for export. */
    isReady: () => boolean;
};

async function buildConfig(
    container: HTMLElement,
    colorMode: string,
    overrides: Record<string, any> = {},
) {
    let bt: Record<string, any> = {};
    if (colorMode === 'dark') {
        try {
            const themes = await import('vega-themes');
            bt = (themes as any).dark || {};
        } catch { /* ignore */ }
    }

    const font = getComputedStyle(container).fontFamily || 'sans-serif';

    const base: Record<string, any> = {
        ...bt,
        background: 'transparent',
        font,
        padding: { left: 5, top: 5, right: 5, bottom: 5 },
        title: { ...bt.title, font },
        axis: {
            ...bt.axis,
            labelFont: font,
            titleFont: font,
            labelPadding: 6,
            titlePadding: 12,
            labelOverlap: true,
            labelSeparation: 8,
        },
        legend: {
            ...bt.legend,
            orient: 'bottom',
            direction: 'horizontal',
            labelFont: font,
            titleFont: font,
            padding: 10,
            labelOffset: 4,
            symbolSize: 100,
            rowPadding: 4,
            columnPadding: 40,
        },
        header: { ...bt.header, labelFont: font, titleFont: font, labelPadding: 10 },
    };

    for (const [key, val] of Object.entries(overrides)) {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            base[key] = { ...base[key], ...val };
        } else {
            base[key] = val;
        }
    }

    return base;
}

const VegaPlot = forwardRef<VegaPlotHandle, VegaPlotProps>(function VegaPlot(
    { spec, height = '300px', configOverrides, overflow },
    ref,
) {
    const { embed, isLoaded, error: loadError } = useVega();
    const { colorMode } = useColorMode();
    const sizeRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<any>(null);
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const usesDynamicSpec = typeof spec === 'function';

    useImperativeHandle(ref, () => ({
        isReady: () => !!viewRef.current,
        exportPng: async (filename: string) => {
            if (!viewRef.current) {
                throw new Error('Plot is not ready to export');
            }
            await exportVegaViewPng(viewRef.current, filename);
        },
    }), []);

    useEffect(() => {
        if (!usesDynamicSpec) return;
        const el = sizeRef.current;
        if (!el) return;

        const measure = () => {
            const w = el.clientWidth;
            const h = el.clientHeight;
            if (w > 0 && h > 0) {
                setDims(prev => (prev && prev.w === w && prev.h === h) ? prev : { w, h });
            }
        };

        measure();

        let raf: number | null = null;
        const observer = new ResizeObserver(() => {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(measure);
        });
        observer.observe(el);

        return () => {
            if (raf) cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [usesDynamicSpec]);

    const resolvedSpec = useMemo(() => {
        if (usesDynamicSpec) {
            if (!dims) return null;
            return (spec as SpecBuilder)(dims.w, dims.h);
        }
        return spec as Record<string, any>;
    }, [spec, dims, usesDynamicSpec]);

    useEffect(() => {
        if (!isLoaded || !embed || !plotRef.current || !resolvedSpec) return;

        let cancelled = false;

        const render = async () => {
            const el = plotRef.current as HTMLElement;
            const config = await buildConfig(el, colorMode, configOverrides);
            setRenderError(null);

            try {
                const result = await embed(el, resolvedSpec, {
                    actions: false,
                    renderer: 'svg',
                    config,
                });
                if (!cancelled) {
                    viewRef.current = result?.view ?? null;
                }
            } catch (err: any) {
                console.error('Vega render error:', err);
                if (!cancelled) {
                    viewRef.current = null;
                    setRenderError(err?.message ?? 'Failed to render chart');
                }
            }
        };

        render();

        return () => {
            cancelled = true;
            viewRef.current = null;
        };
    }, [isLoaded, embed, resolvedSpec, colorMode, configOverrides]);

    if (loadError) {
        return (
            <Box p={4} bg="var(--color-btn-danger-subtle)" borderRadius="md">
                <Text color="var(--color-text-danger)" fontSize="sm">Failed to load chart library</Text>
            </Box>
        );
    }

    if (!isLoaded) {
        return (
            <Box p={4} minH={height} display="flex" alignItems="center" justifyContent="center">
                <Spinner size="sm" />
                <Text fontSize="sm" color="var(--color-text-muted)" ml={2}>Loading chart…</Text>
            </Box>
        );
    }

    if (usesDynamicSpec && !dims) {
        return (
            <Box ref={sizeRef} position="relative" width="100%" height={height}>
                <Box p={4} minH={height} display="flex" alignItems="center" justifyContent="center">
                    <Spinner size="sm" />
                    <Text fontSize="sm" color="var(--color-text-muted)" ml={2}>Sizing chart…</Text>
                </Box>
            </Box>
        );
    }

    const plotOverflow = overflow ?? (usesDynamicSpec ? 'hidden' : 'auto');

    return (
        <Box ref={usesDynamicSpec ? sizeRef : undefined} position="relative" width="100%" height={height} overflow={plotOverflow}>
            {renderError && (
                <Box p={4} bg="var(--color-btn-danger-subtle)" borderRadius="md" mb={2}>
                    <Text color="var(--color-text-danger)" fontSize="sm">{renderError}</Text>
                </Box>
            )}
            <Box
                ref={plotRef}
                width="100%"
                height={renderError ? `calc(${height} - 4rem)` : height}
                minH={usesDynamicSpec ? undefined : '480px'}
                overflow={plotOverflow}
            />
        </Box>
    );
});

export default VegaPlot;
