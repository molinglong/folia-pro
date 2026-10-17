import type { PlayerState, LyricData } from '../types';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from './videoExport';

// src/types/remoteControl.ts
// Shared payloads for the Electron remote control window.
export type PlayerChromeVisibilityMode = 'always-hidden' | 'always-visible' | 'auto-hide';

export interface RemoteTrackTransition {
    /** Unix time when the audible AutoMix/Crossfade transition started. */
    startedAtMs: number;
    /** Actual wall-clock span scheduled by the shared transition session. */
    durationSec: number;
    /** Point inside the span where the incoming track becomes dominant, 0..1. */
    crossover: number;
}

export type RemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'cycle-loop-mode' }
    | { type: 'resize-main-window'; width: number; height: number }
    | { type: 'set-main-window-border-visible'; visible: boolean }
    | { type: 'set-main-window-click-through'; enabled: boolean }
    | { type: 'set-main-window-always-on-top'; enabled: boolean }
    | { type: 'set-transparent-mode-enabled'; enabled: boolean }
    | { type: 'disable-transparent-mode' }
    | { type: 'cycle-player-chrome-visibility-mode' }
    | { type: 'open-export' }
    /** 遥控窗口确认已处理某次「切到导出面板」请求，主窗口据此不再重发它。 */
    | { type: 'export-panel-seen'; seq: number }
    | { type: 'start-export'; preset: VideoExportPreset; startMode: VideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' };

export interface RemoteControlSnapshot {
    hasTrack: boolean;
    /** 当前曲目标识，遥控窗口据此判断"换歌了"并触发过渡 */
    trackKey: string | null;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    loopMode: 'off' | 'all' | 'one';
    canGoPrevious: boolean;
    canGoNext: boolean;
    prevTrackKey: string | null;
    prevTrackTitle: string | null;
    prevTrackArtist: string | null;
    prevTrackCoverUrl: string | null;
    nextTrackKey: string | null;
    nextTrackTitle: string | null;
    nextTrackArtist: string | null;
    nextTrackCoverUrl: string | null;
    /** Present while an AutoMix or explicitly selected Crossfade transition is audible. */
    trackTransition: RemoteTrackTransition | null;
    controlsDisabled: boolean;
    isStageActive: boolean;
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    playerChromeVisibilityMode: PlayerChromeVisibilityMode;
    exportState: VideoExportState;
    /**
     * 待处理的「切到导出面板」请求序号（「录制歌词视频」命令按下时递增）；0 = 无请求。
     * 遥控窗口切换后回发 export-panel-seen 销账，重新打开窗口不会被旧请求劫持。
     */
    exportPanelRequest?: number;
    isDaylight?: boolean;
    lyrics?: LyricData | null;
    lyricOffsetMs?: number;
    isLiked?: boolean;
    canLike?: boolean;
    likeUnavailableProvider?: string;
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
}
