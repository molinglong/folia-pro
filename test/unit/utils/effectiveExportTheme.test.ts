import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/utils/effectiveExportTheme.test.ts
// Locks readEffectiveExportTheme (the theme the OBS copy link bakes). It follows the last-applied
// pointer, not whatever happens to be saved: AI active -> the cached AI theme, default preset ->
// null. That last case matters — a user who once saved an AI theme and then went back to the
// preset must not get the stale AI theme baked in.

vi.mock('@/services/themePreferences', () => ({ readStoredLastAppliedThemePointer: vi.fn() }));
vi.mock('@/services/themeCache', () => ({ getLastDualTheme: vi.fn() }));
vi.mock('@/utils/appearanceCodec', () => ({
    compressConfig: vi.fn(() => 'folia-theme://x'),
}));

import { readEffectiveExportTheme } from '@/services/obs/currentObsUrl';
import { readStoredLastAppliedThemePointer } from '@/services/themePreferences';
import { getLastDualTheme } from '@/services/themeCache';

const pointerMock = vi.mocked(readStoredLastAppliedThemePointer);
const aiMock = vi.mocked(getLastDualTheme);

const AI = { light: { name: 'ai-l' }, dark: { name: 'ai-d' } } as never;

describe('readEffectiveExportTheme', () => {
    beforeEach(() => {
        pointerMock.mockReset();
        aiMock.mockReset().mockResolvedValue(AI);
    });

    it('bakes the cached AI theme when AI is active', async () => {
        pointerMock.mockReturnValue('ai');
        expect(await readEffectiveExportTheme()).toBe(AI);
    });

    // A leftover saved AI theme must not leak into a preset's static link.
    it('returns null on the default preset, ignoring a leftover saved theme', async () => {
        pointerMock.mockReturnValue('default');
        expect(await readEffectiveExportTheme()).toBeNull();
        expect(aiMock).not.toHaveBeenCalled();
    });

    it('returns null when AI is active but no AI theme is cached (avoids a stale bake)', async () => {
        pointerMock.mockReturnValue('ai');
        aiMock.mockResolvedValue(null);
        expect(await readEffectiveExportTheme()).toBeNull();
    });
});
