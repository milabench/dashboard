/** Browser download helpers for plot/data export. */

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function downloadJson(data: unknown, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
    });
    const name = filename.endsWith('.json') ? filename : `${filename}.json`;
    downloadBlob(blob, name);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
}

/** Sanitize a string for use in a download filename. */
export function safeFilename(parts: Array<string | null | undefined>, ext: string): string {
    const stem = parts
        .filter(Boolean)
        .map((p) =>
            String(p)
                .trim()
                .replace(/[^a-zA-Z0-9._-]+/g, '_')
                .replace(/^_+|_+$/g, ''),
        )
        .filter(Boolean)
        .join('_');
    const base = stem || 'export';
    const suffix = ext.startsWith('.') ? ext : `.${ext}`;
    return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

/**
 * Export a Vega View to PNG with an opaque background (plots use transparent CSS bg).
 */
export async function exportVegaViewPng(
    view: { toCanvas: (scaleFactor?: number) => Promise<HTMLCanvasElement> },
    filename: string,
    options?: { scaleFactor?: number; background?: string },
): Promise<void> {
    const scaleFactor = options?.scaleFactor ?? 2;
    const background =
        options?.background ??
        (typeof document !== 'undefined'
            ? getComputedStyle(document.documentElement)
                  .getPropertyValue('--color-bg-page')
                  .trim() || '#ffffff'
            : '#ffffff');

    const rendered = await view.toCanvas(scaleFactor);
    const out = document.createElement('canvas');
    out.width = rendered.width;
    out.height = rendered.height;
    const ctx = out.getContext('2d');
    if (!ctx) {
        throw new Error('Could not create canvas context for PNG export');
    }
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(rendered, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, 'image/png'),
    );
    if (!blob) {
        throw new Error('PNG export failed');
    }
    const name = filename.endsWith('.png') ? filename : `${filename}.png`;
    downloadBlob(blob, name);
}
