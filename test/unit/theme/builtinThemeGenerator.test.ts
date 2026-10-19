import { describe, expect, it } from 'vitest';
import { BUILTIN_THEME_PROVIDER, COVER_PALETTE_VERSION, generateBuiltinDualTheme } from '@/utils/builtinTheme/generateBuiltinDualTheme';
import { analyzeCoverPalette } from '@/utils/builtinTheme/coverPaletteAnalysis';
import { BUILTIN_NAME_SUFFIX } from '@/utils/builtinTheme/themeNameTable';
import { sanitizeDualTheme } from '@/services/themeSanitizer';
import { getContrastRatio, getHueDistance, hexToHsl } from '@/utils/themeColorMath';
import type { Theme } from '@/types';

// test/unit/theme/builtinThemeGenerator.test.ts

const createSequenceRandom = (seed: number) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
};

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

const expectReadableTheme = (theme: Theme) => {
    expect(getContrastRatio(theme.primaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(9);
    expect(getContrastRatio(theme.accentColor, theme.backgroundColor)).toBeGreaterThanOrEqual(3.2);
    expect(getContrastRatio(theme.secondaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(4.5);
};

describe('generateBuiltinDualTheme', () => {
    // Sweep many seeds and cover shapes: the contrast floors are solved iteratively, so a single
    // sample would not prove the solver never gives up short of the floor.
    const coverSamples: string[][] = [
        [],
        ['#f97316'],
        ['#22c55e', '#0ea5e9'],
        ['#7c3aed', '#f43f5e', '#facc15'],
        ['#2a2a2c', '#333336'],
        ['rgb(235, 120, 60)', 'rgb(40, 150, 220)'],
    ];

    it('stamps cover-derived themes with the current palette version', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#f97316'],
            random: createSequenceRandom(7),
        });

        expect(dualTheme.light.provider).toBe(BUILTIN_THEME_PROVIDER);
        expect(dualTheme.dark.provider).toBe(BUILTIN_THEME_PROVIDER);
        expect(dualTheme.light.paletteVersion).toBe(COVER_PALETTE_VERSION);
        expect(dualTheme.dark.paletteVersion).toBe(COVER_PALETTE_VERSION);
        // The stamp must survive the sanitizer so a fresh cache is not immediately treated stale.
        expect(sanitizeDualTheme(dualTheme).light.paletteVersion).toBe(COVER_PALETTE_VERSION);
    });

    it('gives duotone covers a background wash and keeps monochrome covers flat', () => {
        const duotone = generateBuiltinDualTheme({
            coverColors: ['#22c55e', '#0ea5e9'],
            random: createSequenceRandom(11),
        });

        for (const theme of [duotone.light, duotone.dark]) {
            expect(theme.backgroundStops).toEqual([theme.backgroundColor, theme.accentColor]);
        }

        const monochrome = generateBuiltinDualTheme({
            coverColors: ['#f97316'],
            random: createSequenceRandom(13),
        });

        expect(monochrome.light.backgroundStops).toBeUndefined();
        expect(monochrome.dark.backgroundStops).toBeUndefined();
    });

    it('keeps every generated theme readable and hex-shaped', () => {
        for (const coverColors of coverSamples) {
            for (let seed = 1; seed <= 25; seed += 1) {
                const dualTheme = generateBuiltinDualTheme({
                    coverColors,
                    random: createSequenceRandom(seed * 977 + 3),
                });

                for (const theme of [dualTheme.light, dualTheme.dark]) {
                    expect(theme.backgroundColor).toMatch(HEX_PATTERN);
                    expect(theme.primaryColor).toMatch(HEX_PATTERN);
                    expect(theme.accentColor).toMatch(HEX_PATTERN);
                    expect(theme.secondaryColor).toMatch(HEX_PATTERN);
                    expectReadableTheme(theme);
                }

                // Light stays light, dark stays dark.
                expect(hexToHsl(dualTheme.light.backgroundColor)!.l).toBeGreaterThan(0.85);
                expect(hexToHsl(dualTheme.dark.backgroundColor)!.l).toBeLessThan(0.2);
            }
        }
    });

    it('survives sanitizeDualTheme without any color being replaced', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#0ea5e9', '#f43f5e'],
            random: createSequenceRandom(42),
        });

        expect(sanitizeDualTheme(dualTheme)).toEqual(dualTheme);
    });

    it('names themes from the built-in table and marks them Built-in', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#7c3aed'],
            random: createSequenceRandom(5),
        });

        expect(dualTheme.light.name.endsWith(BUILTIN_NAME_SUFFIX)).toBe(true);
        expect(dualTheme.dark.name.endsWith(BUILTIN_NAME_SUFFIX)).toBe(true);
        expect(dualTheme.light.name.replace(BUILTIN_NAME_SUFFIX, '')).toHaveLength(4);
        expect(dualTheme.dark.name.replace(BUILTIN_NAME_SUFFIX, '')).toHaveLength(4);
        expect(dualTheme.light.name.slice(0, 2)).toBe(dualTheme.dark.name.slice(0, 2));
        expect(dualTheme.light.name).not.toBe(dualTheme.dark.name);
        expect(dualTheme.light.provider).toBe('Built-in');
    });

    it('fills a light and a dark atmosphere line from the description table', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#22c55e'],
            random: createSequenceRandom(13),
        });

        for (const theme of [dualTheme.light, dualTheme.dark]) {
            expect(theme.description?.length).toBeGreaterThanOrEqual(15);
            expect(theme.description?.length).toBeLessThanOrEqual(30);
        }

        expect(dualTheme.light.description).not.toBe(dualTheme.dark.description);
    });

    it('leaves wordColors and lyricsIcons empty (no lyrics semantics available)', () => {
        const dualTheme = generateBuiltinDualTheme({ random: createSequenceRandom(3) });

        expect(dualTheme.light.wordColors).toEqual([]);
        expect(dualTheme.light.lyricsIcons).toEqual([]);
        expect(dualTheme.dark.wordColors).toEqual([]);
        expect(dualTheme.dark.lyricsIcons).toEqual([]);
    });

    it('varies background and name across random streams even without a cover', () => {
        const themes = [1, 2, 3, 4, 5, 6].map(seed => (
            generateBuiltinDualTheme({ random: createSequenceRandom(seed * 7919) })
        ));

        expect(new Set(themes.map(theme => theme.dark.backgroundColor)).size).toBeGreaterThan(1);
        expect(new Set(themes.map(theme => theme.dark.name)).size).toBeGreaterThan(1);
    });

    it('takes the accent hue from a second cover color when the cover is duotone', () => {
        const coverColors = ['#f43f5e', '#0ea5e9'];

        const duotoneRuns = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => (
            analyzeCoverPalette(coverColors, createSequenceRandom(seed * 131))
        )).filter(palette => palette.scheme === 'duotone');

        expect(duotoneRuns.length).toBeGreaterThan(0);

        const coverHues = coverColors.map(color => hexToHsl(color)!.h);
        for (const palette of duotoneRuns) {
            // The accent is the cover's own second hue (plus the small jitter), not a computed one.
            const nearestCoverHue = Math.min(...coverHues.map(hue => getHueDistance(palette.accentHue, hue)));
            expect(nearestCoverHue).toBeLessThanOrEqual(8);
            expect(getHueDistance(palette.accentHue, palette.baseHue)).toBeGreaterThan(20);
        }
    });

    // Swatches arrive in area order. The leading colorful one is the cover's dominant hue; a big
    // black border or white backdrop must not swallow the theme, and a tiny saturated accent must
    // not beat a larger second color.
    it('lets the largest colorful swatch lead past black and white backdrops', () => {
        const palette = analyzeCoverPalette(['#1a1a1a', '#fafafa', '#3b82f6'], createSequenceRandom(17));

        expect(getHueDistance(palette.baseHue, hexToHsl('#3b82f6')!.h)).toBeLessThanOrEqual(1);
        // Only one colorful swatch: the accent stays on that same hue.
        expect(palette.scheme).toBe('monochrome');
    });

    it('takes the accent from the next-largest colorful swatch, not the loudest one', () => {
        const palette = analyzeCoverPalette(['#22c55e', '#0ea5e9', '#f43f5e'], createSequenceRandom(19));

        expect(getHueDistance(palette.baseHue, hexToHsl('#22c55e')!.h)).toBeLessThanOrEqual(1);
        expect(palette.scheme).toBe('duotone');
        // Red is more saturated than blue but covers less area, so blue must be the accent.
        expect(getHueDistance(palette.accentHue, hexToHsl('#0ea5e9')!.h)).toBeLessThanOrEqual(8);
    });

    it('falls back to the largest swatch when the artwork has no hue at all', () => {
        const palette = analyzeCoverPalette(['#2a2a2c', '#d4d4d8'], createSequenceRandom(23));

        expect(palette.scheme).toBe('monochrome');
        expect(palette.baseLightness).toBeCloseTo(hexToHsl('#2a2a2c')!.l, 5);
    });

    // A black-and-white sleeve still rounds to a near-grey swatch with a stray hue. Every role's
    // saturation is capped by the cover's own colorfulness, so that hue must not resurface as a
    // vivid accent (the purple stroke around the playing poster).
    it('keeps black-and-white artwork neutral instead of inventing a vivid accent', () => {
        const neutral = generateBuiltinDualTheme({
            coverColors: ['#8a8a8a', '#dcdcdc'],
            random: createSequenceRandom(31),
        });

        for (const theme of [neutral.light, neutral.dark]) {
            expect(hexToHsl(theme.accentColor)!.s).toBeLessThan(0.1);
            expect(hexToHsl(theme.secondaryColor)!.s).toBeLessThan(0.08);
            expect(hexToHsl(theme.primaryColor)!.s).toBeLessThan(0.08);
            expect(hexToHsl(theme.backgroundColor)!.s).toBeLessThan(0.1);
        }
    });

    it('keeps a vivid accent when the artwork really carries color', () => {
        const vivid = generateBuiltinDualTheme({
            coverColors: ['#3b82f6', '#f43f5e'],
            random: createSequenceRandom(37),
        });

        for (const theme of [vivid.light, vivid.dark]) {
            expect(hexToHsl(theme.accentColor)!.s).toBeGreaterThan(0.35);
        }
    });
});
