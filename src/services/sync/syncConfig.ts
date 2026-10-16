import { getFromCache, removeFromCache, saveToCache } from '../db';
import { SYNC_PROVIDER, type SyncAccountSession, type SyncProviderConfig, type SyncRuntimeStatus } from './syncTypes';

// src/services/sync/syncConfig.ts
// Local persistence for user-owned sync server settings and runtime status.

const SYNC_CONFIG_STORAGE_KEY = 'folia_sync_config_v1';
const SYNC_STATUS_STORAGE_KEY = 'folia_sync_status_v1';
const SYNC_CONFIG_EVENT = 'folia-sync-config-changed';
const SYNC_STATUS_EVENT = 'folia-sync-status-changed';

const DEFAULT_CONFIG: SyncProviderConfig = {
    provider: SYNC_PROVIDER,
    enabled: false,
    workerBaseUrl: '',
    authToken: '',
};

// 内置默认同步服务器：登录与同步开箱即用，不再要求先手填地址；用户显式配置始终优先。
export const DEFAULT_SYNC_SERVER_URL = 'https://music.yuban.icu/sync';

const DEFAULT_STATUS: SyncRuntimeStatus = {
    state: 'idle',
    lastSyncAt: null,
    lastError: null,
};

const isBrowser = () => typeof window !== 'undefined';

const readJson = <T,>(key: string, fallback: T): T => {
    if (!isBrowser()) {
        return fallback;
    }

    const stored = window.localStorage.getItem(key);
    if (!stored) {
        return fallback;
    }

    try {
        return JSON.parse(stored) as T;
    } catch {
        return fallback;
    }
};

const emitEvent = (eventName: string) => {
    if (isBrowser()) {
        window.dispatchEvent(new Event(eventName));
    }
};

export const getSyncConfig = (): SyncProviderConfig => {
    const stored = readJson<Partial<SyncProviderConfig>>(SYNC_CONFIG_STORAGE_KEY, {});
    const account = stored.account
        && typeof stored.account === 'object'
        && typeof (stored.account as { userId?: unknown }).userId === 'string'
        && typeof (stored.account as { email?: unknown }).email === 'string'
        ? stored.account
        : undefined;
    return {
        ...DEFAULT_CONFIG,
        ...stored,
        provider: SYNC_PROVIDER,
        workerBaseUrl: (typeof stored.workerBaseUrl === 'string' && stored.workerBaseUrl.trim())
            ? stored.workerBaseUrl.trim()
            : DEFAULT_SYNC_SERVER_URL,
        authToken: typeof stored.authToken === 'string' ? stored.authToken.trim() : '',
        enabled: Boolean(stored.enabled),
        account,
    };
};

export const saveSyncConfig = (config: SyncProviderConfig) => {
    if (!isBrowser()) {
        return;
    }

    window.localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify({
        provider: SYNC_PROVIDER,
        enabled: config.enabled,
        workerBaseUrl: config.workerBaseUrl.trim().replace(/\/+$/, ''),
        authToken: config.authToken.trim(),
        account: config.account ?? null,
    }));
    emitEvent(SYNC_CONFIG_EVENT);
};

// --- 账号会话存储 ---
// token 本体只进 IndexedDB（避免 XSS 直接可读 localStorage）；localStorage 只存非敏感的
// userId/email 供 UI 展示。内存里持有一份，让同步流程能同步地判断"是否已配置"。

const SESSION_CACHE_KEY = 'folia_sync_session_v1';

let memorySession: SyncAccountSession | null = null;
let sessionHydrated: Promise<void> | null = null;

const hydrateSession = async (): Promise<void> => {
    const stored = await getFromCache<SyncAccountSession>(SESSION_CACHE_KEY);
    if (stored && typeof stored.accessToken === 'string' && typeof stored.refreshToken === 'string') {
        memorySession = stored;
    }
};

export const whenSessionHydrated = (): Promise<void> => {
    if (!sessionHydrated) {
        sessionHydrated = isBrowser()
            ? hydrateSession().catch(() => undefined)
            : Promise.resolve();
    }
    return sessionHydrated;
};

// 模块加载即开始水合，启动早期的请求不至于总是错过会话。
void whenSessionHydrated();

export const getActiveSession = (): SyncAccountSession | null => memorySession;

export const storeSession = (session: SyncAccountSession) => {
    memorySession = session;
    void saveToCache(SESSION_CACHE_KEY, session);
};

export const clearStoredSession = () => {
    memorySession = null;
    void removeFromCache(SESSION_CACHE_KEY);
};

export const isSyncConfigured = (config = getSyncConfig()) => (
    config.enabled && Boolean(config.workerBaseUrl) && Boolean(config.authToken || memorySession)
);

export const getSyncStatus = (): SyncRuntimeStatus => readJson(SYNC_STATUS_STORAGE_KEY, DEFAULT_STATUS);

export const setSyncStatus = (patch: Partial<SyncRuntimeStatus>) => {
    if (!isBrowser()) {
        return;
    }

    const next = {
        ...getSyncStatus(),
        ...patch,
    };
    window.localStorage.setItem(SYNC_STATUS_STORAGE_KEY, JSON.stringify(next));
    emitEvent(SYNC_STATUS_EVENT);
};

export const subscribeSyncConfig = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_CONFIG_EVENT, listener);
    return () => window.removeEventListener(SYNC_CONFIG_EVENT, listener);
};

export const subscribeSyncStatus = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_STATUS_EVENT, listener);
    return () => window.removeEventListener(SYNC_STATUS_EVENT, listener);
};
