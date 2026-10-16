import { describe, expect, it } from 'vitest';
import { buildAppStyle } from '@/components/app/presentation/buildAppStyle';
import type { Theme } from '@/types';

// test/unit/app/buildAppStyle.test.ts

const songTheme: Theme = {
    name: 'Song',
    backgroundColor: '#101418',
    primaryColor: '#e7ecef',
    accentColor: '#f97316',
    secondaryColor: '#64748b',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const asStyleMap = (style: ReturnType<typeof buildAppStyle>) => style as Record<string, string | undefined>;

describe('buildAppStyle', () => {
    it('adds the duotone wash only when the song theme carries stops', () => {
        const style = asStyleMap(buildAppStyle({
            bgMode: 'ai',
            isDaylight: false,
            theme: { ...songTheme, backgroundStops: [songTheme.backgroundColor, songTheme.accentColor] },
            daylightTheme: songTheme,
            defaultTheme: songTheme,
        }));

        expect(style.backgroundImage).toContain('linear-gradient(155deg');
        // Leading edge fully transparent, trailing edge tinted at ~34% alpha.
        expect(style.backgroundImage).toContain(`${songTheme.backgroundColor}00 0%`);
        expect(style.backgroundImage).toContain(`${songTheme.accentColor}57 100%`);
    });

    it('stays a flat color for stopless themes, the default mode and transparent shells', () => {
        const stops = [songTheme.backgroundColor, songTheme.accentColor];

        const noStops = asStyleMap(buildAppStyle({
            bgMode: 'ai',
            isDaylight: false,
            theme: songTheme,
            daylightTheme: songTheme,
            defaultTheme: songTheme,
        }));
        expect(noStops.backgroundImage).toBeUndefined();

        const defaultMode = asStyleMap(buildAppStyle({
            bgMode: 'default',
            isDaylight: false,
            theme: { ...songTheme, backgroundStops: stops },
            daylightTheme: songTheme,
            defaultTheme: songTheme,
        }));
        expect(defaultMode.backgroundImage).toBeUndefined();

        const transparentShell = asStyleMap(buildAppStyle({
            bgMode: 'ai',
            isDaylight: false,
            theme: { ...songTheme, backgroundStops: stops },
            daylightTheme: songTheme,
            defaultTheme: songTheme,
            transparentBackground: true,
        }));
        expect(transparentShell.backgroundImage).toBeUndefined();
    });
});
