import type { PlaybackSongSource } from '../utils/appPlaybackGuards';

// src/types/listeningStats.ts
// One row per qualifying listen. The record keeps a metadata snapshot, so a song whose source or
// local file disappears later still has a readable history.

export type ListeningPlaySource = PlaybackSongSource;

export interface ListeningPlayRecord {
    /** Primary key: one listening session writes once, even if the settle path runs twice. */
    sessionId: string;
    /** Same identity the queue and scrobble paths use: online:netease:123 / local:xxx / navidrome:xxx. */
    songKey: string;
    source: ListeningPlaySource;
    title: string;
    artist: string;
    album: string;
    coverUrl?: string;
    /** Full track length at the time of listening, seconds. 0 when the deck never knew it. */
    durationSec: number;
    /** Seconds of audio that really played. Seeks and stalls are not counted. */
    listenedSec: number;
    startedAt: number;
    playedAt: number;
    /** Nearly the whole track was heard (>= 90% of durationSec). */
    completed: boolean;
    /**
     * Local-only owner tag: never uploaded and stripped before a push. null means it was recorded
     * while signed out; the first account that signs in adopts those rows.
     */
    ownerId?: string | null;
}

/**
 * One pending cloud-sync operation. The table is an outbox: local writes append here, the sync module
 * drains it after a successful push. `accountId` tags the account the op belongs to so switching
 * accounts cannot leak one user's plays into another; a null tag means "recorded while signed out"
 * and is adopted by the first account that signs in on this device.
 */
export type ListeningSyncOutboxKind = 'play' | 'delete' | 'clear';

export interface ListeningSyncOutboxRecord {
    id?: number;
    kind: ListeningSyncOutboxKind;
    /** The row a play/delete op refers to; empty for clear. */
    sessionId?: string;
    /** Milliseconds, used to drop ops covered by a remote clear watermark. */
    playedAt?: number;
    /** Clear watermark, milliseconds. */
    clearedAt?: number;
    accountId: string | null;
    createdAt: number;
}

export type ListeningStatsRange = 'week' | 'month' | 'year' | 'all';

export type ListeningStatsWindow = {
    from: number;
    to: number;
};

export type ListeningStatsBucket = {
    key: string;
    label: string;
    sublabel?: string;
    coverUrl?: string;
    plays: number;
    seconds: number;
};

export type ListeningStatsSummary = {
    totalSeconds: number;
    totalPlays: number;
    completedPlays: number;
    uniqueSongs: number;
    uniqueArtists: number;
    activeDays: number;
    topSongs: ListeningStatsBucket[];
    topArtists: ListeningStatsBucket[];
    topAlbums: ListeningStatsBucket[];
    /** Seconds per local hour of day, 24 entries. */
    byHour: number[];
    /** Seconds per weekday, Monday first. */
    byWeekday: number[];
    bySource: ListeningStatsBucket[];
    /** Seconds per local calendar day, keyed YYYY-MM-DD. Only days with plays are present. */
    dailySeconds: Record<string, number>;
};

export type ListeningStatsStreak = {
    /** Consecutive local days with a play, ending today or yesterday. */
    current: number;
    /** Longest run of consecutive days inside the heatmap year. */
    longest: number;
};

export type ListeningStatsResult = {
    range: ListeningStatsRange;
    window: ListeningStatsWindow;
    /** Always the trailing 365 days, whatever range the readout is showing. */
    heatmapWindow: ListeningStatsWindow;
    /** Scoped to `window`; the heatmap has its own map below. */
    summary: ListeningStatsSummary;
    /** Seconds per local day across the heatmap year, keyed YYYY-MM-DD. */
    heatmapDailySeconds: Record<string, number>;
    /** Streaks measured over the heatmap year. */
    streak: ListeningStatsStreak;
    /** Earliest play on record, or null when the table is empty. */
    firstPlayedAt: number | null;
    /** The local database could not be read; an empty readout is not the same as no history. */
    unavailable?: boolean;
    recent: ListeningPlayRecord[];
};
