import React, { useCallback, useState } from 'react';
import { motionValue } from 'framer-motion';
import FloatingPlayerControls from '../../src/components/FloatingPlayerControls';
import PlaybackQuickPanel from '../../src/components/floating-player/PlaybackQuickPanel';
import { PlayerState } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/playbackQuick.probe.tsx
// @fork 本地魔改版（2026-10-14）：胶囊右槽默认动作 playback-quick 与它的二级浮层（音量 + 静音 + 洗牌）。
// 浮层读写的是真的 useAudioSettingsStore / usePlaybackStore（探针不隔离 store，与主页样式探针同款），
// 洗牌只数次数——真实实现住在 App，这里验证的是「按钮 → 开关 → 行项」这条接线本身。

const currentTime = motionValue(42);

const PlaybackQuickProbe: React.FC = () => {
    const [shuffleCalls, setShuffleCalls] = useState(0);
    // 洗牌可用性不在这里给：浮层直接读真的 usePlaybackStore（队列 ≥ 2 首才可点），
    // 次数写在根节点 data 属性上供用例断言。
    const bump = useCallback(() => setShuffleCalls(count => count + 1), []);

    return (
        <div className="relative h-screen" data-probe-shuffle-calls={shuffleCalls}>
            <FloatingPlayerControls
                currentSong={{ name: 'Probe Song' }}
                playerState={PlayerState.PLAYING}
                currentTime={currentTime}
                duration={200}
                loopMode="all"
                currentView="player"
                audioSrc="probe://audio"
                canTogglePlay
                lyrics={null}
                onSeek={() => {}}
                onTogglePlay={() => {}}
                onToggleLoop={() => {}}
                onNavigateToPlayer={() => {}}
                isDaylight={false}
                slotPrimary="loop"
                slotSecondary="playback-quick"
                slotContext={{
                    onShuffle: () => {},
                    canShuffle: false,
                    onLike: () => {},
                    isLiked: false,
                    likeDisabled: true,
                    invokeCommandById: () => {},
                    canInvokeCommandById: () => true,
                }}
                onCommitBottomBarOffset={() => {}}
            />
            <PlaybackQuickPanel isDaylight={false} onShuffle={bump} />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'playbackQuick',
    title: '播放胶囊 · 播放快捷二级浮层',
    description: '右槽 playback-quick 点开/收起胶囊上方浮层：音量滑条、静音、洗牌。',
    Component: PlaybackQuickProbe,
};

export default definition;
