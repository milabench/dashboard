import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Box, Text, Spinner } from '@chakra-ui/react';
import { useVega } from '../../contexts/VegaContext';
import { useColorMode } from '../ui/color-mode';

export type SpecBuilder = (width: number, height: number) => Record<string, any> | null;

export interface VegaPlotProps {
    spec: Record<string, any> | SpecBuilder;
    height?: string;
    configOverrides?: Record<string, any>;
}

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

const VegaPlot: React.FC<VegaPlotProps> = ({ spec, height = '300px', configOverrides }) => {
    const { embed, isLoaded, error: loadError } = useVega();
    const { colorMode } = useColorMode();
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);
    const [containerHeight, setContainerHeight] = useState(600);

    useEffect(() => {
        const measure = () => {
            const el = containerRef.current;
            if (el) {
                if (el.clientWidth > 0) setContainerWidth(el.clientWidth);
                if (el.clientHeight > 0) setContainerHeight(el.clientHeight);
            }
        };

        measure();
        const timer = setTimeout(measure, 100);

        const observer = new ResizeObserver(() => measure());
        if (containerRef.current) observer.observe(containerRef.current);

        return () => {
            clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    const resolvedSpec = useMemo(() => {
        if (typeof spec === 'function') {
            return spec(containerWidth, containerHeight);
        }
        return spec;
    }, [spec, containerWidth, containerHeight]);

    useEffect(() => {
        if (!isLoaded || !embed || !containerRef.current || !resolvedSpec) return;

        const render = async () => {
            const el = containerRef.current as HTMLElement;
            const config = await buildConfig(el, colorMode, configOverrides);

            try {
                await embed(el, resolvedSpec, {
                    actions: false,
                    renderer: 'svg',
                    config,
                });
            } catch (err: any) {
                console.error('Vega render error:', err);
            }
        };

        render();
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

    return (
        <Box
            ref={containerRef}
            width="100%"
            minHeight={height}
            overflow="hidden"
        />
    );
};

export default VegaPlot;
