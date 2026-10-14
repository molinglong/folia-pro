import { create } from 'zustand';

// src/stores/usePlaybackQuickPanelStore.ts
// 播放胶囊「播放快捷」二级浮层的开关。和 useHomeStylePanelStore 同款：纯 UI 状态（不是偏好），
// 不落 localStorage，刷新后回到关闭。
// 入口是胶囊右槽的动作按钮（playerControlSlotActions 的 'playback-quick'，toggle 语义：再点一下收起）；
// 浮层本身挂在 App（PlaybackQuickPanel），读这份状态决定画不画。
// @fork 本地魔改版（2026-10-14）：bravais 墙工具面板里的音量滑条与洗牌移进这颗浮层，墙面面板只管墙。

export type PlaybackQuickPanelState = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
};

export const usePlaybackQuickPanelStore = create<PlaybackQuickPanelState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set(state => ({ isOpen: !state.isOpen })),
}));

/** 非响应式读改（槽位动作一类的入口用）。 */
export const openPlaybackQuickPanel = () => usePlaybackQuickPanelStore.getState().open();
export const closePlaybackQuickPanel = () => usePlaybackQuickPanelStore.getState().close();
export const togglePlaybackQuickPanel = () => usePlaybackQuickPanelStore.getState().toggle();
