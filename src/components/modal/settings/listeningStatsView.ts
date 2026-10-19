import { toListeningDateKey } from '../../../services/listeningStats/listeningStatsAggregation';

// src/components/modal/settings/listeningStatsView.ts
// Turns the daily-seconds map into the trailing-year grid the settings page draws. Weeks run Monday
// to Sunday so every column is a full week; the two edge weeks are padded, not truncated.

export type ListeningHeatmapCell = {
    key: string;
    timestamp: number;
    seconds: number;
    level: 0 | 1 | 2 | 3 | 4;
};

export type ListeningHeatmap = {
    cells: ListeningHeatmapCell[];
    columns: number;
    maxSeconds: number;
    yearSeconds: number;
};

const levelFor = (seconds: number, maxSeconds: number): ListeningHeatmapCell['level'] => {
    if (seconds <= 0) return 0;
    if (maxSeconds <= 0) return 1;
    return Math.min(4, Math.max(1, Math.ceil((seconds / maxSeconds) * 4))) as ListeningHeatmapCell['level'];
};

export const buildListeningHeatmap = (
    dailySeconds: Record<string, number>,
    endTimestamp: number,
): ListeningHeatmap => {
    const end = new Date(endTimestamp);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const startDay = new Date(endDay);
    startDay.setDate(startDay.getDate() - 364);

    // Pad both ends out to full Monday-to-Sunday columns.
    const startOffset = (startDay.getDay() + 6) % 7;
    startDay.setDate(startDay.getDate() - startOffset);
    const endOffset = (endDay.getDay() + 6) % 7;
    endDay.setDate(endDay.getDate() + (6 - endOffset));

    const cells: ListeningHeatmapCell[] = [];
    let maxSeconds = 0;
    let yearSeconds = 0;
    const cursor = new Date(startDay);

    while (cursor.getTime() <= endDay.getTime()) {
        const timestamp = cursor.getTime();
        const key = toListeningDateKey(timestamp);
        const seconds = Math.max(0, dailySeconds[key] || 0);
        maxSeconds = Math.max(maxSeconds, seconds);
        yearSeconds += seconds;
        cells.push({ key, timestamp, seconds, level: 0 });
        cursor.setDate(cursor.getDate() + 1);
    }

    for (const cell of cells) {
        cell.level = levelFor(cell.seconds, maxSeconds);
    }

    return {
        cells,
        columns: Math.ceil(cells.length / 7),
        maxSeconds,
        yearSeconds,
    };
};

/**
 * One label per month, pinned to the column where that month first appears. Labels closer than
 * three columns would overlap, so the newer one wins when a month starts in a padded first week.
 */
export const buildListeningHeatmapMonths = (
    cells: readonly ListeningHeatmapCell[],
): { column: number; timestamp: number }[] => {
    const starts: { column: number; timestamp: number }[] = [];
    let seenMonth = '';
    cells.forEach((cell, index) => {
        const date = new Date(cell.timestamp);
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (monthKey === seenMonth) return;
        seenMonth = monthKey;
        starts.push({ column: Math.floor(index / 7), timestamp: cell.timestamp });
    });

    const labels: { column: number; timestamp: number }[] = [];
    starts.forEach((start, index) => {
        const previous = labels[labels.length - 1];
        if (previous && start.column - previous.column < 3) {
            if (index === starts.length - 1) labels[labels.length - 1] = start;
            return;
        }
        labels.push(start);
    });
    return labels;
};

/** Inclusive local day count between two timestamps, used for per-day averages. */
export const countListeningWindowDays = (from: number, to: number): number => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
    const start = new Date(from);
    const end = new Date(to);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let days = 0;
    while (cursor.getTime() <= last.getTime()) {
        days += 1;
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
};
