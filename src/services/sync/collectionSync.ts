import type { MediaId, OnlineProviderId, ProviderCollection, ProviderUser } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { loadProviderAccountSnapshot, saveProviderAccountSnapshot } from '../onlineMusic/providerAccountCache';
import { getActiveSession, getSyncConfig, isSyncConfigured } from './syncConfig';
import { getRemoteCollection, putRemoteCollection, SyncClientError } from './syncClient';
import type { SyncedCloudCollection, SyncedCloudSnapshot, SyncedCloudUser } from './syncTypes';

// src/services/sync/collectionSync.ts
// 双向对账（/collections/*）：本地快照 <-> 云端快照，LWW 以 watermark + dirty 时间戳收敛。
//
// 三个时间量：
// - watermark：本地与云端最后一次一致的时刻（pull / push 成功后写入）。
// - dirtyAt：本地最后一次"用户产生的变更"时刻（queueCollectionPush 写入）。
//   不用快照 savedAt 做脏标记，因为 pull 写缓存会刷新 savedAt，会把回声当成变更。
// - remote.updatedAt：云端快照时间戳，服务端 LWW 依据。

const COLLECTION_PUSH_DEBOUNCE_MS = 60_000;
// 与 sync-server 的 COLLECTION_PROVIDERS 对齐；Folium mod 源不在服务端白名单内。
const COLLECTION_SYNC_PROVIDERS: OnlineProviderId[] = ['netease', 'qq', 'kugou'];

const COLLECTION_WATERMARK_KEY = 'folia_collection_sync_watermark_v1';
const COLLECTION_DIRTY_KEY = 'folia_collection_sync_dirty_v1';

export type CollectionSyncOutcome = 'pushed' | 'pulled' | 'unchanged' | 'skipped';

export type CollectionSyncSummary = {
    pushed: number;
    pulled: number;
    unchanged: number;
    skipped: number;
};

type LocalCollectionSnapshot = {
    savedAt: number;
    user: ProviderUser;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
};

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readStoredMap = <T,>(key: string): Record<string, T> => {
    if (!isBrowser()) return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || '') as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed as Record<string, T>;
    } catch {
        return {};
    }
};

const writeStoredValue = <T,>(key: string, providerId: string, value: T): void => {
    if (!isBrowser()) return;
    try {
        const map = readStoredMap<T>(key);
        map[providerId] = value;
        window.localStorage.setItem(key, JSON.stringify(map));
    } catch {
        // 存储不可用只意味着多一次对账，不值得让同步失败。
    }
};

const readCollectionWatermark = (providerId: OnlineProviderId): string | null => (
    readStoredMap<string>(COLLECTION_WATERMARK_KEY)[providerId] || null
);

const writeCollectionWatermark = (providerId: OnlineProviderId, updatedAt: string): void => {
    writeStoredValue(COLLECTION_WATERMARK_KEY, providerId, updatedAt);
};

const readCollectionDirtyAt = (providerId: OnlineProviderId): number | null => {
    const value = readStoredMap<number>(COLLECTION_DIRTY_KEY)[providerId];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const writeCollectionDirtyAt = (providerId: OnlineProviderId, timestamp: number): void => {
    writeStoredValue(COLLECTION_DIRTY_KEY, providerId, timestamp);
};

const clearCollectionDirtyAt = (providerId: OnlineProviderId): void => {
    if (!isBrowser()) return;
    try {
        const map = readStoredMap<number>(COLLECTION_DIRTY_KEY);
        if (map[providerId] === undefined) return;
        delete map[providerId];
        window.localStorage.setItem(COLLECTION_DIRTY_KEY, JSON.stringify(map));
    } catch {
        // ignore
    }
};

// --- 白名单投影：绝不允许把 provider 凭证/内部字段整体上云 ---

const toCloudUser = (user: ProviderUser): SyncedCloudUser => {
    const cloudUser: SyncedCloudUser = { id: String(user.id), nickname: user.nickname || '' };
    if (typeof user.avatarUrl === 'string' && user.avatarUrl) {
        cloudUser.avatarUrl = user.avatarUrl;
    }
    return cloudUser;
};

const toCloudCollection = (collection: ProviderCollection): SyncedCloudCollection => {
    const cloudCollection: SyncedCloudCollection = {
        providerId: String(collection.providerId),
        id: String(collection.id),
        name: collection.name || '',
        type: collection.type || 'playlist',
    };
    if (typeof collection.coverUrl === 'string' && collection.coverUrl) cloudCollection.coverUrl = collection.coverUrl;
    if (typeof collection.description === 'string' && collection.description) cloudCollection.description = collection.description;
    if (typeof collection.trackCount === 'number' && Number.isFinite(collection.trackCount)) {
        cloudCollection.trackCount = Math.trunc(collection.trackCount);
    }
    if (typeof collection.isLiked === 'boolean') cloudCollection.isLiked = collection.isLiked;
    if (typeof collection.isOwned === 'boolean') cloudCollection.isOwned = collection.isOwned;
    if (typeof collection.playCount === 'number' && Number.isFinite(collection.playCount)) {
        cloudCollection.playCount = Math.trunc(collection.playCount);
    }
    return cloudCollection;
};

export const toCloudSnapshot = (snapshot: {
    user: ProviderUser;
    collections: ProviderCollection[];
    likedSongIds: MediaId[];
}): SyncedCloudSnapshot => ({
    user: toCloudUser(snapshot.user),
    collections: snapshot.collections.map(toCloudCollection),
    likedSongIds: Array.from(new Set(snapshot.likedSongIds.map(id => String(id)).filter(id => id.length > 0))),
});

// --- 云端快照还原（只构造白名单字段，其余 provider 专有字段由刷新重建）---

const fromCloudUser = (user: SyncedCloudUser): ProviderUser => ({
    id: user.id,
    nickname: user.nickname,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
});

const fromCloudCollection = (collection: SyncedCloudCollection): ProviderCollection => ({
    providerId: collection.providerId as OnlineProviderId,
    id: collection.id,
    name: collection.name,
    type: collection.type,
    ...(collection.coverUrl ? { coverUrl: collection.coverUrl } : {}),
    ...(collection.description ? { description: collection.description } : {}),
    ...(collection.trackCount !== undefined ? { trackCount: collection.trackCount } : {}),
    ...(collection.isLiked !== undefined ? { isLiked: collection.isLiked } : {}),
    ...(collection.isOwned !== undefined ? { isOwned: collection.isOwned } : {}),
    ...(collection.playCount !== undefined ? { playCount: collection.playCount } : {}),
});

const collectionKey = (collection: ProviderCollection): string => (
    `${String(collection.providerId)}:${collection.type}:${String(collection.id)}`
);

const mergeCollections = (local: ProviderCollection[], remote: ProviderCollection[]): ProviderCollection[] => {
    const seenKeys = new Set(local.map(collectionKey));
    return [...local, ...remote.filter(collection => !seenKeys.has(collectionKey(collection)))];
};

// --- 本地数据源：store（平台登录中）优先，回退 IndexedDB 快照（含匿名历史数据） ---

const readLocalCollectionSnapshot = async (providerId: OnlineProviderId): Promise<LocalCollectionSnapshot | null> => {
    const account = useOnlineProviderAccountStore.getState().accounts[providerId];
    if (account?.user) {
        return {
            savedAt: account.lastUpdatedAt ?? Date.now(),
            user: account.user,
            collections: account.collections || [],
            likedSongIds: account.likedSongIds || [],
        };
    }

    const cached = await loadProviderAccountSnapshot(providerId);
    if (!cached) return null;
    return {
        savedAt: cached.savedAt,
        user: cached.user,
        collections: cached.collections,
        likedSongIds: cached.likedSongIds,
    };
};

// --- 云端快照应用（设计文档 §5.2：只填数据，不伪造登录态） ---

const applyRemoteCollection = (providerId: OnlineProviderId, data: SyncedCloudSnapshot): void => {
    const cloudUser = fromCloudUser(data.user);
    const cloudCollections = data.collections.map(fromCloudCollection);
    const cloudLikedSongIds = [...data.likedSongIds];

    // 快照缓存永远写：netease 的点赞集合靠下次启动 hydration 从这里恢复。
    // cloudOrigin 标记让 hydration 与登录态判定知道这是云端投影，不当成本机会话。
    saveProviderAccountSnapshot(providerId, {
        user: cloudUser,
        collections: cloudCollections,
        likedSongIds: cloudLikedSongIds,
        cloudOrigin: true,
    }).catch(() => {
        // 写缓存失败不影响 store 应用，下次对账还会再写。
    });

    // netease 的点赞/歌单由 useNeteaseLibrary 本地 state 当家，单向镜像进 store；
    // 从同步侧写 store 只会造成一帧旧数据闪烁，云端数据等下次 hydration 生效。
    if (providerId === 'netease') return;

    const store = useOnlineProviderAccountStore.getState();
    const account = store.accounts[providerId];
    if (account?.status === 'authenticated' && account.user) {
        // 本地平台登录中：保留本地 user（更新鲜），歌单按 key 去重合并（本地优先），
        // 点赞集合以云端为准——只有 replace 能让"取消喜欢"跨设备传播。
        // 本机已接管，清掉云端投影标记。
        store.updateAccount(providerId, {
            collections: mergeCollections(account.collections || [], cloudCollections),
            likedSongIds: cloudLikedSongIds,
            cloudOrigin: false,
        });
        return;
    }

    // 匿名设备：整份写入供首页展示"数据已同步"。status 不动——用户扫码/登录平台账号后才算接管。
    // cloudOrigin 让登录态判定失败时保留这些数据（否则一次 refresh 就被当未登录清光）。
    store.updateAccount(providerId, {
        user: cloudUser,
        collections: cloudCollections,
        likedSongIds: cloudLikedSongIds,
        cloudOrigin: true,
    });
};

// --- 推送与对账 ---

const pushLocalCollection = async (providerId: OnlineProviderId): Promise<CollectionSyncOutcome> => {
    const config = getSyncConfig();
    const local = await readLocalCollectionSnapshot(providerId);
    if (!local) {
        clearCollectionDirtyAt(providerId);
        return 'unchanged';
    }

    const record = {
        schemaVersion: 1 as const,
        updatedAt: new Date().toISOString(),
        data: toCloudSnapshot(local),
    };
    try {
        await putRemoteCollection(config, providerId, record);
        writeCollectionWatermark(providerId, record.updatedAt);
        clearCollectionDirtyAt(providerId);
        return 'pushed';
    } catch (error) {
        if (error instanceof SyncClientError && error.status === 409) {
            // 服务端已有更新快照：以远端为准拉回合并，本地的 likes 补救交给下次对账。
            const remote = await getRemoteCollection(config, providerId);
            if (remote) {
                applyRemoteCollection(providerId, remote.data);
                writeCollectionWatermark(providerId, remote.updatedAt);
                clearCollectionDirtyAt(providerId);
                return 'pulled';
            }
            return 'unchanged';
        }
        throw error;
    }
};

const syncProviderCollection = async (providerId: OnlineProviderId): Promise<CollectionSyncOutcome> => {
    const config = getSyncConfig();
    if (!isSyncConfigured(config) || !getActiveSession()) {
        return 'skipped';
    }

    const remote = await getRemoteCollection(config, providerId);
    const local = await readLocalCollectionSnapshot(providerId);
    const watermark = readCollectionWatermark(providerId);
    const dirtyAt = readCollectionDirtyAt(providerId);
    const remoteUpdatedAtMs = remote ? Date.parse(remote.updatedAt) : null;

    if (watermark === null) {
        // 首次对账：两边都有数据时按快照时间 newer 赢（本地数据来自平台 API，可信）。
        if (local && (!remote || local.savedAt > (remoteUpdatedAtMs ?? 0))) {
            return await pushLocalCollection(providerId);
        }
        if (remote) {
            applyRemoteCollection(providerId, remote.data);
            writeCollectionWatermark(providerId, remote.updatedAt);
            clearCollectionDirtyAt(providerId);
            return 'pulled';
        }
        return 'unchanged';
    }

    const isDirty = dirtyAt !== null && dirtyAt > Date.parse(watermark);
    if (isDirty && (!remote || dirtyAt >= (remoteUpdatedAtMs ?? 0))) {
        return await pushLocalCollection(providerId);
    }
    if (remote && remote.updatedAt !== watermark) {
        // watermark 之外远端被别的设备写过：拉回合并（LWW 输的本地变更由合并策略兜底）。
        applyRemoteCollection(providerId, remote.data);
        writeCollectionWatermark(providerId, remote.updatedAt);
        clearCollectionDirtyAt(providerId);
        return 'pulled';
    }
    return 'unchanged';
};

export const syncAllCollections = async (): Promise<CollectionSyncSummary> => {
    const summary: CollectionSyncSummary = { pushed: 0, pulled: 0, unchanged: 0, skipped: 0 };
    const config = getSyncConfig();
    if (!isSyncConfigured(config) || !getActiveSession()) {
        summary.skipped = COLLECTION_SYNC_PROVIDERS.length;
        return summary;
    }

    for (const providerId of COLLECTION_SYNC_PROVIDERS) {
        try {
            const outcome = await syncProviderCollection(providerId);
            summary[outcome] += 1;
        } catch (error) {
            summary.skipped += 1;
            console.warn('[sync] Collection sync failed', {
                providerId,
                name: error instanceof Error ? error.name : 'Error',
            });
        }
    }
    return summary;
};

// --- mutation 后的 debounce 推送 ---

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

const runQueuedCollectionPush = async (providerId: OnlineProviderId): Promise<void> => {
    try {
        await pushLocalCollection(providerId);
    } catch (error) {
        // dirtyAt 保留，下次对账或手动同步会重试。
        console.warn('[sync] Queued collection push failed', {
            providerId,
            name: error instanceof Error ? error.name : 'Error',
        });
    }
};

export const queueCollectionPush = (providerId: OnlineProviderId): void => {
    const config = getSyncConfig();
    if (!isSyncConfigured(config) || !getActiveSession()) return;

    writeCollectionDirtyAt(providerId, Date.now());

    const existingTimer = pushTimers.get(providerId);
    if (existingTimer) clearTimeout(existingTimer);
    pushTimers.set(providerId, setTimeout(() => {
        pushTimers.delete(providerId);
        void runQueuedCollectionPush(providerId);
    }, COLLECTION_PUSH_DEBOUNCE_MS));
};

// 登出/切换账号时调用：watermark 记的是上一个账号数据域的对账位置，
// 带进新账号会把旧位置误当成"远端没变"。清掉后下次登录走首次对账（按快照时间 newer 赢）。
export const clearCollectionSyncState = (): void => {
    for (const timer of pushTimers.values()) clearTimeout(timer);
    pushTimers.clear();
    if (!isBrowser()) return;
    try {
        window.localStorage.removeItem(COLLECTION_WATERMARK_KEY);
        window.localStorage.removeItem(COLLECTION_DIRTY_KEY);
    } catch {
        // ignore
    }
};
