import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../types';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { getPlaybackSongKey, getPlaybackSourceRef, isStagePlaybackSong } from '../utils/appPlaybackGuards';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { PlaybackListenTracker, type PlaybackListenSessionInput } from '../utils/playbackListenTracker';
import { buildListeningPlayRecord } from '../services/listeningStats/listeningPlayRecord';
import { recordListeningPlay } from '../services/listeningStats/listeningStatsRepository';

// src/hooks/useListeningHistoryRecorder.ts
// Writes one local history row per qualifying listen, for every source the app can play.
//
// The measurement is PlaybackListenTracker, the same accumulator the NetEase report uses: it only
// counts audio it saw advance, so a seek to the end or a stalled deck never inflates the history.
// Nothing here reaches the network; a write is a single Dexie put.

type UseListeningHistoryRecorderParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    /** Changes when automix hands playback to the other deck, so the listeners follow it. */
    activeDeck: string;
};

const resolveListeningCandidate = (song: SongResult | null): PlaybackListenSessionInput | null => {
    if (!song || isStagePlaybackSong(song)) {
        return null;
    }
    const source = getPlaybackSourceRef(song);
    return {
        songKey: getPlaybackSongKey(song),
        mediaId: String(source.mediaId),
        totalSeconds: getProviderSongMetadata(song).durationMs / 1000,
    };
};

export const useListeningHistoryRecorder = ({
    audioRef,
    currentSong,
    activeDeck,
}: UseListeningHistoryRecorderParams): void => {
    const enabled = useAudioSettingsStore(state => state.listeningStatsEnabled);
    const trackerRef = useRef<PlaybackListenTracker | null>(null);
    const sessionSongRef = useRef<SongResult | null>(null);
    const sessionStartedAtRef = useRef(0);
    /** Last `timeupdate` actually seen; `playedAt` follows it so a long pause cannot move a play to the next day. */
    const lastProgressAtRef = useRef(0);

    if (!trackerRef.current) {
        trackerRef.current = new PlaybackListenTracker();
    }

    useEffect(() => {
        const tracker = trackerRef.current;
        if (!tracker) return;

        /** Closes the open session and writes the row it earned, if any. */
        const settle = () => {
            const song = sessionSongRef.current;
            const startedAt = sessionStartedAtRef.current;
            const lastProgressAt = lastProgressAtRef.current;
            const report = tracker.settle();
            tracker.clear();
            sessionSongRef.current = null;
            sessionStartedAtRef.current = 0;
            lastProgressAtRef.current = 0;
            if (!song || !report) return;

            const record = buildListeningPlayRecord({
                song,
                report,
                startedAt,
                // A stretch with no `timeupdate` (pause, stall, sleep) leaves the session alone; the
                // record belongs to the moment sound was last heard, not to the moment it settles.
                playedAt: Math.max(startedAt, lastProgressAt),
            });
            if (!record) return;

            void recordListeningPlay(record).catch(error => {
                console.warn('[ListeningStats] Failed to write a listening record', error);
            });
        };

        const openSession = (song: SongResult | null) => {
            const candidate = resolveListeningCandidate(song);
            if (!candidate) return;
            const startedAt = Date.now();
            tracker.start(candidate, startedAt);
            sessionSongRef.current = song;
            sessionStartedAtRef.current = startedAt;
            lastProgressAtRef.current = startedAt;
        };

        // Switching history off must not bank the listen that was in progress: the listener asked
        // for nothing to be recorded, and a settle here would write one last row.
        if (!enabled) {
            tracker.clear();
            sessionSongRef.current = null;
            sessionStartedAtRef.current = 0;
            lastProgressAtRef.current = 0;
            return;
        }

        // The song changed under an open session, so the previous one is over. This is also the path
        // an automix handover takes: the queue advances when the blend starts, so the outgoing deck's
        // last few crossfade seconds go uncounted - the same undercount the scrobble path accepts.
        if (tracker.getSongKey() !== (currentSong ? getPlaybackSongKey(currentSong) : null)) {
            settle();
            openSession(currentSong);
        }

        const audioElement = audioRef.current;
        if (!audioElement) return;

        const handleTimeUpdate = () => {
            if (audioElement.paused || audioElement.ended) return;
            lastProgressAtRef.current = Date.now();
            if (tracker.handleProgress(audioElement.currentTime || 0).restarted) {
                // Loop-one, or a replay by hand: bank the first listen before counting the second.
                const song = sessionSongRef.current;
                settle();
                openSession(song);
            }
        };

        const handleEnded = () => settle();

        audioElement.addEventListener('timeupdate', handleTimeUpdate);
        audioElement.addEventListener('ended', handleEnded);

        return () => {
            audioElement.removeEventListener('timeupdate', handleTimeUpdate);
            audioElement.removeEventListener('ended', handleEnded);
        };
        // `activeDeck` is here because `audioRef` names a different element after an automix swap and
        // these listeners are bound to the element itself.
    }, [audioRef, activeDeck, currentSong, enabled]);
};
