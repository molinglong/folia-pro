import type { ListeningPlayRecord } from '../../types/listeningStats';
import type {
    SyncProviderConfig,
    SyncRemoteState,
    SyncThemeManifest,
    SyncedCollectionRecord,
    SyncedListeningPull,
    SyncedListeningPushResult,
    SyncedPlatformSessionRecord,
    SyncedSettingsRecord,
    SyncedThemeRecord,
    WorkerHealthResponse,
} from './syncTypes';
import { LISTENING_SYNC_SCHEMA_VERSION } from './syncTypes';
import {
    parseSyncCollectionRecord,
    parseSyncPlatformSessionRecord,
    parseSyncRemoteState,
    parseSyncThemeManifest,
    parseSyncedListeningPull,
    parseSyncedListeningPushResult,
    parseSyncedSettingsRecord,
    parseSyncedThemeRecords,
} from './syncSchema';
import { getActiveSession, whenSessionHydrated } from './syncConfig';
import { refreshSession, shouldRefreshSession } from './authClient';

// src/services/sync/syncClient.ts
// HTTP adapter for Folia's user-hosted sync API.

export class SyncClientError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'SyncClientError';
        this.status = status;
    }
}

export type ThemeListPage = {
    themes: SyncedThemeRecord[];
    cursor: string | null;
};

const buildUrl = (config: SyncProviderConfig, path: string) => (
    `${config.workerBaseUrl.replace(/\/+$/, '')}${path}`
);

// 鉴权优先级：登录会话 → 兼容模式全局 SYNC_TOKEN。未水合完先等一下，避免启动竞态。
const resolveBearerToken = async (config: SyncProviderConfig): Promise<string | null> => {
    await whenSessionHydrated();
    const session = getActiveSession();
    if (session) {
        if (shouldRefreshSession(session)) {
            const refreshed = await refreshSession();
            if (refreshed) return refreshed.accessToken;
        }
        return session.accessToken;
    }
    return config.authToken || null;
};

const requestJson = async <T,>(
    config: SyncProviderConfig,
    path: string,
    init: RequestInit = {},
): Promise<T> => {
    const bearerToken = await resolveBearerToken(config);
    const response = await fetch(buildUrl(config, path), {
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
    });

    // 会话 access token 意外失效（时钟偏差/服务端重启）：刷新一次再重试。
    // 刷新在 authClient 内单飞，重试只做一次，避免循环。
    if (response.status === 401 && getActiveSession()) {
        const refreshed = await refreshSession();
        if (refreshed) {
            const retryResponse = await fetch(buildUrl(config, path), {
                ...init,
                headers: {
                    Accept: 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    Authorization: `Bearer ${refreshed.accessToken}`,
                },
            });
            if (retryResponse.ok) {
                return await parseResponse<T>(retryResponse);
            }
        }
    }

    if (!response.ok) {
        throw new SyncClientError(`Sync request failed: ${response.status}`, response.status);
    }

    return await parseResponse<T>(response);
};

const parseResponse = async <T,>(response: Response): Promise<T> => {
    if (response.status === 204) {
        return null as T;
    }
    return await response.json() as T;
};

export const testSyncConnection = async (config: SyncProviderConfig) => (
    await requestJson<WorkerHealthResponse>(config, '/health')
);

export const getRemoteState = async (config: SyncProviderConfig): Promise<SyncRemoteState | null> => (
    parseSyncRemoteState(await requestJson(config, '/state'))
);

export const getRemoteThemeManifest = async (config: SyncProviderConfig): Promise<SyncThemeManifest | null> => (
    parseSyncThemeManifest(await requestJson(config, '/themes/manifest'))
);

export const getRemoteSettings = async (config: SyncProviderConfig): Promise<SyncedSettingsRecord | null> => (
    parseSyncedSettingsRecord(await requestJson(config, '/settings'))
);

export const putRemoteSettings = async (config: SyncProviderConfig, record: SyncedSettingsRecord) => {
    await requestJson(config, '/settings', {
        method: 'PUT',
        body: JSON.stringify(record),
    });
};

export const getRemoteThemes = async (
    config: SyncProviderConfig,
    fingerprints: string[],
): Promise<SyncedThemeRecord[]> => {
    const uniqueFingerprints = Array.from(new Set(fingerprints.filter(Boolean)));
    if (uniqueFingerprints.length === 0) {
        return [];
    }

    const response = await requestJson<{ themes?: unknown[] }>(config, '/themes/get', {
        method: 'POST',
        body: JSON.stringify({ fingerprints: uniqueFingerprints }),
    });

    return parseSyncedThemeRecords(response.themes ?? []);
};

export const putRemoteThemes = async (
    config: SyncProviderConfig,
    themes: SyncedThemeRecord[],
) => {
    if (themes.length === 0) {
        return;
    }

    await requestJson(config, '/themes/put', {
        method: 'POST',
        body: JSON.stringify({ themes }),
    });
};

// 服务端无数据时回 200 + null；旧服务端没有该路由时是 404，同样按"无远端数据"处理。
export const getRemoteCollection = async (
    config: SyncProviderConfig,
    providerId: string,
): Promise<SyncedCollectionRecord | null> => {
    try {
        return parseSyncCollectionRecord(await requestJson(config, `/collections/${providerId}`));
    } catch (error) {
        if (error instanceof SyncClientError && error.status === 404) {
            return null;
        }
        throw error;
    }
};

export const putRemoteCollection = async (
    config: SyncProviderConfig,
    providerId: string,
    record: SyncedCollectionRecord,
) => {
    await requestJson(config, `/collections/${providerId}`, {
        method: 'PUT',
        body: JSON.stringify(record),
    });
};

// 旧服务端（schema ≤ 2）无该路由回 404，与"无远端数据"同义，静默降级为 null。
export const getRemotePlatformSession = async (
    config: SyncProviderConfig,
    providerId: string,
): Promise<SyncedPlatformSessionRecord | null> => {
    try {
        return parseSyncPlatformSessionRecord(await requestJson(config, `/platform-sessions/${providerId}`));
    } catch (error) {
        if (error instanceof SyncClientError && (error.status === 404 || error.status === 400)) {
            return null;
        }
        throw error;
    }
};

export const putRemotePlatformSession = async (
    config: SyncProviderConfig,
    providerId: string,
    record: SyncedPlatformSessionRecord,
) => {
    await requestJson(config, `/platform-sessions/${providerId}`, {
        method: 'PUT',
        body: JSON.stringify(record),
    });
};

/** 返回 stale 时的服务端 updatedAt（409 语义），供调用方决定是否重试或放弃。 */
export const deleteRemotePlatformSession = async (
    config: SyncProviderConfig,
    providerId: string,
    options: { ifUpdatedAt?: string } = {},
): Promise<{ ok: true } | { ok: false; staleUpdatedAt: string | null }> => {
    const query = options.ifUpdatedAt ? `?ifUpdatedAt=${encodeURIComponent(options.ifUpdatedAt)}` : '';
    try {
        await requestJson(config, `/platform-sessions/${providerId}${query}`, { method: 'DELETE' });
        return { ok: true };
    } catch (error) {
        if (error instanceof SyncClientError && error.status === 409) {
            return { ok: false, staleUpdatedAt: null };
        }
        if (error instanceof SyncClientError && (error.status === 404 || error.status === 400)) {
            // 旧服务端没有该路由：登出目标已达成，按成功处理。
            return { ok: true };
        }
        throw error;
    }
};

export const getRemoteThemesByBuckets = async (
    config: SyncProviderConfig,
    bucketIds: number[],
): Promise<SyncedThemeRecord[]> => {
    const ids = Array.from(new Set(bucketIds.filter(Number.isInteger)));
    if (ids.length === 0) {
        return [];
    }

    const response = await requestJson<{ themes?: unknown[] }>(config, '/themes/bucket', {
        method: 'POST',
        body: JSON.stringify({ bucketIds: ids }),
    });

    return parseSyncedThemeRecords(response.themes ?? []);
};

export const listRemoteThemes = async (
    config: SyncProviderConfig,
    options: { cursor?: string | null; limit?: number } = {},
): Promise<ThemeListPage> => {
    const response = await requestJson<{ themes?: unknown[]; cursor?: unknown }>(config, '/themes/list', {
        method: 'POST',
        body: JSON.stringify({
            cursor: options.cursor ?? null,
            limit: options.limit ?? 500,
        }),
    });

    return {
        themes: parseSyncedThemeRecords(response.themes ?? []),
        cursor: typeof response.cursor === 'string' && response.cursor ? response.cursor : null,
    };
};

// --- 听歌记录云同步（/listening-plays）---

export type ListeningPushPayload = {
    plays?: ListeningPlayRecord[];
    deletes?: string[];
    /** 必须单独成批：语义是"那一刻之前的记录全不要"，混入新增会让顺序含糊。 */
    clear?: { clearedAt: number };
};

export type ListeningPushOutcome =
    | { status: 'ok'; result: SyncedListeningPushResult }
    | { status: 'unsupported' };

/** 旧服务端没有该路由（404）、兼容模式没有账号（403）：都按"不支持听歌同步"降级为 null。 */
export const getRemoteListeningPlays = async (
    config: SyncProviderConfig,
    options: { since: number; limit?: number },
): Promise<SyncedListeningPull | null> => {
    const since = Math.max(0, Math.trunc(options.since));
    const limit = Math.min(1_000, Math.max(1, Math.trunc(options.limit ?? 500)));
    try {
        return parseSyncedListeningPull(
            await requestJson(config, `/listening-plays?since=${since}&limit=${limit}`),
        );
    } catch (error) {
        if (error instanceof SyncClientError && (error.status === 404 || error.status === 403 || error.status === 400)) {
            return null;
        }
        throw error;
    }
};

export const pushRemoteListeningPlays = async (
    config: SyncProviderConfig,
    payload: ListeningPushPayload,
): Promise<ListeningPushOutcome | null> => {
    try {
        const parsed = parseSyncedListeningPushResult(
            await requestJson(config, '/listening-plays', {
                method: 'POST',
                body: JSON.stringify({ schemaVersion: LISTENING_SYNC_SCHEMA_VERSION, ...payload }),
            }),
        );
        // 应答不是可以识别的格式：保留 outbox，下次再试，不把待推送数据丢掉。
        return parsed ? { status: 'ok', result: parsed } : null;
    } catch (error) {
        if (error instanceof SyncClientError && (error.status === 404 || error.status === 403)) {
            return { status: 'unsupported' };
        }
        throw error;
    }
};
