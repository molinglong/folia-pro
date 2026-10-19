import type {
    ListeningPlayRecord,
    ListeningStatsBucket,
    ListeningStatsRange,
    ListeningStatsStreak,
    ListeningStatsSummary,
    ListeningStatsWindow,
} from '../../types/listeningStats';

// src/services/listeningStats/listeningStatsAggregation.ts
// Pure aggregation over rows the repository already read. No Dexie, no i18n, no clock of its own:
// the window is an argument, so the whole summary is testable with plain objects.

const TOP_LIMIT = 5;

const pad = (value: number) => String(value).padStart(2, '0');

/** YYYY-MM-DD in local time, the key the heatmap and the active-day count share. */
export const toListeningDateKey = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Local date key shifted by whole days; the Date round-trip keeps DST from skewing the key. */
const shiftListeningDateKey = (key: string, offsetDays: number): string => {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + offsetDays);
    return toListeningDateKey(date.getTime());
};

/**
 * Streaks over the daily map. `current` counts back from today, but a day without a play today
 * still lets yesterday's run stand until the day is over. `longest` is the best run in the map.
 */
export const computeListeningStreaks = (
    dailySeconds: Record<string, number>,
    now: Date = new Date(),
): ListeningStatsStreak => {
    const activeKeys = Object.keys(dailySeconds)
        .filter(key => (dailySeconds[key] || 0) > 0)
        .sort();
    if (activeKeys.length === 0) {
        return { current: 0, longest: 0 };
    }

    let longest = 1;
    let run = 1;
    for (let index = 1; index < activeKeys.length; index += 1) {
        const previous = new Date(`${activeKeys[index - 1]}T00:00:00`);
        const next = new Date(`${activeKeys[index]}T00:00:00`);
        // A local day can be 23 or 25 hours long; rounding still reads both as one day.
        const gapDays = Math.round((next.getTime() - previous.getTime()) / 86_400_000);
        run = gapDays === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    const todayKey = toListeningDateKey(now.getTime());
    let cursor = (dailySeconds[todayKey] || 0) > 0
        ? todayKey
        : shiftListeningDateKey(todayKey, -1);
    let current = 0;
    while ((dailySeconds[cursor] || 0) > 0) {
        current += 1;
        cursor = shiftListeningDateKey(cursor, -1);
    }

    return { current, longest };
};

export const resolveListeningStatsWindow = (
    range: ListeningStatsRange,
    now: Date = new Date(),
): ListeningStatsWindow => {
    const to = now.getTime();
    if (range === 'all') {
        return { from: 0, to };
    }
    if (range === 'year') {
        return { from: new Date(now.getFullYear(), 0, 1).getTime(), to };
    }
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    from.setDate(from.getDate() - (range === 'week' ? 6 : 29));
    return { from: from.getTime(), to };
};

/** The trailing 365 days ending today: the heatmap always shows a year, whatever the readout range. */
export const resolveListeningHeatmapWindow = (now: Date = new Date()): ListeningStatsWindow => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(today);
    from.setDate(from.getDate() - 364);
    return { from: from.getTime(), to: now.getTime() };
};

export const buildDailyListeningSeconds = (
    plays: readonly ListeningPlayRecord[],
): Record<string, number> => {
    const daily: Record<string, number> = {};
    for (const play of plays) {
        if (!Number.isFinite(play.listenedSec) || play.listenedSec <= 0) continue;
        const key = toListeningDateKey(play.playedAt);
        daily[key] = (daily[key] || 0) + play.listenedSec;
    }
    return daily;
};

type BucketAccumulator = ListeningStatsBucket;

const bumpBucket = (
    buckets: Map<string, BucketAccumulator>,
    key: string,
    create: () => Omit<BucketAccumulator, 'plays' | 'seconds'>,
    seconds: number,
) => {
    const existing = buckets.get(key);
    if (existing) {
        existing.plays += 1;
        existing.seconds += seconds;
        return;
    }
    buckets.set(key, { ...create(), plays: 1, seconds });
};

const sortAndTrim = (buckets: Map<string, BucketAccumulator>): ListeningStatsBucket[] => (
    [...buckets.values()]
        .sort((a, b) => (
            b.seconds - a.seconds
            || b.plays - a.plays
            || a.label.localeCompare(b.label)
        ))
        .slice(0, TOP_LIMIT)
);

export const aggregateListeningPlays = (
    plays: readonly ListeningPlayRecord[],
): ListeningStatsSummary => {
    const songs = new Map<string, BucketAccumulator>();
    const artists = new Map<string, BucketAccumulator>();
    const albums = new Map<string, BucketAccumulator>();
    const sources = new Map<string, BucketAccumulator>();
    const uniqueSongs = new Set<string>();
    const uniqueArtists = new Set<string>();
    const activeDays = new Set<string>();
    const byHour = Array.from({ length: 24 }, () => 0);
    const byWeekday = Array.from({ length: 7 }, () => 0);

    let totalSeconds = 0;
    let completedPlays = 0;

    for (const play of plays) {
        const seconds = Number.isFinite(play.listenedSec) ? Math.max(0, play.listenedSec) : 0;
        totalSeconds += seconds;
        if (play.completed) completedPlays += 1;

        uniqueSongs.add(play.songKey);
        if (play.artist) uniqueArtists.add(play.artist);
        activeDays.add(toListeningDateKey(play.playedAt));

        const date = new Date(play.playedAt);
        byHour[date.getHours()] += seconds;
        // Monday first: the heatmap and the weekday strip share this order.
        byWeekday[(date.getDay() + 6) % 7] += seconds;

        bumpBucket(songs, play.songKey, () => ({
            key: play.songKey,
            label: play.title,
            ...(play.artist ? { sublabel: play.artist } : {}),
            ...(play.coverUrl ? { coverUrl: play.coverUrl } : {}),
        }), seconds);

        if (play.artist) {
            bumpBucket(artists, play.artist, () => ({
                key: play.artist,
                label: play.artist,
            }), seconds);
        }

        if (play.album) {
            const albumKey = `${play.artist}::${play.album}`;
            bumpBucket(albums, albumKey, () => ({
                key: albumKey,
                label: play.album,
                ...(play.artist ? { sublabel: play.artist } : {}),
            }), seconds);
        }

        bumpBucket(sources, play.source, () => ({
            key: play.source,
            label: play.source,
        }), seconds);
    }

    return {
        totalSeconds,
        totalPlays: plays.length,
        completedPlays,
        uniqueSongs: uniqueSongs.size,
        uniqueArtists: uniqueArtists.size,
        activeDays: activeDays.size,
        topSongs: sortAndTrim(songs),
        topArtists: sortAndTrim(artists),
        topAlbums: sortAndTrim(albums),
        byHour,
        byWeekday,
        bySource: [...sources.values()].sort((a, b) => b.seconds - a.seconds),
        dailySeconds: buildDailyListeningSeconds(plays),
    };
};
