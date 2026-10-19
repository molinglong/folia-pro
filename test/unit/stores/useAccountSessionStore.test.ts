import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/useAccountSessionStore.test.ts
// 老会话（早期只存了 userId + token，没有 email）的邮箱兜底：入口行与已登录卡片都靠 email，
// 缺了会让那一行空着、头像退成兜底的 F。顺序：会话里的 email → sync 配置里的非敏感元数据 →
// /account/profile（新服务端）→ /auth/me（旧服务端）。

const state = vi.hoisted(() => ({
    session: null as { userId: string; email?: string; accessToken: string; refreshToken: string } | null,
    configAccount: undefined as { userId: string; email: string } | undefined,
    profile: null as { userId: string; email: string; avatar: string | null } | null,
    identity: null as { userId: string; email: string } | null,
    stored: [] as { userId: string; email?: string }[],
}));

vi.mock('@/services/sync/syncConfig', () => ({
    getActiveSession: () => state.session,
    getSyncConfig: () => ({ account: state.configAccount }),
    saveSyncConfig: vi.fn(),
    storeSession: (session: { userId: string; email?: string }) => { state.stored.push(session); },
    whenSessionHydrated: () => Promise.resolve(),
}));

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn().mockResolvedValue(null),
    saveToCache: vi.fn().mockResolvedValue(undefined),
    removeFromCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/sync/authClient', () => ({
    AuthClientError: class AuthClientError extends Error {
        status: number;
        code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
    fetchAccountProfile: async () => {
        if (!state.profile) throw new Error('not found');
        return state.profile;
    },
    loginAccount: vi.fn(),
    logoutAccount: vi.fn(),
    registerAccount: vi.fn(),
    updateAccountProfile: vi.fn(),
    verifyAccountSession: async () => state.identity,
}));

vi.mock('@/services/sync/collectionSync', () => ({ clearCollectionSyncState: vi.fn() }));
vi.mock('@/services/sync/syncCoordinator', () => ({ syncNow: vi.fn() }));

import { useAccountSessionStore } from '@/stores/useAccountSessionStore';

const resetStore = () => {
    useAccountSessionStore.setState({
        status: 'hydrating',
        userId: null,
        email: null,
        avatar: null,
        busy: false,
        avatarBusy: false,
        errorCode: null,
        avatarErrorCode: null,
    });
};

describe('useAccountSessionStore email fallbacks', () => {
    beforeEach(() => {
        state.session = null;
        state.configAccount = undefined;
        state.profile = null;
        state.identity = null;
        state.stored = [];
        resetStore();
    });

    it('initialize fills a missing email from the sync config metadata', async () => {
        state.session = { userId: 'u1', accessToken: 'a', refreshToken: 'r' };
        state.configAccount = { userId: 'u1', email: 'someone@example.com' };
        await useAccountSessionStore.getState().initialize();
        expect(useAccountSessionStore.getState().status).toBe('signed-in');
        expect(useAccountSessionStore.getState().email).toBe('someone@example.com');
    });

    it('ignores config metadata that belongs to another user', async () => {
        state.session = { userId: 'u1', accessToken: 'a', refreshToken: 'r' };
        state.configAccount = { userId: 'u2', email: 'other@example.com' };
        state.profile = null;
        await useAccountSessionStore.getState().initialize();
        expect(useAccountSessionStore.getState().email).toBeNull();
    });

    it('refreshProfile picks up the email and writes it back into the stored session', async () => {
        state.session = { userId: 'u1', accessToken: 'a', refreshToken: 'r' };
        state.profile = { userId: 'u1', email: 'someone@example.com', avatar: 'data:image/png;base64,x' };
        await useAccountSessionStore.getState().initialize();
        await vi.waitFor(() => expect(useAccountSessionStore.getState().email).toBe('someone@example.com'));
        expect(useAccountSessionStore.getState().avatar).toBe('data:image/png;base64,x');
        expect(state.stored.at(-1)).toMatchObject({ userId: 'u1', email: 'someone@example.com' });
    });

    it('falls back to /auth/me when the profile endpoint is missing', async () => {
        state.session = { userId: 'u1', accessToken: 'a', refreshToken: 'r' };
        state.identity = { userId: 'u1', email: 'someone@example.com' };
        await useAccountSessionStore.getState().initialize();
        await vi.waitFor(() => expect(useAccountSessionStore.getState().email).toBe('someone@example.com'));
        expect(state.stored.at(-1)).toMatchObject({ userId: 'u1', email: 'someone@example.com' });
    });
});
