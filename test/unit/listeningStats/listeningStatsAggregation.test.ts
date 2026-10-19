import { describe, expect, it } from 'vitest';
import {
    aggregateListeningPlays,
    buildDailyListeningSeconds,
    computeListeningStreaks,
    resolveListeningHeatmapWindow,
    resolveListeningStatsWindow,
    toListeningDateKey,
} from '../../../src/services/listeningStats/listeningStatsAggregation';
import type { ListeningPlayRecord } from '../../../src/types/listeningStats';

// test/unit/listeningStats/listeningStatsAggregation.test.ts
// The readout is only as honest as this pass: every number the settings page prints comes out of
// these pure functions, so the totals, the Monday-first strips and the top-list order are pinned here.

/** Local-time constructor: date keys, hours and weekdays are all read in the listener's zone. */
const at = (year: number, monthIndex: number, day: number, hour = 12, minute = 0): number => (
    new Date(year, monthIndex, day, hour, minute, 0).getTime()
);

const play = (overrides: Partial<ListeningPlayRecord> = {}): ListeningPlayRecord => ({
    sessionId: 'session-1',
    songKey: 'online:netease:1',
    source: 'netease',
    title: 'Track one',
    artist: 'Artist A',
    album: 'Album X',
    durationSec: 200,
    listenedSec: 60,
    startedAt: at(2026, 9, 19, 9),
    playedAt: at(2026, 9, 19, 9, 30),
    completed: false,
    ...overrides,
});

describe('listeningStatsAggregation', () => {
    it('writes local YYYY-MM-DD keys with zero padding', () => {
        expect(toListeningDateKey(at(2026, 0, 5))).toBe('2026-01-05');
        expect(toListeningDateKey(at(2026, 11, 31))).toBe('2026-12-31');
    });

    it('resolves the week, month and year windows from local midnights', () => {
        const now = new Date(2026, 9, 19, 15, 30);

        const week = resolveListeningStatsWindow('week', now);
        expect(new Date(week.from)).toEqual(new Date(2026, 9, 13));
        expect(week.to).toBe(now.getTime());

        const month = resolveListeningStatsWindow('month', now);
        expect(new Date(month.from)).toEqual(new Date(2026, 8, 20));

        const year = resolveListeningStatsWindow('year', now);
        expect(new Date(year.from)).toEqual(new Date(2026, 0, 1));

        expect(resolveListeningStatsWindow('all', now)).toEqual({ from: 0, to: now.getTime() });
    });

    it('always looks back 365 days for the heatmap, whatever the readout range', () => {
        const now = new Date(2026, 9, 19, 15, 30);
        const window = resolveListeningHeatmapWindow(now);

        expect(new Date(window.from)).toEqual(new Date(2025, 9, 20));
        expect(window.to).toBe(now.getTime());
    });

    it('sums the daily map by playedAt and skips unusable seconds', () => {
        const daily = buildDailyListeningSeconds([
            play({ sessionId: 'a', listenedSec: 60 }),
            play({ sessionId: 'b', listenedSec: 30 }),
            play({ sessionId: 'c', playedAt: at(2026, 9, 20, 21), listenedSec: 90 }),
            play({ sessionId: 'd', listenedSec: 0 }),
            play({ sessionId: 'e', listenedSec: Number.NaN }),
        ]);

        expect(daily).toEqual({
            '2026-10-19': 90,
            '2026-10-20': 90,
        });
    });

    it('totals plays, completed plays and distinct songs, artists and days', () => {
        const summary = aggregateListeningPlays([
            play({ sessionId: 'a', songKey: 'online:netease:1', listenedSec: 60 }),
            play({
                sessionId: 'b',
                songKey: 'online:qq:2',
                source: 'qq',
                title: 'Track two',
                artist: 'Artist A',
                listenedSec: 120,
                completed: true,
                playedAt: at(2026, 9, 19, 9, 45),
            }),
            play({ sessionId: 'c', songKey: 'online:netease:1', listenedSec: 30, playedAt: at(2026, 9, 20, 21) }),
        ]);

        expect(summary.totalSeconds).toBe(210);
        expect(summary.totalPlays).toBe(3);
        expect(summary.completedPlays).toBe(1);
        expect(summary.uniqueSongs).toBe(2);
        expect(summary.uniqueArtists).toBe(1);
        expect(summary.activeDays).toBe(2);
    });

    it('orders the top songs by seconds, then plays, and keeps the artist as sublabel', () => {
        const summary = aggregateListeningPlays([
            play({ sessionId: 'a', songKey: 'song-1', title: 'One', listenedSec: 60 }),
            play({ sessionId: 'b', songKey: 'song-2', title: 'Two', listenedSec: 120 }),
            play({ sessionId: 'c', songKey: 'song-1', title: 'One', listenedSec: 30 }),
        ]);

        expect(summary.topSongs.map(bucket => bucket.key)).toEqual(['song-2', 'song-1']);
        expect(summary.topSongs[1]).toMatchObject({ label: 'One', sublabel: 'Artist A', plays: 2, seconds: 90 });
    });

    it('keeps the top lists to five buckets', () => {
        const plays = Array.from({ length: 6 }, (_, index) => play({
            sessionId: `session-${index}`,
            songKey: `song-${index}`,
            title: `Track ${index}`,
            listenedSec: (index + 1) * 10,
        }));

        const summary = aggregateListeningPlays(plays);

        expect(summary.topSongs).toHaveLength(5);
        expect(summary.topSongs.map(bucket => bucket.key)).toEqual(['song-5', 'song-4', 'song-3', 'song-2', 'song-1']);
    });

    it('groups albums by artist and album, not by album name alone', () => {
        const summary = aggregateListeningPlays([
            play({ sessionId: 'a', artist: 'Artist A', album: 'Same name', listenedSec: 60 }),
            play({ sessionId: 'b', artist: 'Artist B', album: 'Same name', listenedSec: 30 }),
        ]);

        expect(summary.topAlbums.map(bucket => bucket.key)).toEqual(['Artist A::Same name', 'Artist B::Same name']);
        expect(summary.topAlbums[0]).toMatchObject({ label: 'Same name', sublabel: 'Artist A', plays: 1, seconds: 60 });
    });

    it('splits seconds across hours and Monday-first weekdays', () => {
        const summary = aggregateListeningPlays([
            play({ sessionId: 'a', listenedSec: 60, playedAt: at(2026, 9, 19, 9, 30) }),
            play({ sessionId: 'b', listenedSec: 120, playedAt: at(2026, 9, 19, 9, 45) }),
            play({ sessionId: 'c', listenedSec: 30, playedAt: at(2026, 9, 20, 21) }),
        ]);

        expect(summary.byHour).toHaveLength(24);
        expect(summary.byHour[9]).toBe(180);
        expect(summary.byHour[21]).toBe(30);

        expect(summary.byWeekday).toHaveLength(7);
        expect(summary.byWeekday[0]).toBe(180); // Monday
        expect(summary.byWeekday[1]).toBe(30); // Tuesday
    });

    it('orders the source split by seconds and keeps every source', () => {
        const summary = aggregateListeningPlays([
            play({ sessionId: 'a', source: 'netease', listenedSec: 30 }),
            play({ sessionId: 'b', source: 'qq', listenedSec: 120 }),
            play({ sessionId: 'c', source: 'qq', listenedSec: 60 }),
            play({ sessionId: 'd', source: 'local', listenedSec: 10 }),
        ]);

        expect(summary.bySource.map(bucket => bucket.key)).toEqual(['qq', 'netease', 'local']);
        expect(summary.bySource[0]).toMatchObject({ plays: 2, seconds: 180 });
    });

    it('returns an empty but well-shaped summary for no plays', () => {
        const summary = aggregateListeningPlays([]);

        expect(summary).toMatchObject({
            totalSeconds: 0,
            totalPlays: 0,
            completedPlays: 0,
            uniqueSongs: 0,
            uniqueArtists: 0,
            activeDays: 0,
            topSongs: [],
            topArtists: [],
            topAlbums: [],
            bySource: [],
            dailySeconds: {},
        });
        expect(summary.byHour).toEqual(Array.from({ length: 24 }, () => 0));
        expect(summary.byWeekday).toEqual(Array.from({ length: 7 }, () => 0));
    });
});

describe('computeListeningStreaks', () => {
    const now = new Date(2026, 9, 19, 15, 30); // Monday 19 October 2026, local time

    it('returns zeroes for an empty map', () => {
        expect(computeListeningStreaks({}, now)).toEqual({ current: 0, longest: 0 });
    });

    it('keeps a run that reaches today alive', () => {
        expect(computeListeningStreaks({
            '2026-10-17': 30,
            '2026-10-18': 60,
            '2026-10-19': 90,
        }, now)).toEqual({ current: 3, longest: 3 });
    });

    it('counts from yesterday while today has no play yet', () => {
        expect(computeListeningStreaks({
            '2026-10-17': 30,
            '2026-10-18': 60,
        }, now)).toEqual({ current: 2, longest: 2 });
    });

    it('drops the current run once a whole day is missed', () => {
        expect(computeListeningStreaks({
            '2026-10-15': 30,
            '2026-10-16': 30,
            '2026-10-17': 30,
            '2026-10-18': 0,
        }, now)).toEqual({ current: 0, longest: 3 });
    });

    it('finds the longest run even when it is not the latest one', () => {
        expect(computeListeningStreaks({
            '2026-10-01': 30,
            '2026-10-02': 30,
            '2026-10-03': 30,
            '2026-10-04': 30,
            '2026-10-18': 60,
            '2026-10-19': 60,
        }, now)).toEqual({ current: 2, longest: 4 });
    });

    it('crosses a month boundary without breaking the run', () => {
        expect(computeListeningStreaks({
            '2026-09-29': 30,
            '2026-09-30': 30,
            '2026-10-01': 30,
            '2026-10-02': 30,
        }, new Date(2026, 9, 2, 8))).toEqual({ current: 4, longest: 4 });
    });
});
