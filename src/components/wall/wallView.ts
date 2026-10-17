// src/components/wall/wallView.ts

import type { Bounds } from './layout';

// Viewport <-> world conversions for the fixed-world wall. The pure geometry here talks about the
// world point under the seam line (the "view centre"); the DOM camera is a translation plus scale.

export type WallView = {
    /** Viewport size in screen px. */
    width: number;
    height: number;
    scale: number;
    /** Screen x of the seam's base line; the viewport's horizontal middle when omitted. */
    lineX?: number;
    /**
     * Screen y of a horizontal seam's base line (portrait wall: the opening rides on a row
     * boundary). Omitted for the vertical seam; the y centre then stays the viewport middle.
     */
    lineY?: number;
};

export type WallViewCenter = { x: number; y: number };

/** Same shape as the wall's DOM camera: `screen = camera + world * scale`. */
export type WallViewCamera = { x: number; y: number; scale: number };

export const getViewLineX = (view: WallView) => view.lineX ?? view.width / 2;

export const getViewLineY = (view: WallView) => view.lineY ?? view.height / 2;

export const viewCenterFromCamera = (camera: WallViewCamera, view: WallView): WallViewCenter => ({
    x: (getViewLineX(view) - camera.x) / camera.scale,
    y: (getViewLineY(view) - camera.y) / camera.scale,
});

export const cameraFromViewCenter = (center: WallViewCenter, view: WallView): WallViewCamera => ({
    x: getViewLineX(view) - center.x * view.scale,
    y: getViewLineY(view) - center.y * view.scale,
    scale: view.scale,
});

/**
 * World rect on screen around a view centre. An open seam pushes the two halves apart, so the
 * horizontal span is widened by the seam width on both sides (as the prototype's culling does).
 */
export const getViewWorldBounds = (
    center: WallViewCenter,
    view: WallView,
    { seamWidth = 0, seamHeight = 0, overscan = 0 }: { seamWidth?: number; seamHeight?: number; overscan?: number } = {},
): Bounds => {
    const lineX = getViewLineX(view);
    const lineY = getViewLineY(view);
    return {
        left: center.x - (lineX + seamWidth) / view.scale - overscan,
        right: center.x + (view.width - lineX + seamWidth) / view.scale + overscan,
        top: center.y - (lineY + seamHeight) / view.scale - overscan,
        bottom: center.y + (view.height - lineY + seamHeight) / view.scale + overscan,
    };
};
