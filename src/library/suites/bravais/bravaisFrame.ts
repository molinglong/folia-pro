import {
    getSeamGeometry,
    getSeamGeometryY,
    getSeamSplitOffsets,
    getSeamSplitOffsetsY,
} from '../../../components/wall/seamPlan';
import { cameraFromViewCenter, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisFrame.ts
// 每一帧要写到 DOM 上的几何（纯计算）：墙的两半各自的 transform、缝的屏幕位置与开口、缝内容的透明度、
// 边缘标签在不在、在哪一侧。缝开在块边界上，没有磁贴跨过它，所以墙按锚点分成两个世界层，各自平移让出
// 半个开口（加半个 GAP），不需要裁剪。stage 在相机移动、缝开合时调用它，只写 transform / 尺寸，不经过 React。
// 竖屏（axis 'y'）：缝横过来开在行边界上，两半是上下；left / right 两个字段在竖屏里分别是上半 / 下半，
// seam 的 x / width 换成 y / height。开口大小（openWidth / contentWidth）沿缝的轴量。

export type BravaisFrameAxis = 'x' | 'y';

export type BravaisFrameInput = {
    center: WallViewCenter;
    view: WallView;
    axis: BravaisFrameAxis;
    /** 缝锚点的世界 x（竖缝）；没有层时为 null（墙合拢，没有缝）。 */
    anchorX: number | null;
    /** 缝锚点的世界 y（横缝）；竖缝时为 null。 */
    anchorY: number | null;
    /** 此刻（动画中）的目标开口，屏幕 px，沿缝的轴。 */
    openWidth: number;
    /** 缝里此刻渲染的那套内容的排版尺寸（翻转不重排：不跟目标开口走）。 */
    contentWidth: number;
    /** 折叠等级（hidden）：标签换成悬浮按钮，常驻。 */
    hidden: boolean;
};

export type BravaisFrame = {
    /** 竖缝：左半 / 右半；横缝：上半 / 下半。 */
    left: { x: number; y: number };
    right: { x: number; y: number };
    scale: number;
    seam: { x: number; y: number; width: number; height: number; visible: boolean };
    /** 缝内容的透明度：开口比排版尺寸窄时随之淡出。 */
    contentOpacity: number;
    /** 边缘标签：自动出屏收起（collapsed）或手动折叠（hidden）时出现。 */
    tab: { visible: boolean; side: 'left' | 'right' | 'top' | 'bottom' };
};

export const computeBravaisFrame = ({ center, view, axis, anchorX, anchorY, openWidth, contentWidth, hidden }: BravaisFrameInput): BravaisFrame => {
    const camera = cameraFromViewCenter(center, view);
    const anchor = axis === 'y' ? anchorY : anchorX;
    if (anchor === null) {
        return {
            left: { x: camera.x, y: camera.y },
            right: { x: camera.x, y: camera.y },
            scale: view.scale,
            seam: { x: view.width / 2, y: view.height / 2, width: 0, height: 0, visible: false },
            contentOpacity: 0,
            tab: { visible: false, side: 'left' },
        };
    }
    const layoutSize = Math.max(contentWidth, 1);
    if (axis === 'y') {
        const geometry = getSeamGeometryY({ anchorY: anchor, cameraY: center.y, openWidth, view });
        const offsets = getSeamSplitOffsetsY(geometry.height, view.scale, BRAVAIS_METRICS);
        return {
            left: { x: camera.x, y: camera.y + offsets.top },
            right: { x: camera.x, y: camera.y + offsets.bottom },
            scale: view.scale,
            seam: { x: 0, y: geometry.screenY, width: 0, height: geometry.height, visible: geometry.height >= 1 },
            // 原型：(开口 / 排版尺寸 − .35) / .65，开到三成五以下就看不见。
            contentOpacity: Math.max(0, Math.min(1, (geometry.height / layoutSize - 0.35) / 0.65)),
            tab: { visible: hidden || geometry.collapsed, side: geometry.side },
        };
    }
    const geometry = getSeamGeometry({ anchorX: anchor, cameraX: center.x, openWidth, view });
    const offsets = getSeamSplitOffsets(geometry.width, view.scale, BRAVAIS_METRICS);
    return {
        left: { x: camera.x + offsets.left, y: camera.y },
        right: { x: camera.x + offsets.right, y: camera.y },
        scale: view.scale,
        seam: { x: geometry.screenX, y: 0, width: geometry.width, height: 0, visible: geometry.width >= 1 },
        contentOpacity: Math.max(0, Math.min(1, (geometry.width / layoutSize - 0.35) / 0.65)),
        tab: { visible: hidden || geometry.collapsed, side: geometry.side },
    };
};
