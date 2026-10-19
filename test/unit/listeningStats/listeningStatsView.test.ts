import { describe, expect, it } from 'vitest';
import {
    buildListeningHeatmap,
    buildListeningHeatmapMonths,
    countListeningWindowDays,
} from '../../../src/components/modal/settings/listeningStatsView';

// test/unit/listeningStats/listeningStatsView.test.ts
// The grid is drawn with `grid-flow-col` over seven rows, so a short first or last week would shift
// every following column by a day. These pin the Monday-to-Sunday padding and the level buckets.

const end = new Date(2026, 9, 19, 12, 0).getTime(); // Monday 19 October 2026, local time

describe('buildListeningHeatmap', () => {
    it('always returns whole Monday-to-Sunday columns', () => {
        const heatmap = buildListeningHeatmap({}, end);

        expect(heatmap.cells.length % 7).toBe(0);
        expect(heatmap.columns).toBe(heatmap.cells.length / 7);
    });

    it('pads the trailing year out to a full week at both ends', () => {
        const heatmap = buildListeningHeatmap({}, end);

        // 364 days back is Monday 20 October 2025; the end is padded forward to Sunday 25 October.
        expect(heatmap.cells[0].key).toBe('2025-10-20');
        expect(heatmap.cells[heatmap.cells.length - 1].key).toBe('2026-10-25');
        expect(heatmap.columns).toBe(53);
    });

    it('reads seconds back per day and leaves unplayed days at zero', () => {
        const heatmap = buildListeningHeatmap({
            '2026-10-19': 120,
            '2026-10-18': 30,
        }, end);

        const played = heatmap.cells.find(cell => cell.key === '2026-10-19');
        const quiet = heatmap.cells.find(cell => cell.key === '2026-10-17');

        expect(played?.seconds).toBe(120);
        expect(quiet?.seconds).toBe(0);
        expect(quiet?.level).toBe(0);
        expect(heatmap.yearSeconds).toBe(150);
        expect(heatmap.maxSeconds).toBe(120);
    });

    it('buckets levels against the busiest day', () => {
        const heatmap = buildListeningHeatmap({
            '2026-10-19': 120,
            '2026-10-18': 30,
            '2026-10-17': 90,
        }, end);

        const levelOn = (key: string) => heatmap.cells.find(cell => cell.key === key)?.level;

        expect(levelOn('2026-10-19')).toBe(4);
        expect(levelOn('2026-10-18')).toBe(1);
        expect(levelOn('2026-10-17')).toBe(3);
    });

    it('ignores days outside the trailing year instead of letting them set the scale', () => {
        const heatmap = buildListeningHeatmap({
            '2026-10-19': 120,
            '2024-01-01': 99_999,
        }, end);

        expect(heatmap.maxSeconds).toBe(120);
        expect(heatmap.yearSeconds).toBe(120);
    });

    it('stays flat when nothing has played', () => {
        const heatmap = buildListeningHeatmap({}, end);

        expect(heatmap.maxSeconds).toBe(0);
        expect(heatmap.yearSeconds).toBe(0);
        expect(heatmap.cells.every(cell => cell.level === 0)).toBe(true);
    });
});

describe('buildListeningHeatmapMonths', () => {
    it('pins each label to the column where its month first appears', () => {
        const heatmap = buildListeningHeatmap({}, end);
        const months = buildListeningHeatmapMonths(heatmap.cells);
        const monthOf = (year: number, monthIndex: number) => months.find(month => {
            const date = new Date(month.timestamp);
            return date.getFullYear() === year && date.getMonth() === monthIndex;
        });

        // The padded first column already belongs to October, so its label sits at column zero.
        expect(monthOf(2025, 9)?.column).toBe(0);
        // November starts one column later; drawing both would overlap, so the newer one yields.
        expect(monthOf(2025, 10)).toBeUndefined();
        // December is far enough from October to be drawn again.
        expect(monthOf(2025, 11)?.column).toBe(6);
    });

    it('returns no labels for an empty grid', () => {
        expect(buildListeningHeatmapMonths([])).toEqual([]);
    });
});

describe('countListeningWindowDays', () => {
    it('counts both endpoints in local days', () => {
        expect(countListeningWindowDays(
            new Date(2026, 9, 13).getTime(),
            new Date(2026, 9, 19, 15).getTime(),
        )).toBe(7);
    });

    it('spans month and year boundaries', () => {
        expect(countListeningWindowDays(
            new Date(2025, 11, 30).getTime(),
            new Date(2026, 0, 2, 9).getTime(),
        )).toBe(4);
    });

    it('counts one day whatever the times of day are', () => {
        expect(countListeningWindowDays(
            new Date(2026, 9, 19, 0, 1).getTime(),
            new Date(2026, 9, 19, 23, 59).getTime(),
        )).toBe(1);
    });

    it('returns zero for an inverted or unusable pair', () => {
        expect(countListeningWindowDays(10, 5)).toBe(0);
        expect(countListeningWindowDays(Number.NaN, 5)).toBe(0);
    });
});
