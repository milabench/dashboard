import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box,
    Badge,
    Button,
    Checkbox,
    Dialog,
    HStack,
    NativeSelect,
    Stack,
    Text,
    VStack,
    useDisclosure,
} from '@chakra-ui/react';
import { MonacoEditor } from '../shared/MonacoEditor';
import VegaPlot, { type VegaPlotHandle } from '../charts/VegaPlot';
import { toaster } from '../ui/toaster';
import { cssColor } from '../../utils/gpuColors';
import { copyTextToClipboard, safeFilename } from '../../utils/download';
import {
    convertPivotToChartData,
    filterPlotRows,
    type ChartFieldMeta,
    type PivotFieldConfig,
} from '../../utils/pivotToChartData';
import {
    buildTemplateSpec,
    FACET_LAYOUT_OPTIONS,
    FACET_WRAP_COLUMN_OPTIONS,
    fieldsForSlot,
    getPlotTemplate,
    injectPlotData,
    PLOT_TEMPLATES,
    stripInlinePlotData,
    suggestTemplateFields,
    templateRequiredFieldsFilled,
    type FacetLayoutMode,
    type FacetLayoutOptions,
    normalizeFacetLayout,
    type PlotTemplateId,
} from '../../utils/pivotPlotTemplates';
import type { PivotTransformStep } from '../../utils/pivotPlotTransforms';
import { fieldsAfterTransforms, ensureGroupbyForPlotField, hasActiveTransforms, plotSelectableFields } from '../../utils/pivotPlotTransforms';
import {
    encodePivotPlotState,
    isPlotStateShareable,
    normalizePlotAxisOptions,
    parsePivotPlotFromSearchParams,
    validatePlotFields,
    type PivotPlotUrlState,
    type PlotAxisOptions,
} from '../../utils/pivotPlotUrlParams';
import { PivotTransformBuilder } from './PivotTransformBuilder';

export interface PivotPlotPageActions {
    onSavePlot?: () => void;
    onLoadPlot?: () => void;
    onLoadData?: () => void;
    isLoadingData?: boolean;
    showSavePlot?: boolean;
}

export interface PivotPlotViewProps {
    pivotData: Record<string, unknown>[];
    pivotFields: PivotFieldConfig[];
    pivotConfigKey: string;
    pageActions?: PivotPlotPageActions;
}

export const PIVOT_PLOT_SIDEBAR_PROPS = {
    w: { base: '100%', lg: '340px' },
    minW: { lg: '300px' },
    maxW: { lg: '380px' },
} as const;

export function PlotSidebarTopActions({
    onSavePlot,
    onLoadPlot,
    showSavePlot = false,
}: Pick<PivotPlotPageActions, 'onSavePlot' | 'onLoadPlot' | 'showSavePlot'>) {
    return (
        <HStack gap={2} w="100%" flexShrink={0}>
            {showSavePlot && onSavePlot && (
                <Button
                    flex="1"
                    size="sm"
                    onClick={onSavePlot}
                    bg="var(--color-btn-save-bg)"
                    color="var(--color-btn-save-text)"
                    _hover={{ bg: 'var(--color-btn-save-hover)' }}
                >
                    Save plot
                </Button>
            )}
            {onLoadPlot && (
                <Button
                    flex="1"
                    size="sm"
                    onClick={onLoadPlot}
                    bg="var(--color-btn-load-bg)"
                    color="var(--color-btn-load-text)"
                    _hover={{ bg: 'var(--color-btn-load-hover)' }}
                >
                    Load plot
                </Button>
            )}
        </HStack>
    );
}

export function PlotSidebarBottomActions({
    onLoadData,
    isLoadingData = false,
}: Pick<PivotPlotPageActions, 'onLoadData' | 'isLoadingData'>) {
    if (!onLoadData) return null;
    return (
        <Button
            w="100%"
            size="sm"
            onClick={onLoadData}
            loading={isLoadingData}
            bg="var(--color-primary)"
            color="var(--color-primary-text)"
            _hover={{ bg: 'var(--color-primary-hover)' }}
            flexShrink={0}
        >
            Refresh data
        </Button>
    );
}

export function PlotSidebarActionPanel({
    pageActions,
    children,
}: {
    pageActions?: PivotPlotPageActions;
    children?: ReactNode;
}) {
    return (
        <VStack
            align="stretch"
            gap={3}
            {...PIVOT_PLOT_SIDEBAR_PROPS}
            flexShrink={0}
            h={{ base: 'auto', lg: '100%' }}
            minH={0}
        >
            {pageActions && (
                <PlotSidebarTopActions
                    onSavePlot={pageActions.onSavePlot}
                    onLoadPlot={pageActions.onLoadPlot}
                    showSavePlot={pageActions.showSavePlot}
                />
            )}
            {children ? (
                <Box flex="1" minH={0} overflowY="auto">
                    {children}
                </Box>
            ) : (
                <Box flex="1" minH={0} />
            )}
            {pageActions && (
                <PlotSidebarBottomActions
                    onLoadData={pageActions.onLoadData}
                    isLoadingData={pageActions.isLoadingData}
                />
            )}
        </VStack>
    );
}

const PLOT_CONFIG_OVERRIDES_BASE = {
    padding: { left: 8, top: 8, right: 8, bottom: 8 },
    legend: {
        orient: 'right' as const,
        direction: 'vertical' as const,
        labelLimit: 260,
        titleLimit: 180,
        columns: 1,
        padding: 8,
        labelFontSize: 11,
    },
    axis: {
        labelFontSize: 11,
        titleFontSize: 12,
    },
};

function buildPlotConfigOverrides(axisOptions: Required<PlotAxisOptions>) {
    return {
        ...PLOT_CONFIG_OVERRIDES_BASE,
        axisX: {
            labelPadding: axisOptions.xLabelPadding,
            titlePadding: axisOptions.xTitlePadding,
        },
        axisY: {
            labelPadding: axisOptions.yLabelPadding,
            titlePadding: axisOptions.yTitlePadding,
        },
    };
}

const PLOT_FORM_LABEL_W = '88px';

function PlotFormRow({
    label,
    children,
}: {
    label: ReactNode;
    children: ReactNode;
}) {
    return (
        <HStack gap={2} align="center" w="100%">
            <Text
                fontSize="xs"
                fontWeight="semibold"
                color="var(--color-text-muted)"
                flexShrink={0}
                w={PLOT_FORM_LABEL_W}
                textAlign="right"
            >
                {label}
            </Text>
            <Box flex="1" minW={0}>
                {children}
            </Box>
        </HStack>
    );
}

function plotFormHint(text: string) {
    return (
        <Text
            fontSize="xs"
            color="var(--color-text-muted)"
            mt={1}
            pl={`calc(${PLOT_FORM_LABEL_W} + 8px)`}
        >
            {text}
        </Text>
    );
}

function PlotAxisDialRow({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}) {
    return (
        <PlotFormRow label={label}>
            <HStack gap={2} w="100%">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        accentColor: 'var(--color-primary)',
                    }}
                />
                <Text
                    fontSize="xs"
                    color="var(--color-text-muted)"
                    w="24px"
                    textAlign="right"
                    flexShrink={0}
                >
                    {value}
                </Text>
            </HStack>
        </PlotFormRow>
    );
}

const DEFAULT_FACET_LAYOUT: FacetLayoutOptions = { mode: 'wrap' };

function slotFieldsUsed(templateId: PlotTemplateId, fields: Record<string, string>): string[] {
    const template = getPlotTemplate(templateId);
    return template.slots
        .map((s) => fields[s.id]?.trim())
        .filter((f): f is string => Boolean(f));
}

export function PivotPlotView({ pivotData, pivotFields, pivotConfigKey, pageActions }: PivotPlotViewProps) {
    const plotRef = useRef<VegaPlotHandle>(null);
    const [exportingPng, setExportingPng] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const plotFromUrl = useMemo(
        () => parsePivotPlotFromSearchParams(searchParams),
        [searchParams],
    );
    const lastSyncedPlotParamRef = useRef<string | null>(searchParams.get('plot'));
    const prevPivotConfigKeyRef = useRef(pivotConfigKey);

    const chartData = useMemo(
        () => convertPivotToChartData(pivotData, pivotFields),
        [pivotData, pivotFields],
    );

    const [templateId, setTemplateId] = useState<PlotTemplateId>(
        plotFromUrl?.template ?? 'scatter',
    );
    const [plotFields, setPlotFields] = useState<Record<string, string>>(
        plotFromUrl?.fields ?? {},
    );
    const [transforms, setTransforms] = useState<PivotTransformStep[]>(
        plotFromUrl?.transforms ?? [],
    );
    const [hideNulls, setHideNulls] = useState(plotFromUrl?.hideNulls ?? true);
    const [facetLayout, setFacetLayout] = useState<FacetLayoutOptions>(
        normalizeFacetLayout(plotFromUrl?.facetLayout),
    );
    const [axisOptions, setAxisOptions] = useState<Required<PlotAxisOptions>>(
        normalizePlotAxisOptions(plotFromUrl?.axisOptions),
    );
    const [initialized, setInitialized] = useState(false);
    const [customSpec, setCustomSpec] = useState<Record<string, unknown> | null>(null);
    const [specEditorText, setSpecEditorText] = useState('');
    const [specEditorError, setSpecEditorError] = useState<string | null>(null);
    const { open: specEditorOpen, onOpen: onSpecEditorOpen, onClose: onSpecEditorClose, setOpen: setSpecEditorOpen } = useDisclosure();

    const template = useMemo(() => getPlotTemplate(templateId), [templateId]);

    const syncPlotToUrl = useCallback((state: PivotPlotUrlState) => {
        if (!isPlotStateShareable(state)) return;

        const plotParam = encodePivotPlotState(state);
        lastSyncedPlotParamRef.current = plotParam;
        setSearchParams(
            (prev) => {
                if (prev.get('plot') === plotParam) return prev;
                const next = new URLSearchParams(prev);
                next.set('plot', plotParam);
                return next;
            },
            { replace: true },
        );
    }, [setSearchParams]);

    useEffect(() => {
        if (!chartData || initialized) return;

        const rowKeys = Object.keys(chartData.long[0] ?? {});
        let nextState: PivotPlotUrlState;

        if (plotFromUrl) {
            const availableFields = plotSelectableFields(
                plotFromUrl.transforms ?? [],
                chartData.fields,
            );
            const validatedFields = validatePlotFields(
                plotFromUrl.template,
                plotFromUrl.fields,
                availableFields,
                rowKeys,
            );
            const suggested = suggestTemplateFields(
                plotFromUrl.template,
                chartData,
                pivotFields,
                rowKeys,
                availableFields,
            );
            const mergedFields: Record<string, string> = {};
            for (const slot of getPlotTemplate(plotFromUrl.template).slots) {
                mergedFields[slot.id] = validatedFields[slot.id] || suggested[slot.id] || '';
            }
            nextState = {
                template: plotFromUrl.template,
                fields: mergedFields,
                transforms: plotFromUrl.transforms ?? [],
                hideNulls: plotFromUrl.hideNulls ?? true,
                facetLayout: normalizeFacetLayout(plotFromUrl.facetLayout),
                axisOptions: normalizePlotAxisOptions(plotFromUrl.axisOptions),
            };
            lastSyncedPlotParamRef.current = searchParams.get('plot');
        } else {
            const suggested = suggestTemplateFields('scatter', chartData, pivotFields, rowKeys);
            nextState = {
                template: 'scatter',
                fields: suggested,
                transforms: [],
                hideNulls: true,
                facetLayout: DEFAULT_FACET_LAYOUT,
                axisOptions: normalizePlotAxisOptions(),
            };
        }

        setTemplateId(nextState.template);
        setPlotFields(nextState.fields);
        setTransforms(nextState.transforms ?? []);
        setHideNulls(nextState.hideNulls ?? true);
        setFacetLayout(normalizeFacetLayout(nextState.facetLayout));
        setAxisOptions(normalizePlotAxisOptions(nextState.axisOptions));
        setInitialized(true);
        if (isPlotStateShareable(nextState)) {
            syncPlotToUrl(nextState);
        }
    }, [chartData, pivotFields, plotFromUrl, initialized, syncPlotToUrl, searchParams]);

    useEffect(() => {
        if (prevPivotConfigKeyRef.current === pivotConfigKey) return;
        prevPivotConfigKeyRef.current = pivotConfigKey;
        setCustomSpec(null);
        setInitialized(false);
    }, [pivotConfigKey]);

    const plotUrlState = useMemo(
        () => ({
            template: templateId,
            fields: plotFields,
            transforms,
            hideNulls,
            facetLayout: plotFields.facet?.trim() ? facetLayout : undefined,
            axisOptions,
        }),
        [templateId, plotFields, transforms, hideNulls, facetLayout, axisOptions],
    );

    useEffect(() => {
        if (!initialized) return;
        const timer = window.setTimeout(() => syncPlotToUrl(plotUrlState), 400);
        return () => window.clearTimeout(timer);
    }, [plotUrlState, initialized, syncPlotToUrl]);

    useEffect(() => {
        if (!initialized || !chartData) return;

        const plotParam = searchParams.get('plot');
        if (!plotParam || plotParam === lastSyncedPlotParamRef.current) return;

        const fromUrl = parsePivotPlotFromSearchParams(searchParams);
        if (!fromUrl) return;

        const rowKeys = Object.keys(chartData.long[0] ?? {});
        const availableFields = plotSelectableFields(fromUrl.transforms ?? [], chartData.fields);
        setTemplateId(fromUrl.template);
        setPlotFields(validatePlotFields(fromUrl.template, fromUrl.fields, availableFields, rowKeys));
        setTransforms(fromUrl.transforms ?? []);
        setHideNulls(fromUrl.hideNulls ?? true);
        setFacetLayout(normalizeFacetLayout(fromUrl.facetLayout));
        setAxisOptions(normalizePlotAxisOptions(fromUrl.axisOptions));
        lastSyncedPlotParamRef.current = plotParam;
    }, [searchParams, initialized, chartData]);

    const plotConfigOverrides = useMemo(
        () => buildPlotConfigOverrides(axisOptions),
        [axisOptions],
    );

    const handleAxisOptionChange = (key: keyof PlotAxisOptions, value: number) => {
        setAxisOptions((prev) => normalizePlotAxisOptions({ ...prev, [key]: value }));
    };

    const rows = chartData?.long ?? [];

    const availablePlotFields = useMemo(
        () => plotSelectableFields(transforms, chartData?.fields ?? []),
        [transforms, chartData?.fields],
    );

    const postTransformFields = useMemo(
        () => fieldsAfterTransforms(transforms, chartData?.fields ?? []),
        [transforms, chartData?.fields],
    );

    const baseFieldNames = useMemo(
        () => new Set((chartData?.fields ?? []).map((f) => f.name)),
        [chartData?.fields],
    );
    const usedFields = useMemo(
        () => slotFieldsUsed(templateId, plotFields),
        [templateId, plotFields],
    );

    const plotRows = useMemo(() => {
        if (!hideNulls) return rows;
        return filterPlotRows(rows, usedFields);
    }, [rows, usedFields, hideNulls]);

    const hiddenNullCount = rows.length - plotRows.length;

    const fieldMeta = useMemo(() => {
        const map = new Map<string, ChartFieldMeta>();
        availablePlotFields.forEach((f) => map.set(f.name, f));
        return map;
    }, [availablePlotFields]);

    const specBuilder = useCallback((_w: number, _h: number) => {
        if (!chartData) return null;
        const dataRows = hasActiveTransforms(transforms) ? rows : plotRows;
        if (dataRows.length === 0) return null;

        return buildTemplateSpec({
            templateId,
            fields: plotFields,
            fieldMeta,
            transforms,
            rows: dataRows,
            textColor: cssColor('--color-text', '#1a202c'),
            width: Math.min(640, Math.max(360, _w - 24)),
            height: Math.min(480, Math.max(280, _h - 24)),
            facetLayout: plotFields.facet?.trim() ? facetLayout : undefined,
        });
    }, [chartData, templateId, plotFields, fieldMeta, transforms, rows, plotRows, facetLayout]);

    const plotSpecWithData = useCallback((_w: number, _h: number) => {
        const base = customSpec ?? specBuilder(_w, _h);
        if (!base) return null;
        const dataRows = customSpec || hasActiveTransforms(transforms) ? rows : plotRows;
        return injectPlotData(base, dataRows);
    }, [customSpec, specBuilder, rows, plotRows, transforms]);

    const canRenderPlot = customSpec
        ? true
        : Boolean(chartData && templateRequiredFieldsFilled(templateId, plotFields));

    const handleFacetLayoutModeChange = (mode: FacetLayoutMode) => {
        setCustomSpec(null);
        setFacetLayout((prev) => {
            const next: FacetLayoutOptions = { mode, independentAxes: prev.independentAxes };
            if (mode === 'wrap' && prev.mode === 'wrap' && prev.columns) {
                next.columns = prev.columns;
            }
            return next;
        });
    };

    const handleIndependentAxisChange = (axis: 'x' | 'y', checked: boolean) => {
        setCustomSpec(null);
        setFacetLayout((prev) => {
            const current = prev.independentAxes ?? {};
            const nextAxes = {
                ...current,
                [axis]: checked ? true : undefined,
            };
            if (!nextAxes.x) delete nextAxes.x;
            if (!nextAxes.y) delete nextAxes.y;
            const hasAny = Boolean(nextAxes.x || nextAxes.y);
            return {
                ...prev,
                independentAxes: hasAny ? nextAxes : undefined,
            };
        });
    };

    const handleFacetWrapColumnsChange = (value: string) => {
        setCustomSpec(null);
        const columns = value ? Number.parseInt(value, 10) : undefined;
        setFacetLayout((prev) => ({
            mode: 'wrap',
            independentAxes: prev.independentAxes,
            ...(columns && columns > 0 ? { columns } : {}),
        }));
    };

    const hasFacetField = Boolean(plotFields.facet?.trim());

    const handleTemplateChange = (nextTemplate: PlotTemplateId) => {
        if (!chartData) return;
        setCustomSpec(null);
        setTemplateId(nextTemplate);
        const rowKeys = Object.keys(chartData.long[0] ?? {});
        setPlotFields(suggestTemplateFields(
            nextTemplate,
            chartData,
            pivotFields,
            rowKeys,
            availablePlotFields,
        ));
    };

    const handleFieldChange = (slotId: string, value: string) => {
        setCustomSpec(null);
        if (value && chartData) {
            const nextTransforms = ensureGroupbyForPlotField(transforms, value, chartData.fields);
            if (nextTransforms !== transforms) {
                setTransforms(nextTransforms);
            }
        }
        setPlotFields((prev) => ({ ...prev, [slotId]: value }));
    };

    const handleTransformsChange = (next: PivotTransformStep[]) => {
        if (!chartData) return;
        setCustomSpec(null);
        setTransforms(next);
        const selectable = plotSelectableFields(next, chartData.fields);
        const validNames = new Set(selectable.map((f) => f.name));
        setPlotFields((prev) => {
            const updated = { ...prev };
            for (const [slotId, value] of Object.entries(updated)) {
                if (value && !validNames.has(value)) {
                    updated[slotId] = '';
                }
            }
            return updated;
        });
    };

    const openSpecEditor = useCallback(() => {
        const built = specBuilder(800, 500);
        const base = customSpec ?? built;
        setSpecEditorText(base ? JSON.stringify(stripInlinePlotData(base), null, 2) : '{}');
        setSpecEditorError(null);
        onSpecEditorOpen();
    }, [specBuilder, customSpec, onSpecEditorOpen]);

    const syncSpecEditorFromTemplate = useCallback(() => {
        const built = specBuilder(800, 500);
        if (!built) {
            setSpecEditorError('Fill required fields before syncing from the template');
            return;
        }
        setSpecEditorText(JSON.stringify(stripInlinePlotData(built), null, 2));
        setSpecEditorError(null);
    }, [specBuilder]);

    const handleApplySpec = useCallback(() => {
        try {
            const parsed = JSON.parse(specEditorText) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setSpecEditorError('Spec must be a JSON object');
                return;
            }
            setCustomSpec(stripInlinePlotData(parsed as Record<string, unknown>));
            setSpecEditorError(null);
            onSpecEditorClose();
            toaster.create({
                title: 'Spec applied',
                description: 'Plot is using your custom Vega-Lite spec',
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            setSpecEditorError(err instanceof Error ? err.message : 'Invalid JSON');
        }
    }, [specEditorText, onSpecEditorClose]);

    const handleResetCustomSpec = useCallback(() => {
        setCustomSpec(null);
    }, []);

    const handleExportPng = async () => {
        if (!plotRef.current?.isReady()) {
            toaster.create({
                title: 'Plot not ready',
                description: 'Configure the plot and wait for the chart to render',
                type: 'warning',
                duration: 3000,
            });
            return;
        }
        setExportingPng(true);
        try {
            const nameParts = [templateId, ...usedFields.slice(0, 2)];
            await plotRef.current.exportPng(safeFilename(nameParts, 'png'));
            toaster.create({ title: 'PNG saved', type: 'success', duration: 3000 });
        } catch (err) {
            toaster.create({
                title: 'PNG export failed',
                description: err instanceof Error ? err.message : 'Could not save PNG',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setExportingPng(false);
        }
    };

    const handleCopyLink = async () => {
        try {
            await copyTextToClipboard(window.location.href);
            toaster.create({ title: 'Link copied', type: 'success', duration: 3000 });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                description: err instanceof Error ? err.message : 'Could not copy link',
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleCopySpec = async () => {
        const spec = customSpec ?? specBuilder(800, 500);
        if (!spec) return;
        try {
            await copyTextToClipboard(JSON.stringify(stripInlinePlotData(spec), null, 2));
            toaster.create({ title: 'Spec copied', type: 'success', duration: 3000 });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                description: err instanceof Error ? err.message : 'Could not copy spec',
                type: 'error',
                duration: 5000,
            });
        }
    };

    const handleCopyData = async () => {
        if (rows.length === 0) return;
        try {
            await copyTextToClipboard(JSON.stringify(rows, null, 2));
            toaster.create({
                title: 'Data copied',
                description: `${rows.length} rows copied as JSON`,
                type: 'success',
                duration: 3000,
            });
        } catch (err) {
            toaster.create({
                title: 'Copy failed',
                type: 'error',
                duration: 5000,
            });
        }
    };

    if (!chartData) {
        return (
            <Box p={8} textAlign="center">
                <Text color="var(--color-text-muted)">No pivot data to plot. Run a query first.</Text>
            </Box>
        );
    }

    return (
        <VStack align="stretch" gap={3} h="100%" minH={0}>
            <HStack justify="space-between" flexWrap="wrap" gap={2} flexShrink={0}>
                <Text fontSize="sm" color="var(--color-text-muted)">
                    {plotRows.length.toLocaleString()} rows
                    {hiddenNullCount > 0 ? ` · ${hiddenNullCount.toLocaleString()} nulls hidden` : ''}
                </Text>
                <HStack gap={2} flexWrap="wrap">
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopyLink}>
                        Copy link
                    </Button>
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleExportPng} disabled={!canRenderPlot || exportingPng}>
                        {exportingPng ? 'Saving…' : 'Save PNG'}
                    </Button>
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopyData} disabled={rows.length === 0}>
                        Copy data
                    </Button>
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={openSpecEditor}>
                        Edit spec
                    </Button>
                    <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopySpec}>
                        Copy spec
                    </Button>
                    {customSpec && (
                        <Badge
                            bg="var(--color-pivot-filter-bg)"
                            color="var(--color-pivot-filter-heading)"
                            fontSize="xs"
                            px={2}
                            py={1}
                            borderRadius="md"
                            cursor="pointer"
                            onClick={handleResetCustomSpec}
                        >
                            Custom spec ×
                        </Badge>
                    )}
                </HStack>
            </HStack>

            <Stack
                direction={{ base: 'column', lg: 'row' }}
                align="stretch"
                gap={3}
                flex="1"
                minH={0}
            >
                <VStack
                    align="stretch"
                    gap={3}
                    {...PIVOT_PLOT_SIDEBAR_PROPS}
                    flexShrink={0}
                    h={{ base: 'auto', lg: '100%' }}
                    minH={0}
                    maxH={{ base: '45vh', lg: 'none' }}
                >
                    {pageActions && (
                        <PlotSidebarTopActions
                            onSavePlot={pageActions.onSavePlot}
                            onLoadPlot={pageActions.onLoadPlot}
                            showSavePlot={pageActions.showSavePlot}
                        />
                    )}

                    <VStack
                        align="stretch"
                        gap={3}
                        flex="1"
                        minH={0}
                        overflowY="auto"
                        pr={1}
                    >
                    <PivotTransformBuilder
                        transforms={transforms}
                        fields={chartData.fields}
                        onChange={handleTransformsChange}
                        compact
                    />

                    <Box
                        borderWidth="1px"
                        borderColor="var(--color-border)"
                        borderRadius="md"
                        p={3}
                        bg="var(--color-bg-card)"
                    >
                        <Text fontSize="sm" fontWeight="semibold" color="var(--color-text)" mb={3}>
                            Plot
                        </Text>

                        <VStack align="stretch" gap={2}>
                            <Box>
                                <PlotFormRow label="Type">
                                    <NativeSelect.Root size="sm">
                                        <NativeSelect.Field
                                            value={templateId}
                                            onChange={(e) => handleTemplateChange(e.target.value as PlotTemplateId)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            {PLOT_TEMPLATES.map((t) => (
                                                <option key={t.id} value={t.id}>{t.label}</option>
                                            ))}
                                        </NativeSelect.Field>
                                    </NativeSelect.Root>
                                </PlotFormRow>
                                {plotFormHint(template.description)}
                            </Box>

                            {template.slots.map((slot) => {
                                const options = fieldsForSlot(availablePlotFields, slot.kind);
                                const transformed = options.filter((f) => !baseFieldNames.has(f.name));
                                const pivot = options.filter((f) => baseFieldNames.has(f.name));
                                const inactive = pivot.filter(
                                    (f) => !postTransformFields.some((pf) => pf.name === f.name),
                                );
                                const activePivot = pivot.filter(
                                    (f) => postTransformFields.some((pf) => pf.name === f.name),
                                );

                                return (
                                    <PlotFormRow key={slot.id} label={`${slot.label}${slot.required ? ' *' : ''}`}>
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={plotFields[slot.id] ?? ''}
                                                onChange={(e) => handleFieldChange(slot.id, e.target.value)}
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                            >
                                                {!slot.required && <option value="">—</option>}
                                            {transformed.length > 0 && (
                                                <optgroup label="From transforms">
                                                    {transformed.map((f) => (
                                                        <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                            {activePivot.length > 0 && (
                                                <optgroup label="Pivot fields">
                                                    {activePivot.map((f) => (
                                                        <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                            {inactive.length > 0 && (
                                                <optgroup label="Pivot (add to group by)">
                                                    {inactive.map((f) => (
                                                        <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                    </PlotFormRow>
                                );
                            })}

                            {hasFacetField && (
                                <Box>
                                    <PlotFormRow label="Layout">
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={facetLayout.mode}
                                                onChange={(e) => handleFacetLayoutModeChange(e.target.value as FacetLayoutMode)}
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                            >
                                                {FACET_LAYOUT_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                    </PlotFormRow>
                                    {plotFormHint(
                                        FACET_LAYOUT_OPTIONS.find((o) => o.value === facetLayout.mode)?.description ?? '',
                                    )}
                                    {facetLayout.mode === 'wrap' && (
                                        <Box mt={2}>
                                            <PlotFormRow label="Columns">
                                                <NativeSelect.Root size="sm">
                                                    <NativeSelect.Field
                                                        value={facetLayout.columns ? String(facetLayout.columns) : ''}
                                                        onChange={(e) => handleFacetWrapColumnsChange(e.target.value)}
                                                        bg="var(--color-bg-card)"
                                                        borderColor="var(--color-border)"
                                                        color="var(--color-text)"
                                                    >
                                                        {FACET_WRAP_COLUMN_OPTIONS.map((option) => (
                                                            <option key={option.value || 'auto'} value={option.value}>
                                                                {option.label}
                                                            </option>
                                                        ))}
                                                    </NativeSelect.Field>
                                                </NativeSelect.Root>
                                            </PlotFormRow>
                                        </Box>
                                    )}
                                    <Box mt={2}>
                                        <PlotFormRow label="Indep. axes">
                                            <HStack gap={4} flexWrap="wrap">
                                                <Checkbox.Root
                                                    size="sm"
                                                    checked={Boolean(facetLayout.independentAxes?.x)}
                                                    onCheckedChange={(e) => handleIndependentAxisChange('x', Boolean(e.checked))}
                                                >
                                                    <Checkbox.HiddenInput />
                                                    <Checkbox.Control />
                                                    <Checkbox.Label color="var(--color-text)" fontSize="sm">X</Checkbox.Label>
                                                </Checkbox.Root>
                                                <Checkbox.Root
                                                    size="sm"
                                                    checked={Boolean(facetLayout.independentAxes?.y)}
                                                    onCheckedChange={(e) => handleIndependentAxisChange('y', Boolean(e.checked))}
                                                >
                                                    <Checkbox.HiddenInput />
                                                    <Checkbox.Control />
                                                    <Checkbox.Label color="var(--color-text)" fontSize="sm">Y</Checkbox.Label>
                                                </Checkbox.Root>
                                            </HStack>
                                        </PlotFormRow>
                                    </Box>
                                    {plotFormHint('Checked axes use a separate scale per facet')}
                                </Box>
                            )}

                            <PlotFormRow label="Hide nulls">
                                <Checkbox.Root
                                    size="sm"
                                    checked={hideNulls}
                                    onCheckedChange={(e) => setHideNulls(Boolean(e.checked))}
                                >
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                </Checkbox.Root>
                            </PlotFormRow>

                            <Box pt={1}>
                                <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)" mb={2}>
                                    Axis spacing
                                </Text>
                                <VStack align="stretch" gap={2}>
                                    <PlotAxisDialRow
                                        label="X values"
                                        value={axisOptions.xLabelPadding}
                                        min={0}
                                        max={32}
                                        onChange={(value) => handleAxisOptionChange('xLabelPadding', value)}
                                    />
                                    <PlotAxisDialRow
                                        label="X title"
                                        value={axisOptions.xTitlePadding}
                                        min={0}
                                        max={48}
                                        onChange={(value) => handleAxisOptionChange('xTitlePadding', value)}
                                    />
                                    <PlotAxisDialRow
                                        label="Y values"
                                        value={axisOptions.yLabelPadding}
                                        min={0}
                                        max={32}
                                        onChange={(value) => handleAxisOptionChange('yLabelPadding', value)}
                                    />
                                    <PlotAxisDialRow
                                        label="Y title"
                                        value={axisOptions.yTitlePadding}
                                        min={0}
                                        max={48}
                                        onChange={(value) => handleAxisOptionChange('yTitlePadding', value)}
                                    />
                                </VStack>
                                {plotFormHint('Increase title spacing when tick values overlap the axis name')}
                            </Box>
                        </VStack>
                    </Box>
                    </VStack>

                    {pageActions && (
                        <PlotSidebarBottomActions
                            onLoadData={pageActions.onLoadData}
                            isLoadingData={pageActions.isLoadingData}
                        />
                    )}
                </VStack>

                <Box
                    flex="1"
                    minW={0}
                    minH={{ base: '320px', lg: 0 }}
                    borderWidth="1px"
                    borderColor="var(--color-border)"
                    borderRadius="md"
                    overflow="auto"
                    bg="var(--color-bg-card)"
                    p={2}
                >
                    {!canRenderPlot ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%" minH="200px">
                            <Text color="var(--color-text-muted)">
                                Select a plot type and fill the required fields
                            </Text>
                        </Box>
                    ) : !customSpec && plotRows.length === 0 && rows.length > 0 ? (
                        <Box display="flex" alignItems="center" justifyContent="center" h="100%" minH="200px" p={4}>
                            <Text color="var(--color-text-muted)" textAlign="center">
                                All rows are null for the selected fields.
                                {hideNulls ? ' Turn off Hide nulls to inspect them.' : ''}
                            </Text>
                        </Box>
                    ) : (
                        <VegaPlot
                            ref={plotRef}
                            spec={plotSpecWithData}
                            height="100%"
                            configOverrides={plotConfigOverrides}
                        />
                    )}
                </Box>
            </Stack>

            <Dialog.Root open={specEditorOpen} onOpenChange={(details) => setSpecEditorOpen(details.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="min(960px, 92vw)" w="100%">
                        <Dialog.Header>
                            <Dialog.Title>Edit Vega-Lite spec</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body pb={4}>
                            <VStack align="stretch" gap={3}>
                                <Text fontSize="sm" color="var(--color-text-muted)">
                                    Advanced editing — data is omitted and bound from the pivot query at render time.
                                </Text>
                                <Box h="min(60vh, 520px)" minH="320px">
                                    <MonacoEditor
                                        height="100%"
                                        language="json"
                                        value={specEditorText}
                                        onChange={(value) => {
                                            setSpecEditorText(value);
                                            if (specEditorError) setSpecEditorError(null);
                                        }}
                                    />
                                </Box>
                                {specEditorError && (
                                    <Text fontSize="sm" color="var(--color-danger, #e53e3e)">
                                        {specEditorError}
                                    </Text>
                                )}
                                <HStack gap={2} flexWrap="wrap">
                                    <Button
                                        size="sm"
                                        bg="var(--color-primary)"
                                        color="var(--color-primary-text)"
                                        _hover={{ bg: 'var(--color-primary-hover)' }}
                                        onClick={handleApplySpec}
                                    >
                                        Apply
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                        onClick={syncSpecEditorFromTemplate}
                                    >
                                        Sync from template
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                        onClick={onSpecEditorClose}
                                    >
                                        Cancel
                                    </Button>
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </VStack>
    );
}

export default PivotPlotView;
