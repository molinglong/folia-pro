import { describe, expect, it } from 'vitest';
import { polishAiDualTheme, polishAiTheme } from '@/services/aiThemePolish';
import { getContrastRatio } from '@/utils/themeColorMath';
import {
    ACCENT_MIN_CONTRAST,
    PRIMARY_MIN_CONTRAST,
    SECONDARY_MIN_CONTRAST,
} from '@/utils/builtinTheme/themeColorRanges';
import type { Theme } from '@/types';

// test/unit/theme/aiThemePolish.test.ts

const baseTheme: Theme = {
    name: 'AI 主题',
    backgroundColor: '#0b1020',
    primaryColor: '#e7ecef',
    accentColor: '#f97316',
    secondaryColor: '#64748b',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [{ word: 'gone', color: '#8a8f9a' }],
    lyricsIcons: [],
};

describe('polishAiTheme', () => {
    it('lifts text colors that sit under the contrast floors and keeps passing ones', () => {
        const weak: Theme = {
            ...baseTheme,
            primaryColor: '#2a3040',
            secondaryColor: '#1f2534',
            accentColor: '#141a2c',
            wordColors: [{ word: 'gone', color: '#333a4a' }],
        };

        const polished = polishAiTheme(weak);

        expect(getContrastRatio(polished.primaryColor, polished.backgroundColor))
            .toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST);
        expect(getContrastRatio(polished.secondaryColor, polished.backgroundColor))
            .toBeGreaterThanOrEqual(SECONDARY_MIN_CONTRAST);
        expect(getContrastRatio(polished.accentColor, polished.backgroundColor))
            .toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
        const firstWordColor = polished.wordColors?.[0];
        expect(firstWordColor && getContrastRatio(firstWordColor.color, polished.backgroundColor))
            .toBeGreaterThanOrEqual(SECONDARY_MIN_CONTRAST);

        const passing = polishAiTheme(baseTheme);
        // Colors already over their floor come back untouched, so the model's design survives.
        expect(passing.primaryColor).toBe(baseTheme.primaryColor);
        expect(passing.accentColor).toBe(baseTheme.accentColor);
    });

    it('adds the duotone wash only when the accent really is a second color', () => {
        const polished = polishAiTheme(baseTheme);
        expect(polished.backgroundStops).toEqual([baseTheme.backgroundColor, polished.accentColor]);

        // A single-hue palette stays a flat color, mirroring the monochrome-cover rule.
        const monochrome = polishAiTheme({ ...baseTheme, accentColor: '#1d2b4f' });
        expect(monochrome.backgroundStops).toBeUndefined();
    });

    it('polishes both sides of the dual theme', () => {
        const dual = polishAiDualTheme({ light: baseTheme, dark: baseTheme });

        for (const side of [dual.light, dual.dark]) {
            expect(getContrastRatio(side.primaryColor, side.backgroundColor))
                .toBeGreaterThanOrEqual(PRIMARY_MIN_CONTRAST);
            expect(side.backgroundStops).toEqual([side.backgroundColor, side.accentColor]);
        }
    });
});
