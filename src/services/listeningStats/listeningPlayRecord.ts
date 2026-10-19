import type { SongResult } from '../../types';
import type { ListeningPlayRecord } from '../../types/listeningStats';
import { getPlaybackSongKey, getPlaybackSongSource, isStagePlaybackSong } from '../../utils/appPlaybackGuards';
import type { PlaybackListenReport } from '../../utils/playbackListenTracker';
import { resolvePlaybackSongArtist, resolvePlaybackSongCoverUrl } from '../../utils/playbackSongMeta';
import { getProviderSongMetadata } from '../onlineMusic/songMetadata';

// src/services/listeningStats/listeningPlayRecord.ts
// Builds the row a settled listening session writes. The tracker already refuses below-threshold,
// seek-inflated and background-deck plays; this only adds the metadata snapshot and identity.

export type BuildListeningPlayRecordArgs = {
    song: SongResult;
    report: PlaybackListenReport;
    /** When the session opened, not when the audio element first emitted a timeupdate. */
    startedAt: number;
    /** When the session settled. */
    playedAt: number;
};

const roundSeconds = (value: number) => Math.round(value * 1000) / 1000;

/** Session ids are stable across a double settle and distinct across a genuine replay. */
export const buildListeningSessionId = (song: SongResult, startedAt: number): string => (
    `${getPlaybackSongKey(song)}@${Math.trunc(startedAt)}`
);

export const buildListeningPlayRecord = ({
    song,
    report,
    startedAt,
    playedAt,
}: BuildListeningPlayRecordArgs): ListeningPlayRecord | null => {
    // Stage playback is a rehearsal surface, not listening; external sources never reach this hook.
    if (isStagePlaybackSong(song)) {
        return null;
    }

    const listenedSec = roundSeconds(report.playedSeconds);
    if (!Number.isFinite(listenedSec) || listenedSec <= 0) {
        return null;
    }

    const metadata = getProviderSongMetadata(song);
    const durationSec = report.totalSeconds > 0
        ? roundSeconds(report.totalSeconds)
        : roundSeconds(Math.max(0, metadata.durationMs / 1000));
    const artist = resolvePlaybackSongArtist(song) || '';
    const album = metadata.album?.name || song.album?.name || '';
    const coverUrl = resolvePlaybackSongCoverUrl(song) || undefined;

    return {
        sessionId: buildListeningSessionId(song, startedAt),
        songKey: report.songKey,
        source: getPlaybackSongSource(song),
        title: song.name?.trim() || metadata.album?.name || report.mediaId,
        artist,
        album,
        ...(coverUrl ? { coverUrl } : {}),
        durationSec,
        listenedSec,
        startedAt: Math.trunc(startedAt),
        playedAt: Math.trunc(playedAt),
        completed: durationSec > 0 && listenedSec >= durationSec * 0.9,
    };
};
