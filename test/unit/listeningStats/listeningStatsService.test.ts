import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListeningPlayRecord } from '../../../src/types/listeningStats';

// test/unit/listeningStats/listeningStatsService.test.ts
// The service is the seam between range and history: the readout must stay scoped to the chosen
// range while the heatmap always looks at the trailing year. These pin that split, plus the
// difference between an empty table and a table that could not be read at all.

const repository = vi.hoisted(() => ({
    readListeningPlaysInRange: vi.fn(),
    readRecentListeningPlays: vi.fn(),
    readAllListeningPlays: vi.fn(),
    readFirstListeningPlay: vi.fn(),
}));

vi.mock('../../../src/services/listeningStats/listeningStatsRepository', () => repository);

const { getListeningStats } = await import('../../../src/services/listeningStats/listeningStatsService');

const at = (year: number, monthIndex: number, day: number, hour = 12): number => (
    new Date(year, monthIndex, day, hour, 0, 0).getTime()
);

const play = (sessionId: string, playedAt: number, listenedSec = 60): ListeningPlayRecord => ({
    sessionId,
    songKey: 'online:netease:1',
    source: 'netease',
    title: 'Night Drive',
    artist: 'Aria',
    album: 'Neon',
    durationSec: 200,
    listenedSec,
    startedAt: playedAt,
    playedAt,
    completed: false,
});

describe('getListeningStats', () => {
    const now = new Date(2026, 9, 19, 15, 30);

    beforeEach(() => {
        repository.readListeningPlaysInRange.mockReset().mockResolvedValue([]);
        repository.readRecentListeningPlays.mockReset().mockResolvedValue([]);
        repository.readAllListeningPlays.mockReset().mockResolvedValue([]);
        repository.readFirstListeningPlay.mockReset().mockResolvedValue(undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the range summary apart from the trailing-year heatmap map', async () => {
        const today = play('today', at(2026, 9, 19, 9), 60);
        const january = play('january', at(2026, 0, 1, 20), 120);
        repository.readListeningPlaysInRange
            .mockResolvedValueOnce([today])
            .mockResolvedValueOnce([today, january]);
        repository.readRecentListeningPlays.mockResolvedValue([today]);
        repository.readFirstListeningPlay.mockResolvedValue(january);

        const result = await getListeningStats('week', now);

        expect(result.summary.totalSeconds).toBe(60);
        expect(result.summary.dailySeconds).toEqual({ '2026-10-19': 60 });
        expect(result.heatmapDailySeconds).toEqual({
            '2026-01-01': 120,
            '2026-10-19': 60,
        });
        expect(result.streak).toEqual({ current: 1, longest: 1 });
        expect(result.firstPlayedAt).toBe(january.playedAt);
        expect(result.recent).toEqual([today]);
        expect(result.unavailable).toBeUndefined();
    });

    it('slices the all-time read for the heatmap instead of querying twice', async () => {
        const inWindow = play('recent', at(2026, 9, 19, 9), 60);
        const outsideWindow = play('old', at(2025, 0, 1, 9), 300);
        repository.readListeningPlaysInRange.mockResolvedValue([outsideWindow, inWindow]);

        const result = await getListeningStats('all', now);

        expect(repository.readListeningPlaysInRange).toHaveBeenCalledTimes(1);
        expect(result.summary.totalSeconds).toBe(360);
        expect(result.heatmapDailySeconds).toEqual({ '2026-10-19': 60 });
    });

    it('marks the readout unavailable when the local table cannot be read', async () => {
        repository.readRecentListeningPlays.mockRejectedValue(new Error('blocked'));

        const result = await getListeningStats('month', now);

        expect(result.unavailable).toBe(true);
        expect(result.summary.totalSeconds).toBe(0);
        expect(result.heatmapDailySeconds).toEqual({});
        expect(result.streak).toEqual({ current: 0, longest: 0 });
        expect(result.firstPlayedAt).toBeNull();
        expect(result.recent).toEqual([]);
    });
});
