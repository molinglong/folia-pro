import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import {
    applyRemoteListeningClear,
    applyRemoteListeningDeletes,
    applyRemoteListeningPlays,
    clearListeningPlays,
    deleteListeningPlay,
    enqueueListeningSyncPlays,
    pruneListeningSyncPlayOutbox,
    readAllListeningPlays,
    readFirstListeningPlay,
    readListeningPlaysInRange,
    readListeningSyncOutbox,
    readRecentListeningPlays,
    recordListeningPlay,
} from '../../../src/services/listeningStats/listeningStatsRepository';
import type { ListeningPlayRecord } from '../../../src/types/listeningStats';

// test/unit/listeningStats/listeningStatsRepository.test.ts
// The only layer that touches the v1 table. Session ids have to absorb a repeated settle, and the
// range read backs the heatmap, so both are exercised against a real (fake) IndexedDB.

const record = (sessionId: string, playedAt: number): ListeningPlayRecord => ({
    sessionId,
    songKey: 'online:netease:1',
    source: 'netease',
    title: 'Night Drive',
    artist: 'Aria',
    album: 'Neon',
    durationSec: 200,
    listenedSec: 60,
    startedAt: playedAt,
    playedAt,
    completed: false,
});

describe('listeningStatsRepository', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    afterEach(async () => {
        await appDatabase.delete();
    });

    it('writes a row and reads it back', async () => {
        await recordListeningPlay(record('session-1', 1_000));

        expect(await readAllListeningPlays()).toEqual([{ ...record('session-1', 1_000), ownerId: null }]);
    });

    it('overwrites a repeated settle instead of counting the play twice', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay({ ...record('session-1', 1_000), listenedSec: 75 });

        const plays = await readAllListeningPlays();

        expect(plays).toHaveLength(1);
        expect(plays[0].listenedSec).toBe(75);
    });

    it('reads a closed range inclusive of both ends', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 2_000));
        await recordListeningPlay(record('session-3', 3_000));

        expect((await readListeningPlaysInRange(1_000, 2_000)).map(play => play.sessionId)).toEqual([
            'session-1',
            'session-2',
        ]);
    });

    it('treats a from of zero as the whole archive', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 2_000));

        expect(await readListeningPlaysInRange(0, 5_000)).toHaveLength(2);
    });

    it('reads the most recent plays first', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 2_000));
        await recordListeningPlay(record('session-3', 3_000));

        expect((await readRecentListeningPlays(2)).map(play => play.sessionId)).toEqual(['session-3', 'session-2']);
    });

    it('reads the oldest play for the first-record line', async () => {
        await recordListeningPlay(record('session-2', 2_000));
        await recordListeningPlay(record('session-1', 1_000));

        expect((await readFirstListeningPlay())?.sessionId).toBe('session-1');
        expect(await readFirstListeningPlay()).toBeDefined();
    });

    it('returns undefined as the first play of an empty archive', async () => {
        expect(await readFirstListeningPlay()).toBeUndefined();
    });

    it('deletes one play without touching the rest', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 2_000));

        await deleteListeningPlay('session-1');

        expect((await readAllListeningPlays()).map(play => play.sessionId)).toEqual(['session-2']);
    });

    it('clears the archive', async () => {
        await recordListeningPlay(record('session-1', 1_000));

        await clearListeningPlays();

        expect(await readAllListeningPlays()).toEqual([]);
    });

    it('queues a play op with no account label while signed out', async () => {
        await recordListeningPlay(record('session-1', 1_000));

        const ops = await readListeningSyncOutbox();

        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ kind: 'play', sessionId: 'session-1', playedAt: 1_000, accountId: null });
    });

    it('replaces a pending play with a delete tombstone', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await deleteListeningPlay('session-1');

        const ops = await readListeningSyncOutbox();

        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ kind: 'delete', sessionId: 'session-1', playedAt: 1_000 });
    });

    it('coalesces a clear into one op with the newest watermark', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await clearListeningPlays();

        const first = await readListeningSyncOutbox();
        expect(first).toHaveLength(1);
        expect(first[0].kind).toBe('clear');
        expect(first[0].clearedAt).toBeGreaterThan(0);

        await clearListeningPlays();
        const second = await readListeningSyncOutbox();
        expect(second).toHaveLength(1);
        expect(second[0].clearedAt).toBeGreaterThanOrEqual(first[0].clearedAt as number);
    });

    it('keeps local rows when merging a pulled page and skips pending deletes', async () => {
        await recordListeningPlay(record('session-local', 1_000));
        await recordListeningPlay(record('session-pending-delete', 1_500));
        await deleteListeningPlay('session-pending-delete');

        const applied = await applyRemoteListeningPlays([
            { ...record('session-local', 1_000), listenedSec: 10 },
            record('session-pending-delete', 1_500),
            record('session-remote', 2_000),
        ], 'user-a');

        expect(applied).toBe(1);
        expect((await readAllListeningPlays()).map(play => play.sessionId)).toEqual(['session-local', 'session-remote']);
        expect((await readAllListeningPlays()).find(play => play.sessionId === 'session-local')?.listenedSec).toBe(60);
        expect((await readAllListeningPlays()).find(play => play.sessionId === 'session-remote')?.ownerId).toBe('user-a');
    });

    it('applies a remote delete and drops the queued play for that row', async () => {
        await recordListeningPlay(record('session-1', 1_000));

        expect(await applyRemoteListeningDeletes(['session-1'])).toBe(1);

        expect(await readAllListeningPlays()).toEqual([]);
        expect(await readListeningSyncOutbox()).toEqual([]);
    });

    it('applies a remote clear watermark without touching later rows', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 3_000));

        expect(await applyRemoteListeningClear(2_000)).toBe(1);

        expect((await readAllListeningPlays()).map(play => play.sessionId)).toEqual(['session-2']);
        const ops = await readListeningSyncOutbox();
        expect(ops.map(op => op.sessionId)).toEqual(['session-2']);
    });

    it('seeds history in bulk and later prunes plays the remote already has', async () => {
        await recordListeningPlay(record('session-1', 1_000));
        await recordListeningPlay(record('session-2', 2_000));

        expect(await enqueueListeningSyncPlays(await readAllListeningPlays(), 'user-a')).toBe(2);
        expect((await readListeningSyncOutbox()).filter(op => op.kind === 'play')).toHaveLength(4);

        await pruneListeningSyncPlayOutbox(['session-1'], 'user-a');

        const remaining = (await readListeningSyncOutbox()).filter(op => op.kind === 'play');
        expect(remaining.map(op => op.sessionId)).toEqual(['session-2', 'session-2']);
    });
});
