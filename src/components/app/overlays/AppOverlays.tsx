import React from 'react';
import FloatingPlayerControls from '../../FloatingPlayerControls';
import MobilePlayerPill from '../../floating-player/MobilePlayerPill';
import SearchWorkspace from '../search/SearchWorkspace';
import DevDebugOverlay from '../../DevDebugOverlay';
import MemoryMonitorWindow from '../../debug/MemoryMonitorWindow';
import NowPlayingToast from './NowPlayingToast';
import type { AppOverlaysModel } from './buildAppOverlaysModel';
import { countRender } from '../../../dev/renderCount';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import { useSupportsFinePointer } from '../../../hooks/useSupportsFinePointer';
import type { SongResult } from '../../../types';

// Centralized app-level overlay renderer so App.tsx does not mount leaf overlays directly.
type AppOverlaysProps = {
    model: AppOverlaysModel;
};

const AppOverlays: React.FC<AppOverlaysProps> = ({ model }) => {
    countRender('AppOverlays');
    const isCurrentSongPosterVisible = useLatticeControlsStore(state => state.isCurrentSongPosterVisible);
    const isFinePointer = useSupportsFinePointer();
    const {
        searchOverlay,
        debugOverlay,
        memoryMonitor,
        floatingControls,
        nowPlayingToast,
    } = model;

    return (
        <>
            {searchOverlay && <SearchWorkspace {...searchOverlay} />}

            {debugOverlay && <DevDebugOverlay {...debugOverlay} />}

            {memoryMonitor && <MemoryMonitorWindow {...memoryMonitor} />}

            {floatingControls
                && (floatingControls.currentView !== 'lattice' || !isCurrentSongPosterVisible)
                && (isFinePointer
                    ? <FloatingPlayerControls {...floatingControls} />
                    : <MobilePlayerPill
                        {...floatingControls}
                        currentSong={floatingControls.currentSong as SongResult | null}
                    />)}

            {/* 左下角 now playing 卡片只在桌面（细指针）显示：触屏端底部已有 MobilePlayerPill，
                再叠这张卡是重复占位。与上面浮层控件按同一条 isFinePointer 判据分流。 */}
            {isFinePointer && nowPlayingToast && <NowPlayingToast {...nowPlayingToast} />}
        </>
    );
};

export default React.memo(AppOverlays);
