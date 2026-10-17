// src/components/wall/seamPlan.ts

import type { WallMetrics } from './layout';
import { getViewLineX, getViewLineY, type WallView } from './wallView';
import { getBlockSize } from './wallSlots';

// Where a vertical split may open and how it reacts to the camera. The split only ever opens on a
// block boundary: no slot crosses the gap between two 12x8 blocks, so nothing is squeezed or cut.
// When the chosen boundary cannot hold the whole opening on screen, the camera yields the minimum
// distance instead. The split belongs to the world (it rides with the camera) and narrows as it
// nears a viewport edge, closing completely once it leaves. Opening widths are the caller's.

/** Screen-px margin kept between an open split and the viewport edge. */
export const SEAM_EDGE_MARGIN = 14;
/** Weight of "distance from the base line" against "camera shift" when choosing a boundary. */
export const SEAM_LINE_DISTANCE_WEIGHT = 0.15;

/** World x of the gap midline on the left edge of block `column`. */
export const getSeamBoundaryX = (column: number, metrics: WallMetrics) => (
    column * getBlockSize(metrics).width - metrics.gap / 2
);

export const nearestSeamBoundaryX = (x: number, metrics: WallMetrics) => (
    getSeamBoundaryX(Math.round((x + metrics.gap / 2) / getBlockSize(metrics).width), metrics)
);

export const isSeamBoundaryX = (x: number, metrics: WallMetrics) => (
    Math.abs(nearestSeamBoundaryX(x, metrics) - x) < 1e-6
);

export type SeamPlan = {
    /** World x of the split (a block boundary unless `preferX` said otherwise). */
    x: number;
    /** View centre x after yielding; equals the input when the split already fits. */
    cameraX: number;
    /** Camera shift in screen px. */
    shift: number;
};

export type BlockSeamPlanInput = {
    /** Current view centre x (world point under the base line). */
    cameraX: number;
    /** Width the split is about to open to, in screen px. */
    openWidth: number;
    view: WallView;
    metrics: WallMetrics;
    /** Keep this boundary (the split is visible and stays put); only the camera may yield. */
    preferX?: number;
    edge?: number;
};

/**
 * Picks the boundary for a split: the nearest few around the camera (or `preferX`), each moved
 * on screen by the smallest camera shift that fits the whole opening, scored by
 * shift + weight x distance from the base line.
 */
export const blockSeamPlan = ({
    cameraX,
    openWidth,
    view,
    metrics,
    preferX,
    edge = SEAM_EDGE_MARGIN,
}: BlockSeamPlanInput): SeamPlan => {
    const lineX = getViewLineX(view);
    const need = openWidth / 2 + edge;
    const blockWidth = getBlockSize(metrics).width;
    const base = Math.round((cameraX + metrics.gap / 2) / blockWidth);
    const candidates = preferX !== undefined
        ? [preferX]
        : [base - 1, base, base + 1].map(column => getSeamBoundaryX(column, metrics));

    let best: SeamPlan | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const x of candidates) {
        const screenX = lineX + (x - cameraX) * view.scale;
        const fitX = Math.max(need, Math.min(view.width - need, screenX));
        const nextCameraX = x - (fitX - lineX) / view.scale;
        const shift = Math.abs(nextCameraX - cameraX) * view.scale;
        const score = shift + Math.abs(fitX - lineX) * SEAM_LINE_DISTANCE_WEIGHT;
        if (!best || score < bestScore) {
            best = { x, cameraX: nextCameraX, shift };
            bestScore = score;
        }
    }
    return best!;
};

export type SeamGeometry = {
    /** Screen x of the split's centre. */
    screenX: number;
    /** Rendered opening: squeezed to twice the room left before the edge margin, 0 off screen. */
    width: number;
    /** Meant to be open but squeezed shut - show the edge tab on `side`. */
    collapsed: boolean;
    side: 'left' | 'right';
};

/** Follow coupling: the split sits on its world anchor and narrows near the viewport edges. */
export const getSeamGeometry = ({
    anchorX,
    cameraX,
    openWidth,
    view,
    edge = SEAM_EDGE_MARGIN,
}: { anchorX: number; cameraX: number; openWidth: number; view: WallView; edge?: number }): SeamGeometry => {
    const lineX = getViewLineX(view);
    const screenX = lineX + (anchorX - cameraX) * view.scale;
    const room = Math.min(screenX, view.width - screenX) - edge;
    const width = Math.max(0, Math.min(openWidth, room * 2));
    return { screenX, width, collapsed: openWidth > 1 && width < 2, side: screenX < lineX ? 'left' : 'right' };
};

/**
 * Camera x range that keeps the whole opening on screen. Camera clamps are widened to include it,
 * otherwise the yield from `blockSeamPlan` would be rubber-banded straight back.
 */
export const getSeamCameraSpan = ({
    anchorX,
    openWidth,
    view,
    edge = SEAM_EDGE_MARGIN,
}: { anchorX: number; openWidth: number; view: WallView; edge?: number }) => {
    const lineX = getViewLineX(view);
    const need = openWidth / 2 + edge;
    const min = anchorX - (view.width - need - lineX) / view.scale;
    const max = anchorX + (lineX - need) / view.scale;
    if (min <= max) return { min, max };
    // Wider than the viewport: the only sensible spot is centred.
    const centred = anchorX - (view.width / 2 - lineX) / view.scale;
    return { min: centred, max: centred };
};

/**
 * Split mode moves each half away by half the opening plus half a gap (scaled), so the paper strip
 * sits one gap from the posters on both sides. Returns screen-px offsets for the two halves.
 */
export const getSeamSplitOffsets = (width: number, scale: number, metrics: WallMetrics) => {
    const pad = (metrics.gap / 2) * scale * Math.min(1, width / 16);
    return { left: -width / 2 - pad, right: width / 2 + pad };
};

// ---- horizontal seam (portrait wall) ----------------------------------------------------------
// The same rules with the axis rotated: the opening rides on a block row boundary, narrows near
// the top / bottom viewport edges and closes once it leaves; the two halves yield vertically.

/** World y of the gap midline on the top edge of block `row`. */
export const getSeamBoundaryY = (row: number, metrics: WallMetrics) => (
    row * getBlockSize(metrics).height - metrics.gap / 2
);

export const nearestSeamBoundaryY = (y: number, metrics: WallMetrics) => (
    getSeamBoundaryY(Math.round((y + metrics.gap / 2) / getBlockSize(metrics).height), metrics)
);

export type SeamPlanY = {
    /** World y of the split (a block boundary unless `preferY` said otherwise). */
    y: number;
    /** View centre y after yielding; equals the input when the split already fits. */
    cameraY: number;
    /** Camera shift in screen px. */
    shift: number;
};

export const blockSeamPlanY = ({
    cameraY,
    openWidth,
    view,
    metrics,
    preferY,
    edge = SEAM_EDGE_MARGIN,
}: {
    cameraY: number;
    openWidth: number;
    view: WallView;
    metrics: WallMetrics;
    preferY?: number;
    edge?: number;
}): SeamPlanY => {
    const lineY = getViewLineY(view);
    const need = openWidth / 2 + edge;
    const blockHeight = getBlockSize(metrics).height;
    const base = Math.round((cameraY + metrics.gap / 2) / blockHeight);
    const candidates = preferY !== undefined
        ? [preferY]
        : [base - 1, base, base + 1].map(row => getSeamBoundaryY(row, metrics));

    let best: SeamPlanY | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const y of candidates) {
        const screenY = lineY + (y - cameraY) * view.scale;
        const fitY = Math.max(need, Math.min(view.height - need, screenY));
        const nextCameraY = y - (fitY - lineY) / view.scale;
        const shift = Math.abs(nextCameraY - cameraY) * view.scale;
        const score = shift + Math.abs(fitY - lineY) * SEAM_LINE_DISTANCE_WEIGHT;
        if (!best || score < bestScore) {
            best = { y, cameraY: nextCameraY, shift };
            bestScore = score;
        }
    }
    return best!;
};

export type SeamGeometryY = {
    /** Screen y of the split's centre. */
    screenY: number;
    /** Rendered opening: squeezed to twice the room left before the edge margin, 0 off screen. */
    height: number;
    /** Meant to be open but squeezed shut - show the edge tab on `side`. */
    collapsed: boolean;
    side: 'top' | 'bottom';
};

export const getSeamGeometryY = ({
    anchorY,
    cameraY,
    openWidth,
    view,
    edge = SEAM_EDGE_MARGIN,
}: { anchorY: number; cameraY: number; openWidth: number; view: WallView; edge?: number }): SeamGeometryY => {
    const lineY = getViewLineY(view);
    const screenY = lineY + (anchorY - cameraY) * view.scale;
    const room = Math.min(screenY, view.height - screenY) - edge;
    const height = Math.max(0, Math.min(openWidth, room * 2));
    return { screenY, height, collapsed: openWidth > 1 && height < 2, side: screenY < lineY ? 'top' : 'bottom' };
};

export const getSeamCameraSpanY = ({
    anchorY,
    openWidth,
    view,
    edge = SEAM_EDGE_MARGIN,
}: { anchorY: number; openWidth: number; view: WallView; edge?: number }) => {
    const lineY = getViewLineY(view);
    const need = openWidth / 2 + edge;
    const min = anchorY - (view.height - need - lineY) / view.scale;
    const max = anchorY + (lineY - need) / view.scale;
    if (min <= max) return { min, max };
    const centred = anchorY - (view.height / 2 - lineY) / view.scale;
    return { min: centred, max: centred };
};

export const getSeamSplitOffsetsY = (width: number, scale: number, metrics: WallMetrics) => {
    const pad = (metrics.gap / 2) * scale * Math.min(1, width / 16);
    return { top: -width / 2 - pad, bottom: width / 2 + pad };
};
