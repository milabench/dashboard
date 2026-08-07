import { Button, HStack } from '@chakra-ui/react';
import {
    pivotPlotShareUrl,
    pivotTableShareUrl,
} from '../../utils/pivotUrlParams';

/** Match outline toolbar buttons; anchors need explicit padding because global button CSS only targets `button`. */
const outlineToolbarButtonProps = {
    variant: 'outline' as const,
    color: 'var(--color-text)',
    borderColor: 'var(--color-border)',
    bg: 'var(--color-bg-card)',
    borderRadius: '8px',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    _hover: { bg: 'var(--color-bg-hover)', textDecoration: 'none' },
    flexShrink: 0,
};

const outlineToolbarPadding = {
    xs: { px: 3, py: 1.5, minH: 7, fontSize: 'xs' },
    sm: { px: 4, py: 2, minH: 8, fontSize: 'sm' },
} as const;

interface PivotShareActionsProps {
    kind: 'table' | 'plot';
    searchParams: URLSearchParams;
    plotShareSpec?: Record<string, unknown> | null;
    disabled?: boolean;
    size?: 'xs' | 'sm';
}

export function PivotShareActions({
    kind,
    searchParams,
    plotShareSpec = null,
    disabled = false,
    size = 'sm',
}: PivotShareActionsProps) {
    const sharePath = kind === 'table'
        ? pivotTableShareUrl(searchParams)
        : plotShareSpec
            ? pivotPlotShareUrl(plotShareSpec)
            : null;
    const viewLabel = kind === 'table' ? 'View table' : 'View plot';
    const paddingProps = outlineToolbarPadding[size];
    const isDisabled = disabled || !sharePath;

    return (
        <HStack gap={2} flexWrap="nowrap" flexShrink={0}>
            {isDisabled ? (
                <Button size={size} {...outlineToolbarButtonProps} {...paddingProps} disabled>
                    {viewLabel}
                </Button>
            ) : (
                <Button asChild size={size} {...outlineToolbarButtonProps} {...paddingProps}>
                    <a href={sharePath} target="_blank" rel="noopener noreferrer">
                        {viewLabel}
                    </a>
                </Button>
            )}
        </HStack>
    );
}
