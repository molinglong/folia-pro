import { create } from 'zustand';

// src/stores/useHomeStylePanelStore.ts
// 主页样式内联浮层的开关。它是纯 UI 状态（不是偏好），所以不落 localStorage：刷新后回到关闭。
// 入口是 bravais 墙右下角那颗常驻 companion（原「前往 Lattice」，见 BravaisStageChrome），点了 open 这里；
// 浮层本身挂在 App 的首页层同级（HomeStylePanel），读这份状态决定画不画。

export type HomeStylePanelState = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
};

export const useHomeStylePanelStore = create<HomeStylePanelState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set(state => ({ isOpen: !state.isOpen })),
}));

/** 非响应式打开（companion 的 onSelect、命令面板一类的入口用）。 */
export const openHomeStylePanel = () => useHomeStylePanelStore.getState().open();
export const closeHomeStylePanel = () => useHomeStylePanelStore.getState().close();
