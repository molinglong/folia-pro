import type { CSSProperties } from 'react';
import type { Theme } from '../../../types';

// src/components/app/presentation/buildAppStyle.ts

const withAlpha = (hex: string, alpha: number) => (
    `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
);

// Duotone covers carry a soft wash over the flat background: transparent at the leading edge,
// gently tinted with the cover's own colors toward the trailing one. Monochrome covers and
// default themes have no stops and stay a single flat color.
const buildBackgroundImage = (theme: Theme) => {
    const stops = theme.backgroundStops;
    if (!stops || stops.length < 2) {
        return undefined;
    }

    const maxAlpha = 0.34;
    const segments = stops.map((stop, index) => {
        const ratio = index / (stops.length - 1);
        return `${withAlpha(stop, maxAlpha * ratio)} ${Math.round(ratio * 100)}%`;
    });

    return `linear-gradient(155deg, ${segments.join(', ')})`;
};

// Builds CSS custom properties for the top-level app shell theme surface.
export const buildAppStyle = ({
    bgMode,
    isDaylight,
    theme,
    daylightTheme,
    defaultTheme,
    transparentBackground = false,
}: {
    bgMode: string;
    isDaylight: boolean;
    theme: Theme;
    daylightTheme: Theme;
    defaultTheme: Theme;
    transparentBackground?: boolean;
}) => {
    // The wash rides on the song theme only, and never on a transparent (OBS / native blur) shell.
    const backgroundImage = transparentBackground || bgMode !== 'ai'
        ? undefined
        : buildBackgroundImage(theme);

    return {
        '--bg-color': bgMode === 'default' ? (isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor) : theme.backgroundColor,
        '--text-primary': theme.primaryColor,
        '--text-secondary': theme.secondaryColor,
        '--text-accent': theme.accentColor,
        backgroundColor: transparentBackground ? 'transparent' : 'var(--bg-color)',
        ...(backgroundImage ? { backgroundImage } : {}),
        color: 'var(--text-primary)',
    } as CSSProperties;
};
