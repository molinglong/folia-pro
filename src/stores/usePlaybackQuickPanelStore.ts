import { create } from 'zustand';

// src/stores/usePlaybackQuickPanelStore.ts
// 播放胶囊「播放快捷」二级浮层的开关。和 useHomeStylePanelStore 同款：纯 UI 状态（不是偏好），
// 不落 localStorage，刷新后回到关闭。
// 入口是胶囊右槽的动作按钮（playerControlSlotActions 的 'playback-quick'，toggle 语义：再点一下收起）；
// 浮层本身挂在 App（PlaybackQuickPanel），读这份状态决定画不画。
// @fork 本地魔改版（2026-10-14）：bravais 墙工具面板里的音量滑条与洗牌移进这颗浮层，墙面面板只管墙。
// @fork 本地魔改版（2026-10-17）：open/toggle 可带触发按钮的视口矩形（anchor）。浮层不再钉死在
// 「底部胶囊正上方」这一固定位置 —— 谁按的就贴着谁弹出来；没带 anchor 的旧入口仍按底栏基线兜底。

/** 触发按钮的视口矩形（getBoundingClientRect 的四个分量），由点击方算好传进来，store 不碰 DOM。 */
export type PlaybackQuickAnchor = { left: number; right: number; top: number; bottom: number };

export type PlaybackQuickPanelState = {
    isOpen: boolean;
    /** 最近一次打开时传入的按钮几何；null = 旧入口，浮层按底栏基线兜底。 */
    anchor: PlaybackQuickAnchor | null;
    open: (anchor?: PlaybackQuickAnchor | null) => void;
    close: () => void;
    toggle: (anchor?: PlaybackQuickAnchor | null) => void;
};

export const usePlaybackQuickPanelStore = create<PlaybackQuickPanelState>(set => ({
    isOpen: false,
    anchor: null,
    open: anchor => set({ isOpen: true, anchor: anchor ?? null }),
    close: () => set({ isOpen: false }),
    toggle: anchor => set(state => ({ isOpen: !state.isOpen, anchor: state.isOpen ? state.anchor : (anchor ?? null) })),
}));

/** 非响应式读改（槽位动作一类的入口用）。 */
export const openPlaybackQuickPanel = (anchor?: PlaybackQuickAnchor | null) => usePlaybackQuickPanelStore.getState().open(anchor);
export const closePlaybackQuickPanel = () => usePlaybackQuickPanelStore.getState().close();
export const togglePlaybackQuickPanel = (anchor?: PlaybackQuickAnchor | null) => usePlaybackQuickPanelStore.getState().toggle(anchor);
