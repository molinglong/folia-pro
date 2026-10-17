import { create } from 'zustand';
import {
    BRAVAIS_NARROW_VIEWPORT_PX,
    BRAVAIS_SEAM_FULL_HEIGHT,
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_HOME_HEIGHT,
    BRAVAIS_SEAM_HOME_WIDTH,
    BRAVAIS_SEAM_SPINE_WIDTH,
    isBravaisPortraitView,
} from './bravaisConstants';
import type { BravaisLayerSurface } from './bravaisLayer';

// src/library/suites/bravais/bravaisSeamLevel.ts
// 缝的开口等级（设计稿 §5「开口等级」）：全局一个等级，跨层沿用——用户收起后进别的歌单，缝仍是收起的。
// full = 完整信息条（首页是窄缝），spine = 书脊，hidden = 折叠到屏幕侧边只剩悬浮按钮。
// 默认：宽屏 full、窄屏（< 900px）spine；跨过阈值时非 hidden 的等级回到新宽度下的默认值。
// 折叠时记下折叠前的等级，悬浮按钮恢复到它。纯规则 + 一个模块级的小 store（stage 卸载后等级不丢）。
// 竖屏（手机）：横缝没有书脊这一档（64px 高的横带排不下竖排内容），默认与 spine 都落在 full；
// 开口尺寸是高度（resolveSeamOpenWidth 的 portrait 分支）。

export type BravaisSeamLevel = 'full' | 'spine' | 'hidden';

/** 缝里渲染哪一套内容：首页窄缝 / 首页书脊 / 完整信息条 / 书脊 / 没有（折叠）。 */
export type BravaisSeamVariant = 'home' | 'home-spine' | 'full' | 'spine' | 'none';

export type BravaisSeamLevelState = {
    level: BravaisSeamLevel;
    /** 折叠前的等级（悬浮按钮恢复到它）。 */
    restoreLevel: Exclude<BravaisSeamLevel, 'hidden'>;
};

export const isNarrowViewport = (width: number) => width < BRAVAIS_NARROW_VIEWPORT_PX;

/** 排版模式：竖屏横缝 / 桌面窄窗（书脊）/ 宽屏。跨模式时等级回到新模式的默认值。 */
const seamViewportMode = (width: number, height: number): 'portrait' | 'narrow' | 'wide' => (
    isBravaisPortraitView({ width, height }) ? 'portrait' : isNarrowViewport(width) ? 'narrow' : 'wide'
);

export const defaultSeamLevel = (viewportWidth: number, viewportHeight?: number): Exclude<BravaisSeamLevel, 'hidden'> => (
    viewportHeight !== undefined && isBravaisPortraitView({ width: viewportWidth, height: viewportHeight })
        ? 'full'
        : isNarrowViewport(viewportWidth) ? 'spine' : 'full'
);

/** 换等级：折叠时记下当前等级；其它等级直接换。 */
export const applySeamLevel = (state: BravaisSeamLevelState, next: BravaisSeamLevel): BravaisSeamLevelState => {
    if (next === state.level) return state;
    if (next === 'hidden') return { level: 'hidden', restoreLevel: state.level === 'hidden' ? state.restoreLevel : state.level };
    return { level: next, restoreLevel: next };
};

/** 悬浮按钮：恢复折叠前的等级。 */
export const restoreSeamLevel = (state: BravaisSeamLevelState): BravaisSeamLevelState => (
    state.level === 'hidden' ? applySeamLevel(state, state.restoreLevel) : state
);

/** 视口跨过排版模式（竖屏 / 窄屏 / 宽屏）：非 hidden 的等级回到新模式的默认值（hidden 的恢复目标也跟着换）。 */
export const resolveSeamLevelOnResize = (
    state: BravaisSeamLevelState,
    previous: { width: number; height: number },
    next: { width: number; height: number },
): BravaisSeamLevelState => {
    if (seamViewportMode(previous.width, previous.height) === seamViewportMode(next.width, next.height)) return state;
    const fallback = defaultSeamLevel(next.width, next.height);
    return state.level === 'hidden' ? { level: 'hidden', restoreLevel: fallback } : { level: fallback, restoreLevel: fallback };
};

/** 某一层在某个等级下的开口（屏幕 px）：竖缝是宽度，竖屏横缝（portrait）是高度。 */
export const resolveSeamOpenWidth = (surface: BravaisLayerSurface, level: BravaisSeamLevel, portrait = false): number => {
    if (level === 'hidden') return 0;
    if (portrait) {
        // 竖屏没有书脊：spine 档也排完整信息条的高度（横带收得更矮排不下内容）。
        return surface === 'home' ? BRAVAIS_SEAM_HOME_HEIGHT : BRAVAIS_SEAM_FULL_HEIGHT;
    }
    if (level === 'spine') return BRAVAIS_SEAM_SPINE_WIDTH;
    return surface === 'home' ? BRAVAIS_SEAM_HOME_WIDTH : BRAVAIS_SEAM_FULL_WIDTH;
};

export const resolveSeamVariant = (surface: BravaisLayerSurface, level: BravaisSeamLevel): BravaisSeamVariant => {
    if (level === 'hidden') return 'none';
    if (surface === 'home') return level === 'spine' ? 'home-spine' : 'home';
    return level === 'spine' ? 'spine' : 'full';
};

/** 一套内容排版用的开口（翻转时旧内容保持旧尺寸排版，转到 90° 才换）：竖缝是宽度，竖屏横缝是高度（内容横向铺满视口，由 CSS 接管）。 */
export const seamVariantWidth = (variant: BravaisSeamVariant, portrait = false): number => {
    if (portrait) {
        switch (variant) {
            case 'home': return BRAVAIS_SEAM_HOME_HEIGHT;
            case 'home-spine':
            case 'spine':
            case 'full': return BRAVAIS_SEAM_FULL_HEIGHT;
            default: return 0;
        }
    }
    switch (variant) {
        case 'home': return BRAVAIS_SEAM_HOME_WIDTH;
        case 'full': return BRAVAIS_SEAM_FULL_WIDTH;
        case 'home-spine':
        case 'spine': return BRAVAIS_SEAM_SPINE_WIDTH;
        default: return 0;
    }
};

type BravaisSeamStore = BravaisSeamLevelState & {
    /** 上一次量到的视口宽度（判断跨阈值）；0 表示还没量过。 */
    viewportWidth: number;
    setLevel: (level: BravaisSeamLevel) => void;
    restore: () => void;
    syncViewport: (width: number, height?: number) => void;
};

const initialWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
const initialHeight = typeof window === 'undefined' ? 800 : window.innerHeight;

export const useBravaisSeamStore = create<BravaisSeamStore>((set, get) => ({
    level: defaultSeamLevel(initialWidth, initialHeight),
    restoreLevel: defaultSeamLevel(initialWidth, initialHeight),
    viewportWidth: 0,
    setLevel: level => set(state => applySeamLevel(state, level)),
    restore: () => set(state => restoreSeamLevel(state)),
    syncViewport: (width, height = 0) => {
        const previous = get().viewportWidth;
        if (previous === width) return;
        // 第一次量到宽度时只记下，不改等级：初值已经按窗口尺寸定过。
        if (previous === 0) {
            set({ viewportWidth: width });
            return;
        }
        set(state => ({
            ...resolveSeamLevelOnResize(state, { width: previous, height: 0 }, { width, height }),
            viewportWidth: width,
        }));
    },
}));
