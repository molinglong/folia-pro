import { create } from 'zustand';
import {
    AuthClientError,
    fetchAccountProfile,
    loginAccount,
    logoutAccount,
    registerAccount,
    updateAccountProfile,
    verifyAccountSession,
} from '../services/sync/authClient';
import { clearCollectionSyncState } from '../services/sync/collectionSync';
import { getFromCache, removeFromCache, saveToCache } from '../services/db';
import { getActiveSession, getSyncConfig, saveSyncConfig, storeSession, whenSessionHydrated } from '../services/sync/syncConfig';
import { syncNow } from '../services/sync/syncCoordinator';

// src/stores/useAccountSessionStore.ts
// Folia 账号（sync-server 会话）的 UI 登录态。token 本体不进 store——
// 存取走 syncConfig（IndexedDB），这里只持有非敏感的 userId/email 供展示。
// 头像（data URL）是从 /account/profile 拉下来的账号资料，本地再缓存一份，刷新页面先亮缓存。

export type AccountSessionStatus = 'hydrating' | 'signed-in' | 'signed-out';

/** 头像本地缓存：只认当前 userId，换账号不串脸。 */
const PROFILE_CACHE_KEY = 'folia_account_profile_v1';

type CachedAccountProfile = {
    userId: string;
    avatar: string | null;
};

type AccountSessionStore = {
    status: AccountSessionStatus;
    userId: string | null;
    email: string | null;
    /** 账号头像（data URL）；未设置或旧服务端没有资料接口时为 null，界面退回首字母占位。 */
    avatar: string | null;
    /** 登录/注册/登出请求进行中。 */
    busy: boolean;
    /** 头像上传请求进行中（与登录 busy 分开，登出按钮不被头像拖住）。 */
    avatarBusy: boolean;
    /** 最近一次失败的服务端错误码（AuthClientError.code），供 i18n 映射。 */
    errorCode: string | null;
    /** 最近一次头像更新失败的错误码。 */
    avatarErrorCode: string | null;
    initialize: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<boolean>;
    signUp: (email: string, password: string) => Promise<boolean>;
    signOut: () => Promise<void>;
    /** 从服务端拉一次账号资料（头像）。失败静默：旧服务端没有这个接口，不能影响登录态。 */
    refreshProfile: () => Promise<void>;
    /** 更新头像；null 表示移除、退回首字母占位。 */
    updateAvatar: (avatar: string | null) => Promise<boolean>;
    clearError: () => void;
    clearAvatarError: () => void;
};

const toAuthErrorCode = (error: unknown): string => (
    error instanceof AuthClientError ? error.code : 'network_error'
);

// 登录成功后：先把云同步开关打开（新设备不再要求去存储区手动开启），再做一次全量同步——
// 云端设置/主题/收藏都拉下来，本地没推过的变更也补上去。
const syncAfterAdoptingSession = (): void => {
    saveSyncConfig({ ...getSyncConfig(), enabled: true });
    void syncNow({ syncThemes: true, applyRemoteSettings: true, pushSettings: true });
};

export const useAccountSessionStore = create<AccountSessionStore>((set, get) => ({
    status: 'hydrating',
    userId: null,
    email: null,
    avatar: null,
    busy: false,
    avatarBusy: false,
    errorCode: null,
    avatarErrorCode: null,

    initialize: async () => {
        await whenSessionHydrated();
        const session = getActiveSession();
        if (!session) {
            set({ status: 'signed-out', userId: null, email: null, avatar: null });
            return;
        }
        // 本地有会话就算登录态；token 是否仍然有效由 syncClient 的 401 自动刷新兜底，
        // 网络断开不能把用户登出。
        // 早期存的会话可能没带邮箱（当时只用 userId + token 同步）：先看 sync 配置里那份非敏感元数据，
        // 否则入口行与已登录卡片的邮箱那一行是空的（头像也会退成兜底的 F）。
        const accountMeta = getSyncConfig().account;
        const fallbackEmail = accountMeta && accountMeta.userId === session.userId ? accountMeta.email : null;
        set({ status: 'signed-in', userId: session.userId, email: session.email || fallbackEmail || null });
        // 头像缓存先顶上（刷新页面不闪一下首字母），再向服务端要最近一份。
        const cached = await getFromCache<CachedAccountProfile>(PROFILE_CACHE_KEY);
        if (cached?.userId === session.userId && get().userId === session.userId) {
            set({ avatar: typeof cached.avatar === 'string' ? cached.avatar : null });
        }
        void get().refreshProfile();
    },

    signIn: async (email, password) => {
        set({ busy: true, errorCode: null });
        try {
            const session = await loginAccount(email.trim().toLowerCase(), password);
            set({ status: 'signed-in', userId: session.userId, email: session.email, busy: false });
            syncAfterAdoptingSession();
            void get().refreshProfile();
            return true;
        } catch (error) {
            set({ busy: false, errorCode: toAuthErrorCode(error) });
            return false;
        }
    },

    signUp: async (email, password) => {
        set({ busy: true, errorCode: null });
        try {
            const session = await registerAccount(email.trim().toLowerCase(), password);
            set({ status: 'signed-in', userId: session.userId, email: session.email, busy: false });
            syncAfterAdoptingSession();
            void get().refreshProfile();
            return true;
        } catch (error) {
            set({ busy: false, errorCode: toAuthErrorCode(error) });
            return false;
        }
    },

    signOut: async () => {
        set({ busy: true });
        try {
            await logoutAccount();
        } finally {
            // watermark/dirty 属于上一个账号的数据域，登出必须清空；
            // 重新登录后走首次对账（按快照时间 newer 赢）。
            clearCollectionSyncState();
            void removeFromCache(PROFILE_CACHE_KEY);
            set({
                status: 'signed-out',
                userId: null,
                email: null,
                avatar: null,
                busy: false,
                avatarBusy: false,
                avatarErrorCode: null,
            });
        }
    },

    refreshProfile: async () => {
        if (get().status !== 'signed-in') return;
        try {
            const profile = await fetchAccountProfile();
            // 请求期间换了账号：这一份不能写给新账号。
            if (get().userId !== profile.userId) return;
            set({ avatar: profile.avatar, ...(profile.email ? { email: profile.email } : {}) });
            void saveToCache(PROFILE_CACHE_KEY, { userId: profile.userId, avatar: profile.avatar });
            // 老会话缺邮箱：把服务端这份写回会话，下次启动直接就有。
            const session = getActiveSession();
            if (session && profile.email && session.email !== profile.email) {
                storeSession({ ...session, email: profile.email });
            }
        } catch {
            // 旧服务端没有 /account/profile（404）或此刻断网：保持现状（缓存头像 / 首字母占位）。
            // 邮箱还空着的话至少从 /auth/me 补回来——入口行与卡片都靠它显示。
            if (get().email) return;
            const identity = await verifyAccountSession();
            if (!identity || get().userId !== identity.userId) return;
            set({ email: identity.email });
            const session = getActiveSession();
            if (session) storeSession({ ...session, email: identity.email });
        }
    },

    updateAvatar: async avatar => {
        if (get().status !== 'signed-in' || get().avatarBusy) return false;
        set({ avatarBusy: true, avatarErrorCode: null });
        try {
            const profile = await updateAccountProfile({ avatar });
            if (get().userId !== profile.userId) {
                set({ avatarBusy: false });
                return false;
            }
            set({ avatar: profile.avatar, avatarBusy: false });
            void saveToCache(PROFILE_CACHE_KEY, { userId: profile.userId, avatar: profile.avatar });
            return true;
        } catch (error) {
            set({ avatarBusy: false, avatarErrorCode: toAuthErrorCode(error) });
            return false;
        }
    },

    clearError: () => set({ errorCode: null }),
    clearAvatarError: () => set({ avatarErrorCode: null }),
}));
