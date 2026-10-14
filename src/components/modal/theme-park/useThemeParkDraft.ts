import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DualTheme, Theme } from '../../../types';
import {
    normalizeThemeParkDualTheme,
    patchDualThemeMode,
    patchDualThemeShared,
    type EditableColorKey,
    type EditableMode,
} from './themeParkDraft';

// src/components/modal/theme-park/useThemeParkDraft.ts
// Owns the Theme Park editing session: the song AI theme draft plus the throttled color writes
// the picker drags through.

const COLOR_THROTTLE_MS = 33; // ~30fps, same budget as the quick editor

type UseThemeParkDraftOptions = {
    aiTheme: DualTheme | null;
    seedTheme: DualTheme;
    isDaylight: boolean;
};

export const useThemeParkDraft = ({
    aiTheme,
    seedTheme,
    isDaylight,
}: UseThemeParkDraftOptions) => {
    const [mode, setMode] = useState<EditableMode>(() => (isDaylight ? 'light' : 'dark'));
    const [activeColorKey, setActiveColorKey] = useState<EditableColorKey>('accentColor');

    // seedTheme is rebuilt on every parent render, so it is only read once: it is just the
    // fallback used when no theme is saved yet, never a reason to rebuild the baseline.
    const seedThemeRef = useRef(seedTheme);

    const baseTheme = useMemo<DualTheme>(
        () => normalizeThemeParkDualTheme(aiTheme ?? seedThemeRef.current),
        [aiTheme],
    );

    const [draft, setDraft] = useState<DualTheme>(baseTheme);
    const previousBaseThemeRef = useRef(baseTheme);

    // A theme saved or regenerated elsewhere refreshes the baseline, but only replaces the draft
    // when the user has not touched it yet - an in-progress edit is never thrown away underneath them.
    useEffect(() => {
        if (previousBaseThemeRef.current === baseTheme) {
            return;
        }
        const untouched = draft === previousBaseThemeRef.current;
        previousBaseThemeRef.current = baseTheme;
        if (untouched) {
            setDraft(baseTheme);
        }
    }, [baseTheme, draft]);

    useEffect(() => {
        setMode(isDaylight ? 'light' : 'dark');
    }, [isDaylight]);

    const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingColorRef = useRef<{ mode: EditableMode; key: EditableColorKey; color: string; } | null>(null);

    const flushPendingColor = useCallback(() => {
        if (throttleTimeoutRef.current) {
            clearTimeout(throttleTimeoutRef.current);
            throttleTimeoutRef.current = null;
        }

        const pending = pendingColorRef.current;
        pendingColorRef.current = null;
        return pending;
    }, []);

    // The picker fires at 60fps; commit at most every COLOR_THROTTLE_MS and keep the latest value
    // so a drag that ends between ticks is not lost.
    const updateColorThrottled = useCallback((color: string) => {
        pendingColorRef.current = { mode, key: activeColorKey, color };
        if (throttleTimeoutRef.current) {
            return;
        }

        throttleTimeoutRef.current = setTimeout(() => {
            throttleTimeoutRef.current = null;
            const pending = pendingColorRef.current;
            pendingColorRef.current = null;
            if (!pending) {
                return;
            }
            setDraft(previous => patchDualThemeMode(previous, pending.mode, { [pending.key]: pending.color }));
        }, COLOR_THROTTLE_MS);
    }, [activeColorKey, mode]);

    const updateColorInstant = useCallback((color: string) => {
        flushPendingColor();
        setDraft(previous => patchDualThemeMode(previous, mode, { [activeColorKey]: color }));
    }, [activeColorKey, flushPendingColor, mode]);

    const updateModeField = useCallback((patch: Partial<Theme>, targetMode: EditableMode = mode) => {
        setDraft(previous => patchDualThemeMode(previous, targetMode, patch));
    }, [mode]);

    const updateSharedField = useCallback((patch: Partial<Theme>) => {
        setDraft(previous => patchDualThemeShared(previous, patch));
    }, []);

    const replaceDraft = useCallback((nextTheme: DualTheme) => {
        flushPendingColor();
        setDraft(() => normalizeThemeParkDualTheme(nextTheme, baseTheme));
    }, [baseTheme, flushPendingColor]);

    const reset = useCallback(() => {
        flushPendingColor();
        setDraft(baseTheme);
    }, [baseTheme, flushPendingColor]);

    // Flushes any in-flight picker value, then hands back a sanitized theme fit to save or copy.
    const buildFinalTheme = useCallback(() => {
        const pending = flushPendingColor();
        const pendingDraft = pending
            ? patchDualThemeMode(draft, pending.mode, { [pending.key]: pending.color })
            : draft;

        return normalizeThemeParkDualTheme(pendingDraft, baseTheme);
    }, [baseTheme, draft, flushPendingColor]);

    useEffect(() => () => {
        if (throttleTimeoutRef.current) {
            clearTimeout(throttleTimeoutRef.current);
        }
    }, []);

    const safeDraft = useMemo(
        () => normalizeThemeParkDualTheme(draft, baseTheme),
        [baseTheme, draft],
    );

    return {
        mode,
        setMode,
        activeColorKey,
        setActiveColorKey,
        draft,
        safeDraft,
        baseTheme,
        updateColorThrottled,
        updateColorInstant,
        updateModeField,
        updateSharedField,
        replaceDraft,
        reset,
        buildFinalTheme,
    };
};
