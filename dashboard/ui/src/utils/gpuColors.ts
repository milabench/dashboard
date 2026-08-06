/**
 * Vendor-tinted GPU color scales for Vega plots.
 * NVIDIA → greens/teals, AMD → reds/oranges, Intel → blues,
 * Tenstorrent → purples (CSS vars in theme.css).
 */

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'tenstorrent';

export type ColorScale = { domain: string[]; range: string[] };

const VENDOR_ORDER: GpuVendor[] = ['nvidia', 'amd', 'intel', 'tenstorrent'];

const VENDOR_BASE: Record<GpuVendor, { css: string; fallback: string }> = {
    nvidia: { css: '--color-vendor-nvidia', fallback: '#76B900' },
    amd: { css: '--color-vendor-amd', fallback: '#DC2626' },
    intel: { css: '--color-vendor-intel', fallback: '#0071C5' },
    tenstorrent: { css: '--color-vendor-tenstorrent', fallback: '#7C3AED' },
};

const RAMP_VARS: Record<GpuVendor, readonly string[]> = {
    nvidia: [
        '--color-nvidia-1',
        '--color-nvidia-2',
        '--color-nvidia-3',
        '--color-nvidia-4',
        '--color-nvidia-5',
        '--color-nvidia-6',
        '--color-nvidia-7',
        '--color-nvidia-8',
    ],
    amd: [
        '--color-amd-1',
        '--color-amd-2',
        '--color-amd-3',
        '--color-amd-4',
        '--color-amd-5',
        '--color-amd-6',
        '--color-amd-7',
        '--color-amd-8',
    ],
    intel: [
        '--color-intel-1',
        '--color-intel-2',
        '--color-intel-3',
        '--color-intel-4',
        '--color-intel-5',
        '--color-intel-6',
    ],
    tenstorrent: [
        '--color-tenstorrent-1',
        '--color-tenstorrent-2',
        '--color-tenstorrent-3',
        '--color-tenstorrent-4',
        '--color-tenstorrent-5',
        '--color-tenstorrent-6',
    ],
};

const RAMP_FALLBACK: Record<GpuVendor, string[]> = {
    nvidia: [
        '#76B900',
        '#0D9488',
        '#C4D600',
        '#166534',
        '#22C55E',
        '#065F46',
        '#84CC16',
        '#115E59',
    ],
    amd: [
        '#DC2626',
        '#EA580C',
        '#BE123C',
        '#F97316',
        '#9F1239',
        '#FB7185',
        '#7F1D1D',
        '#E11D48',
    ],
    intel: [
        '#0071C5',
        '#0EA5E9',
        '#1E3A8A',
        '#38BDF8',
        '#0369A1',
        '#60A5FA',
    ],
    tenstorrent: [
        '#7C3AED',
        '#A855F7',
        '#5B21B6',
        '#C084FC',
        '#6D28D9',
        '#E9D5FF',
    ],
};

/** Resolve a CSS custom property from :root (falls back when SSR / unset). */
export function cssColor(name: string, fallback: string): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return value || fallback;
}

/**
 * Infer vendor from a GPU product / stem name.
 * Aligns with dashboard.server.database.gpu._guess_vendor plus common
 * product strings from exec metadata.
 */
export function guessVendor(name: string): GpuVendor {
    const upper = (name || '').trim().toUpperCase();
    if (!upper) return 'nvidia';

    if (
        upper.includes('TENSTORRENT') ||
        upper.includes('WORMHOLE') ||
        upper.includes('BLACKHOLE') ||
        upper.includes('GRAYSKULL') ||
        upper.includes('GALAXY') && upper.includes('TT') ||
        /(^|[^A-Z])TT[-_]?N?\d/.test(upper) ||
        upper.startsWith('N300') ||
        upper.startsWith('P150')
    ) {
        return 'tenstorrent';
    }

    if (
        upper.includes('INTEL') ||
        upper.includes('GAUDI') ||
        upper.includes('HABANA') ||
        upper.includes('ARC A') ||
        upper.includes('DATA CENTER GPU') ||
        /(^|[^A-Z])XPU\b/.test(upper) ||
        /(^|[^A-Z])PVC\b/.test(upper) ||
        /\bMAX\s*1[135]0\b/.test(upper)
    ) {
        return 'intel';
    }

    if (
        upper.startsWith('MI') ||
        upper.includes('AMD') ||
        upper.includes('INSTINCT') ||
        upper.includes('RADEON') ||
        /(^|[^A-Z])RX\s*\d/.test(upper)
    ) {
        return 'amd';
    }

    return 'nvidia';
}

function rampColors(vendor: GpuVendor): string[] {
    const vars = RAMP_VARS[vendor];
    const fallbacks = RAMP_FALLBACK[vendor];
    return vars.map((v, i) => cssColor(v, fallbacks[i] ?? fallbacks[0]));
}

/**
 * Assign palette colors with maximum separation when there are fewer
 * series than colors (e.g. 2 GPUs → first + last, not two adjacent greens).
 */
function assignFromPalette(names: string[], palette: string[]): string[] {
    if (names.length === 0) return [];
    if (palette.length === 0) return names.map(() => '#718096');
    if (names.length === 1) return [palette[0]];
    if (names.length >= palette.length) {
        return names.map((_, i) => palette[i % palette.length]);
    }
    const last = palette.length - 1;
    return names.map((_, i) => {
        const idx = Math.round((i * last) / (names.length - 1));
        return palette[idx];
    });
}

/** Nominal color scale for per-GPU series, tinted by vendor family. */
export function buildGpuColorScale(gpuNames: Iterable<string>): ColorScale {
    const unique = [...new Set([...gpuNames].filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
    );

    const byVendor: Record<GpuVendor, string[]> = {
        nvidia: [],
        amd: [],
        intel: [],
        tenstorrent: [],
    };
    for (const gpu of unique) {
        byVendor[guessVendor(gpu)].push(gpu);
    }

    const domain: string[] = [];
    const range: string[] = [];
    for (const vendor of VENDOR_ORDER) {
        const names = byVendor[vendor];
        domain.push(...names);
        range.push(...assignFromPalette(names, rampColors(vendor)));
    }
    return { domain, range };
}

/** Nominal color scale when the field is already a vendor string. */
export function buildVendorColorScale(
    vendors: Iterable<string> = VENDOR_ORDER,
): ColorScale {
    const present = new Set(
        [...vendors].map((v) => v.toLowerCase().trim()).filter(Boolean),
    );

    const domain: string[] = [];
    const range: string[] = [];
    for (const vendor of VENDOR_ORDER) {
        if (!present.has(vendor)) continue;
        domain.push(vendor);
        const { css, fallback } = VENDOR_BASE[vendor];
        range.push(cssColor(css, fallback));
    }
    return { domain, range };
}

/** Chakra colorPalette for arch/vendor badges (Supported GPUs, etc.). */
export function vendorBadgePalette(
    archOrVendor: string,
): 'green' | 'red' | 'blue' | 'purple' | 'gray' {
    const key = (archOrVendor || '').trim().toLowerCase();
    if (key === 'cuda' || key === 'nvidia') return 'green';
    if (key === 'rocm' || key === 'amd') return 'red';
    if (key === 'xpu' || key === 'hpu' || key === 'intel' || key === 'gaudi') {
        return 'blue';
    }
    if (key === 'tenstorrent' || key === 'tt') return 'purple';
    return 'gray';
}
