import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/listeningStats/listeningPlayRecord.test.ts
// The tracker decides whether a listen happened; this module decides what the row says. The provider
// metadata lookup is the only thing it borrows from the network stack, so it is stubbed out here and
// the snapshot rules (identity, completion, fallbacks) stay testable in the node environment.
vi.mock('../../../src/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: SongResult | null | undefined) => ({
        artists: song?.artists ?? [],
        album: song?.album ?? { id: 0, name: '' },
        durationMs: song?.durationMs ?? 0,
        aliases: [],
        translatedNames: [],
        coverUrl: song?.album?.coverUrl,
    }),
}));

const { buildListeningPlayRecord, buildListeningSessionId } = await import(
    '../../../src/services/listeningStats/listeningPlayRecord'
);

const startedAt = new Date(2026, 9, 19, 9, 30, 0, 0).getTime();
const playedAt = startedAt + 180_000;

const song = (overrides: Partial<SongResult> = {}): SongResult => ({
    id: '1001',
    name: 'Night Drive',
    artists: [{ id: 'artist-1', name: 'Aria' }],
    album: { id: 'album-1', name: 'Neon', coverUrl: 'https://img.test/neon.jpg' },
    durationMs: 210_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1001' },
    ...overrides,
});

const report = {
    mediaId: '1001',
    songKey: 'online:netease:1001',
    playedSeconds: 195,
    totalSeconds: 200,
};

describe('buildListeningPlayRecord', () => {
    it('snapshots the song and the real listened seconds into one row', () => {
        const record = buildListeningPlayRecord({
            song: song(),
            report,
            startedAt,
            playedAt,
        });

        expect(record).toEqual({
            sessionId: `online:netease:1001@${Math.trunc(startedAt)}`,
            songKey: 'online:netease:1001',
            source: 'netease',
            title: 'Night Drive',
            artist: 'Aria',
            album: 'Neon',
            coverUrl: 'https://img.test/neon.jpg',
            durationSec: 200,
            listenedSec: 195,
            startedAt: Math.trunc(startedAt),
            playedAt: Math.trunc(playedAt),
            completed: true,
        });
    });

    it('only calls a play complete at ninety percent of the track', () => {
        const record = buildListeningPlayRecord({
            song: song(),
            report: { ...report, playedSeconds: 179 },
            startedAt,
            playedAt,
        });

        expect(record?.completed).toBe(false);
    });

    it('rounds the reported seconds but keeps sub-second precision', () => {
        const record = buildListeningPlayRecord({
            song: song(),
            report: { ...report, playedSeconds: 42.123456 },
            startedAt,
            playedAt,
        });

        expect(record?.listenedSec).toBe(42.123);
    });

    it('falls back to the track metadata when the report carries no duration', () => {
        const record = buildListeningPlayRecord({
            song: song({ durationMs: 211_400 }),
            report: { ...report, totalSeconds: 0 },
            startedAt,
            playedAt,
        });

        expect(record?.durationSec).toBe(211.4);
    });

    it('falls back to the album name when the title is blank', () => {
        const record = buildListeningPlayRecord({
            song: song({ name: '   ' }),
            report,
            startedAt,
            playedAt,
        });

        expect(record?.title).toBe('Neon');
    });

    it('drops stage playback, which is a rehearsal surface rather than listening', () => {
        const record = buildListeningPlayRecord({
            song: song({ sourceRef: { kind: 'stage', mediaId: '1001' } }),
            report,
            startedAt,
            playedAt,
        });

        expect(record).toBeNull();
    });

    it('drops a report without usable seconds', () => {
        const build = (playedSeconds: number) => buildListeningPlayRecord({
            song: song(),
            report: { ...report, playedSeconds },
            startedAt,
            playedAt,
        });

        expect(build(0)).toBeNull();
        expect(build(-3)).toBeNull();
        expect(build(Number.NaN)).toBeNull();
        expect(build(Number.POSITIVE_INFINITY)).toBeNull();
    });
});

describe('buildListeningSessionId', () => {
    it('keeps the same id across a repeated settle of one session', () => {
        expect(buildListeningSessionId(song(), startedAt)).toBe(buildListeningSessionId(song(), startedAt));
    });

    it('separates a genuine replay from the session before it', () => {
        expect(buildListeningSessionId(song(), startedAt + 200_000))
            .not.toBe(buildListeningSessionId(song(), startedAt));
    });
});
