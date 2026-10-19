import type { DualTheme, Theme } from '../../types';
import {
    adjustLightnessForContrast,
    clamp01,
    getContrastRatio,
    getHueDistance,
    hslToHex,
    normalizeHue,
} from '../themeColorMath';
import { analyzeCoverPalette, type CoverPalette } from './coverPaletteAnalysis';
import { pickBuiltinThemeDescriptions } from './themeDescriptionTable';
import { pickBuiltinThemeNames } from './themeNameTable';
import {
    ACCENT_MIN_CONTRAST,
    ACCENT_RANGES,
    BACKGROUND_TONES,
    MIN_BACKGROUND_SATURATION,
    PRIMARY_MIN_CONTRAST,
    PRIMARY_RANGES,
    SECONDARY_MIN_CONTRAST,
    SECONDARY_RANGES,
    type Range,
    type ThemeMode,
} from './themeColorRanges';

// src/utils/builtinTheme/generateBuiltinDualTheme.ts
// Generates the light/dark theme pair used when no AI API key is configured. Every hue comes from
// the cover itself — the leading hue for ground and text, the cover's own second hue for the
// accent — instead of a random harmony scheme flinging colors across the wheel, and every text
// color is pushed along its lightness axis until it clears the contrast floor, so it keeps its
// hue rather than collapsing into a hard-coded near-white / near-black.

const between = (random: () => number, [min, max]: Range) => min + random() * (max - min);

// v2 stops flinging the accent hue with random harmony schemes; v3 additionally waits for the
// song's own artwork before deriving; v4 adds the duotone background wash; v5 reads
// population-weighted swatches in area order instead of the most saturated pixels; v6 caps every
// role's saturation by the cover's own colorfulness so neutral artwork stays neutral. Caches
// stamped below this are treated as missing.
export const COVER_PALETTE_VERSION = 6;
export const BUILTIN_THEME_PROVIDER = 'Built-in';

// Interpolates along the shorter arc so a base/accent pair never swings through the opposite hue.
const lerpHue = (from: number, to: number, amount: number) => {
    const delta = ((to - from + 540) % 360) - 180;
    return normalizeHue(from + delta * amount);
};

const buildBackgroundColor = (mode: ThemeMode, palette: CoverPalette, random: () => number) => {
    const tone = BACKGROUND_TONES[palette.tone];
    const lightnessRange = mode === 'dark' ? tone.darkLightness : tone.lightLightness;
    const saturationRange = mode === 'dark' ? tone.darkSaturation : tone.lightSaturation;
    // The ground is tinted in proportion to how colorful the cover actually is. A near-grey swatch
    // still carries an arbitrary hue, so a black-and-white sleeve has to stay neutral rather than
    // inherit a barely-visible tint at full background saturation.
    const coverWeight = 0.1 + 0.9 * clamp01((palette.baseSaturation - MIN_COVER_CHROMA) / 0.45);

    return hslToHex({
        h: palette.baseHue,
        s: Math.max(MIN_BACKGROUND_SATURATION, between(random, saturationRange) * coverWeight),
        l: between(random, lightnessRange),
    });
};

// Saturation below this reads as grey on a cover; only the excess above it is what the theme is
// allowed to amplify. A slightly tinted black-and-white photo must not become a vivid theme.
const MIN_COVER_CHROMA = 0.15;

// Maps a swatch's raw saturation to 0..1 colorfulness, discarding the near-grey floor.
const resolveCoverChroma = (saturation: number) => (
    saturation <= MIN_COVER_CHROMA ? 0 : (saturation - MIN_COVER_CHROMA) / (1 - MIN_COVER_CHROMA)
);

// Every role's saturation is capped by the colorfulness of the swatch it borrows its hue from:
// a neutral artwork yields neutral text and accents, a vivid one keeps its full range.
const resolveChromaCeiling = (saturation: number, gain: number, floor: number) => (
    clamp01(floor + resolveCoverChroma(saturation) * gain)
);

const buildAccentColor = (
    mode: ThemeMode,
    palette: CoverPalette,
    backgroundColor: string,
    primaryColor: string,
    random: () => number,
) => {
    const ranges = ACCENT_RANGES[mode];
    const saturation = Math.min(
        between(random, ranges.saturation),
        resolveChromaCeiling(palette.accentSaturation, 1.6, 0.06),
    );
    const lightness = between(random, ranges.lightness);
    const accent = adjustLightnessForContrast(
        hslToHex({ h: palette.accentHue, s: saturation, l: lightness }),
        backgroundColor,
        ACCENT_MIN_CONTRAST,
    );

    // A single-hue accent can land on top of the primary text color; rotate it away.
    const collidesWithPrimary = getHueDistance(palette.accentHue, palette.baseHue) < 15
        && getContrastRatio(accent, primaryColor) < 1.3;

    if (!collidesWithPrimary) {
        return accent;
    }

    return adjustLightnessForContrast(
        hslToHex({ h: normalizeHue(palette.accentHue + 40), s: saturation, l: lightness }),
        backgroundColor,
        ACCENT_MIN_CONTRAST,
    );
};

const buildModeTheme = (
    mode: ThemeMode,
    palette: CoverPalette,
    random: () => number,
    name: string,
    description: string,
): Theme => {
    const backgroundColor = buildBackgroundColor(mode, palette, random);

    const primaryRanges = PRIMARY_RANGES[mode];
    const primaryColor = adjustLightnessForContrast(
        hslToHex({
            h: palette.baseHue,
            s: Math.min(
                between(random, primaryRanges.saturation),
                resolveChromaCeiling(palette.baseSaturation, 1.2, 0.04),
            ),
            l: between(random, primaryRanges.lightness),
        }),
        backgroundColor,
        PRIMARY_MIN_CONTRAST,
    );

    const accentColor = buildAccentColor(mode, palette, backgroundColor, primaryColor, random);

    const secondaryRanges = SECONDARY_RANGES[mode];
    const secondaryColor = adjustLightnessForContrast(
        hslToHex({
            h: lerpHue(palette.baseHue, palette.accentHue, 0.2 + random() * 0.4),
            s: Math.min(
                between(random, secondaryRanges.saturation),
                resolveChromaCeiling(palette.baseSaturation, 1.2, 0.04),
            ),
            l: between(random, secondaryRanges.lightness),
        }),
        backgroundColor,
        SECONDARY_MIN_CONTRAST,
    );

    return {
        name,
        description,
        backgroundColor,
        primaryColor,
        accentColor,
        secondaryColor,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: BUILTIN_THEME_PROVIDER,
        paletteVersion: COVER_PALETTE_VERSION,
        // A duotone cover earns a soft accent wash over the ground color; a monochrome one stays
        // a single flat color by design.
        ...(palette.scheme === 'duotone' ? { backgroundStops: [backgroundColor, accentColor] } : {}),
    };
};

export const generateBuiltinDualTheme = ({
    coverColors = [],
    random = Math.random,
}: {
    coverColors?: string[];
    random?: () => number;
} = {}): DualTheme => {
    const palette = analyzeCoverPalette(coverColors, random);
    const names = pickBuiltinThemeNames(palette, random);
    const descriptions = pickBuiltinThemeDescriptions(palette, random);

    return {
        light: buildModeTheme('light', palette, random, names.light, descriptions.light),
        dark: buildModeTheme('dark', palette, random, names.dark, descriptions.dark),
    };
};
