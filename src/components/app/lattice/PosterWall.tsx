import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SongResult } from '../../../types';
import {
    getLatticeGeometry,
    layoutExpandedBlock,
    layoutLattice,
    locateFullyVisibleInstance,
    locateInstanceWithId,
    overlaps,
    toBounds,
    type Bounds,
    type LatticeGeometry,
    type ReflowTile,
    type WallMetrics,
} from '../../wall/layout';
import { useWallCameraPan, type LatticeCamera } from '../../wall/useWallCameraPan';
import { computeLightsRippleDelay } from '../../wall/lightsRipple';
import LightsStageGlow from '../../wall/LightsStageGlow';
import { useLatticePosterSelection } from './useLatticePosterSelection';
import { useWallKeyboardFocus } from './useWallKeyboardFocus';
import { useWallPointerPan } from '../../wall/useWallPointerPan';
import type { LatticeTile } from './latticeModel';
import LatticePoster from './LatticePoster';
import { countRender } from '../../../dev/renderCount';
import {
    useLatticePlaybackFocus,
} from './useLatticePlaybackFocus';
import { setLatticeCurrentSongPosterVisible } from '../../../stores/useLatticeControlsStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { useDevicePixelRatio } from '../../../hooks/useMediaQuery';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { EXPANSION_SPAN } from '../../wall/blockTemplates';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import { useLatticeWallHandoff } from './useLatticeWallHandoff';

// Draggable poster field: one greedily packed block template repeats over the queue.
// 翻牌交接（设计稿 §7「进入队列」）：从资料库墙进来时不跑自己的入场波次，海报侧立着等资料库墙翻出、再按到起点的距离翻进；
// 回资料库墙时海报按距离翻出（useLatticeWallHandoff）。

type PosterWallProps = {
    tiles: LatticeTile[];
    /** Only for playback focus and visibility tracking; the chrome reads transport state from context. */
    currentSong: SongResult | null;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onBack: () => void;
};


const CELL_SIZE = 128;
const GAP = 8;
const OVERSCAN = 500;
// How much of the flight path may stay rendered while the camera travels, in viewports.
const MAX_RESERVED_VIEWPORTS = 3;
// Metro tile landing: the wave starts at the top-left of the viewport and runs down the diagonal.
const ENTRANCE_STAGGER = 0.03;
const ENTRANCE_MAX_DELAY = 0.34;
const ENTRANCE_WINDOW = 1100;
const METRICS: WallMetrics = { cellSize: CELL_SIZE, gap: GAP };
// Longest edge a card can reach, which is the gear expansion hands it.
const EXPANDED_SIZE = EXPANSION_SPAN.cols * (CELL_SIZE + GAP) - GAP;
// 涟漪熄灯：关灯/开灯时以正在播放那张为中心，每张卡的熄灯层按与中心的欧氏距离延后启动。具体延迟公式抽到
// components/wall/lightsRipple.ts，bravais 那边同一份。


const getScale = (width: number) => width < 640 ? 0.52 : width < 1100 ? 0.64 : 0.76;

const getWorldBounds = (camera: LatticeCamera, viewport: { width: number; height: number }): Bounds => ({
    left: -camera.x / camera.scale,
    top: -camera.y / camera.scale,
    right: (viewport.width - camera.x) / camera.scale,
    bottom: (viewport.height - camera.y) / camera.scale,
});

export default function PosterWall({
    tiles,
    currentSong,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onBack,
}: PosterWallProps) {
    countRender('PosterWall');
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<LatticeCamera>({ x: 34, y: 80, scale: 0.76 });
    const viewportRef = useRef({ width: 1280, height: 720 });
    const frameRef = useRef<number | null>(null);
    const trackedCurrentPosterRef = useRef<{
        enabled: boolean;
        rect: Omit<ReflowTile, 'instanceId'> | null;
    }>({ enabled: false, rect: null });
    const currentPosterVisibleRef = useRef(true);
    // expandPoster 是海报的永久身份回调，读当时在播的歌走 ref，不进依赖。
    const currentSongKeyRef = useRef<string | null>(null);
    const [bounds, setBounds] = useState<Bounds>(() => getWorldBounds(cameraRef.current, viewportRef.current));
    // Nothing is drawn until the field reports its size: the seeded camera and the default
    // viewport would otherwise place the entering wave, and the playing song, off centre.
    const [measured, setMeasured] = useState(false);
    const [entranceDone, setEntranceDone] = useState(false);
    // Camera scale, mirrored into state only so posters can size their artwork. It follows the
    // width breakpoints, so this settles after the first measure and then only moves on a resize.
    const [cameraScale, setCameraScale] = useState(() => cameraRef.current.scale);
    const reducedMotion = useReducedMotionFor('lattice');
    // 从资料库墙翻牌交接进来（或淡入交叉）：入场由交接代替，不跑抬起落下的波次。
    const entranceSuppressed = useWallHandoffStore(state => resolveWallHandoffRole(state.session, 'lattice') === 'in');
    const autoFocusOnSongChange = useLatticeSettingsStore(state => state.autoFocusOnSongChange);
    const devicePixelRatio = useDevicePixelRatio();
    const pixelScale = cameraScale * devicePixelRatio;

    const geometry = useMemo(() => getLatticeGeometry(tiles.length, METRICS), [tiles.length]);
    const [activePoster, setActivePoster] = useLatticePosterSelection(tiles, geometry, METRICS);

    // 播放吸附的锚点：入场 / 换曲 / 手动聚焦居中的那一张副本（instanceId 是永久身份）。墙按周期
    // 平铺，同一首歌有许多副本，检查只认这张。吸附看「离开过」：用户滚动/拖动期间它只要离开过
    // 「完整在屏」（被边缘裁掉或出屏），停下时又完整在屏，就吸回正中一次；全程都完整在屏的浏览
    // 不吸（否则每次停稳都被拉回去，滚动没法用）。
    const playbackAnchorRef = useRef<{ songKey: string; instanceId: string } | null>(null);
    const anchorLeftFullViewRef = useRef(false);
    // 跟踪与停稳检查共用的场景数据。layout 随展开/收起每渲染重建，而跟踪挂在每帧镜头上，
    // 走 ref 不进依赖，免得 applyCamera 跟着重建。
    const anchorSceneRef = useRef<{
        geometry: LatticeGeometry;
        tilesLength: number;
        layout: Map<string, { x: number; y: number; width: number; height: number }> | null;
    }>({ geometry, tilesLength: tiles.length, layout: null });
    // 用户驱动的镜头（拖动/滚轮/触控板/惯性）每帧过一遍：锚点那张不完整在屏就记「离开过」。
    // 按帧跟踪而不是只在停稳时采样：滚出去又滚回来中间不停顿（间隔不到 300ms 不算停稳），
    // 采样会漏记那次「离开」，滚回来就不吸了。panTo 的程序化飞行（入场/换曲/吸附本身）不走
    // updateCamera，不会把起飞前的裁边误记成用户浏览造成的离开。
    const trackAnchorLeftFullView = useCallback((camera: LatticeCamera) => {
        const anchor = playbackAnchorRef.current;
        if (!anchor) return;
        const { geometry: sceneGeometry, tilesLength, layout: sceneLayout } = anchorSceneRef.current;
        const instance = locateInstanceWithId(sceneGeometry, tilesLength, anchor.instanceId, METRICS);
        if (!instance) return;
        const rect = sceneLayout?.get(instance.instanceId) ?? instance;
        const view = getWorldBounds(camera, viewportRef.current);
        if (rect.x < view.left || rect.y < view.top
            || rect.x + rect.width > view.right || rect.y + rect.height > view.bottom) {
            if (!anchorLeftFullViewRef.current) console.log('[snap] 逐帧：锚点离开完整在屏');
            anchorLeftFullViewRef.current = true;
        }
    }, []);

    const publishCurrentPosterVisibility = useCallback((camera: LatticeCamera) => {
        const tracked = trackedCurrentPosterRef.current;
        const visible = !tracked.enabled || Boolean(
            tracked.rect && overlaps(toBounds(tracked.rect), getWorldBounds(camera, viewportRef.current)),
        );
        if (currentPosterVisibleRef.current === visible) return;
        currentPosterVisibleRef.current = visible;
        setLatticeCurrentSongPosterVisible(visible);
    }, []);

    const applyCamera = useCallback((next: LatticeCamera, updateBounds = false) => {
        cameraRef.current = next;
        if (worldRef.current) {
            worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
        }
        publishCurrentPosterVisibility(next);
        trackAnchorLeftFullView(next);
        if (!updateBounds || frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            setBounds(getWorldBounds(cameraRef.current, viewportRef.current));
            frameRef.current = null;
        });
    }, [publishCurrentPosterVisibility, trackAnchorLeftFullView]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(([entry]) => {
            viewportRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
            const scale = getScale(entry.contentRect.width);
            applyCamera({ ...cameraRef.current, scale }, true);
            setCameraScale(previous => previous === scale ? previous : scale);
            setMeasured(true);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        };
    }, [applyCamera]);

    // Widens the culled region to cover a pan's destination the moment it starts. Held arrow
    // keys interrupt each pan before it settles, so bounds cannot wait for the animation to end.
    const reserveBounds = useCallback((camera: LatticeCamera) => {
        const destination = getWorldBounds(camera, viewportRef.current);
        setBounds(current => {
            const covered = destination.left >= current.left && destination.right <= current.right
                && destination.top >= current.top && destination.bottom <= current.bottom;
            if (covered) return current;

            const merged = {
                left: Math.min(current.left, destination.left),
                right: Math.max(current.right, destination.right),
                top: Math.min(current.top, destination.top),
                bottom: Math.max(current.bottom, destination.bottom),
            };
            // A long flight would otherwise reserve more than the render cap can fill, which
            // empties the far end; past that point only the destination is worth keeping.
            const mergedArea = (merged.right - merged.left) * (merged.bottom - merged.top);
            const destinationArea = (destination.right - destination.left)
                * (destination.bottom - destination.top);
            return mergedArea > destinationArea * MAX_RESERVED_VIEWPORTS ? destination : merged;
        });
    }, []);

    const { panTo, stopPan, animationRef } = useWallCameraPan({ cameraRef, viewportRef, reducedMotion, applyCamera, reserveBounds });

    useEffect(() => {
        if (!measured || entranceDone) return;
        if (reducedMotion || entranceSuppressed) {
            setEntranceDone(true);
            return;
        }
        const timer = setTimeout(() => setEntranceDone(true), ENTRANCE_WINDOW);
        return () => clearTimeout(timer);
    }, [entranceDone, entranceSuppressed, measured, reducedMotion]);

    // Posters landing in the opening wave are held back by their distance from that corner; once
    // the wave is over every poster mounts in place, so panning never replays it.
    const getEntranceDelay = useCallback((rect: { x: number; y: number }) => {
        if (entranceDone || reducedMotion || entranceSuppressed) return null;
        const steps = Math.max(0, rect.x - bounds.left) + Math.max(0, rect.y - bounds.top);
        return Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
    }, [bounds.left, bounds.top, entranceDone, entranceSuppressed, reducedMotion]);

    // The entry wave reaches the top-left first; leaving reverses that order while cards retrace
    // their upward flight, so the wall empties back toward the corner it entered from.
    //
    // Permanently identified, and reading the corner it measures from through a ref, because the
    // posters hold this across camera moves. A delay computed per render would have to be handed
    // down as a changing number, and the corner moves with every pan - which defeated
    // LatticePoster's memo and re-rendered every mounted card on each re-cull. The card calls this
    // when it actually leaves, so the wave is still measured against the corner of the moment.
    const exitWaveRef = useRef({ bounds, reducedMotion });
    exitWaveRef.current = { bounds, reducedMotion };
    const getExitDelay = useCallback((rect: { x: number; y: number }) => {
        const { bounds: corner, reducedMotion: reduced } = exitWaveRef.current;
        if (reduced) return 0;
        const steps = Math.max(0, rect.x - corner.left) + Math.max(0, rect.y - corner.top);
        const entranceDelay = Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
        return ENTRANCE_MAX_DELAY - entranceDelay;
    }, []);

    const instances = useMemo(() => {
        if (!measured) return [];
        const visible = layoutLattice(geometry, tiles.length, bounds, OVERSCAN, METRICS);
        if (!activePoster || visible.some(instance => instance.instanceId === activePoster.instance.instanceId)) {
            return visible;
        }
        return [...visible, activePoster.instance];
    }, [activePoster, bounds, geometry, measured, tiles.length]);

    // World point the viewport is centred on; both the keyboard seed and playback follow need it.
    const getViewportCenter = useCallback(() => {
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        return {
            x: (viewport.width / 2 - camera.x) / camera.scale,
            y: (viewport.height / 2 - camera.y) / camera.scale,
        };
    }, []);

    // Only the block holding the open card is re-geared; every other poster keeps its base rect.
    const layout = useMemo(() => (
        activePoster
            ? layoutExpandedBlock(geometry, tiles.length, activePoster.instance, METRICS)
            : new Map<string, { x: number; y: number; width: number; height: number }>()
    ), [activePoster, geometry, tiles.length]);

    anchorSceneRef.current = { geometry, tilesLength: tiles.length, layout };

    // 播放中的卡「离开过、又完整出现就吸一次」（2026-10-15）：镜头停稳（拖动松手 / 惯性滑完 /
    // 滚轮停下，见 useWallPointerPan 的 onPanSettle）后检查一次——绑定的那张副本
    // （playbackAnchorRef，入场 / 换曲 / 手动聚焦居中的那张）在这次浏览里离开过「完整在屏」
    // （trackAnchorLeftFullView 逐帧记），停下时又完整在屏，就吸回正中一次；全程都完整在屏时
    // 不动镜头。展开别的卡看的时候不抢镜头；吸附不改展开状态：没展开就居中格子，展开着就居中
    // 展开块。交接期间镜头被接管，不检查。
    // [snap] 以下 console.log 均为临时诊断（真机不吸附排查），定位后整体删除。
    const centerPlaybackPoster = useCallback(() => {
        if (!measured || animationRef.current) {
            console.log('[snap] 停稳但跳过：measured=%s 上一段动画还挂着=%s', measured, Boolean(animationRef.current));
            return;
        }
        const container = containerRef.current;
        if (!container || container.closest('[data-wall-handoff]')) {
            console.log('[snap] 停稳但跳过：交接中');
            return;
        }
        const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        if (!songKey) {
            console.log('[snap] 停稳但跳过：没有在播的歌');
            return;
        }
        const queueIndex = tiles.findIndex(tile => tile.id === songKey);
        if (queueIndex < 0) {
            console.log('[snap] 停稳但跳过：在播的歌不在队列里 %s', songKey);
            return;
        }
        if (activePoster && activePoster.tile.id !== songKey) {
            console.log('[snap] 停稳但跳过：展开的是别的卡');
            return;
        }
        const viewport = getWorldBounds(cameraRef.current, viewportRef.current);
        // 锚点指向的歌不在了（换曲 / 队列重排后席位映射会漂）就当作没有锚点，重新找完整可见的最近副本。
        const anchor = playbackAnchorRef.current;
        const anchoredHere = anchor?.songKey === songKey
            ? locateInstanceWithId(geometry, tiles.length, anchor.instanceId, METRICS)
            : null;
        const anchored = anchoredHere && anchoredHere.queueIndex === queueIndex ? anchoredHere : null;
        const instance = anchored
            ?? locateFullyVisibleInstance(geometry, tiles.length, queueIndex, viewport, METRICS,
                candidate => layout.get(candidate.instanceId) ?? candidate);
        if (!instance) {
            console.log('[snap] 停稳但跳过：找不到完整可见的副本');
            return;
        }
        const rect = layout.get(instance.instanceId) ?? instance;
        const fullyVisible = rect.x >= viewport.left && rect.y >= viewport.top
            && rect.x + rect.width <= viewport.right && rect.y + rect.height <= viewport.bottom;
        if (!anchored) {
            // 没有锚点（首次 / 换曲后没跟随的第一次停稳）：有完整可见的副本就吸这一次，并定为锚点。
            if (!fullyVisible) {
                console.log('[snap] 无锚点且不完整在屏：不吸');
                return;
            }
            console.log('[snap] 无锚点首次停稳：吸这一次并播种 %s', instance.instanceId);
            playbackAnchorRef.current = { songKey, instanceId: instance.instanceId };
            anchorLeftFullViewRef.current = false;
        } else if (!fullyVisible) {
            // 锚点那张被裁掉或不在屏：不吸，镜头留在停下的地方；「离开过」已由每帧跟踪记下。
            console.log('[snap] 锚点不在屏：记下离开过');
            anchorLeftFullViewRef.current = true;
            return;
        } else if (!anchorLeftFullViewRef.current) {
            // 这次浏览它全程都完整在屏：不吸，停在哪就待在哪。
            console.log('[snap] 锚点全程完整在屏：不吸');
            return;
        } else {
            // 离开过、现在又完整回来了：吸回正中一次，清掉标记。
            console.log('[snap] 离开过又回来了：触发吸附');
            anchorLeftFullViewRef.current = false;
        }
        const targetX = viewportRef.current.width / 2 - (rect.x + rect.width / 2) * cameraRef.current.scale;
        const targetY = viewportRef.current.height / 2 - (rect.y + rect.height / 2) * cameraRef.current.scale;
        // 已经对中就不再起动画：panTo 的落点就是这里，重跑只会白飞一次。
        if (Math.abs(targetX - cameraRef.current.x) < 1.5 && Math.abs(targetY - cameraRef.current.y) < 1.5) {
            console.log('[snap] 位移不足 1.5px：不吸（dx=%s dy=%s）', targetX - cameraRef.current.x, targetY - cameraRef.current.y);
            return;
        }
        // 吸附用弹簧档：缓起缓收，小距离也不生硬（展开/键盘跳格的 panTo 仍走原 tween）。
        panTo(rect, false, { spring: true });
    }, [activePoster, currentSong, geometry, layout, measured, panTo, tiles]);

    const { didDragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } = useWallPointerPan({
        applyCamera,
        animationRef,
        stopPan,
        containerRef,
        reducedMotion,
        overscan: OVERSCAN,
        bounds,
        cameraRef,
        getWorldBounds,
        viewportRef,
        onPanSettle: centerPlaybackPoster,
        onCameraFrame: trackAnchorLeftFullView,
    });

    useEffect(() => {
        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        const isTracking = measured && Boolean(currentSongKey);
        const rect = activePoster && activePoster.tile.id === currentSongKey
            ? layout.get(activePoster.instance.instanceId) ?? activePoster.instance
            : null;
        trackedCurrentPosterRef.current = { enabled: isTracking, rect };
        publishCurrentPosterVisibility(cameraRef.current);
    }, [activePoster, currentSong, layout, measured, publishCurrentPosterVisibility]);

    useEffect(() => () => {
        currentPosterVisibleRef.current = true;
        setLatticeCurrentSongPosterVisible(true);
    }, []);

    const { focused, setFocused, handleKeyDown, handleFocusCapture, handleBlurCapture } = useWallKeyboardFocus({
        activePoster,
        containerRef,
        geometry,
        getViewportCenter,
        instances,
        metrics: METRICS,
        panTo,
        rendered: layout,
        setActivePoster,
        tiles,
        worldRef,
        onBack,
    });

    // Permanent identities for the two handlers every poster receives. An arrow per poster is
    // re-created on each wall render, which alone would defeat LatticePoster's memo and put all
    // 50+ poster bodies back on the critical path of every unrelated App re-render.
    const latestWall = useRef({ geometry, instances, tiles });
    latestWall.current = { geometry, instances, tiles };
    const expandPoster = useCallback((instanceId: string) => {
        const { geometry: currentGeometry, instances: currentInstances, tiles: currentTiles } = latestWall.current;
        const instance = currentInstances.find(item => item.instanceId === instanceId);
        const tile = instance ? currentTiles[instance.queueIndex] : undefined;
        if (!instance || !tile) return;
        setFocused(instance);
        setActivePoster({ instance, tile });
        // Expansion reflows both the position and size of the selected slot.
        const expandedRect = layoutExpandedBlock(currentGeometry, currentTiles.length, instance, METRICS).get(instanceId);
        if (expandedRect) panTo(expandedRect);
        // 手动展开正在播放的歌也算一次「对中」：锚点跟着走，随后的停稳检查查的就是这张。
        if (currentSongKeyRef.current && tile.id === currentSongKeyRef.current) {
            console.log('[snap] 手动展开在播卡：播种锚点 %s', instance.instanceId);
            playbackAnchorRef.current = { songKey: currentSongKeyRef.current, instanceId: instance.instanceId };
            anchorLeftFullViewRef.current = false;
        }
    }, [panTo, setActivePoster, setFocused]);
    const collapsePoster = useCallback(() => setActivePoster(null), [setActivePoster]);

    useLatticePlaybackFocus({
        currentSong,
        ready: measured,
        tiles,
        geometry,
        metrics: METRICS,
        getViewportCenter,
        setActivePoster,
        setFocused,
        panTo,
        onFocusInstance: instance => {
            // 跟随居中的那张就是吸附的锚点：之后的停稳检查从它开始，而不是任找一张完整副本。
            if (currentSongKeyRef.current) {
                console.log('[snap] 入场/换曲跟随：播种锚点 %s', instance.instanceId);
                playbackAnchorRef.current = { songKey: currentSongKeyRef.current, instanceId: instance.instanceId };
                anchorLeftFullViewRef.current = false;
            }
        },
    });
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    currentSongKeyRef.current = currentSongKey;
    const handoff = useLatticeWallHandoff({
        containerRef,
        cameraRef,
        applyCamera,
        measured,
        metrics: METRICS,
        activePoster,
        layout,
        focused,
        waitingForFocus: autoFocusOnSongChange && !activePoster && currentSongKey !== null
            && tiles.some(tile => tile.id === currentSongKey),
    });
    // 涟漪熄灯的中心：当前播放那张卡的世界坐标中心。没在播/不在队列里时为 null，延迟固定 0（不做涟漪）。
    // instances 变化（重新剔归/culling）与 layout 变化（展开或收起）都会重新算；song 切换时 tiles 已换新引用，
    // 本来就会引发 LatticePoster 重渲染，不担心额外的开销。
    const lightsRippleOrigin = useMemo(() => {
        for (const instance of instances) {
            const tile = tiles[instance.queueIndex];
            if (!tile || tile.section !== 'now') continue;
            const rect = layout.get(instance.instanceId) ?? instance;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        return null;
    }, [instances, layout, tiles]);
    const getLightsRippleDelay = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
        return computeLightsRippleDelay(rect, lightsRippleOrigin);
    }, [lightsRippleOrigin]);
    return (
        <div
            ref={containerRef}
            className="lattice-field"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={event => {
                // Touch transfers implicit capture from the poster to the field when dragging.
                if (event.target === event.currentTarget) onPointerCancel(event);
            }}
            onClickCapture={onClickCapture}
        >
            <div ref={worldRef} className="lattice-world">
                {instances.map(instance => {
                    const tile = tiles[instance.queueIndex];
                    if (!tile) return null;
                    const expanded = activePoster?.instance.instanceId === instance.instanceId;
                    const rect = layout.get(instance.instanceId) ?? instance;
                    return (
                        <LatticePoster
                            key={instance.instanceId}
                            instanceId={instance.instanceId}
                            isFocused={focused?.instanceId === instance.instanceId}
                            tile={tile}
                            rect={rect}
                            gap={METRICS.gap}
                            pixelScale={pixelScale}
                            expandedSize={EXPANDED_SIZE}
                            entranceDelay={getEntranceDelay(rect)}
                            getExitDelay={getExitDelay}
                            handoff={handoff.getPosterHandoff(instance.instanceId, rect)}
                            lightsRippleDelay={getLightsRippleDelay(rect)}
                            expanded={expanded}
                            reducedMotion={reducedMotion}
                            didDragRef={didDragRef}
                            onExpand={expandPoster}
                            onPlay={onPlay}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                        />
                    );
                })}
            </div>

            {/* 关灯态舞台聚光（雾感版，见组件头注）：自包含 canvas，自己跟随 is-lights-out 与 .is-current，开灯时休眠。 */}
            <LightsStageGlow />
        </div>
    );
}
