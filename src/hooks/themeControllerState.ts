import { DualTheme, Theme } from '../types';
import { applyStoredAnimationIntensityToDualTheme } from '../services/themePreferences';
import { FALLBACK_AI_DUAL_THEME } from '../services/themeSanitizer';
import { generateBuiltinDualTheme } from '../utils/builtinTheme/generateBuiltinDualTheme';

export type ThemeSourceKind = 'default' | 'ai';
export type EditableThemeSourceKind = 'ai';

export type ThemeSourceOption = {
    source: ThemeSourceKind;
    available: boolean;
    editable: boolean;
    theme: Theme | null;
    label: string;
    swatchColor: string;
};

export type ThemeSourceModel = {
    activeSource: ThemeSourceKind;
    current: ThemeSourceOption;
    options: Record<ThemeSourceKind, ThemeSourceOption>;
    editableSource: EditableThemeSourceKind | null;
    canOpenQuickEditor: boolean;
    hasLocalAiTheme: boolean;
    // False while the "ai" slot only shows the hard-coded sanitizer fallback: the slot stays
    // clickable (click generates a real theme) but swatches must not pass the placeholder off as
    // this song's palette.
    hasSavedAiTheme: boolean;
};

export const getBaseThemeForMode = ({
    defaultTheme,
    daylightTheme,
    isDaylight,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}): Theme => {
    return isDaylight ? daylightTheme : defaultTheme;
};

const getSelectedDualTheme = (dualTheme: DualTheme, isDaylight: boolean) => (
    isDaylight ? dualTheme.light : dualTheme.dark
);

const buildThemeSourceOption = (
    source: ThemeSourceKind,
    theme: Theme | null,
    available: boolean,
    editable: boolean,
): ThemeSourceOption => ({
    source,
    available,
    editable,
    theme,
    label: theme?.name ?? '',
    swatchColor: theme?.backgroundColor ?? 'transparent',
});

export const buildThemeSourceModel = ({
    bgMode,
    aiTheme,
    legacyTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    currentSongHasLocalAiTheme,
}: {
    bgMode: ThemeSourceKind;
    aiTheme: DualTheme | null;
    legacyTheme: Theme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    currentSongHasLocalAiTheme: boolean;
}): ThemeSourceModel => {
    const defaultSourceTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
    const hasSavedAiTheme = Boolean(aiTheme || legacyTheme);
    const aiSourceTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : legacyTheme ?? getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);

    const options: Record<ThemeSourceKind, ThemeSourceOption> = {
        default: buildThemeSourceOption('default', defaultSourceTheme, true, false),
        ai: buildThemeSourceOption('ai', aiSourceTheme, true, Boolean(aiTheme || !legacyTheme)),
    };

    const activeSource = options[bgMode]?.available ? bgMode : 'default';
    // Legacy single-layer AI themes stay display-only: the quick editor edits a DualTheme, so
    // opening it here would silently swap the user's legacy palette for the sanitizer fallback.
    const editableSource = activeSource === 'ai' && options.ai.editable ? 'ai' : null;

    return {
        activeSource,
        current: options[activeSource],
        options,
        editableSource,
        canOpenQuickEditor: options.ai.editable,
        hasLocalAiTheme: currentSongHasLocalAiTheme,
        hasSavedAiTheme,
    };
};

export const resolveBgModeTheme = ({
    mode,
    aiTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    previousTheme,
}: {
    mode: 'default' | 'ai';
    aiTheme: DualTheme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    previousTheme: Theme;
}): Theme => {
    if (mode === 'default') {
        const baseTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
        if (!aiTheme) {
            return baseTheme;
        }

        const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
        return {
            ...selectedAiTheme,
            backgroundColor: baseTheme.backgroundColor,
            wordColors: previousTheme.wordColors,
            lyricsIcons: previousTheme.lyricsIcons
        };
    }

    const selectedAiTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);
    return {
        ...selectedAiTheme,
        wordColors: previousTheme.wordColors,
        lyricsIcons: previousTheme.lyricsIcons
    };
};

// Cover-derived fallback theme used when no AI API key is configured; the color/name work lives
// in utils/builtinTheme, this only keeps the stored animation intensity applied.
export const buildBuiltinDualTheme = ({
    coverColors = [],
    random,
}: {
    coverColors?: string[];
    random?: () => number;
} = {}): DualTheme => applyStoredAnimationIntensityToDualTheme(
    generateBuiltinDualTheme({ coverColors, random }),
);
