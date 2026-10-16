import type { DualTheme, Theme } from '../types';
import { adjustLightnessForContrast, getHueDistance, hexToHsl } from '../utils/themeColorMath';
import {
    ACCENT_MIN_CONTRAST,
    PRIMARY_MIN_CONTRAST,
    SECONDARY_MIN_CONTRAST,
} from '../utils/builtinTheme/themeColorRanges';

// src/services/aiThemePolish.ts
// A generated AI theme usually reads well, but nothing guarantees it: a washed-out secondary or an
// accent sitting on top of the background slips through the prompt's "should have contrast" wording.
// Every text color is pushed along its lightness axis until it clears the same floor the built-in
// cover themes are held to, keeping the model's hue; the duotone background wash rides along so AI
// themes match that look too. Only freshly generated themes are polished -- cached and user-edited
// ones come back as saved.

// Below this hue separation the model's palette counts as single-hue and the wash stays off -- the
// same threshold the cover pipeline uses to call a cover duotone.
const MIN_WASH_HUE_DISTANCE = 25;

export const polishAiTheme = (theme: Theme): Theme => {
    const backgroundColor = theme.backgroundColor;

    // An already-passing color comes back untouched, so the model's design survives.
    const liftToFloor = (color: string, minRatio: number) => (
        adjustLightnessForContrast(color, backgroundColor, minRatio)
    );

    const primaryColor = liftToFloor(theme.primaryColor, PRIMARY_MIN_CONTRAST);
    const secondaryColor = liftToFloor(theme.secondaryColor, SECONDARY_MIN_CONTRAST);
    const accentColor = liftToFloor(theme.accentColor, ACCENT_MIN_CONTRAST);
    // sanitize guarantees an array, but the type is optional.
    const wordColors = (theme.wordColors ?? []).map(word => ({
        ...word,
        color: liftToFloor(word.color, SECONDARY_MIN_CONTRAST),
    }));

    const backgroundHue = hexToHsl(backgroundColor)?.h;
    const accentHue = hexToHsl(accentColor)?.h;
    const isDuotone = backgroundHue !== undefined
        && accentHue !== undefined
        && getHueDistance(backgroundHue, accentHue) >= MIN_WASH_HUE_DISTANCE;

    return {
        ...theme,
        primaryColor,
        secondaryColor,
        accentColor,
        wordColors,
        ...(isDuotone ? { backgroundStops: [backgroundColor, accentColor] } : {}),
    };
};

export const polishAiDualTheme = (dualTheme: DualTheme): DualTheme => ({
    light: polishAiTheme(dualTheme.light),
    dark: polishAiTheme(dualTheme.dark),
});
