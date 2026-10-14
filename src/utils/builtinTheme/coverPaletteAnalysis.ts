import { getHueDistance, hexToHsl, normalizeHue, type Hsl } from '../themeColorMath';

// src/utils/builtinTheme/coverPaletteAnalysis.ts
// Reads the cover's extracted colors and decides the color skeleton of a built-in theme: which
// hue leads, which hue accents it, and how saturated/deep the backgrounds should read.

export type HarmonyScheme = 'duotone' | 'monochrome';
export type PaletteTone = 'ink' | 'tinted' | 'rich';

export type CoverPalette = {
    baseHue: number;
    baseSaturation: number;
    baseLightness: number;
    accentHue: number;
    scheme: HarmonyScheme;
    tone: PaletteTone;
};

const MIN_SUPPORT_SATURATION = 0.15;
const MIN_SUPPORT_HUE_DISTANCE = 25;
const MAX_SUPPORT_HUE_DISTANCE = 160;

// Prefers colors that are both saturated and mid-lightness: those carry the cover's identity,
// while near-black / near-white pixels only describe its background.
const getCoverColorScore = ({ s, l }: Hsl) => s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.2);

const pickWeighted = <T,>(random: () => number, entries: { value: T; weight: number; }[]): T => {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = random() * total;

    for (const entry of entries) {
        cursor -= entry.weight;
        if (cursor <= 0) {
            return entry.value;
        }
    }

    return entries[entries.length - 1].value;
};

const pickBaseColor = (parsedColors: Hsl[], random: () => number): Hsl => {
    if (parsedColors.length === 0) {
        // No cover to read: pick a hue outright so a coverless song still varies run to run.
        return { h: random() * 360, s: 0.35 + random() * 0.3, l: 0.5 };
    }

    const scored = parsedColors.reduce((best, candidate) => (
        getCoverColorScore(candidate) > getCoverColorScore(best) ? candidate : best
    ), parsedColors[0]);

    return getCoverColorScore(scored) > 0.02 ? scored : parsedColors[0];
};

const pickSupportHue = (parsedColors: Hsl[], base: Hsl) => {
    const support = parsedColors.find(candidate => {
        if (candidate.s < MIN_SUPPORT_SATURATION) return false;
        const distance = getHueDistance(candidate.h, base.h);
        return distance >= MIN_SUPPORT_HUE_DISTANCE && distance <= MAX_SUPPORT_HUE_DISTANCE;
    });

    return support ? support.h : null;
};

const pickScheme = (supportHue: number | null): HarmonyScheme => {
    // The accent must stay on the artwork: a real second hue when the cover carries one, the
    // leading hue again when it doesn't. Random harmony schemes are what sent yellow covers to
    // green and blue ones to purple — the wheel spin never reads as "this song's colors".
    return supportHue !== null ? 'duotone' : 'monochrome';
};

const resolveAccentHue = (
    scheme: HarmonyScheme,
    baseHue: number,
    supportHue: number | null,
) => {
    if (scheme === 'duotone') {
        return supportHue ?? baseHue;
    }
    return baseHue;
};

// Turns raw cover swatches into the hue/tone contract the built-in theme generator builds on.
export const analyzeCoverPalette = (coverColors: string[], random: () => number): CoverPalette => {
    const parsedColors = coverColors
        .map(color => hexToHsl(color))
        .filter((color): color is Hsl => color !== null);

    const base = pickBaseColor(parsedColors, random);
    const supportHue = pickSupportHue(parsedColors, base);
    const scheme = pickScheme(supportHue);
    const accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16;

    return {
        baseHue: normalizeHue(base.h),
        baseSaturation: base.s,
        baseLightness: base.l,
        accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue) + accentJitter),
        scheme,
        tone: pickWeighted<PaletteTone>(random, [
            { value: 'ink', weight: 3 },
            { value: 'tinted', weight: 4 },
            { value: 'rich', weight: 2.5 },
        ]),
    };
};
