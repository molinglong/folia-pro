import React, { useEffect, useRef } from 'react';
import { PlayerState } from '../../../../types';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { useCurrentSongMvUrl } from '../../../../services/onlineMusic/useCurrentSongMv';
import type { VisualizerBackgroundRenderProps } from '../definition';
import CommonBackgroundEntry from '../common/entry';

// src/components/visualizer/backgrounds/mv/MvBackground.tsx
// Background type that plays the current online song's MV (muted) in place of a painted
// background. Songs without an MV fall back to the common background render verbatim, so the
// shell never sits on a bare void. Playback follows the player exactly like the video layer,
// but a muted background MV needs no clock alignment or drift correction -- only play/pause.

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

    if (!mvUrl) {
        return <>{CommonBackgroundEntry.render(props)}</>;
    }

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
