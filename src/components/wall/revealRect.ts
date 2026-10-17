// src/components/wall/revealRect.ts

import { SEAM_EDGE_MARGIN, getSeamSplitOffsets, getSeamSplitOffsetsY } from './seamPlan';
import type { WallMetrics } from './layout';
import { getViewLineX, getViewLineY, type WallView, type WallViewCenter } from './wallView';

// Smallest camera move that brings a world rect fully on screen, while keeping an open split on
// screen when both fit (the prototype's `revealRect`). The split rides with the world, so a move
// that pushed it off an edge would also squeeze it shut; between "rect visible" and "split stays",
// the rect wins. Vertically the rect clears `bottomInset` - the player bar's safe area.
// Portrait wall (seamAxis 'y'): the same rules with the axis rotated - the horizontal split rides on
// a row boundary, content sits below it and the rect only needs the usual pad above.

export type RevealRect = { x: number; y: number; width: number; height: number };

export type RevealInput = {
    rect: RevealRect;
    /** Current view centre (world point under the split's base line). */
    center: WallViewCenter;
    view: WallView;
    metrics: WallMetrics;
    /** World x of the split; null when the layer has none. */
    anchorX: number | null;
    /** Portrait wall: the split's axis and its world y anchor (the vertical split is then null). */
    seamAxis?: 'x' | 'y';
    anchorY?: number | null;
    /** Opening the split is drawn at right now, in screen px (0 when shut). */
    seamWidth: number;
    /** Screen-px margin kept around the rect. */
    pad?: number;
    /** Screen px the rect's bottom edge must stay above (player bar safe area); defaults to pad. */
    bottomInset?: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** View centre after the minimal move; equal to `center` when the rect already shows. */
export const resolveRevealCenter = ({
    rect,
    center,
    view,
    metrics,
    anchorX,
    seamAxis = 'x',
    anchorY = null,
    seamWidth,
    pad = 24,
    bottomInset = pad,
}: RevealInput): WallViewCenter => {
    const scale = view.scale;
    if (seamAxis === 'y') {
        // Portrait: plain horizontal fit, vertical fit keeps the rect below the open band when both fit.
        const xLow = rect.x + rect.width - (view.width - pad) / scale;
        const xHigh = rect.x - pad / scale;
        const x = xLow <= xHigh ? clamp(center.x, xLow, xHigh) : rect.x + rect.width / 2;

        const lineY = getViewLineY(view);
        const hasSeam = anchorY !== null && seamWidth > 1;
        const offsets = hasSeam ? getSeamSplitOffsetsY(seamWidth, scale, metrics) : { top: 0, bottom: 0 };
        const rectCenterY = rect.y + rect.height / 2;
        const offset = anchorY !== null && rectCenterY < anchorY ? offsets.top : offsets.bottom;

        const fitLow = rect.y + rect.height - (view.height - pad - bottomInset) / scale;
        const fitHigh = rect.y - (pad - lineY - offset) / scale;
        let y: number;
        if (hasSeam) {
            const need = seamWidth / 2 + SEAM_EDGE_MARGIN;
            const seamLow = anchorY! - (view.height - need - lineY) / scale;
            const seamHigh = anchorY! + (lineY - need) / scale;
            const low = Math.max(fitLow, seamLow);
            const high = Math.min(fitHigh, seamHigh);
            y = low <= high ? clamp(center.y, low, high) : clamp(center.y, Math.min(fitLow, fitHigh), Math.max(fitLow, fitHigh));
        } else {
            y = fitLow <= fitHigh ? clamp(center.y, fitLow, fitHigh) : rect.y + rect.height / 2;
        }
        return { x, y };
    }

    const lineX = getViewLineX(view);
    const hasSeam = anchorX !== null && seamWidth > 1;
    // The half the rect sits in is pushed away from the split; screen x = line + offset + (x - cx) * s.
    const offsets = hasSeam ? getSeamSplitOffsets(seamWidth, scale, metrics) : { left: 0, right: 0 };
    const rectCenterX = rect.x + rect.width / 2;
    const offset = anchorX !== null && rectCenterX < anchorX ? offsets.left : offsets.right;

    const fitLow = rect.x + rect.width - (view.width - pad - lineX - offset) / scale;
    const fitHigh = rect.x - (pad - lineX - offset) / scale;
    let x: number;
    if (hasSeam) {
        const need = seamWidth / 2 + SEAM_EDGE_MARGIN;
        const seamLow = anchorX! - (view.width - need - lineX) / scale;
        const seamHigh = anchorX! + (lineX - need) / scale;
        const low = Math.max(fitLow, seamLow);
        const high = Math.min(fitHigh, seamHigh);
        x = low <= high ? clamp(center.x, low, high) : clamp(center.x, Math.min(fitLow, fitHigh), Math.max(fitLow, fitHigh));
    } else {
        x = clamp(center.x, Math.min(fitLow, fitHigh), Math.max(fitLow, fitHigh));
    }

    const yLow = rect.y + rect.height - (view.height / 2 - bottomInset) / scale;
    const yHigh = rect.y - (pad - view.height / 2) / scale;
    const y = yLow <= yHigh ? clamp(center.y, yLow, yHigh) : rect.y + rect.height / 2;
    return { x, y };
};
