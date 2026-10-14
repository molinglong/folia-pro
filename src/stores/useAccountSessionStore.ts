import { create } from 'zustand';
import { AuthClientError, loginAccount, logoutAccount, registerAccount } from '../services/sync/authClient';
import { clearCollectionSyncState } from '../services/sync/collectionSync';
import { getActiveSession, whenSessionHydrated } from '../services/sync/syncConfig';
import { syncNow } from '../services/sync/syncCoordinator';

// src/stores/useAccountSessionStore.ts
// Folia 账号（sync-server 会话）的 UI 登录态。token 本体不进 store——
// 存取走 syncConfig（IndexedDB），这里只持有非敏感的 userId/email 供展示。

export type AccountSessionStatus = 'hydrating' | 'signed-in' | 'signed-out';

type AccountSessionStore = {
    status: AccountSessionStatus;
    userId: string | null;
    email: string | null;
    /** 登录/注册/登出请求进行中。 */
    busy: boolean;
    /** 最近一次失败的服务端错误码（AuthClientError.code），供 i18n 映射。 */
    errorCode: string | null;
    initialize: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<boolean>;
    signUp: (email: string, password: string) => Promise<boolean>;
    signOut: () => Promise<void>;
    clearError: () => void;
};

const toAuthErrorCode = (error: unknown): string => (
    error instanceof AuthClientError ? error.code : 'network_error'
);

// 登录成功后立即做一次全量同步：云端设置/主题/收藏都拉下来，本地没推过的变更也补上去。
const syncAfterAdoptingSession = (): void => {
    void syncNow({ syncThemes: true, applyRemoteSettings: true, pushSettings: true });
};

export const useAccountSessionStore = create<AccountSessionStore>(set => ({
    status: 'hydrating',
    userId: null,
    email: null,
    busy: false,
    errorCode: null,

    initialize: async () => {
        await whenSessionHydrated();
        const session = getActiveSession();
        if (!session) {
            set({ status: 'signed-out', userId: null, email: null });
            return;
        }
        // 本地有会话就算登录态；token 是否仍然有效由 syncClient 的 401 自动刷新兜底，
        // 网络断开不能把用户登出。
        set({ status: 'signed-in', userId: session.userId, email: session.email });
    },

    signIn: async (email, password) => {
        set({ busy: true, errorCode: null });
        try {
            const session = await loginAccount(email.trim().toLowerCase(), password);
            set({ status: 'signed-in', userId: session.userId, email: session.email, busy: false });
            syncAfterAdoptingSession();
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
            set({ status: 'signed-out', userId: null, email: null, busy: false });
        }
    },

    clearError: () => set({ errorCode: null }),
}));
