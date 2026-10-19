import type { ListeningPlayRecord, ListeningSyncOutboxRecord } from '../../types/listeningStats';
import { appDatabase } from '../appDatabase';
import { getActiveSession } from '../sync/syncConfig';

// src/services/listeningStats/listeningStatsRepository.ts
// The only place that touches the listening_plays table. Each local write also appends to the sync
// outbox, so a play/delete/clear survives a restart and is pushed once an account is signed in.

/** Fired after a local write, a remote apply or a clear so an open statistics page can reload. */
export const LISTENING_STATS_CHANGED_EVENT = 'folia-listening-stats-changed';

const notifyChanged = () => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(LISTENING_STATS_CHANGED_EVENT));
    }
};

/** The account label stamped on new ops; null means "recorded while signed out". */
const currentAccountId = (): string | null => {
    try {
        return getActiveSession()?.userId ?? null;
    } catch {
        return null;
    }
};

const appendOutbox = async (
    entry: Omit<ListeningSyncOutboxRecord, 'id' | 'accountId' | 'createdAt'> & { accountId?: string | null },
) => {
    await appDatabase.listening_sync_outbox.add({
        ...entry,
        accountId: entry.accountId === undefined ? currentAccountId() : entry.accountId,
        createdAt: Date.now(),
    });
};

export const recordListeningPlay = async (record: ListeningPlayRecord): Promise<void> => {
    const accountId = currentAccountId();
    await appDatabase.transaction('rw', appDatabase.listening_plays, appDatabase.listening_sync_outbox, async () => {
        // ownerId 只留在本机：seed 时用它区分"匿名历史"和"别的账号的历史"，推送前会剔除。
        await appDatabase.listening_plays.put({ ...record, ownerId: accountId });
        await appendOutbox({ kind: 'play', sessionId: record.sessionId, playedAt: record.playedAt });
    });
    notifyChanged();
};

export const readListeningPlaysInRange = async (from: number, to: number): Promise<ListeningPlayRecord[]> => {
    const table = appDatabase.listening_plays;
    if (!Number.isFinite(from) || from <= 0) {
        return table.orderBy('playedAt').toArray();
    }
    return table.where('playedAt').between(from, to, true, true).toArray();
};

export const readRecentListeningPlays = async (limit = 12): Promise<ListeningPlayRecord[]> => (
    appDatabase.listening_plays.orderBy('playedAt').reverse().limit(limit).toArray()
);

export const readAllListeningPlays = async (): Promise<ListeningPlayRecord[]> => (
    appDatabase.listening_plays.orderBy('playedAt').toArray()
);

/** The oldest row, used to say how far back the history actually goes. */
export const readFirstListeningPlay = async (): Promise<ListeningPlayRecord | undefined> => (
    appDatabase.listening_plays.orderBy('playedAt').first()
);

/** Removes one row. `sessionId` is the primary key, so a repeated settle cannot resurrect it. */
export const deleteListeningPlay = async (sessionId: string): Promise<void> => {
    const existing = await appDatabase.listening_plays.get(sessionId);
    await appDatabase.transaction('rw', appDatabase.listening_plays, appDatabase.listening_sync_outbox, async () => {
        await appDatabase.listening_plays.delete(sessionId);
        // 记录都没了，排队中的 play op 已经没有内容可推；墓碑仍要发，挡住其它设备可能的历史副本。
        const playOps = await appDatabase.listening_sync_outbox.where('sessionId').equals(sessionId).toArray();
        const playOpIds = playOps
            .filter(op => op.kind === 'play' && op.id != null)
            .map(op => op.id as number);
        if (playOpIds.length > 0) await appDatabase.listening_sync_outbox.bulkDelete(playOpIds);
        await appendOutbox({ kind: 'delete', sessionId, playedAt: existing?.playedAt });
    });
    notifyChanged();
};

export const clearListeningPlays = async (): Promise<void> => {
    const clearedAt = Date.now();
    await appDatabase.transaction('rw', appDatabase.listening_plays, appDatabase.listening_sync_outbox, async () => {
        await appDatabase.listening_plays.clear();
        // Plays/deletes before the watermark are moot: the server drops plays that old, and a
        // delete of an already-cleared row changes nothing. One clear op replaces them all.
        await appDatabase.listening_sync_outbox.where('kind').equals('play').delete();
        await appDatabase.listening_sync_outbox.where('kind').equals('delete').delete();
        const pendingClear = await appDatabase.listening_sync_outbox.where('kind').equals('clear').first();
        if (pendingClear?.id != null) {
            await appDatabase.listening_sync_outbox.update(pendingClear.id, {
                clearedAt: Math.max(pendingClear.clearedAt ?? 0, clearedAt),
            });
        } else {
            await appendOutbox({ kind: 'clear', clearedAt });
        }
    });
    notifyChanged();
};

// --- 云同步：远端应用与发件箱 ---

const readPendingDeleteIds = async (): Promise<Set<string>> => {
    const ops = await appDatabase.listening_sync_outbox.where('kind').equals('delete').toArray();
    return new Set(ops.map(op => op.sessionId).filter((id): id is string => Boolean(id)));
};

/** Merges a pulled page. Local rows win (a local settle may carry a larger listenedSec), and a
 *  row with a pending delete is skipped so it cannot come back before the delete is pushed. */
export const applyRemoteListeningPlays = async (
    plays: ListeningPlayRecord[],
    ownerId: string | null,
): Promise<number> => {
    if (plays.length === 0) return 0;
    const pendingDeletes = await readPendingDeleteIds();
    const existing = await appDatabase.listening_plays.bulkGet(plays.map(play => play.sessionId));
    const known = new Set(existing.filter((row): row is ListeningPlayRecord => Boolean(row)).map(row => row.sessionId));
    const next = plays
        .filter(play => !pendingDeletes.has(play.sessionId) && !known.has(play.sessionId))
        .map(play => ({ ...play, ownerId }));
    if (next.length > 0) {
        await appDatabase.listening_plays.bulkPut(next);
        notifyChanged();
    }
    return next.length;
};

export const applyRemoteListeningDeletes = async (sessionIds: string[]): Promise<number> => {
    const unique = Array.from(new Set(sessionIds.filter(Boolean)));
    if (unique.length === 0) return 0;
    const existing = await appDatabase.listening_plays.bulkGet(unique);
    const removed = existing.filter(Boolean).length;
    await appDatabase.transaction('rw', appDatabase.listening_plays, appDatabase.listening_sync_outbox, async () => {
        await appDatabase.listening_plays.bulkDelete(unique);
        // Pending plays for rows another device deleted must not be pushed back.
        const ops = await appDatabase.listening_sync_outbox.where('sessionId').anyOf(unique).toArray();
        const ids = ops
            .filter(op => op.kind === 'play' && op.id != null)
            .map(op => op.id as number);
        if (ids.length > 0) await appDatabase.listening_sync_outbox.bulkDelete(ids);
    });
    if (removed > 0) notifyChanged();
    return removed;
};

/** Drops every local row at or before the remote clear watermark, plus the ops it covers. */
export const applyRemoteListeningClear = async (clearedAt: number): Promise<number> => {
    if (!Number.isFinite(clearedAt) || clearedAt <= 0) return 0;
    const cutoff = Math.trunc(clearedAt);
    let removed = 0;
    await appDatabase.transaction('rw', appDatabase.listening_plays, appDatabase.listening_sync_outbox, async () => {
        removed = await appDatabase.listening_plays.where('playedAt').belowOrEqual(cutoff).delete();
        const covered = await appDatabase.listening_sync_outbox
            .filter(op => op.kind !== 'clear' && typeof op.playedAt === 'number' && op.playedAt <= cutoff)
            .toArray();
        const ids = covered.map(op => op.id).filter((id): id is number => id != null);
        if (ids.length > 0) await appDatabase.listening_sync_outbox.bulkDelete(ids);
    });
    if (removed > 0) notifyChanged();
    return removed;
};

/** First sync for an account: queue every row already on this device. */
export const enqueueListeningSyncPlays = async (
    records: ListeningPlayRecord[],
    accountId: string | null,
): Promise<number> => {
    if (records.length === 0) return 0;
    const createdAt = Date.now();
    await appDatabase.listening_sync_outbox.bulkAdd(records.map(record => ({
        kind: 'play' as const,
        sessionId: record.sessionId,
        playedAt: record.playedAt,
        accountId,
        createdAt,
    })));
    return records.length;
};

export const readListeningSyncOutbox = async (): Promise<ListeningSyncOutboxRecord[]> => (
    appDatabase.listening_sync_outbox.toArray()
);

export const deleteListeningSyncOutbox = async (ids: number[]): Promise<void> => {
    const unique = Array.from(new Set(ids.filter(id => Number.isFinite(id))));
    if (unique.length > 0) await appDatabase.listening_sync_outbox.bulkDelete(unique);
};

/** A pulled row already exists remotely; drop the matching pending play so it is not pushed again. */
export const pruneListeningSyncPlayOutbox = async (
    sessionIds: string[],
    accountId: string | null,
): Promise<void> => {
    const unique = Array.from(new Set(sessionIds.filter(Boolean)));
    if (unique.length === 0) return;
    const ops = await appDatabase.listening_sync_outbox.where('sessionId').anyOf(unique).toArray();
    const ids = ops
        .filter(op => op.kind === 'play' && (op.accountId === null || op.accountId === accountId) && op.id != null)
        .map(op => op.id as number);
    await deleteListeningSyncOutbox(ids);
};

export const readListeningPlaysBySessionIds = async (sessionIds: string[]): Promise<ListeningPlayRecord[]> => {
    const unique = Array.from(new Set(sessionIds.filter(Boolean)));
    if (unique.length === 0) return [];
    const rows = await appDatabase.listening_plays.bulkGet(unique);
    return rows.filter((row): row is ListeningPlayRecord => Boolean(row));
};
