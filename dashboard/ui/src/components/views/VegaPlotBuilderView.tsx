import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    VStack,
    HStack,
    Heading,
    Text,
    Button,
    Input,
    Field,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import { Loading } from '../common/Loading';

type VegaEmbedFn = (el: HTMLElement, spec: unknown, opts?: Record<string, unknown>) => Promise<unknown>;

const loadScript = (src: string) => {
    return new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
    });
};

const loadVegaEmbed = async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/vega@5');
    await loadScript('https://cdn.jsdelivr.net/npm/vega-lite@5');
    await loadScript('https://cdn.jsdelivr.net/npm/vega-embed@6');
    return (window as unknown as { vegaEmbed?: VegaEmbedFn }).vegaEmbed;
};

export const VegaPlotBuilderView: React.FC = () => {
    usePageTitle('Vega Plot Builder');

    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);

    const dataUrl = searchParams.get('dataUrl') || '';

    const { data, isLoading, error } = useQuery({
        queryKey: ['vegaBuilderData', dataUrl],
        queryFn: async () => {
            const response = await fetch(dataUrl, { credentials: 'include' });
            if (!response.ok) {
                throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
            }
            return response.json();
        },
        enabled: !!dataUrl,
    });

    const availableFields = useMemo<string[]>(() => {
        if (!Array.isArray(data) || data.length === 0) return [];
        const keys = data.reduce((acc, row) => {
            Object.keys((row as Record<string, unknown>) || {}).forEach((key) => acc.add(String(key)));
            return acc;
        }, new Set<string>());
        return Array.from(keys);
    }, [data]);

    const [vegaMark, setVegaMark] = useState<string>('point');
    const [vegaX, setVegaX] = useState<string>('');
    const [vegaY, setVegaY] = useState<string>('');
    const [vegaColor, setVegaColor] = useState<string>('');
    const [vegaSize, setVegaSize] = useState<string>('');
    const [vegaShape, setVegaShape] = useState<string>('');

    const escapeField = (field: string) => field.replace(/\\/g, '\\\\').replace(/\./g, '\\.');

    const vegaSpec = useMemo(() => {
        const spec: Record<string, unknown> = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: {
                values: Array.isArray(data) ? data : [],
            },
            mark: vegaMark,
            encoding: {},
        };   
   
        const encoding: Record<string, unknown> = {};
        if (vegaX) {
            encoding.x = {
                field: escapeField(vegaX),
                type: 'quantitative',
                title: vegaX,
                scale: { zero: false },
            };
        }
        if (vegaY) {
            encoding.y = {
                field: escapeField(vegaY),
                type: 'quantitative',
                title: vegaY,
                scale: { zero: false },
            };
        }
        if (vegaColor) encoding.color = { field: escapeField(vegaColor), type: 'nominal', title: vegaColor };
        if (vegaSize) encoding.size = { field: escapeField(vegaSize), type: 'quantitative', title: vegaSize };
        if (vegaShape) encoding.shape = { field: escapeField(vegaShape), type: 'nominal', title: vegaShape };

        (spec as { encoding: Record<string, unknown> }).encoding = encoding;
        return spec;
    }, [data, vegaMark, vegaX, vegaY, vegaColor, vegaSize, vegaShape]);

    useEffect(() => {
        if (!containerRef.current || !Array.isArray(data)) return;
        let cancelled = false;
        loadVegaEmbed()
            .then((vegaEmbed) => {
                if (!vegaEmbed || cancelled || !containerRef.current) return;
                return vegaEmbed(containerRef.current, vegaSpec, { actions: false });
            })
            .catch((err) => {
                if (cancelled) return;
                toaster.create({
                    title: 'Vega embed failed',
                    description: err instanceof Error ? err.message : String(err),
                    type: 'error',
                    duration: 5000,
                });
            });
        return () => {
            cancelled = true;
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [data, vegaSpec]);

    const handleCopySpec = async () => {
        const specText = JSON.stringify(vegaSpec, null, 2);
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(specText);
            } else {
                const tempInput = document.createElement('textarea');
                tempInput.value = specText;
                tempInput.setAttribute('readonly', 'true');
                tempInput.style.position = 'absolute';
                tempInput.style.left = '-9999px';
                document.body.appendChild(tempInput);
                tempInput.select();
                const success = document.execCommand('copy');
                document.body.removeChild(tempInput);
                if (!success) {
                    throw new Error('document.execCommand("copy") failed');
                }
            }
            toaster.create({
                title: 'Spec copied',
                description: 'Vega-Lite spec copied to clipboard',
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toaster.create({
                title: 'Copy failed',
                description: `Unable to copy the spec: ${message}`,
                type: 'error',
                duration: 5000,
            });
        }
    };

    if (!dataUrl) {
        return (
            <Box p={4}>
                <VStack align="stretch" gap={4}>
                    <Heading size="md">Vega Plot Builder</Heading>
                    <Text>Missing data URL. Please open this view from Datafile View.</Text>
                    <Button onClick={() => navigate('/datafile')}>Back to Datafile View</Button>
                </VStack>
            </Box>
        );
    }

    return (
        <Box p={4} minH="100vh">
            <VStack align="stretch" gap={6}>
                <HStack justify="space-between">
                    <Heading size="lg">Vega Plot Builder</Heading>
                    <HStack gap={2}>
                        <Button variant="outline" onClick={() => navigate('/datafile')}>
                            Back to Datafile View
                        </Button>
                        <Button onClick={handleCopySpec} disabled={isLoading || !Array.isArray(data)}>
                            Copy Spec
                        </Button>
                    </HStack>
                </HStack>

                {isLoading ? (
                    <Loading />
                ) : error ? (
                    <Text>Unable to load data for plotting.</Text>
                ) : (
                    <HStack align="start" gap={4}>
                        <Box w="320px" borderRadius="md" borderWidth={1} p={3}>
                            <VStack align="stretch" gap={3}>
                                <Heading size="sm">Encodings</Heading>
                                <Field.Root>
                                    <Field.Label>Mark</Field.Label>
                                    <Input
                                        value={vegaMark}
                                        onChange={(e) => setVegaMark(e.target.value)}
                                        placeholder="point, line, bar..."
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>X</Field.Label>
                                    <Input
                                        value={vegaX}
                                        onChange={(e) => setVegaX(e.target.value)}
                                        list="vega-fields"
                                        placeholder="Field for X"
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Y</Field.Label>
                                    <Input
                                        value={vegaY}
                                        onChange={(e) => setVegaY(e.target.value)}
                                        list="vega-fields"
                                        placeholder="Field for Y"
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Color</Field.Label>
                                    <Input
                                        value={vegaColor}
                                        onChange={(e) => setVegaColor(e.target.value)}
                                        list="vega-fields"
                                        placeholder="Field for color"
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Size</Field.Label>
                                    <Input
                                        value={vegaSize}
                                        onChange={(e) => setVegaSize(e.target.value)}
                                        list="vega-fields"
                                        placeholder="Field for size"
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>Shape</Field.Label>
                                    <Input
                                        value={vegaShape}
                                        onChange={(e) => setVegaShape(e.target.value)}
                                        list="vega-fields"
                                        placeholder="Field for shape"
                                    />
                                </Field.Root>
                                <datalist id="vega-fields">
                                    {availableFields.map((field) => (
                                        <option key={field} value={field} />
                                    ))}
                                </datalist>
                            </VStack>
                        </Box>
                        <Box flex="1" borderRadius="md" borderWidth={1} p={3}>
                            <Box ref={containerRef} />
                        </Box>
                    </HStack>
                )}
            </VStack>
        </Box>
    );
};


