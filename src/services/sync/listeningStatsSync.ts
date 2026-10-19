import type { ListeningPlayRecord, ListeningSyncOutboxRecord } from '../../types/listeningStats';
import {
    applyRemoteListeningClear,
    applyRemoteListeningDeletes,
    applyRemoteListeningPlays,
    deleteListeningSyncOutbox,
    enqueueListeningSyncPlays,
    LISTENING_STATS_CHANGED_EVENT,
    pruneListeningSyncPlayOutbox,
    readAllListeningPlays,
    readListeningPlaysBySessionIds,
    readListeningSyncOutbox,
} from '../listeningStats/listeningStatsRepository';
import { getActiveSession, getSyncConfig, isSyncConfigured, whenSessionHydrated } from './syncConfig';
import { getRemoteListeningPlays, pushRemoteListeningPlays } from './syncClient';
import { parseSyncedListeningPlay } from './syncSchema';
import { LISTENING_SYNC_SOURCES, type SyncProviderConfig } from './syncTypes';

// src/services/sync/listeningStatsSync.ts
// 听歌记录的云同步编排：登录账号后把本机历史补推上去，并按 revision 游标增量拉取。
// 记录是只追加事件，跨设备按 sessionId 合并；删除走墓碑、清空走 clearedAt 水位线，
// 两者都由服务端下发，本地只负责应用。
//
// 只有登录账号才同步：兼容模式（全局 SYNC_TOKEN）没有用户数据域，服务端明确 403。
// 旧服务端没有 /listening-plays（404）时静默降级，不影响设置、主题、收藏等其它同步域。

const SYNC_CURSORS_KEY = 'folia_listening_stats_sync_cursors_v1';
const SEED_MARKERS_KEY = 'folia_listening_stats_sync_seed_v1';
const AUTO_PUSH_DEBOUNCE_MS = 15_000;
const PULL_PAGE_LIMIT = 500;
const MAX_PULL_PAGES = 40;
const PUSH_PLAY_BATCH = 100;
const PUSH_DELETE_BATCH = 500;

type StoredCursor = {
    cursor: number;
    clearedAt: number;
};

type PullOutcome = {
    unsupported: boolean;
    cursor: number;
    clearedAt: number;
    pulledPlays: number;
    pulledDeletes: number;
    appliedClear: boolean;
};

type PushOutcome = {
    unsupported: boolean;
    pushedPlays: number;
    pushedDeletes: number;
    pushedClear: boolean;
};

export type ListeningStatsSyncSummary = {
    pulledPlays: number;
    pulledDeletes: number;
    appliedClear: boolean;
    pushedPlays: number;
    pushedDeletes: number;
    pushedClear: boolean;
    /** 服务端不支持这个同步域（旧版服务端或兼容模式），本次没有推送也没有拉取。 */
    unsupported: boolean;
};

const isBrowser = () => typeof window !== 'undefined';

const readJsonRecord = (key: string): Record<string, unknown> => {
    if (!isBrowser()) return {};
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) as unknown : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
};

const writeJsonRecord = (key: string, value: Record<string, unknown>) => {
    if (!isBrowser()) return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 隐私模式/配额满：游标丢了最多重拉一遍，重复记录按 sessionId 合并。
    }
};

/** Cursors are keyed by userId: signing into another account starts from its own position. */
const readCursor = (userId: string): StoredCursor => {
    const entry = readJsonRecord(SYNC_CURSORS_KEY)[userId];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>;
        const cursor = typeof record.cursor === 'number' && Number.isFinite(record.cursor) ? record.cursor : 0;
        const clearedAt = typeof record.clearedAt === 'number' && Number.isFinite(record.clearedAt) ? record.clearedAt : 0;
        return {
            cursor: Math.max(0, Math.trunc(cursor)),
            clearedAt: Math.max(0, Math.trunc(clearedAt)),
        };
    }
    return { cursor: 0, clearedAt: 0 };
};

const writeCursor = (userId: string, cursor: StoredCursor) => {
    writeJsonRecord(SYNC_CURSORS_KEY, {
        ...readJsonRecord(SYNC_CURSORS_KEY),
        [userId]: { cursor: Math.max(0, Math.trunc(cursor.cursor)), clearedAt: Math.max(0, Math.trunc(cursor.clearedAt)) },
    });
};

const isSeeded = (userId: string) => readJsonRecord(SEED_MARKERS_KEY)[userId] === true;

const markSeeded = (userId: string) => {
    writeJsonRecord(SEED_MARKERS_KEY, { ...readJsonRecord(SEED_MARKERS_KEY), [userId]: true });
};

/** First sync for an account queues the history already on this device; the marker survives restarts. */
const seedLocalHistory = async (userId: string) => {
    if (isSeeded(userId)) return;
    // 只认领匿名历史和本账号自己的行；另一个账号留在这台设备上的记录不能被推到当前账号。
    const records = (await readAllListeningPlays())
        .filter(record => record.ownerId == null || record.ownerId === userId);
    if (records.length > 0) {
        // 刚播放完的那条已经排进发件箱了：seed 只补上还没有 play op 的旧记录，避免重复推送。
        const ops = await readListeningSyncOutbox();
        const pending = new Set(
            ops
                .filter(op => op.kind === 'play' && isPushable(op, userId) && op.sessionId)
                .map(op => op.sessionId as string),
        );
        const missing = records.filter(record => !pending.has(record.sessionId));
        if (missing.length > 0) {
            await enqueueListeningSyncPlays(missing, userId);
        }
    }
    markSeeded(userId);
};

const chunk = <T,>(items: T[], size: number): T[][] => {
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        batches.push(items.slice(index, index + size));
    }
    return batches;
};

const MAX_SYNCED_COVER_URL_LENGTH = 2_048;

/**
 * 本机字段与本地封面不能上云：ownerId 是服务端严格白名单之外的多余键，
 * 本地歌曲封面是 folia-cover:// 或 /__folia_cover/（服务端只收 http(s)），
 * 原样推送会让整批 400 并永久卡住发件箱。
 */
const toSyncedPlay = (record: ListeningPlayRecord): ListeningPlayRecord => {
    const { ownerId: _ownerId, ...play } = record;
    if (play.coverUrl && (
        !/^https?:\/\//i.test(play.coverUrl)
        || play.coverUrl.length > MAX_SYNCED_COVER_URL_LENGTH
    )) {
        delete play.coverUrl;
    }
    return play;
};

/** 服务端会拒收的记录先在本机挡下（本机记录保留），否则一条坏数据会让每次同步都失败。 */
const toSyncablePlay = (record: ListeningPlayRecord): ListeningPlayRecord | null => (
    parseSyncedListeningPlay(toSyncedPlay(record))
);

const stillSameAccount = (userId: string) => getActiveSession()?.userId === userId;

const pullRemote = async (
    config: SyncProviderConfig,
    userId: string,
): Promise<PullOutcome> => {
    const initial = readCursor(userId);
    let cursor = initial.cursor;
    let clearedAt = initial.clearedAt;
    let pulledPlays = 0;
    let pulledDeletes = 0;
    let appliedClear = false;
    let resetHandled = false;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < MAX_PULL_PAGES) {
        if (!stillSameAccount(userId)) {
            // 请求期间切了账号：游标属于上一个用户，不能继续用它的位置拉新账号的数据。
            break;
        }
        pageCount += 1;
        const page = await getRemoteListeningPlays(config, { since: cursor, limit: PULL_PAGE_LIMIT });
        if (!page) {
            return { unsupported: true, cursor, clearedAt, pulledPlays, pulledDeletes, appliedClear };
        }

        // 服务端换库/回滚：游标超前时回到 0 重拉，并把本地记录重新排进发件箱（seed 已经标记过）。
        if (page.reset && !resetHandled) {
            resetHandled = true;
            cursor = 0;
            const localRecords = await readAllListeningPlays();
            if (localRecords.length > 0) {
                await enqueueListeningSyncPlays(localRecords, userId);
            }
            continue;
        }

        if (page.clearedAt > clearedAt) {
            await applyRemoteListeningClear(page.clearedAt);
            clearedAt = page.clearedAt;
            appliedClear = true;
        }
        if (page.deletes.length > 0) {
            await applyRemoteListeningDeletes(page.deletes);
            pulledDeletes += page.deletes.length;
        }
        if (page.plays.length > 0) {
            pulledPlays += await applyRemoteListeningPlays(page.plays, userId);
            // 远端已有这些行，本机待推送的同名 play 就不必再发一遍。
            await pruneListeningSyncPlayOutbox(page.plays.map(play => play.sessionId), userId);
        }

        cursor = Math.max(cursor, page.since);
        hasMore = page.hasMore;
        if (!hasMore) {
            // 被墓碑挡下的重复上传会留下 revision 空洞，直接推进到服务端最新水位。
            cursor = Math.max(cursor, page.latestRevision);
        }
        writeCursor(userId, { cursor, clearedAt });
    }

    return { unsupported: false, cursor, clearedAt, pulledPlays, pulledDeletes, appliedClear };
};

const isPushable = (op: ListeningSyncOutboxRecord, userId: string) => (
    op.accountId === null || op.accountId === userId
);

const pushPending = async (
    config: SyncProviderConfig,
    userId: string,
): Promise<PushOutcome> => {
    const ops = await readListeningSyncOutbox();
    const mine = ops.filter(op => op.id != null && isPushable(op, userId));
    const outcome: PushOutcome = {
        unsupported: false,
        pushedPlays: 0,
        pushedDeletes: 0,
        pushedClear: false,
    };
    if (mine.length === 0) return outcome;

    // 清空必须单独成批，而且先于新增/删除发送。
    const clearOps = mine.filter(op => op.kind === 'clear' && typeof op.clearedAt === 'number' && op.clearedAt > 0);
    if (clearOps.length > 0) {
        const clearedAt = Math.max(...clearOps.map(op => op.clearedAt as number));
        const push = await pushRemoteListeningPlays(config, { clear: { clearedAt } });
        if (!push) return outcome;
        if (push.status === 'unsupported') {
            outcome.unsupported = true;
            return outcome;
        }
        await deleteListeningSyncOutbox(clearOps.map(op => op.id as number));
        outcome.pushedClear = true;
    }

    if (!stillSameAccount(userId)) return outcome;

    const playOps = mine.filter(op => op.kind === 'play' && op.sessionId);
    if (playOps.length > 0) {
        const records = await readListeningPlaysBySessionIds(playOps.map(op => op.sessionId as string));
        const bySession = new Map(records.map(record => [record.sessionId, record]));
        // 记录已被删掉/清空，或服务端必然拒收（来源/字段超出白名单）：本机记录保留，op 丢掉。
        // 否则这些毒丸会让每一轮同步都整批 400，后面的正常记录永远推不上去。
        const syncable = new Map<string, ListeningPlayRecord>();
        const rejectedOpIds: number[] = [];
        for (const op of playOps) {
            const record = bySession.get(op.sessionId as string);
            const sanitized = record && LISTENING_SYNC_SOURCES.has(record.source)
                ? toSyncablePlay(record)
                : null;
            if (sanitized) {
                syncable.set(op.sessionId as string, sanitized);
            } else if (op.id != null) {
                rejectedOpIds.push(op.id);
            }
        }
        if (rejectedOpIds.length > 0) {
            await deleteListeningSyncOutbox(rejectedOpIds);
        }
        const valid = playOps.filter(op => syncable.has(op.sessionId as string));

        for (const batch of chunk(valid, PUSH_PLAY_BATCH)) {
            if (!stillSameAccount(userId)) return outcome;
            const push = await pushRemoteListeningPlays(config, {
                plays: batch.map(op => syncable.get(op.sessionId as string)!),
            });
            if (!push) return outcome;
            if (push.status === 'unsupported') {
                outcome.unsupported = true;
                return outcome;
            }
            await deleteListeningSyncOutbox(batch.map(op => op.id as number));
            outcome.pushedPlays += batch.length;
        }
    }

    if (!stillSameAccount(userId)) return outcome;

    const deleteOps = mine.filter(op => op.kind === 'delete' && op.sessionId);
    if (deleteOps.length > 0) {
        const uniqueIds = Array.from(new Set(deleteOps.map(op => op.sessionId as string)));
        for (const batch of chunk(uniqueIds, PUSH_DELETE_BATCH)) {
            if (!stillSameAccount(userId)) return outcome;
            const push = await pushRemoteListeningPlays(config, { deletes: batch });
            if (!push) return outcome;
            if (push.status === 'unsupported') {
                outcome.unsupported = true;
                return outcome;
            }
            await deleteListeningSyncOutbox(
                deleteOps
                    .filter(op => batch.includes(op.sessionId as string))
                    .map(op => op.id as number),
            );
            outcome.pushedDeletes += batch.length;
        }
    }

    return outcome;
};

let inFlight: Promise<ListeningStatsSyncSummary | null> | null = null;

const runSync = async (): Promise<ListeningStatsSyncSummary | null> => {
    // 会话从 IndexedDB 水合是异步的；启动早期不能因为没读到就判定"未登录"。
    await whenSessionHydrated();
    const session = getActiveSession();
    // 兼容模式（全局 SYNC_TOKEN）没有账号数据域，服务端会 403，干脆不请求。
    if (!session) return null;
    const config = getSyncConfig();
    if (!isSyncConfigured(config)) return null;

    try {
        await seedLocalHistory(session.userId);
        const pull = await pullRemote(config, session.userId);
        const push = pull.unsupported
            ? { unsupported: true, pushedPlays: 0, pushedDeletes: 0, pushedClear: false }
            : await pushPending(config, session.userId);
        const summary: ListeningStatsSyncSummary = {
            pulledPlays: pull.pulledPlays,
            pulledDeletes: pull.pulledDeletes,
            appliedClear: pull.appliedClear,
            pushedPlays: push.pushedPlays,
            pushedDeletes: push.pushedDeletes,
            pushedClear: push.pushedClear,
            unsupported: pull.unsupported || push.unsupported,
        };
        if (!summary.unsupported
            && (summary.pulledPlays > 0 || summary.pulledDeletes > 0 || summary.pushedPlays > 0
                || summary.pushedDeletes > 0 || summary.pushedClear || summary.appliedClear)) {
            console.info('[ListeningStatsSync] Synced', summary);
        }
        return summary;
    } catch (error) {
        // 网络/服务端错误：游标只在成功页写回，outbox 只在推送成功后删除，下次自动重试。
        console.warn('[ListeningStatsSync] Sync failed', error);
        return null;
    }
};

/** 单飞：自动推送与手动同步撞在一起时共用一个请求序列。 */
export const syncListeningStats = async (): Promise<ListeningStatsSyncSummary | null> => {
    if (inFlight) return inFlight;
    inFlight = runSync().finally(() => {
        inFlight = null;
    });
    return inFlight;
};

let autoPushInitialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 本地每次写入后的 15s 防抖推送。挂在 repository 的 changed 事件上：
 * 远端应用也会触发该事件，但那时 outbox 为空，最多多一次便宜的增量拉取。
 */
export const initializeListeningStatsSync = () => {
    if (autoPushInitialized || !isBrowser()) return () => undefined;
    autoPushInitialized = true;
    const onChanged = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void syncListeningStats();
        }, AUTO_PUSH_DEBOUNCE_MS);
    };
    window.addEventListener(LISTENING_STATS_CHANGED_EVENT, onChanged);
    return () => {
        window.removeEventListener(LISTENING_STATS_CHANGED_EVENT, onChanged);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = null;
        autoPushInitialized = false;
    };
};
