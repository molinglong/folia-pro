import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListeningPlayRecord } from '../../../src/types/listeningStats';
import type { SyncedListeningPull, SyncedListeningPushResult } from '../../../src/services/sync/syncTypes';

// test/unit/listeningStats/listeningStatsSync.test.ts
// 听歌记录同步编排：拉取合并、墓碑/水位线、发件箱推送、账号隔离与旧服务端降级。
// syncConfig / syncClient 都被替换，测试只验证合并与推送的决策逻辑。

const account = vi.hoisted(() => ({
    current: null as { userId: string; email: string } | null,
}));

vi.mock('../../../src/services/sync/syncConfig', () => ({
    whenSessionHydrated: async () => undefined,
    getActiveSession: () => account.current,
    getSyncConfig: () => ({
        provider: 'sync-server',
        enabled: true,
        workerBaseUrl: 'https://sync.test',
        authToken: '',
    }),
    isSyncConfigured: () => true,
}));

const remote = vi.hoisted(() => ({
    getRemoteListeningPlays: vi.fn(),
    pushRemoteListeningPlays: vi.fn(),
}));

vi.mock('../../../src/services/sync/syncClient', () => ({
    getRemoteListeningPlays: remote.getRemoteListeningPlays,
    pushRemoteListeningPlays: remote.pushRemoteListeningPlays,
}));

import { appDatabase } from '../../../src/services/appDatabase';
import {
    clearListeningPlays,
    deleteListeningPlay,
    readAllListeningPlays,
    readListeningSyncOutbox,
    recordListeningPlay,
} from '../../../src/services/listeningStats/listeningStatsRepository';
import { syncListeningStats } from '../../../src/services/sync/listeningStatsSync';

const storage = new Map<string, string>();

const installWindow = () => {
    vi.stubGlobal('window', {
        localStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
    });
};

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

const page = (overrides: Partial<SyncedListeningPull> = {}): SyncedListeningPull => ({
    schemaVersion: 1,
    plays: [],
    deletes: [],
    clearedAt: 0,
    since: 0,
    latestRevision: 0,
    hasMore: false,
    reset: false,
    ...overrides,
});

const pushOk = (): { status: 'ok'; result: SyncedListeningPushResult } => ({
    status: 'ok',
    result: { schemaVersion: 1, revision: 1, clearedAt: 0, savedPlays: 0, savedDeletes: 0 },
});

describe('listeningStatsSync', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        storage.clear();
        installWindow();
        account.current = { userId: 'user-a', email: 'a@example.com' };
        remote.getRemoteListeningPlays.mockReset();
        remote.pushRemoteListeningPlays.mockReset();
        remote.getRemoteListeningPlays.mockResolvedValue(page());
        remote.pushRemoteListeningPlays.mockResolvedValue(pushOk());
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        await appDatabase.delete();
    });

    it('does nothing while signed out', async () => {
        account.current = null;

        expect(await syncListeningStats()).toBeNull();
        expect(remote.getRemoteListeningPlays).not.toHaveBeenCalled();
    });

    it('pulls remote plays into the local table', async () => {
        remote.getRemoteListeningPlays.mockResolvedValue(page({
            plays: [record('s1', 1_000), record('s2', 2_000)],
            since: 2,
            latestRevision: 2,
        }));

        const summary = await syncListeningStats();

        expect(summary?.pulledPlays).toBe(2);
        expect((await readAllListeningPlays()).map(play => play.sessionId)).toEqual(['s1', 's2']);
        expect(remote.pushRemoteListeningPlays).not.toHaveBeenCalled();
    });

    it('applies a remote tombstone and drops the queued play', async () => {
        await recordListeningPlay(record('s1', 1_000));
        remote.getRemoteListeningPlays.mockResolvedValue(page({
            deletes: ['s1'],
            since: 3,
            latestRevision: 3,
        }));

        const summary = await syncListeningStats();

        expect(summary?.pulledDeletes).toBe(1);
        expect(await readAllListeningPlays()).toEqual([]);
        expect(await readListeningSyncOutbox()).toEqual([]);
        expect(remote.pushRemoteListeningPlays).not.toHaveBeenCalled();
    });

    it('applies a remote clear watermark and keeps later rows', async () => {
        await recordListeningPlay(record('s1', 1_000));
        await recordListeningPlay(record('s2', 3_000));
        remote.getRemoteListeningPlays.mockResolvedValue(page({
            clearedAt: 2_000,
            since: 1,
            latestRevision: 1,
        }));

        const summary = await syncListeningStats();

        expect(summary?.appliedClear).toBe(true);
        expect(summary?.pushedPlays).toBe(1);
        expect((await readAllListeningPlays()).map(play => play.sessionId)).toEqual(['s2']);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['s2']);
    });

    it('pushes a queued play and clears the op on success', async () => {
        await recordListeningPlay(record('s1', 1_000));

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(1);
        expect(remote.pushRemoteListeningPlays).toHaveBeenCalledTimes(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['s1']);
        expect(await readListeningSyncOutbox()).toEqual([]);
    });

    it('pushes a delete tombstone', async () => {
        await recordListeningPlay(record('s1', 1_000));
        await deleteListeningPlay('s1');

        const summary = await syncListeningStats();

        expect(summary?.pushedDeletes).toBe(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.deletes).toEqual(['s1']);
        expect(await readListeningSyncOutbox()).toEqual([]);
    });

    it('sends a clear in its own batch before newer plays', async () => {
        await recordListeningPlay(record('s1', 1_000));
        await clearListeningPlays();
        await recordListeningPlay(record('s2', 5_000));

        const summary = await syncListeningStats();

        expect(summary?.pushedClear).toBe(true);
        expect(summary?.pushedPlays).toBe(1);
        expect(remote.pushRemoteListeningPlays).toHaveBeenCalledTimes(2);
        const clearPayload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(clearPayload.clear?.clearedAt).toBeGreaterThan(0);
        expect(clearPayload.plays).toBeUndefined();
        const playPayload = remote.pushRemoteListeningPlays.mock.calls[1][1];
        expect(playPayload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['s2']);
    });

    it('keeps the outbox when the server has no listening endpoint', async () => {
        await recordListeningPlay(record('s1', 1_000));
        remote.getRemoteListeningPlays.mockResolvedValue(null);

        const summary = await syncListeningStats();

        expect(summary?.unsupported).toBe(true);
        expect(remote.pushRemoteListeningPlays).not.toHaveBeenCalled();
        expect(await readListeningSyncOutbox()).toHaveLength(1);
    });

    it('never pushes ops stamped with another account', async () => {
        storage.set('folia_listening_stats_sync_seed_v1', JSON.stringify({ 'user-a': true }));
        await appDatabase.listening_plays.put(record('s1', 1_000));
        await appDatabase.listening_sync_outbox.add({
            kind: 'play',
            sessionId: 's1',
            playedAt: 1_000,
            accountId: 'user-b',
            createdAt: Date.now(),
        });

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(0);
        expect(remote.pushRemoteListeningPlays).not.toHaveBeenCalled();
        expect(await readListeningSyncOutbox()).toHaveLength(1);
    });

    it('seeds local history once and prunes rows the remote already has', async () => {
        await appDatabase.listening_plays.put(record('s1', 1_000));
        await appDatabase.listening_plays.put(record('s2', 2_000));
        remote.getRemoteListeningPlays.mockResolvedValue(page({
            plays: [record('s1', 1_000)],
            since: 1,
            latestRevision: 1,
        }));

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['s2']);

        await syncListeningStats();
        // 标记已写入：第二次同步不再把本地历史排进发件箱。
        expect(remote.pushRemoteListeningPlays).toHaveBeenCalledTimes(1);
    });

    it('never seeds rows owned by another account and strips the local owner tag', async () => {
        await appDatabase.listening_plays.put({ ...record('s1', 1_000), ownerId: 'user-b' });
        await appDatabase.listening_plays.put({ ...record('s2', 2_000), ownerId: null });

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['s2']);
        expect(payload.plays[0].ownerId).toBeUndefined();
    });

    it('strips a local asset cover instead of letting a whole batch fail', async () => {
        // 本地歌曲封面是 folia-cover://，服务端只收 http(s)，原样推送会让整批 400。
        await recordListeningPlay({ ...record('s1', 1_000), coverUrl: 'folia-cover://asset/abc' });

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays[0].coverUrl).toBeUndefined();
        expect(await readListeningSyncOutbox()).toEqual([]);
    });

    it('drops an op the server would reject so it cannot wedge later plays', async () => {
        await appDatabase.listening_plays.put({ ...record('bad', 1_000), title: 'x'.repeat(600) });
        await appDatabase.listening_sync_outbox.add({
            kind: 'play',
            sessionId: 'bad',
            playedAt: 1_000,
            accountId: null,
            createdAt: Date.now(),
        });
        await recordListeningPlay(record('good', 2_000));

        const summary = await syncListeningStats();

        expect(summary?.pushedPlays).toBe(1);
        const payload = remote.pushRemoteListeningPlays.mock.calls[0][1];
        expect(payload.plays.map((play: ListeningPlayRecord) => play.sessionId)).toEqual(['good']);
        expect(await readListeningSyncOutbox()).toEqual([]);
    });
});
