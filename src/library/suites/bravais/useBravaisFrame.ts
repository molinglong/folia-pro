import { useCallback, useRef, type RefObject } from 'react';
import type { WallView, WallViewCenter } from '../../../components/wall/wallView';
import { computeBravaisFrame, type BravaisFrameAxis } from './bravaisFrame';
import { isBravaisPortraitView } from './bravaisConstants';

// src/library/suites/bravais/useBravaisFrame.ts
// stage 每帧要写的那几样（相机、缝的锚点与动画中的开口、缝内容的排版尺寸、是否折叠）放在一个可变的 ref 里，
// 相机与缝的动画只改它再调 renderFrame：直接写两个世界层的 transform、缝的位置与开口、缝内容的透明度、
// 边缘标签的显隐与侧别，不经过 React（frontend-runtime-guardrails：拖动、补间期间没有逐帧 setState）。
// 竖屏（view 高大于宽且窄）时缝轴是 y：锚点走 anchorY，缝写 top / height，标签在上下边缘。

export const getBravaisFrameAxis = (view: WallView | null): BravaisFrameAxis => (
    view && isBravaisPortraitView(view) ? 'y' : 'x'
);

/** 缝锚点（沿缝轴的那一个世界坐标）：竖屏是 anchorY，其余是 anchorX。 */
export const getFrameAnchor = (state: BravaisFrameState): number | null => (
    getBravaisFrameAxis(state.view) === 'y' ? state.anchorY : state.anchorX
);

/** 写缝锚点：另一根轴上的旧值清掉（转屏 / 窗口跨阈值后不留脏锚点）。 */
export const setFrameAnchor = (state: BravaisFrameState, anchor: number | null) => {
    if (getBravaisFrameAxis(state.view) === 'y') {
        state.anchorY = anchor;
        state.anchorX = null;
    } else {
        state.anchorX = anchor;
        state.anchorY = null;
    }
};

/** 缝在墙上的落点（世界坐标）：竖屏锚在 y、相机取中，竖缝反之（「离缝最近的一份」都按它找）。 */
export const frameSeamPoint = (state: BravaisFrameState): WallViewCenter => (
    getBravaisFrameAxis(state.view) === 'y'
        ? { x: state.center.x, y: state.anchorY ?? state.center.y }
        : { x: state.anchorX ?? state.center.x, y: state.center.y }
);

export type BravaisFrameState = {
    view: WallView | null;
    center: WallViewCenter;
    anchorX: number | null;
    anchorY: number | null;
    openWidth: number;
    /** 开口正在补间去的尺寸（不补间时等于 openWidth）：开口张开途中给聚焦卡的相机让位按张开后的缝算。 */
    targetOpenWidth: number;
    contentWidth: number;
    hidden: boolean;
};

export type BravaisFrameRefs = {
    left: RefObject<HTMLDivElement | null>;
    right: RefObject<HTMLDivElement | null>;
    seam: RefObject<HTMLDivElement | null>;
    seamContent: RefObject<HTMLDivElement | null>;
    tab: RefObject<HTMLButtonElement | null>;
};

export const useBravaisFrame = (refs: BravaisFrameRefs) => {
    const stateRef = useRef<BravaisFrameState>({
        view: null,
        center: { x: 0, y: 0 },
        anchorX: null,
        anchorY: null,
        openWidth: 0,
        targetOpenWidth: 0,
        contentWidth: 0,
        hidden: false,
    });

    const renderFrame = useCallback(() => {
        const state = stateRef.current;
        if (!state.view) return;
        const axis = getBravaisFrameAxis(state.view);
        const frame = computeBravaisFrame({
            center: state.center,
            view: state.view,
            axis,
            anchorX: state.anchorX,
            anchorY: state.anchorY,
            openWidth: state.openWidth,
            contentWidth: state.contentWidth,
            hidden: state.hidden,
        });
        const { left, right, seam, seamContent, tab } = refs;
        if (left.current) left.current.style.transform = `translate3d(${frame.left.x}px, ${frame.left.y}px, 0) scale(${frame.scale})`;
        if (right.current) right.current.style.transform = `translate3d(${frame.right.x}px, ${frame.right.y}px, 0) scale(${frame.scale})`;
        const seamElement = seam.current;
        if (seamElement) {
            if (axis === 'y') {
                seamElement.style.transform = `translate3d(0, ${frame.seam.y - frame.seam.height / 2}px, 0)`;
                seamElement.style.height = `${frame.seam.height}px`;
                if (seamElement.style.width !== '') seamElement.style.width = '';
            } else {
                seamElement.style.transform = `translate3d(${frame.seam.x - frame.seam.width / 2}px, 0, 0)`;
                seamElement.style.width = `${frame.seam.width}px`;
                if (seamElement.style.height !== '') seamElement.style.height = '';
            }
            const visibility = frame.seam.visible ? 'visible' : 'hidden';
            if (seamElement.style.visibility !== visibility) seamElement.style.visibility = visibility;
        }
        if (seamContent.current) seamContent.current.style.opacity = String(frame.contentOpacity);
        const tabElement = tab.current;
        if (tabElement) {
            const display = frame.tab.visible ? '' : 'none';
            if (tabElement.style.display !== display) tabElement.style.display = display;
            if (tabElement.dataset.side !== frame.tab.side) tabElement.dataset.side = frame.tab.side;
        }
    }, [refs]);

    return { stateRef, renderFrame };
};
