// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/player-panel/accountTabLogout.test.ts
// 面板账户页（AccountTab）已不再提供平台登出按钮：登出统一走首页切换器与 TUI 账号列表
// （与 AccountTab 同一条 controller.logout 路径）。本文件锁住这个现状，防止登出入口无意回流：
// 账号页只做用户展示、音质与云同步账号卡。
// 历史背景：A4 遗留① 曾要求登出按钮跟 controller 判定走（水合窗口内不可用），该交互随按钮一起移除。

vi.hoisted(() => {
    // jsdom 环境下 node 自带的 localStorage 占位没有 getItem，i18n 初始化会直接抛。
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
});

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AccountTab from '@/components/panelTab/AccountTab';
import type { LibraryAccountController, LibraryAccountSnapshot } from '@/library/core/contracts/account';
import type { ProviderAccountSummary, ProviderUser } from '@/types/onlineMusic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cachedUser: ProviderUser = { id: 42, nickname: 'Cached Netease User', avatarUrl: '' } as ProviderUser;

const netease = (status: ProviderAccountSummary['status'], user: ProviderUser | null): ProviderAccountSummary => ({
    providerId: 'netease',
    displayName: 'NetEase Cloud Music',
    shortName: '网易云',
    availability: { configured: true },
    requiresAccount: true,
    status,
    user,
    collections: [],
    hydration: status === 'unknown' ? 'loading' : 'ready',
});

/** 只实现 AccountTab 用到的那一面：快照、订阅与登出；快照可以由用例改写并通知。 */
const createFakeController = (initial: LibraryAccountSnapshot) => {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    const logout = vi.fn(async (providerId: string) => ({ status: 'logged-out' as const, providerId }));
    const controller = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        logout,
    } as unknown as LibraryAccountController;
    const update = (patch: Partial<LibraryAccountSnapshot>) => {
        snapshot = { ...snapshot, ...patch };
        act(() => listeners.forEach(listener => listener()));
    };
    return { controller, logout, update };
};

const snapshotWith = (provider: ProviderAccountSummary): LibraryAccountSnapshot => ({
    providers: [provider],
    activeProviderId: provider.providerId,
    login: null,
    pendingSwitch: null,
    logout: { providerId: null, status: 'idle' },
    lastLoginCompletion: null,
});

let root: Root | null = null;

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
});

const renderAccountTab = (controller: LibraryAccountController, user: ProviderUser | null) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(AccountTab, {
        user,
        accountController: controller,
        audioQuality: 'high',
        onAudioQualityChange: () => {},
        cacheSize: '0 B',
        onClearCache: () => {},
        onSyncData: () => {},
        isSyncing: false,
        onNavigateHome: () => {},
    })));
    const logoutButton = () => host.querySelector<HTMLButtonElement>('button[title="account.logout"]');
    return { host, logoutButton };
};

describe('account tab logout', () => {
    it('shows the cached NetEase user but renders no logout button (sign-out lives in the home switcher)', () => {
        // 水合窗口：store 里网易还是 unknown（没有 user），App 的 user 已经是缓存的那个。
        // 账号页仍要展示这个缓存用户，但不再提供登出入口。
        const fake = createFakeController(snapshotWith(netease('unknown', null)));
        const { host, logoutButton } = renderAccountTab(fake.controller, cachedUser);

        expect(host.textContent).toContain('Cached Netease User');
        expect(logoutButton()).toBeNull();

        // 登录落定后同样没有登出按钮，controller.logout 不应被账号页触发。
        fake.update({ providers: [netease('authenticated', cachedUser)] });
        expect(logoutButton()).toBeNull();
        expect(fake.logout).not.toHaveBeenCalled();
    });
});
