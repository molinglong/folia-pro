import {
    clearStoredSession,
    getActiveSession,
    getSyncConfig,
    saveSyncConfig,
    storeSession,
} from './syncConfig';
import type { SyncAccountSession } from './syncTypes';

// src/services/sync/authClient.ts
// Account auth against the Folia sync server (POST /auth/*). Deliberately standalone —
// it must never import syncClient (which imports this file for the refresh single-flight).

export class AuthClientError extends Error {
    status: number;
    code: string;

    constructor(message: string, status: number, code: string) {
        super(message);
        this.name = 'AuthClientError';
        this.status = status;
        this.code = code;
    }
}

type AuthSessionResponse = {
    ok: boolean;
    userId: string;
    email: string;
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
};

type AuthErrorBody = { ok?: boolean; error?: string };

const parseAuthError = async (response: Response): Promise<AuthClientError> => {
    const body = await response.json().catch(() => null) as AuthErrorBody | null;
    return new AuthClientError(
        body?.error || `Auth request failed: ${response.status}`,
        response.status,
        body?.error || 'auth_failed',
    );
};

const requestAuth = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const config = getSyncConfig();
    const baseUrl = config.workerBaseUrl.replace(/\/+$/, '');
    if (!baseUrl) {
        throw new AuthClientError('Sync server URL is not configured', 0, 'not_configured');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
    });
    if (!response.ok) {
        throw await parseAuthError(response);
    }
    return await response.json() as T;
};

const toSession = (body: AuthSessionResponse): SyncAccountSession => ({
    userId: body.userId,
    email: body.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessExpiresAt: body.accessExpiresAt,
    refreshExpiresAt: body.refreshExpiresAt,
});

export const registerAccount = async (email: string, password: string): Promise<SyncAccountSession> => {
    const session = toSession(await requestAuth<AuthSessionResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    }));
    adoptSession(session);
    return session;
};

export const loginAccount = async (email: string, password: string): Promise<SyncAccountSession> => {
    const session = toSession(await requestAuth<AuthSessionResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    }));
    adoptSession(session);
    return session;
};

export const logoutAccount = async (): Promise<void> => {
    const session = getActiveSession();
    clearStoredSession();
    // config 里的账号元数据一并清掉，UI 不再显示已登录状态。
    saveSyncConfig({ ...getSyncConfig(), account: undefined });
    if (!session) return;
    // 服务端删除会话尽力而为；本地登出永远成功。
    try {
        await requestAuth('/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
    } catch {
        // ignore
    }
};

export const verifyAccountSession = async (): Promise<{ userId: string; email: string } | null> => {
    const session = getActiveSession();
    if (!session) return null;
    try {
        return await requestAuth<{ userId: string; email: string }>('/auth/me', {
            headers: { Authorization: `Bearer ${session.accessToken}` },
        });
    } catch {
        return null;
    }
};

// 把会话写入存储，并让账号元数据进入 sync 配置（触发 config 订阅者刷新 UI）。
const adoptSession = (session: SyncAccountSession) => {
    storeSession(session);
    saveSyncConfig({
        ...getSyncConfig(),
        account: { userId: session.userId, email: session.email },
    });
};

// --- 刷新单飞 ---
// refresh 是旋转式的：旧 refreshToken 用一次即作废。并发 401 必须共享同一次刷新，
// 否则第二个请求会拿着已被旋转掉的 token 把整个会话弄失效。

let refreshInFlight: Promise<SyncAccountSession | null> | null = null;

export const refreshSession = (): Promise<SyncAccountSession | null> => {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        const session = getActiveSession();
        if (!session) return null;
        try {
            const body = await requestAuth<AuthSessionResponse>('/auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken: session.refreshToken }),
            });
            const nextSession = toSession(body);
            storeSession(nextSession);
            return nextSession;
        } catch (error) {
            // 刷新令牌失效/过期：清掉本地会话，等用户重新登录。
            if (error instanceof AuthClientError && (error.status === 401 || error.status === 400)) {
                clearStoredSession();
            }
            return null;
        } finally {
            refreshInFlight = null;
        }
    })();
    return refreshInFlight;
};

export const shouldRefreshSession = (session: SyncAccountSession): boolean => {
    const expiresAt = Date.parse(session.accessExpiresAt);
    return Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000;
};

// 供 syncClient 判断服务端是否支持账号（旧服务端 /auth/* 会 404）。
export const isAuthErrorNotFound = (error: unknown): boolean => (
    error instanceof AuthClientError && (error.status === 404 || error.status === 0)
);
