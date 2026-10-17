import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../types';
import type { SongResult } from '../../types';
import { getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { toSafeRemoteUrl } from '../../utils/appPlaybackHelpers';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';
import type { TrackNavigation } from '../FloatingPlayerControls';

// src/components/floating-player/MobilePlayerPill.tsx
// 触屏主指针（手机/平板）下的底部播放胶囊，和桌面的 FloatingPlayerControls 按
// useSupportsFinePointer 分流，两边互不吃对方的交互原语：这里没有 hover 展开、
// 没有 layoutId 共享进度条、没有 input[type=range]（全页 range 数量约束不受影响）。
//
// 形态规则（方向四 · Apple Music 式）：
// - 胶囊上不放进度条——只有封面小图、歌名（超长时跑马灯）和一个播放键；
//   seek、前后曲、循环全部收在播放页里。
// - 播放页不渲染本组件（见下方的 currentView 短路）：页面自带全套控件，
//   同一处不挂两个播放器。AppOverlays 的海报墙卡面可见那条例外同样适用。
// - 点胶囊 = 去播放页（lattice 下锚回当前卡，和桌面胶囊的 handleClick 语义一致）。
// - 左右滑胶囊 = 上一首/下一首，松手弹簧回弹；滑过阈值那一下不再触发点击跳转。

/** 滑动切歌的位移阈值（CSS px），和位移跟手系数。 */
const SWIPE_THRESHOLD_PX = 56;
const SWIPE_FOLLOW_RATIO = 0.55;
/** 小于这个位移按"点击"处理，不吞 onClick。 */
const TAP_MAX_TRAVEL_PX = 10;

export interface MobilePlayerPillProps {
    /** 运行时是完整的 SongResult（胶囊的 props 只声明了 name，取封面要用其余字段）。 */
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentView: 'home' | 'player' | 'lattice';
    canTogglePlay?: boolean;
    controlsDisabled?: boolean;
    isDaylight: boolean;
    hideControlBar?: boolean;
    noTrackText?: string;
    trackNavigation?: TrackNavigation | null;
    onTogglePlay: () => void;
    onNavigateToPlayer: () => void;
    onFocusLatticeCurrentSong?: () => void;
}

const MobilePlayerPill: React.FC<MobilePlayerPillProps> = ({
    currentSong,
    playerState,
    currentView,
    canTogglePlay = false,
    controlsDisabled = false,
    isDaylight,
    hideControlBar = false,
    noTrackText = 'No Track',
    trackNavigation = null,
    onTogglePlay,
    onNavigateToPlayer,
    onFocusLatticeCurrentSong,
}) => {
    const { t } = useTranslation();
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    const title = currentSong?.name || noTrackText;
    const trackKey = trackNavigation?.currentTrackKey ?? title;

    // 封面取值链和别处一致：getSongCoverUrl → toSafeRemoteUrl → getSizedCoverUrl。
    // 36px 的图取 3 倍宽，出错（被回收的 blob URL 等）时落回占位图标，不留灰方块。
    const coverSrc = getSizedCoverUrl(toSafeRemoteUrl(getSongCoverUrl(currentSong)), 108);
    const [brokenCoverUrl, setBrokenCoverUrl] = useState<string | null>(null);
    const shownCover = coverSrc && coverSrc !== brokenCoverUrl ? coverSrc : null;

    // 歌名跑马灯：只有真的放不下才动。量 span 的 scrollWidth（内容全宽）而不是
    // offsetWidth——外层 overflow-hidden 会把 shrink-to-fit 的 span 夹到盒宽，
    // 后者永远测不出溢出。
    const textBoxRef = useRef<HTMLDivElement | null>(null);
    const textRef = useRef<HTMLSpanElement | null>(null);
    const [overflowPx, setOverflowPx] = useState(0);
    useEffect(() => {
        const box = textBoxRef.current;
        const text = textRef.current;
        if (!box || !text) {
            return;
        }
        const measure = () => setOverflowPx(Math.max(0, text.scrollWidth - box.clientWidth));
        measure();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        observer.observe(text);
        return () => observer.disconnect();
    }, [trackKey]);

    // 滑动手势。位移写 state 而不是 MotionValue：一帧一次的小组件，不值得再开一条信号链。
    const [dragX, setDragX] = useState(0);
    const [swiping, setSwiping] = useState(false);
    const startXRef = useRef<number | null>(null);
    const lastTravelRef = useRef(0);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest('button')) {
            return;
        }
        startXRef.current = event.clientX;
        lastTravelRef.current = 0;
        setSwiping(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (startXRef.current === null) {
            return;
        }
        const dx = (event.clientX - startXRef.current) * SWIPE_FOLLOW_RATIO;
        lastTravelRef.current = dx;
        setDragX(dx);
    };

    const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (startXRef.current === null) {
            return;
        }
        startXRef.current = null;
        setSwiping(false);
        setDragX(0);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (Math.abs(lastTravelRef.current) >= SWIPE_THRESHOLD_PX) {
            const next = lastTravelRef.current < 0;
            if (next && trackNavigation?.canNext) {
                trackNavigation.onNext();
            } else if (!next && trackNavigation?.canPrev) {
                trackNavigation.onPrev();
            }
        }
    };

    const handleClick = () => {
        // 滑动松手后浏览器还会补一次 click；用真实位移把它挡掉。
        if (Math.abs(lastTravelRef.current) > TAP_MAX_TRAVEL_PX) {
            return;
        }
        if (currentView === 'lattice') {
            onFocusLatticeCurrentSong?.();
        } else {
            onNavigateToPlayer();
        }
    };

    if (hideControlBar || currentView === 'player' || !currentSong) {
        return null;
    }

    const marqueeDuration = Math.max(4, (overflowPx + 24) / 24);

    return (
        <motion.div
            className="absolute inset-x-3 z-60"
            style={{ bottom: bottomBarBottomPx }}
        >
            <motion.div
                data-mobile-pill=""
                data-mobile-pill-track={trackKey}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onClick={handleClick}
                whileTap={{ opacity: 0.88 }}
                className={`pointer-events-auto flex h-[52px] w-full cursor-pointer select-none items-center gap-2.5 rounded-2xl border px-2.5
                    ${isDaylight
                        ? 'border-black/5 bg-white/90 text-zinc-900 shadow-[0_6px_18px_rgba(0,0,0,0.08)]'
                        : 'border-white/10 bg-zinc-900/90 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)]'}`}
                style={{
                    touchAction: 'pan-y',
                    transform: `translateX(${dragX}px)`,
                    transition: swiping
                        ? 'none'
                        : 'transform 0.4s cubic-bezier(0.34, 1.4, 0.5, 1)',
                }}
            >
                <div className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-[9px] ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-800'}`}>
                    {shownCover ? (
                        <img
                            key={shownCover}
                            src={shownCover}
                            alt=""
                            aria-hidden
                            decoding="async"
                            draggable={false}
                            onError={() => setBrokenCoverUrl(shownCover)}
                            className="absolute inset-0 h-full w-full object-cover"
                        />
                    ) : (
                        <Music size={16} className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${isDaylight ? 'text-black/35' : 'text-white/35'}`} />
                    )}
                </div>
                <div ref={textBoxRef} className="min-w-0 flex-1 overflow-hidden">
                    <motion.span
                        key={trackKey}
                        ref={textRef}
                        className="block whitespace-nowrap text-[13px] font-semibold leading-5"
                        animate={overflowPx > 4 ? { x: -overflowPx } : { x: 0 }}
                        transition={overflowPx > 4
                            ? { duration: marqueeDuration, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }
                            : { duration: 0.2 }}
                    >
                        {title}
                    </motion.span>
                </div>
                <button
                    type="button"
                    aria-label={playerState === PlayerState.PLAYING ? t('ui.pause') : t('ui.play')}
                    disabled={!canTogglePlay || controlsDisabled}
                    onClick={(event) => {
                        event.stopPropagation();
                        onTogglePlay();
                    }}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${controlsDisabled ? 'cursor-not-allowed opacity-45' : ''}`}
                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                >
                    {playerState === PlayerState.PLAYING
                        ? <Pause size={16} fill="currentColor" />
                        : <Play size={16} fill="currentColor" className="ml-[1px]" />}
                </button>
            </motion.div>
        </motion.div>
    );
};

export default MobilePlayerPill;
