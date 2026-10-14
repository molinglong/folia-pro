import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GRAPHICS_PRESET_STORAGE_KEY,
    initGraphicsPresetOnFirstRun,
    matchGraphicsPresetSignature,
    resolveDisplayedGraphicsPreset,
    useGraphicsPresetStore,
    type GraphicsPresetSwitchSnapshot,
} from '@/stores/useGraphicsPresetStore';
import { MOTION_SURFACE_IDS, useMotionSettingsStore } from '@/stores/useMotionSettingsStore';
import { useThemeSettingsStore } from '@/stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';

// test/unit/stores/graphicsPreset.test.ts
// Three things this guards, in order of how badly they would fail silently if they drifted:
//   1. 画质优先 has to be exactly the factory default — that's what makes upgrading to a version
//      with tiers a no-op for everyone who never touched a performance switch.
//   2. First-run detection must only ever write the new `graphics_preset` key itself. If it ever
//      starts writing the old switches again, that's the "silently overwrites the user's settings"
//      regression the whole read-only-fingerprint design exists to prevent.
//   3. The preset store is the one place that deliberately drives three other stores at once, so
//      the cross-store write on an explicit tier pick has to actually land on all three.

const surfacesOf = (reduced: readonly string[]): GraphicsPresetSwitchSnapshot['reducedMotionSurfaces'] => (
    Object.fromEntries(MOTION_SURFACE_IDS.map(surface => [surface, reduced.includes(surface)])) as GraphicsPresetSwitchSnapshot['reducedMotionSurfaces']
);

const snapshot = (over: Partial<GraphicsPresetSwitchSnapshot> = {}): GraphicsPresetSwitchSnapshot => ({
    visualizerFrameRate: 'off',
    disableHomeDynamicBackground: false,
    reducedMotionSurfaces: surfacesOf([]),
    ...over,
});

describe('graphics preset store', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });

        // Reset the three domain stores the preset store writes through, back to factory defaults.
        useVisualizerSettingsStore.setState({ visualizerFrameRate: 'off' });
        useThemeSettingsStore.setState({ disableHomeDynamicBackground: false });
        useMotionSettingsStore.setState({ reducedMotionSurfaces: surfacesOf([]) });
        useGraphicsPresetStore.setState({ graphicsPreset: 'quality', isDrifted: false });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('matchGraphicsPresetSignature', () => {
        it('reads the factory default state as quality, not as custom', () => {
            // This is the "new users land here for free" property: quality's fingerprint has to
            // stay identical to whatever the three stores ship with, or the tier stops meaning
            // "nothing was ever changed."
            expect(matchGraphicsPresetSignature(snapshot())).toBe('quality');
        });

        it('reads the smooth fingerprint', () => {
            expect(matchGraphicsPresetSignature(snapshot({
                visualizerFrameRate: 60,
                disableHomeDynamicBackground: true,
                reducedMotionSurfaces: surfacesOf(MOTION_SURFACE_IDS),
            }))).toBe('smooth');
        });

        it('reads the balanced fingerprint, which only reduces the two most expensive surfaces', () => {
            expect(matchGraphicsPresetSignature(snapshot({
                reducedMotionSurfaces: surfacesOf(['monetBackground', 'collectionMorph']),
            }))).toBe('balanced');
        });

        it('falls back to custom for anything that is not one of the three exact fingerprints', () => {
            // One surface off from balanced is already "not a preset" — the tier is a whole
            // fingerprint, not a nearest-neighbour guess.
            expect(matchGraphicsPresetSignature(snapshot({
                reducedMotionSurfaces: surfacesOf(['monetBackground']),
            }))).toBe('custom');

            expect(matchGraphicsPresetSignature(snapshot({ visualizerFrameRate: 120 }))).toBe('custom');
        });
    });

    describe('resolveDisplayedGraphicsPreset', () => {
        it('never re-decides a stored custom, even when the switches happen to match a preset', () => {
            // A user who picked 自定义 and then left everything at, say, quality's exact values
            // chose "show me the switches" — relabelling that as 画质优先 on next mount would
            // hide the panel they asked for.
            const { preset, isDrifted } = resolveDisplayedGraphicsPreset('custom', snapshot());
            expect(preset).toBe('custom');
            expect(isDrifted).toBe(false);
        });

        it('shows custom and flags drift when a single switch moved away from the stored tier', () => {
            // e.g. toggled one motion surface from the command palette while 均衡 was selected.
            const drifted = snapshot({ reducedMotionSurfaces: surfacesOf(['lattice']) });
            expect(resolveDisplayedGraphicsPreset('balanced', drifted)).toEqual({ preset: 'custom', isDrifted: true });
        });

        it('keeps showing the stored tier while the fingerprint still matches', () => {
            expect(resolveDisplayedGraphicsPreset('balanced', snapshot({
                reducedMotionSurfaces: surfacesOf(['monetBackground', 'collectionMorph']),
            }))).toEqual({ preset: 'balanced', isDrifted: false });
        });
    });

    describe('handleSelectGraphicsPreset', () => {
        it('writes every switch the tier owns, across all three stores, on an explicit pick', () => {
            useGraphicsPresetStore.getState().handleSelectGraphicsPreset('smooth');

            expect(useVisualizerSettingsStore.getState().visualizerFrameRate).toBe(60);
            expect(useThemeSettingsStore.getState().disableHomeDynamicBackground).toBe(true);
            MOTION_SURFACE_IDS.forEach(surface => {
                expect(useMotionSettingsStore.getState().reducedMotionSurfaces[surface]).toBe(true);
            });
            expect(values.get(GRAPHICS_PRESET_STORAGE_KEY)).toBe('smooth');
            expect(useGraphicsPresetStore.getState().graphicsPreset).toBe('smooth');
            expect(useGraphicsPresetStore.getState().isDrifted).toBe(false);
        });

        it('leaves the switches alone for custom and just reveals them instead', () => {
            useVisualizerSettingsStore.setState({ visualizerFrameRate: 120 });
            useMotionSettingsStore.setState({ reducedMotionSurfaces: surfacesOf(['lattice']) });

            useGraphicsPresetStore.getState().handleSelectGraphicsPreset('custom');

            expect(useVisualizerSettingsStore.getState().visualizerFrameRate).toBe(120);
            expect(useMotionSettingsStore.getState().reducedMotionSurfaces.lattice).toBe(true);
            expect(useGraphicsPresetStore.getState().graphicsPreset).toBe('custom');
        });
    });

    describe('initGraphicsPresetOnFirstRun', () => {
        it('derives the tier from the live switches the first time, without rewriting any of them', () => {
            // A returning user who had already, by hand, landed on balanced's exact fingerprint.
            useVisualizerSettingsStore.setState({ visualizerFrameRate: 'off' });
            useThemeSettingsStore.setState({ disableHomeDynamicBackground: false });
            useMotionSettingsStore.setState({ reducedMotionSurfaces: surfacesOf(['monetBackground', 'collectionMorph']) });

            initGraphicsPresetOnFirstRun();

            expect(values.get(GRAPHICS_PRESET_STORAGE_KEY)).toBe('balanced');
            // The whole promise: not one of the switches itself moves during this call.
            expect(useMotionSettingsStore.getState().reducedMotionSurfaces.monetBackground).toBe(true);
            expect(useMotionSettingsStore.getState().reducedMotionSurfaces.lattice).toBe(false);
            expect(useThemeSettingsStore.getState().disableHomeDynamicBackground).toBe(false);
        });

        it('writes custom when the current switches do not match any tier', () => {
            useVisualizerSettingsStore.setState({ visualizerFrameRate: 120 });

            initGraphicsPresetOnFirstRun();

            expect(values.get(GRAPHICS_PRESET_STORAGE_KEY)).toBe('custom');
        });

        it('does not re-derive or overwrite anything once a tier has already been stored', () => {
            values.set(GRAPHICS_PRESET_STORAGE_KEY, 'quality');
            useVisualizerSettingsStore.setState({ visualizerFrameRate: 120 });
            useMotionSettingsStore.setState({ reducedMotionSurfaces: surfacesOf(['lattice']) });

            initGraphicsPresetOnFirstRun();

            // Already onboarded: leaving the key and the (deliberately mismatched, drift-bound)
            // switches exactly as they are is the point — this must never turn back into a
            // silent re-application.
            expect(values.get(GRAPHICS_PRESET_STORAGE_KEY)).toBe('quality');
            expect(useVisualizerSettingsStore.getState().visualizerFrameRate).toBe(120);
            expect(useMotionSettingsStore.getState().reducedMotionSurfaces.lattice).toBe(true);
        });
    });
});
