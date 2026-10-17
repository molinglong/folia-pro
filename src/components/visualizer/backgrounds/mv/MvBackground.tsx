import React, { useEffect, useRef } from 'react';
import { PlayerState } from '../../../../types';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { useCurrentSongMvUrl } from '../../../../services/onlineMusic/useCurrentSongMv';
import { currentTime } from '../../../../stores/motionSignals';
import type { VisualizerBackgroundRenderProps } from '../definition';
import CommonBackgroundEntry from '../common/entry';

// src/components/visualizer/backgrounds/mv/MvBackground.tsx
// Background type that plays the current online song's MV (muted) in place of a painted
// background. Songs without an MV fall back to the common background render verbatim, so the
// shell never sits on a bare void. The video clock aligns to the song on mount (so opening
// the MV background mid-song doesn't restart from 0) and corrects drift when the user seeks
// or the clocks diverge beyond the threshold; play/pause still follows the player state.

// A drift larger than this triggers a video seek to catch up with the song clock. Normal
// per-frame advances (~16ms) stay well below, so only user seeks or real drift fire it.
const MV_DRIFT_THRESHOLD_SEC = 2;

const MvBackground: React.FC<VisualizerBackgroundRenderProps> = (props) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pausedRef = useRef(props.paused);
    pausedRef.current = props.paused;

    const displaySong = usePlaybackStore(selectDisplaySong);
    const mvUrl = useCurrentSongMvUrl(displaySong);

    // Follows player-state transitions while the element stays mounted.
    useEffect(() => {
        const video = videoRef.current;
        if (!mvUrl || !video) return;
        const followState = () => {
            const playing = selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING;
            if (playing && !pausedRef.current) void video.play().catch(() => {});
            else video.pause();
        };
        followState();
        const unsubscribe = usePlaybackStore.subscribe((state, previous) => {
            if (selectDisplayPlayerState(state) !== selectDisplayPlayerState(previous)) followState();
        });
        return () => {
            unsubscribe();
            video.pause();
        };
    }, [mvUrl]);

    // The shell's pause flag changes without touching the source; only play/pause needs to follow.
    useEffect(() => {
        const video = videoRef.current;
        if (!mvUrl || !video) return;
        if (props.paused) {
            video.pause();
        } else if (selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING) {
            void video.play().catch(() => {});
        }
    }, [mvUrl, props.paused]);

    // Corrects drift when the song clock jumps (user seek) or the MV and song clocks diverge
    // beyond the threshold. Normal per-frame advances stay below the threshold and never touch
    // the video element, so we don't fight the browser's own playback progress.
    useEffect(() => {
        const video = videoRef.current;
        if (!mvUrl || !video) return;
        const unsubscribe = currentTime.on('change', (value) => {
            const v = videoRef.current;
            if (!v) return;
            const drift = Math.abs(value - v.currentTime);
            if (drift > MV_DRIFT_THRESHOLD_SEC) {
                // If the MV is shorter than the song, clamp to just before the end so the
                // loop keeps cycling instead of seeking past duration and stalling.
                const target = Number.isFinite(v.duration) && v.duration > 0
                    ? Math.min(value, Math.max(0, v.duration - 0.25))
                    : value;
                v.currentTime = target;
            }
        });
        return unsubscribe;
    }, [mvUrl]);

    if (!mvUrl) {
        return <>{CommonBackgroundEntry.render(props)}</>;
    }

    // Runs once when the stream metadata is ready: seek the video to the song's current
    // progress so opening the MV background mid-song doesn't start from 0.
    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        const songTime = currentTime.get();
        if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(songTime, Math.max(0, video.duration - 0.25));
        } else {
            video.currentTime = songTime;
        }
        // After seeking, follow the current player state (play/pause).
        const playing = selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING;
        if (playing && !pausedRef.current) void video.play().catch(() => {});
        else video.pause();
    };

    return (
        <div className="absolute inset-0 z-0 overflow-hidden">
            {/* key forces React to remount the element when the stream URL changes (song switch). */}
            <video
                ref={videoRef}
                key={mvUrl}
                src={mvUrl}
                muted
                loop
                playsInline
                preload="auto"
                aria-hidden
                onLoadedMetadata={handleLoadedMetadata}
                className="absolute inset-0 h-full w-full pointer-events-none"
                style={{ objectFit: 'cover' }}
            />
            {/* Semi-transparent overlay to keep the lyrics readable, same as the embed background. */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))' }}
            />
        </div>
    );
};

export default MvBackground;
