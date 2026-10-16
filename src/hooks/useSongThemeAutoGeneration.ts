import { useEffect, useRef } from 'react';
import type { GenerateAIThemeOptions, GenerateAIThemeResult } from './useThemeController';
import type { LyricData, SongResult } from '../types';
import type { ThemeGenerationSource } from '../services/themePreferences';
import { getCachedThemeStateForSong } from '../services/themeCache';
import {
    getSongThemeAutoGenerationKey,
    hasSongThemePromptSource,
    isSongThemeGenerationStillCurrent,
    shouldRequestSongThemeAutoGeneration,
} from '../utils/songThemeAutoGeneration';
import { usePlaybackStore } from '../stores/usePlaybackStore';

// src/hooks/useSongThemeAutoGeneration.ts
// Coordinates delayed AI theme generation for the real current playback song.

type GenerateAITheme = (
    lyrics: LyricData | null,
    currentSong: SongResult | null,
    options?: GenerateAIThemeOptions,
) => Promise<GenerateAIThemeResult>;

type UseSongThemeAutoGenerationParams = {

    enabled: boolean;
    isLyricsLoading: boolean;
    // 'cover' generates from the artwork alone, so it does not wait for a lyric prompt source.
    themeGenerationSource: ThemeGenerationSource;
    // The cover path reads this artwork; a cover that belongs to the previous song would bake
    // another song's palette into the current one, so generation waits for it to resolve.
    coverUrl: string | null;
    generateAITheme: GenerateAITheme;
};

const AUTO_GENERATE_DELAY_MS = 650;

export function useSongThemeAutoGeneration({
    enabled,
    isLyricsLoading,
    themeGenerationSource,
    coverUrl,
    generateAITheme,
}: UseSongThemeAutoGenerationParams) {
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);

    const requiresPromptSource = themeGenerationSource !== 'cover';
    const latestSongKeyRef = useRef<string | null>(null);
    const latestEnabledRef = useRef(enabled);
    const latestGenerationInputRef = useRef({ currentSong, lyrics, coverUrl });
    const attemptedSongKeysRef = useRef(new Set<string>());
    const generateAIThemeRef = useRef(generateAITheme);
    const songKey = getSongThemeAutoGenerationKey(currentSong);
    const hasPromptSource = currentSong
        ? hasSongThemePromptSource(currentSong, lyrics)
        : false;

    useEffect(() => {
        generateAIThemeRef.current = generateAITheme;
    }, [generateAITheme]);

    useEffect(() => {
        latestGenerationInputRef.current = { currentSong, lyrics, coverUrl };
    }, [currentSong, lyrics, coverUrl]);

    useEffect(() => {
        latestEnabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        latestSongKeyRef.current = songKey;
    }, [songKey]);

    useEffect(() => {
        const scheduledInput = latestGenerationInputRef.current;
        const scheduledSong = scheduledInput.currentSong;
        if (!scheduledSong || !songKey) {
            return;
        }

        // The cover path reads the artwork: without a resolved cover there is nothing honest to
        // derive, and reusing a stale cover would bake another song's palette into this one.
        if (!requiresPromptSource && !scheduledInput.coverUrl) {
            return;
        }

        if (!shouldRequestSongThemeAutoGeneration({
            enabled,
            currentSong: scheduledSong,
            lyrics: scheduledInput.lyrics,
            isLyricsLoading,
            hasAttempted: attemptedSongKeysRef.current.has(songKey),
            hasCachedTheme: false,
            requiresPromptSource,
        })) {
            return;
        }

        const targetSongKey = songKey;
        let cancelled = false;
        const timeoutId = window.setTimeout(() => {
            void (async () => {
                if (cancelled || !isSongThemeGenerationStillCurrent({
                    latestSongKey: latestSongKeyRef.current,
                    targetSongKey,
                    enabled: latestEnabledRef.current,
                })) {
                    return;
                }

                const latestInput = latestGenerationInputRef.current;
                const latestSong = latestInput.currentSong;
                if (!latestSong) {
                    return;
                }
                if (!requiresPromptSource && !latestInput.coverUrl) {
                    return;
                }

                // Match the restore path: under the cover source a stale pre-v2 cache counts as
                // missing so the new algorithm rebuilds it instead of being blocked by it.
                const cachedTheme = await getCachedThemeStateForSong(latestSong, {
                    ignoreStaleCoverThemes: themeGenerationSource === 'cover',
                });
                if (cancelled || !isSongThemeGenerationStillCurrent({
                    latestSongKey: latestSongKeyRef.current,
                    targetSongKey,
                    enabled: latestEnabledRef.current,
                })) {
                    return;
                }
                if (!shouldRequestSongThemeAutoGeneration({
                    enabled: latestEnabledRef.current,
                    currentSong: latestSong,
                    lyrics: latestInput.lyrics,
                    isLyricsLoading: false,
                    hasAttempted: attemptedSongKeysRef.current.has(targetSongKey),
                    hasCachedTheme: cachedTheme.kind !== 'none',
                    requiresPromptSource,
                })) {
                    attemptedSongKeysRef.current.add(targetSongKey);
                    return;
                }

                attemptedSongKeysRef.current.add(targetSongKey);
                const result = await generateAIThemeRef.current(latestInput.lyrics, latestSong, {
                    source: 'auto',
                    shouldApply: () => isSongThemeGenerationStillCurrent({
                        latestSongKey: latestSongKeyRef.current,
                        targetSongKey,
                        enabled: latestEnabledRef.current,
                    }),
                });
                // A skip (no cover resolved yet, no prompt source) is not a verdict: release the
                // key so a later run -- e.g. the cover finishing resolving -- can try again.
                if (result.status === 'skipped') {
                    attemptedSongKeysRef.current.delete(targetSongKey);
                }
            })();
        }, AUTO_GENERATE_DELAY_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [coverUrl, enabled, hasPromptSource, isLyricsLoading, requiresPromptSource, songKey]);
}
