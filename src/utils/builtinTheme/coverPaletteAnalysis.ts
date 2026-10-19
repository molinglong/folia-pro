import { getHueDistance, hexToHsl, normalizeHue, type Hsl } from '../themeColorMath';

// src/utils/builtinTheme/coverPaletteAnalysis.ts
// Reads the cover's extracted colors and decides the color skeleton of a built-in theme: which
// hue leads, which hue accents it, and how saturated/deep the backgrounds should read. Callers
// pass population-weighted swatches in area order (largest first): the dominant colorful swatch
// wins, not the loudest pixel.

export type HarmonyScheme = 'duotone' | 'monochrome';
export type PaletteTone = 'ink' | 'tinted' | 'rich';

export type CoverPalette = {
    baseHue: number;
    baseSaturation: number;
    baseLightness: number;
    accentHue: number;
    /** How colorful the swatch the accent borrows its hue from actually is (0 = neutral). */
    accentSaturation: number;
    scheme: HarmonyScheme;
    tone: PaletteTone;
};

const MIN_SUPPORT_SATURATION = 0.15;
const MIN_SUPPORT_HUE_DISTANCE = 25;
const MAX_SUPPORT_HUE_DISTANCE = 160;
// A swatch that is essentially black, white or grey has no hue to build a theme on. Cover borders,
// plain backdrops and letterboxing are usually the largest swatches, so the leading color has to
// skip them instead of inheriting a grey tone.
const MIN_BASE_SATURATION = 0.1;
const MIN_BASE_LIGHTNESS = 0.06;
const MAX_BASE_LIGHTNESS = 0.94;

const isColorless = ({ s, l }: Hsl) => s < MIN_BASE_SATURATION || l < MIN_BASE_LIGHTNESS || l > MAX_BASE_LIGHTNESS;

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

    // Swatches arrive largest-area first, so the leading colorful one is the cover's dominant hue.
    // Fall back to the largest swatch when the artwork is genuinely monochrome.
    return parsedColors.find(color => !isColorless(color)) ?? parsedColors[0];
};

// The accent borrows the cover's own second hue. Walking the swatches in area order keeps it on
// a real region of the artwork instead of a tiny saturated detail in a corner.
const pickSupportColor = (parsedColors: Hsl[], base: Hsl) => parsedColors.find(candidate => {
    if (candidate.s < MIN_SUPPORT_SATURATION) return false;
    const distance = getHueDistance(candidate.h, base.h);
    return distance >= MIN_SUPPORT_HUE_DISTANCE && distance <= MAX_SUPPORT_HUE_DISTANCE;
}) ?? null;

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
    // A near-grey swatch still carries an arbitrary hue from JPEG noise or a tinted grey. The
    // generator uses the saturation of the swatch the hue came from as a colorfulness budget, so a
    // black-and-white cover yields a neutral theme instead of a vivid one built on that stray hue.
    const support = pickSupportColor(parsedColors, base);
    const supportHue = support ? support.h : null;
    const scheme = pickScheme(supportHue);
    const accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16;

    return {
        baseHue: normalizeHue(base.h),
        baseSaturation: base.s,
        baseLightness: base.l,
        accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue) + accentJitter),
        accentSaturation: support ? support.s : base.s,
        scheme,
        tone: pickWeighted<PaletteTone>(random, [
            { value: 'ink', weight: 3 },
            { value: 'tinted', weight: 4 },
            { value: 'rich', weight: 2.5 },
        ]),
    };
};
