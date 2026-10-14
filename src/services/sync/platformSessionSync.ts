import type { OnlineProviderId } from '../../types/onlineMusic';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../onlineMusic/providerStorage';
import { getActiveSession, getSyncConfig, isSyncConfigured } from './syncConfig';
import { deleteRemotePlatformSession, getRemotePlatformSession, putRemotePlatformSession, SyncClientError } from './syncClient';

// src/services/sync/platformSessionSync.ts
// 平台会话键同步（/platform-sessions/*，docs/qq-shared-session-design.md B' 路线）：
// 把 qq-api 后端签发的不透明会话查找键（qqmusic_session token，非凭证本体）跨设备分发，
// 设备 A 扫码、设备 B 免扫码直接登录。凭证本体始终留在后端加密会话仓库，不上云。

// 一期只接 QQ（用户主力平台）；网易云/酷狗的会话模型不同（cookie 在后端/无后端会话），后续按需扩展。
const PLATFORM_SESSION_PROVIDERS: ReadonlySet<OnlineProviderId> = new Set(['qq']);

const SESSION_SEEN_KEY = 'folia_platform_session_seen_updated_v1';

export type PlatformSessionOutcome = 'pushed' | 'adopted' | 'unchanged' | 'skipped';

type SeenEntry = { token: string; updatedAt: string };

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readSeenMap = (): Record<string, SeenEntry> => {
    if (!isBrowser()) return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(SESSION_SEEN_KEY) || '') as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed as Record<string, SeenEntry>;
    } catch {
        return {};
    }
};

const writeSeenEntry = (providerId: OnlineProviderId, entry: SeenEntry): void => {
    if (!isBrowser()) return;
    try {
        const map = readSeenMap();
        map[providerId] = entry;
        window.localStorage.setItem(SESSION_SEEN_KEY, JSON.stringify(map));
    } catch {
        // 存储不可用只意味着多一次推送，不值得让同步失败。
    }
};

const readSeenEntry = (providerId: OnlineProviderId): SeenEntry | null => readSeenMap()[providerId] || null;

const dropSeenEntry = (providerId: OnlineProviderId): void => {
    if (!isBrowser()) return;
    try {
        const map = readSeenMap();
        delete map[providerId];
        window.localStorage.setItem(SESSION_SEEN_KEY, JSON.stringify(map));
    } catch {
        // 忽略。
    }
};

// qq-music-api 常驻形态：客户端存的是后端签发的 `qqmusic_session=<token>` 整串，
// 上云只放裸 token（查找键本体），落地时再包回整串。
const tokenFromCookieValue = (cookieValue: string): string => {
    for (const entry of cookieValue.split(';')) {
        const separator = entry.indexOf('=');
        if (separator <= 0) continue;
        if (entry.slice(0, separator).trim() === 'qqmusic_session') return entry.slice(separator + 1).trim();
    }
    return '';
};

const buildSessionCookieValue = (token: string): string => `qqmusic_session=${token}`;

/** 共享前提：sync 已登录（兼容模式全局 token 会串号，明确排除）+ 本机指向远程 qq-api 后端
 *  （token 只对签发它的后端实例有效，内嵌后端模式下推了也没用）。 */
export const isPlatformSessionSharingEnabled = (providerId: OnlineProviderId): boolean => {
    if (!PLATFORM_SESSION_PROVIDERS.has(providerId)) return false;
    if (!isSyncConfigured()) return false;
    if (!getActiveSession()) return false;
    // 远程后端判定交给 qqTransport 的配置读取，避免在 sync 层重复实现配置优先级。
    return isRemoteQqBackendConfigured();
};

// 由 qqTransport 注入（设置项/VITE 变量），sync 层不直接依赖 onlineMusic 的配置实现。
let remoteBackendProbe: (() => boolean) | null = null;
export const registerRemoteQqBackendProbe = (probe: () => boolean): void => {
    remoteBackendProbe = probe;
};
const isRemoteQqBackendConfigured = (): boolean => (remoteBackendProbe ? remoteBackendProbe() : false);

// 云端 token 落地本机后的重查通知：hook 侧（useQqLibrary）注册，复用现成的 checkLoginStatus。
type AdoptedListener = (providerId: OnlineProviderId) => void;
const adoptedListeners = new Set<AdoptedListener>();
export const onPlatformSessionAdopted = (listener: AdoptedListener): (() => void) => {
    adoptedListeners.add(listener);
    return () => adoptedListeners.delete(listener);
};
const notifyAdopted = (providerId: OnlineProviderId): void => {
    adoptedListeners.forEach(listener => {
        try {
            listener(providerId);
        } catch {
            // 单个监听者失败不影响其他订阅者。
        }
    });
};

/** 扫码确认成功后调用：把本机新 token 推上云（LWW，最新扫码者胜）。 */
export const queuePlatformSessionPush = async (providerId: OnlineProviderId): Promise<void> => {
    if (!isPlatformSessionSharingEnabled(providerId)) return;
    const cookieValue = readProviderSessionValue(providerId, 'cookie');
    const token = cookieValue ? tokenFromCookieValue(cookieValue) : '';
    if (!token) return;

    const config = getSyncConfig();
    if (!config) return;
    const updatedAt = new Date().toISOString();
    try {
        await putRemotePlatformSession(config, providerId, { schemaVersion: 1, updatedAt, token });
        writeSeenEntry(providerId, { token, updatedAt });
        console.info('[PlatformSessionSync] pushed', { providerId });
    } catch (error) {
        // 409 = 云端有更新的扫码，本机 token 已被取代：下次对账会 pull 回来。
        if (error instanceof SyncClientError && error.status === 409) {
            console.info('[PlatformSessionSync] push superseded by newer scan', { providerId });
            return;
        }
        console.warn('[PlatformSessionSync] push failed', { providerId, error });
    }
};

/** 登出时调用：删云端 token（条件删除防竞态），本机 token 由调用方的登出链路清理。 */
export const clearRemotePlatformSession = async (providerId: OnlineProviderId): Promise<void> => {
    if (!PLATFORM_SESSION_PROVIDERS.has(providerId)) return;
    const config = getSyncConfig();
    if (!config || !getActiveSession()) return;

    const seen = readSeenEntry(providerId);
    try {
        const result = await deleteRemotePlatformSession(config, providerId, { ifUpdatedAt: seen?.updatedAt });
        if (result.ok) {
            dropSeenEntry(providerId);
            console.info('[PlatformSessionSync] remote session cleared', { providerId });
        } else {
            // 云端已被别的设备更新/删除：不再坚持删除，让下一次对账按 LWW 收敛。
            console.info('[PlatformSessionSync] remote clear superseded', { providerId });
        }
    } catch (error) {
        console.warn('[PlatformSessionSync] remote clear failed', { providerId, error });
    }
};

/** syncNow 周期对账：本地 token 优先推送；本机无 token 时领养云端 token 并通知重查。 */
export const syncPlatformSessions = async (providerId: OnlineProviderId): Promise<PlatformSessionOutcome> => {
    if (!isPlatformSessionSharingEnabled(providerId)) return 'skipped';
    const config = getSyncConfig();
    if (!config) return 'skipped';

    const localCookie = readProviderSessionValue(providerId, 'cookie');
    const localToken = localCookie ? tokenFromCookieValue(localCookie) : '';
    const seen = readSeenEntry(providerId);

    // 本机有 token：与 seen 记录比对，变了才推（避免每次 syncNow 都打一次 PUT）。
    if (localToken) {
        if (seen && seen.token === localToken) return 'unchanged';
        const updatedAt = new Date().toISOString();
        try {
            await putRemotePlatformSession(config, providerId, { schemaVersion: 1, updatedAt, token: localToken });
            writeSeenEntry(providerId, { token: localToken, updatedAt });
            console.info('[PlatformSessionSync] pushed (reconcile)', { providerId });
            return 'pushed';
        } catch (error) {
            if (error instanceof SyncClientError && error.status === 409) {
                // 云端已有更新的扫码：本机旧 token 会被下一次 pull 取代，这里直接落败。
                console.info('[PlatformSessionSync] reconcile push superseded', { providerId });
            } else {
                console.warn('[PlatformSessionSync] reconcile push failed', { providerId, error });
            }
            return 'skipped';
        }
    }

    // 本机无 token：领养云端 token（有的话）。
    try {
        const remote = await getRemotePlatformSession(config, providerId);
        if (!remote) {
            // 云端也没有：如果之前领养过又被云端删了（他机登出），清掉本地残留。
            if (seen) {
                removeProviderSessionValue(providerId, 'cookie');
                dropSeenEntry(providerId);
                console.info('[PlatformSessionSync] remote vanished, local residue cleared', { providerId });
            }
            return 'unchanged';
        }
        if (seen && seen.updatedAt === remote.updatedAt) return 'unchanged';

        writeProviderSessionValue(providerId, 'cookie', buildSessionCookieValue(remote.token));
        writeSeenEntry(providerId, { token: remote.token, updatedAt: remote.updatedAt });
        console.info('[PlatformSessionSync] adopted remote session', { providerId, updatedAt: remote.updatedAt });
        notifyAdopted(providerId);
        return 'adopted';
    } catch (error) {
        // 旧服务端（schema ≤ 2）404 已在 client 层转 null；这里只处理网络/鉴权类失败。
        console.warn('[PlatformSessionSync] reconcile pull failed', { providerId, error });
        return 'skipped';
    }
};
