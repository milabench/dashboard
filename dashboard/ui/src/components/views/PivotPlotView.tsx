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
    type PivotChartData,
    type PivotFieldConfig,
} from '../../utils/pivotToChartData';
import {
    buildTemplateSpec,
    FACET_LAYOUT_OPTIONS,
    FACET_WRAP_COLUMN_OPTIONS,
    fieldsForSlot,
    getPlotTemplate,
    injectPlotData,
    injectPlotDataUrl,
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
import { fieldsAfterTransforms, ensureGroupbyForPlotField, hasActiveTransforms, plotSelectableFields, derivedTransformFields } from '../../utils/pivotPlotTransforms';
import {
    encodePivotPlotState,
    hasPlotFacetFields,
    isPlotStateShareable,
    legendConfigFromOptions,
    normalizePlotAxisOptions,
    normalizePlotLegendOptions,
    normalizePlotSizeOptions,
    parsePivotPlotFromSearchParams,
    PLOT_LEGEND_DIRECTION_OPTIONS,
    PLOT_LEGEND_PLACEMENT_OPTIONS,
    validatePlotFields,
    type PivotPlotUrlState,
    type PlotAxisOptions,
    type PlotLegendDirection,
    type PlotLegendOptions,
    type PlotLegendPlacement,
    type PlotSizeOptions,
} from '../../utils/pivotPlotUrlParams';
import { LuInfo } from 'react-icons/lu';
import { Tooltip } from '../ui/tooltip';
import { PivotTransformBuilder } from './PivotTransformBuilder';
import { pivotMeltApiUrl } from '../../utils/pivotUrlParams';

export interface PivotPlotPageActions {
    onSavePlot?: () => void;
    onLoadPlot?: () => void;
    onLoadData?: () => void;
    isLoadingData?: boolean;
    showSavePlot?: boolean;
    savePlotLabel?: string;
    loadedSavedQueryName?: string | null;
}

export interface PivotPlotViewProps {
    /** Pre-melted chart data from `/api/pivot/melt` (preferred). */
    chartData?: PivotChartData | null;
    /** Wide pivot table rows — converted client-side when `chartData` is omitted. */
    pivotData?: Record<string, unknown>[];
    pivotFields: PivotFieldConfig[];
    pivotConfigKey: string;
    pageActions?: PivotPlotPageActions;
    /** Extra actions rendered before copy/export controls in the top toolbar. */
    topBarRight?: ReactNode;
    /** When set, toolbar is rendered by the parent (e.g. on the page title row). */
    onRenderToolbar?: (toolbar: ReactNode) => void;
    /** Called when a shareable Vega-Lite spec (remote melt URL) is available. */
    onShareableSpecChange?: (spec: Record<string, unknown> | null) => void;
    /** When `chart-only`, hide builder sidebar and editing controls. */
    viewMode?: 'builder' | 'chart-only';
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
    savePlotLabel = 'Save plot',
    loadedSavedQueryName,
}: Pick<PivotPlotPageActions, 'onSavePlot' | 'onLoadPlot' | 'showSavePlot' | 'savePlotLabel' | 'loadedSavedQueryName'>) {
    return (
        <VStack align="stretch" gap={2} w="100%" flexShrink={0}>
            <HStack gap={2} w="100%">
                {showSavePlot && onSavePlot && (
                    <Button
                        flex="1"
                        size="sm"
                        onClick={onSavePlot}
                        bg="var(--color-btn-save-bg)"
                        color="var(--color-btn-save-text)"
                        _hover={{ bg: 'var(--color-btn-save-hover)' }}
                    >
                        {savePlotLabel}
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
            {loadedSavedQueryName && (
                <Text fontSize="xs" color="var(--color-text-muted)" px={1}>
                    Editing saved plot: <Text as="span" fontWeight="semibold" color="var(--color-text)">{loadedSavedQueryName}</Text>
                </Text>
            )}
        </VStack>
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
                    savePlotLabel={pageActions.savePlotLabel}
                    loadedSavedQueryName={pageActions.loadedSavedQueryName}
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
        padding: 8,
        labelFontSize: 11,
    },
    axis: {
        labelFontSize: 11,
        titleFontSize: 12,
    },
};

function buildPlotConfigOverrides(
    axisOptions: Required<PlotAxisOptions>,
    legendOptions: Required<PlotLegendOptions>,
) {
    const legendOverrides = legendConfigFromOptions(legendOptions);
    const legend = {
        ...PLOT_CONFIG_OVERRIDES_BASE.legend,
        ...legendOverrides,
    };
    // Explicitly drop columns for row flow — a stale columns value forces one entry per row.
    if (legendOptions.placement !== 'none' && legendOptions.direction === 'horizontal') {
        delete (legend as Record<string, unknown>).columns;
    }

    return {
        ...PLOT_CONFIG_OVERRIDES_BASE,
        legend,
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

function PlotFormHintIcon({ content }: { content: string }) {
    if (!content.trim()) return null;

    return (
        <Tooltip content={content} showArrow positioning={{ placement: 'top', offset: { mainAxis: 6 } }}>
            <Box
                as="span"
                display="inline-flex"
                alignItems="center"
                cursor="help"
                color="var(--color-text-muted)"
                aria-label="Help"
                _hover={{ color: 'var(--color-text)' }}
            >
                <LuInfo size={14} />
            </Box>
        </Tooltip>
    );
}

function PlotFormRow({
    label,
    hint,
    children,
}: {
    label: ReactNode;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <HStack gap={2} align="center" w="100%">
            <HStack
                gap={1}
                flexShrink={0}
                w={PLOT_FORM_LABEL_W}
                justify="flex-end"
                align="center"
            >
                <Text
                    fontSize="xs"
                    fontWeight="semibold"
                    color="var(--color-text-muted)"
                    textAlign="right"
                >
                    {label}
                </Text>
                {hint ? <PlotFormHintIcon content={hint} /> : null}
            </HStack>
            <Box flex="1" minW={0}>
                {children}
            </Box>
        </HStack>
    );
}

function PlotFormSection({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <Box pt={1}>
            <HStack gap={1} mb={2} align="center">
                <Text fontSize="xs" fontWeight="semibold" color="var(--color-text-muted)">
                    {title}
                </Text>
                {hint ? <PlotFormHintIcon content={hint} /> : null}
            </HStack>
            {children}
        </Box>
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

/** Transform outputs only belong on data-mapping slots, not color/facet encodings. */
const TRANSFORM_PLOT_SLOTS = new Set(['x', 'y', 'value']);

function slotFieldsUsed(templateId: PlotTemplateId, fields: Record<string, string>): string[] {
    const template = getPlotTemplate(templateId);
    return template.slots
        .map((s) => fields[s.id]?.trim())
        .filter((f): f is string => Boolean(f));
}

export function PivotPlotView({
    chartData: chartDataProp,
    pivotData,
    pivotFields,
    pivotConfigKey,
    pageActions,
    topBarRight,
    onRenderToolbar,
    onShareableSpecChange,
    viewMode = 'builder',
}: PivotPlotViewProps) {
    const chartOnly = viewMode === 'chart-only';
    const plotRef = useRef<VegaPlotHandle>(null);
    const [exportingPng, setExportingPng] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const plotFromUrl = useMemo(
        () => parsePivotPlotFromSearchParams(searchParams),
        [searchParams],
    );
    const lastSyncedPlotParamRef = useRef<string | null>(searchParams.get('plot'));
    const prevPivotConfigKeyRef = useRef(pivotConfigKey);

    const chartData = useMemo((): PivotChartData | null => {
        if (chartDataProp !== undefined) {
            return chartDataProp;
        }
        if (!pivotData?.length) {
            return null;
        }
        return convertPivotToChartData(pivotData, pivotFields);
    }, [chartDataProp, pivotData, pivotFields]);

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
    const [plotSize, setPlotSize] = useState<Required<PlotSizeOptions>>(
        normalizePlotSizeOptions(plotFromUrl?.plotSize),
    );
    const [legendOptions, setLegendOptions] = useState<Required<PlotLegendOptions>>(
        normalizePlotLegendOptions(plotFromUrl?.legendOptions),
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
                plotSize: normalizePlotSizeOptions(plotFromUrl.plotSize),
                legendOptions: normalizePlotLegendOptions(plotFromUrl.legendOptions),
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
                plotSize: normalizePlotSizeOptions(),
                legendOptions: normalizePlotLegendOptions(),
            };
        }

        setTemplateId(nextState.template);
        setPlotFields(nextState.fields);
        setTransforms(nextState.transforms ?? []);
        setHideNulls(nextState.hideNulls ?? true);
        setFacetLayout(normalizeFacetLayout(nextState.facetLayout));
        setAxisOptions(normalizePlotAxisOptions(nextState.axisOptions));
        setPlotSize(normalizePlotSizeOptions(nextState.plotSize));
        setLegendOptions(normalizePlotLegendOptions(nextState.legendOptions));
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
            facetLayout: hasPlotFacetFields(plotFields) ? facetLayout : undefined,
            axisOptions,
            plotSize,
            legendOptions,
        }),
        [templateId, plotFields, transforms, hideNulls, facetLayout, axisOptions, plotSize, legendOptions],
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
        setPlotSize(normalizePlotSizeOptions(fromUrl.plotSize));
        setLegendOptions(normalizePlotLegendOptions(fromUrl.legendOptions));
        lastSyncedPlotParamRef.current = plotParam;
    }, [searchParams, initialized, chartData]);

    const plotConfigOverrides = useMemo(
        () => buildPlotConfigOverrides(axisOptions, legendOptions),
        [axisOptions, legendOptions],
    );

    const handleAxisOptionChange = (key: keyof PlotAxisOptions, value: number) => {
        setCustomSpec(null);
        setAxisOptions((prev) => normalizePlotAxisOptions({ ...prev, [key]: value }));
    };

    const handlePlotSizeChange = (key: keyof PlotSizeOptions, value: number) => {
        setCustomSpec(null);
        setPlotSize((prev) => normalizePlotSizeOptions({ ...prev, [key]: value }));
    };

    const handleLegendPlacementChange = (placement: PlotLegendPlacement) => {
        setCustomSpec(null);
        setLegendOptions((prev) => normalizePlotLegendOptions({ ...prev, placement }));
    };

    const handleLegendDirectionChange = (direction: PlotLegendDirection) => {
        setCustomSpec(null);
        setLegendOptions((prev) => normalizePlotLegendOptions({ ...prev, direction }));
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

    const derivedPlotFields = useMemo(
        () => derivedTransformFields(transforms, chartData?.fields ?? []),
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
            width: plotSize.width,
            height: plotSize.height,
            facetLayout: hasPlotFacetFields(plotFields) ? facetLayout : undefined,
            swapAxes: axisOptions.swapAxes,
        });
    }, [chartData, templateId, plotFields, fieldMeta, transforms, rows, plotRows, facetLayout, axisOptions.swapAxes, plotSize]);

    const plotSpecWithData = useCallback((_w: number, _h: number) => {
        const base = customSpec ?? specBuilder(_w, _h);
        if (!base) return null;
        const dataRows = customSpec || hasActiveTransforms(transforms) ? rows : plotRows;
        return injectPlotData(base, dataRows);
    }, [customSpec, specBuilder, rows, plotRows, transforms]);

    const canRenderPlot = customSpec
        ? true
        : Boolean(chartData && templateRequiredFieldsFilled(templateId, plotFields));

    const shareableSpec = useMemo(() => {
        if (!canRenderPlot) return null;
        const base = customSpec ?? specBuilder(800, 500);
        if (!base) return null;

        const withDataUrl = injectPlotDataUrl(base, pivotMeltApiUrl(searchParams));
        const configOverrides = buildPlotConfigOverrides(axisOptions, legendOptions);
        const existingConfig = withDataUrl.config && typeof withDataUrl.config === 'object' && !Array.isArray(withDataUrl.config)
            ? withDataUrl.config as Record<string, unknown>
            : {};

        return {
            ...withDataUrl,
            $schema: withDataUrl.$schema ?? 'https://vega.github.io/schema/vega-lite/v5.json',
            config: { ...existingConfig, ...configOverrides },
        };
    }, [canRenderPlot, customSpec, specBuilder, searchParams, axisOptions, legendOptions]);

    useEffect(() => {
        onShareableSpecChange?.(shareableSpec);
    }, [shareableSpec, onShareableSpecChange]);

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

    const handleSwapAxesChange = (checked: boolean) => {
        setCustomSpec(null);
        setAxisOptions((prev) => normalizePlotAxisOptions({ ...prev, swapAxes: checked }));
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

    const hasFacetField = hasPlotFacetFields(plotFields);

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

    const toolbar = useMemo(
        () => (
            <HStack
                gap={2}
                flexWrap="nowrap"
                flexShrink={0}
                overflowX="auto"
                maxW="100%"
                justify="flex-end"
                align="center"
            >
                {topBarRight}
                {topBarRight ? (
                    <Box w="1px" h="18px" bg="var(--color-border)" flexShrink={0} aria-hidden />
                ) : null}
                <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopyLink} flexShrink={0}>
                    Copy builder link
                </Button>
                <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleExportPng} disabled={!canRenderPlot || exportingPng} flexShrink={0}>
                    {exportingPng ? 'Saving…' : 'Save PNG'}
                </Button>
                <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopyData} disabled={rows.length === 0} flexShrink={0}>
                    Copy data
                </Button>
                <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={openSpecEditor} flexShrink={0}>
                    Edit spec
                </Button>
                <Button size="xs" variant="outline" borderColor="var(--color-border)" color="var(--color-text)" onClick={handleCopySpec} flexShrink={0}>
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
                        flexShrink={0}
                    >
                        Custom spec ×
                    </Badge>
                )}
            </HStack>
        ),
        [
            topBarRight,
            canRenderPlot,
            exportingPng,
            rows.length,
            customSpec,
        ],
    );

    useEffect(() => {
        if (!onRenderToolbar) return;
        onRenderToolbar(toolbar);
        return () => onRenderToolbar(null);
    }, [onRenderToolbar, toolbar]);

    if (!chartData) {
        return (
            <Box p={8} textAlign="center">
                <Text color="var(--color-text-muted)">No pivot data to plot. Run a query first.</Text>
            </Box>
        );
    }

    if (chartOnly) {
        return (
            <Box
                flex="1"
                minH="320px"
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
                            Plot configuration is incomplete for the current data.
                        </Text>
                    </Box>
                ) : !customSpec && plotRows.length === 0 && rows.length > 0 ? (
                    <Box display="flex" alignItems="center" justifyContent="center" h="100%" minH="200px" p={4}>
                        <Text color="var(--color-text-muted)" textAlign="center">
                            All rows are null for the selected fields.
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
        );
    }

    return (
        <VStack align="stretch" gap={3} h="100%" minH={0}>
            {!onRenderToolbar && toolbar}

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
                            savePlotLabel={pageActions.savePlotLabel}
                            loadedSavedQueryName={pageActions.loadedSavedQueryName}
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
                            <PlotFormRow label="Type" hint={template.description}>
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

                            {template.slots.map((slot) => {
                                const options = fieldsForSlot(availablePlotFields, slot.kind);
                                const transformed = TRANSFORM_PLOT_SLOTS.has(slot.id)
                                    ? fieldsForSlot(derivedPlotFields, slot.kind)
                                    : [];
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
                                    <PlotFormRow
                                        label="Layout"
                                        hint={FACET_LAYOUT_OPTIONS.find((o) => o.value === facetLayout.mode)?.description ?? ''}
                                    >
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
                                        <PlotFormRow
                                            label="Indep. axes"
                                            hint="Checked axes use a separate scale per facet"
                                        >
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
                                </Box>
                            )}

                            <PlotFormRow
                                label="Swap X/Y"
                                hint="Exchange X and Y encodings on plots with both axes"
                            >
                                <Checkbox.Root
                                    size="sm"
                                    checked={axisOptions.swapAxes}
                                    onCheckedChange={(e) => handleSwapAxesChange(Boolean(e.checked))}
                                >
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                </Checkbox.Root>
                            </PlotFormRow>

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

                            <PlotFormRow
                                label="Legend"
                                hint={
                                    PLOT_LEGEND_PLACEMENT_OPTIONS.find(
                                        (option) => option.value === legendOptions.placement,
                                    )?.description ?? ''
                                }
                            >
                                <NativeSelect.Root size="sm">
                                    <NativeSelect.Field
                                        value={legendOptions.placement}
                                        onChange={(e) => handleLegendPlacementChange(e.target.value as PlotLegendPlacement)}
                                        bg="var(--color-bg-card)"
                                        borderColor="var(--color-border)"
                                        color="var(--color-text)"
                                    >
                                        {PLOT_LEGEND_PLACEMENT_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </PlotFormRow>

                            {legendOptions.placement !== 'none' && (
                                <PlotFormRow
                                    label="Legend flow"
                                    hint={
                                        PLOT_LEGEND_DIRECTION_OPTIONS.find(
                                            (option) => option.value === legendOptions.direction,
                                        )?.description ?? ''
                                    }
                                >
                                    <NativeSelect.Root size="sm">
                                        <NativeSelect.Field
                                            value={legendOptions.direction}
                                            onChange={(e) => handleLegendDirectionChange(e.target.value as PlotLegendDirection)}
                                            bg="var(--color-bg-card)"
                                            borderColor="var(--color-border)"
                                            color="var(--color-text)"
                                        >
                                            {PLOT_LEGEND_DIRECTION_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                    </NativeSelect.Root>
                                </PlotFormRow>
                            )}

                            <PlotFormSection
                                title="Plot size"
                                hint="Base size in pixels for each plot panel (facets use this per cell)"
                            >
                                <VStack align="stretch" gap={2}>
                                    <PlotAxisDialRow
                                        label="Width"
                                        value={plotSize.width}
                                        min={200}
                                        max={1200}
                                        onChange={(value) => handlePlotSizeChange('width', value)}
                                    />
                                    <PlotAxisDialRow
                                        label="Height"
                                        value={plotSize.height}
                                        min={50}
                                        max={900}
                                        onChange={(value) => handlePlotSizeChange('height', value)}
                                    />
                                </VStack>
                            </PlotFormSection>

                            <PlotFormSection
                                title="Axis spacing"
                                hint="Increase title spacing when tick values overlap the axis name"
                            >
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
                            </PlotFormSection>
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
