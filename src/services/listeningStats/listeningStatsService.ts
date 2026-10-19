import type {
    ListeningStatsRange,
    ListeningStatsResult,
    ListeningStatsSummary,
} from '../../types/listeningStats';
import {
    aggregateListeningPlays,
    buildDailyListeningSeconds,
    computeListeningStreaks,
    resolveListeningHeatmapWindow,
    resolveListeningStatsWindow,
} from './listeningStatsAggregation';
import {
    readAllListeningPlays,
    readFirstListeningPlay,
    readListeningPlaysInRange,
    readRecentListeningPlays,
} from './listeningStatsRepository';

// src/services/listeningStats/listeningStatsService.ts
// Reads one range for the readout and the trailing year for the heatmap. Everything here is local;
// a blocked or missing IndexedDB degrades to an empty readout rather than breaking the settings page.

const emptySummary = (): ListeningStatsSummary => ({
    totalSeconds: 0,
    totalPlays: 0,
    completedPlays: 0,
    uniqueSongs: 0,
    uniqueArtists: 0,
    activeDays: 0,
    topSongs: [],
    topArtists: [],
    topAlbums: [],
    byHour: Array.from({ length: 24 }, () => 0),
    byWeekday: Array.from({ length: 7 }, () => 0),
    bySource: [],
    dailySeconds: {},
});

export const getListeningStats = async (
    range: ListeningStatsRange,
    now: Date = new Date(),
): Promise<ListeningStatsResult> => {
    const window = resolveListeningStatsWindow(range, now);
    const heatmapWindow = resolveListeningHeatmapWindow(now);

    try {
        const [rangePlays, heatmapPlays, recent, firstPlay] = await Promise.all([
            readListeningPlaysInRange(window.from, window.to),
            range === 'all'
                ? Promise.resolve(null)
                : readListeningPlaysInRange(heatmapWindow.from, heatmapWindow.to),
            readRecentListeningPlays(12),
            readFirstListeningPlay(),
        ]);
        const summary = aggregateListeningPlays(rangePlays);
        // 'all' already read every row, so its heatmap map is a slice of that read, not a second query.
        const heatmapDailySeconds = buildDailyListeningSeconds(
            heatmapPlays ?? rangePlays.filter(play => play.playedAt >= heatmapWindow.from),
        );

        return {
            range,
            window,
            heatmapWindow,
            summary,
            heatmapDailySeconds,
            streak: computeListeningStreaks(heatmapDailySeconds, now),
            firstPlayedAt: firstPlay?.playedAt ?? null,
            recent,
        };
    } catch (error) {
        console.warn('[ListeningStats] Failed to read local statistics', error);
        return {
            range,
            window,
            heatmapWindow,
            summary: emptySummary(),
            heatmapDailySeconds: {},
            streak: { current: 0, longest: 0 },
            firstPlayedAt: null,
            unavailable: true,
            recent: [],
        };
    }
};

export const exportListeningStatsJson = async (): Promise<string> => {
    // ownerId 是同步用的本机字段，导出的用户数据里不带着它。
    const plays = (await readAllListeningPlays()).map(({ ownerId: _ownerId, ...play }) => play);
    return JSON.stringify({
        app: 'folia',
        kind: 'listening-stats',
        version: 1,
        exportedAt: new Date().toISOString(),
        plays,
    }, null, 2);
};
