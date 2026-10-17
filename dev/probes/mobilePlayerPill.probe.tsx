import React, { useState } from 'react';
import MobilePlayerPill from '../../src/components/floating-player/MobilePlayerPill';
import { PlayerState } from '../../src/types';
import type { SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/mobilePlayerPill.probe.tsx

/**
 * 触屏迷你胶囊（方向四 · Apple Music 式）只有在真实浏览器里才暴露的几件事：
 * 1. 播放页短路——currentView === 'player' 时整条胶囊不渲染，同一处不挂两个播放器；
 * 2. 左右滑胶囊切歌，跟手位移过阈值才生效，且滑动松手补发的那次 click 不能再跳播放页；
 * 3. 点胶囊本体 = 去播放页（lattice 下锚回当前卡），点播放键 = 只切播放态不跳转。
 *
 * 探针不测底栏抬升（那条由共享 MotionValue 驱动，playerBottomBar 探针已覆盖），只把各回调
 * 的次数镜像到 data 属性上，好让用例断言「谁被调了几次」。切换 currentView / currentSong
 * 靠顶部的按钮，模拟浏览页 ↔ 播放页。
 */
const probeSong = { name: 'Probe Song', id: 'probe-1' } as unknown as SongResult;
const longSong = { name: 'A Very Long Track Name That Will Definitely Overflow The Narrow Pill On A Phone Screen', id: 'probe-long' } as unknown as SongResult;

const MobilePlayerPillProbe: React.FC = () => {
    const [view, setView] = useState<'home' | 'player' | 'lattice'>('home');
    const [song, setSong] = useState<SongResult | null>(probeSong);
    const [playerState, setPlayerState] = useState(PlayerState.PLAYING);
    const [hideControlBar, setHideControlBar] = useState(false);
    const [canPrev, setCanPrev] = useState(true);
    const [canNext, setCanNext] = useState(true);

    const [togglePlays, setTogglePlays] = useState(0);
    const [navigations, setNavigations] = useState(0);
    const [latticeFocuses, setLatticeFocuses] = useState(0);
    const [prevs, setPrevs] = useState(0);
    const [nexts, setNexts] = useState(0);

    return (
        <div
            className="relative h-screen bg-zinc-900"
            data-probe-view={view}
            data-probe-has-song={song ? 'on' : 'off'}
            data-probe-hides={hideControlBar ? 'on' : 'off'}
            data-probe-toggles={togglePlays}
            data-probe-navigations={navigations}
            data-probe-lattice-focuses={latticeFocuses}
            data-probe-prevs={prevs}
            data-probe-nexts={nexts}
        >
            <div className="absolute left-4 top-4 z-[80] flex flex-wrap gap-2">
                <button type="button" data-probe-action="view-home" onClick={() => setView('home')}>home</button>
                <button type="button" data-probe-action="view-player" onClick={() => setView('player')}>player</button>
                <button type="button" data-probe-action="view-lattice" onClick={() => setView('lattice')}>lattice</button>
                <button type="button" data-probe-action="song-long" onClick={() => setSong(longSong)}>long</button>
                <button type="button" data-probe-action="song-none" onClick={() => setSong(null)}>no-song</button>
                <button type="button" data-probe-action="toggle-hide" onClick={() => setHideControlBar(v => !v)}>hide-bar</button>
                <button type="button" data-probe-action="block-nav" onClick={() => { setCanPrev(false); setCanNext(false); }}>block-nav</button>
            </div>

            <MobilePlayerPill
                currentSong={song}
                playerState={playerState}
                currentView={view}
                canTogglePlay
                isDaylight={false}
                hideControlBar={hideControlBar}
                onTogglePlay={() => {
                    setTogglePlays(count => count + 1);
                    setPlayerState(state => (state === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING));
                }}
                onNavigateToPlayer={() => setNavigations(count => count + 1)}
                onFocusLatticeCurrentSong={() => setLatticeFocuses(count => count + 1)}
                trackNavigation={{
                    currentTrackKey: song ? String(song.id) : 'none',
                    onPrev: () => setPrevs(count => count + 1),
                    onNext: () => setNexts(count => count + 1),
                    canPrev,
                    canNext,
                    prevTitle: 'Prev Song',
                    nextTitle: 'Next Song',
                    prevLabel: 'Previous',
                    nextLabel: 'Next',
                }}
            />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'mobilePlayerPill',
    title: '触屏迷你播放胶囊 · 播放页短路与滑动切歌',
    description: '无进度迷你胶囊：播放页不渲染、点胶囊去播放页（lattice 锚回当前卡）、点播放键只切态、左右滑过阈值切歌且不误触跳转。',
    Component: MobilePlayerPillProbe,
};

export default definition;
