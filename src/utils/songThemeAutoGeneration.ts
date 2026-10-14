import type { LyricData, SongResult } from '../types';
import type { ThemeGenerationSource } from '../services/themePreferences';
import { getPlaybackSongKey } from './appPlaybackGuards';

// src/utils/songThemeAutoGeneration.ts
// Pure guards for deciding whether playback should auto-generate a song AI theme.

export type SongThemeAutoGenerationDecisionInput = {
    enabled: boolean;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    isLyricsLoading: boolean;
    hasAttempted: boolean;
    hasCachedTheme: boolean;
    // Cover-derived themes read the artwork, not the lyrics, so they need no prompt source.
    requiresPromptSource?: boolean;
};

export const getSongThemeAutoGenerationKey = (song: SongResult | null) => (
    song ? getPlaybackSongKey(song) : null
);

export const hasSongThemePromptSource = (song: SongResult, lyrics: LyricData | null) => (
    Boolean(song.isPureMusic) || Boolean((lyrics?.lines.length ?? 0) > 0)
);

export const isSongThemeGenerationStillCurrent = ({
    latestSongKey,
    targetSongKey,
    enabled,
}: {
    latestSongKey: string | null;
    targetSongKey: string;
    enabled: boolean;
}) => latestSongKey === targetSongKey && enabled;

// Product rule: per-song colors follow the cover by default. The free cover path therefore only
// needs the auto-switch put -- it is not gated behind the metered auto-generate switch, which
// exists to guard AI token spend. An explicit AI source keeps both switches, and the auto-switch
// off-put means "stop moving my colors".
export const resolveSongThemeAutoGenerationEnabled = ({
    themeGenerationSource,
    songThemeAutoSwitchEnabled,
    songThemeAutoGenerateEnabled,
}: {
    themeGenerationSource: ThemeGenerationSource;
    songThemeAutoSwitchEnabled: boolean;
    songThemeAutoGenerateEnabled: boolean;
}) => {
    if (!songThemeAutoSwitchEnabled) {
        return false;
    }

    return themeGenerationSource === 'cover' || songThemeAutoGenerateEnabled;
};

export const shouldRequestSongThemeAutoGeneration = ({
    enabled,
    currentSong,
    lyrics,
    isLyricsLoading,
    hasAttempted,
    hasCachedTheme,
    requiresPromptSource = true,
}: SongThemeAutoGenerationDecisionInput) => {
    if (!enabled || !currentSong || isLyricsLoading || hasAttempted || hasCachedTheme) {
        return false;
    }

    return requiresPromptSource ? hasSongThemePromptSource(currentSong, lyrics) : true;
};
