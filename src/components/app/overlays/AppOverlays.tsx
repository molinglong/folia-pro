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

            {nowPlayingToast && <NowPlayingToast {...nowPlayingToast} />}
        </>
    );
};

export default React.memo(AppOverlays);
