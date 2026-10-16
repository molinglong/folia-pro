import { DualTheme, SongResult, Theme } from '../types';
import { getFromCache, saveToCache } from './db';
import { createSongSyncFingerprintCandidates } from './sync/syncFingerprint';
import { readThemeSyncRegistry, registerThemeSyncRecordForSongIfMissing } from './sync/themeSyncRegistry';
import { sanitizeDualTheme, sanitizeTheme, FALLBACK_AI_DUAL_THEME } from './themeSanitizer';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { COVER_PALETTE_VERSION, BUILTIN_THEME_PROVIDER } from '../utils/builtinTheme/generateBuiltinDualTheme';

export type ThemeCacheSongKey = string | number;

export type GetCachedThemeOptions = {
    // Cover-derived themes from an older palette algorithm are treated as missing under the
    // 'cover' source, so they neither display nor block regeneration; AI themes are untouched.
    ignoreStaleCoverThemes?: boolean;
};

export type CachedThemeState =
    | { kind: 'dual'; theme: DualTheme }
    | { kind: 'legacy'; theme: Theme }
    | { kind: 'none' };

const isStaleCoverDualTheme = (dualTheme: DualTheme) => (
    dualTheme.light.provider === BUILTIN_THEME_PROVIDER
    && dualTheme.dark.provider === BUILTIN_THEME_PROVIDER
    && (dualTheme.light.paletteVersion !== COVER_PALETTE_VERSION
        || dualTheme.dark.paletteVersion !== COVER_PALETTE_VERSION)
);

export async function getCachedThemeState(
    songKey: ThemeCacheSongKey,
    options?: GetCachedThemeOptions,
): Promise<CachedThemeState> {
    const dualTheme = await getFromCache<DualTheme>(`dual_theme_${songKey}`);
    if (dualTheme) {
        const sanitized = sanitizeDualTheme(dualTheme);
        if (!(options?.ignoreStaleCoverThemes && isStaleCoverDualTheme(sanitized))) {
            return { kind: 'dual', theme: sanitized };
        }
        // Stale cover cache: keep looking, try the legacy slot below.
    }

    const legacyTheme = await getFromCache<Theme>(`theme_${songKey}`);
    if (legacyTheme) {
        return { kind: 'legacy', theme: sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark) };
    }

    return { kind: 'none' };
}


export async function getCachedThemeStateForSong(
    song: SongResult | null,
    options?: GetCachedThemeOptions,
): Promise<CachedThemeState> {
    if (!song) {
        return { kind: 'none' };
    }

    const registry = await readThemeSyncRegistry();
    const registryRecord = createSongSyncFingerprintCandidates(song)
        .map(fingerprint => registry[fingerprint])
        .find(Boolean);
    if (registryRecord) {
        const syncedLocalTheme = await getFromCache<DualTheme>(registryRecord.cacheKey);
        const sanitizedSyncedTheme = syncedLocalTheme ? sanitizeDualTheme(syncedLocalTheme) : null;
        if (sanitizedSyncedTheme
            && !(options?.ignoreStaleCoverThemes && isStaleCoverDualTheme(sanitizedSyncedTheme))) {
            return { kind: 'dual', theme: sanitizedSyncedTheme };
        }
    }

    const sourceAwareSongKey = getPlaybackSongKey(song);
    const localThemeState = await getCachedThemeState(sourceAwareSongKey, options);
    if (localThemeState.kind !== 'none') {
        if (localThemeState.kind === 'dual') {
            await registerThemeSyncRecordForSongIfMissing(song, 'manual');
        }
        return localThemeState;
    }

    const legacyThemeState = await getCachedThemeState(song.id, options);
    if (legacyThemeState.kind === 'dual') {
        await saveToCache(`dual_theme_${sourceAwareSongKey}`, legacyThemeState.theme);
        await registerThemeSyncRecordForSongIfMissing(song, 'manual');
    } else if (legacyThemeState.kind === 'legacy') {
        await saveToCache(`theme_${sourceAwareSongKey}`, legacyThemeState.theme);
    }
    if (legacyThemeState.kind !== 'none') return legacyThemeState;

    return { kind: 'none' };
}

export async function getLastDualTheme(): Promise<DualTheme | null> {
    const dualTheme = await getFromCache<DualTheme>('last_dual_theme');
    return dualTheme ? sanitizeDualTheme(dualTheme) : null;
}

export async function getLastLegacyTheme(): Promise<Theme | null> {
    const legacyTheme = await getFromCache<Theme>('last_theme');
    return legacyTheme ? sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark) : null;
}
