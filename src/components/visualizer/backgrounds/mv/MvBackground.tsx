import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../../../types';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { useCurrentSongMvUrl } from '../../../../services/onlineMusic/useCurrentSongMv';
import { currentTime } from '../../../../stores/motionSignals';
import {
    MV_INTRO_OFFSET_MAX_SEC,
    MV_INTRO_OFFSET_STEP,
    resolveMvAlignedSeekTarget,
    useMvIntroOffsetStore,
} from '../../../../stores/useMvIntroOffsetStore';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import type { VisualizerBackgroundRenderProps } from '../definition';
import NomandBackgroundEntry from '../nomand/entry';

// src/components/visualizer/backgrounds/mv/MvBackground.tsx
// Background type that plays the current online song's MV (muted) in place of a painted
// background. Songs without an MV fall back to the Nomand (漫游) wallpaper render verbatim,
// so the shell never sits on a bare void. The video clock aligns to the song on mount (so opening
// the MV background mid-song doesn't restart from 0) and corrects drift when the user seeks
// or the clocks diverge beyond the threshold; play/pause still follows the player state.
// A per-song intro skip (some MV sources open with a black screen / logo / ad) rides
// useMvIntroOffsetStore and is adjusted live by the capsule rendered over the picture.

// A drift larger than this triggers a video seek to catch up with the song clock. Normal
// per-frame advances (~16ms) stay well below, so only user seeks or real drift fire it.
const MV_DRIFT_THRESHOLD_SEC = 2;

const MvBackground: React.FC<VisualizerBackgroundRenderProps> = (props) => {
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pausedRef = useRef(props.paused);
    pausedRef.current = props.paused;

    const displaySong = usePlaybackStore(selectDisplaySong);
    const mvUrl = useCurrentSongMvUrl(displaySong);
    const trackKey = displaySong ? getPlaybackSongKey(displaySong) : null;
    const offsetSeconds = useMvIntroOffsetStore(state => (trackKey ? state.offsets[trackKey] ?? 0 : 0));
    // The clock subscription below lives outside React; it reads the offset through a ref.
    const offsetRef = useRef(offsetSeconds);
    offsetRef.current = offsetSeconds;

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
            const target = resolveMvAlignedSeekTarget(value, offsetRef.current, v.duration);
            if (target === null) return;
            const drift = Math.abs(target - v.currentTime);
            if (drift > MV_DRIFT_THRESHOLD_SEC) v.currentTime = target;
        });
        return unsubscribe;
    }, [mvUrl]);

    // The capsule's +/− writes the offset; re-line the picture up the moment it changes.
    // Writing currentTime only works once the stream metadata is loaded, which is the same
    // gate the mount-time alignment uses (onLoadedMetadata below).
    useEffect(() => {
        const video = videoRef.current;
        if (!mvUrl || !video || video.readyState < 1) return;
        const target = resolveMvAlignedSeekTarget(currentTime.get(), offsetSeconds, video.duration);
        if (target !== null) video.currentTime = target;
    }, [mvUrl, offsetSeconds]);

    if (!mvUrl) {
        return <>{NomandBackgroundEntry.render(props)}</>;
    }

    // Runs once when the stream metadata is ready: seek the video to the song's current
    // progress plus this song's intro skip, so opening the MV background mid-song doesn't
    // start from 0 and a song with an ad-bloated intro can start on the actual content.
    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        const target = resolveMvAlignedSeekTarget(currentTime.get(), offsetRef.current, video.duration);
        if (target !== null) video.currentTime = target;
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
            {/* Per-song intro skip; only meaningful while an identified song's MV is on screen. */}
            {trackKey && (
                <div
                    data-mv-intro-offset=""
                    title={t('options.mvIntroOffsetHint')}
                    className="absolute bottom-24 left-4 z-10 flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-1 text-white/85 backdrop-blur-sm select-none"
                >
                    <button
                        type="button"
                        aria-label={t('options.mvIntroOffsetDecrease')}
                        disabled={offsetSeconds <= 0}
                        onClick={() => useMvIntroOffsetStore.getState().setOffset(trackKey, offsetSeconds - MV_INTRO_OFFSET_STEP)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none hover:bg-white/15 disabled:pointer-events-none disabled:opacity-35"
                    >
                        −
                    </button>
                    <span className="min-w-[5.5rem] text-center text-xs tabular-nums">
                        {t('options.mvIntroOffset', { seconds: offsetSeconds })}
                    </span>
                    <button
                        type="button"
                        aria-label={t('options.mvIntroOffsetIncrease')}
                        disabled={offsetSeconds >= MV_INTRO_OFFSET_MAX_SEC}
                        onClick={() => useMvIntroOffsetStore.getState().setOffset(trackKey, offsetSeconds + MV_INTRO_OFFSET_STEP)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none hover:bg-white/15 disabled:pointer-events-none disabled:opacity-35"
                    >
                        ＋
                    </button>
                </div>
            )}
        </div>
    );
};

export default MvBackground;
