import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredVisualizerBackgroundMode } from '@/stores/visualizerSettingsPersistence';

// test/unit/stores/visualizerBackgroundModeMigration.test.ts
// The old video-layer "MV fill" toggle became the "MV" background type; the stored switch carries
// over once, while an explicit background choice always wins.

describe('readStoredVisualizerBackgroundMode migration', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => { values.delete(key); },
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('returns null without any stored state', () => {
        expect(readStoredVisualizerBackgroundMode()).toBeNull();
    });

    it('prefers an explicit background mode and leaves the legacy switch untouched', () => {
        values.set('visualizer_background_mode', 'common');
        values.set('video_layer_mv_fill', 'true');
        expect(readStoredVisualizerBackgroundMode()).toBe('common');
        expect(values.get('video_layer_mv_fill')).toBe('true');
    });

    it('carries the legacy MV fill switch over as the mv background type', () => {
        values.set('video_layer_mv_fill', 'true');
        expect(readStoredVisualizerBackgroundMode()).toBe('mv');
        expect(values.has('video_layer_mv_fill')).toBe(false);
    });

    it('ignores an invalid stored mode but still honors the migration', () => {
        values.set('visualizer_background_mode', 'no-such-mode');
        values.set('video_layer_mv_fill', 'true');
        expect(readStoredVisualizerBackgroundMode()).toBe('mv');
    });
});
