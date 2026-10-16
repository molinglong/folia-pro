import { findLatestActiveLineIndex } from '../../../../utils/appPlaybackHelpers';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import { getRecentCompletedLine, getUpcomingLine } from '../../../visualizer/runtime';
import { buildMonetVisibleLineEntries } from '../../../visualizer/monet/monetLyricsModel';
import type { Line } from '../../../../types';

// src/components/app/lattice/lyrics/latticeLyricTimeline.ts
/**
 * Context rows stack one line at a time outward from the anchor instead of sharing a single slot,
 * and a row that no longer fits between `top` and `bottom` is flagged hidden so its track can
 * fade it out. The visible count therefore follows the measured content: compact one-row verses
 * show the full window, wrapped long lines yield fewer rows - per song, per moment, script-free.
 */
export interface LatticeStackRow { key: string; height: number; scale: number; }
export function stackLatticeContextRows(opts: {
    anchorY: number; anchorHeight: number; top: number; bottom: number;
    activeGap: number; contextGap: number; before: LatticeStackRow[]; after: LatticeStackRow[];
}) {
    const targets = new Map<string, { y: number; hidden: boolean }>();
    let above = opts.anchorY - opts.activeGap;
    for (const row of opts.before) {
        const h = row.height * row.scale;
        above -= h;
        targets.set(row.key, { y: above, hidden: above < opts.top });
        above -= opts.contextGap;
    }
    let below = opts.anchorY + opts.anchorHeight + opts.activeGap;
    for (const row of opts.after) {
        const h = row.height * row.scale;
        targets.set(row.key, { y: below, hidden: below + h > opts.bottom });
        below += h + opts.contextGap;
    }
    return targets;
}

/** Reuses the playback resolver only at boundaries or seeks, not once per animation frame. */
export function createLatticeTimeline(lines: Line[]) {
    const boundaries = [...new Set(lines.flatMap(line => [line.startTime, line.endTime, getLineRenderEndTime(line)]))].sort((a, b) => a - b);
    let previousStamp = -1;
    let entries: ReturnType<typeof buildMonetVisibleLineEntries> = [];
    return (time: number) => {
        let low = 0, high = boundaries.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (boundaries[mid] <= time) low = mid + 1; else high = mid;
        }
        const stamp = low * 2 + (boundaries[low - 1] === time ? 1 : 0);
        if (stamp !== previousStamp) {
            previousStamp = stamp;
            const currentLineIndex = findLatestActiveLineIndex(lines, time);
            entries = buildMonetVisibleLineEntries({ lines, currentLineIndex, currentTime: time,
                activeLine: lines[currentLineIndex] ?? null,
                recentCompletedLine: getRecentCompletedLine({ lines, currentLineIndex, currentTime: time, getLineEndTime: getLineRenderEndTime }),
                upcomingLine: getUpcomingLine(lines, currentLineIndex, time), before: 3, after: 3 });
        }
        return entries;
    };
}

/** Small fixed substeps keep Monet's spring stable even when a frame arrives late. */
export function stepLatticeSpring(value: number, velocity: number, target: number, delta: number,
    spring: { stiffness: number; damping: number; mass: number }) {
    const steps = Math.max(1, Math.ceil(delta * 120));
    const dt = delta / steps;
    for (let i = 0; i < steps; i++) {
        velocity += ((target - value) * spring.stiffness - velocity * spring.damping) / spring.mass * dt;
        value += velocity * dt;
    }
    const settled = Math.abs(value - target) < 0.01 && Math.abs(velocity) < 0.01;
    return { value: settled ? target : value, velocity: settled ? 0 : velocity, settled };
}
