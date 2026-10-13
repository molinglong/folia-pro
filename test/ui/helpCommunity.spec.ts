import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/helpCommunity.spec.ts
// @fork 本地魔改版：帮助页的「加入社区」胶囊（Discord 邀请 + QQ 自助交流群群号复制）已从
// SettingsModal 移除，本文件因此从「胶囊行为」改为「社区入口不存在」的回归断言。
// 判据设计成可致死的：只要有人把胶囊或任一社区入口重新挂回帮助页，下面第一条用例就会红。
// 上游原用例（点胶囊展开菜单 / QQ 复制群号 / Discord 打开邀请 / Escape 只关菜单）见
// git 历史 f358c44d 之前的该文件，魔改基线可用 `git show mine-base:test/ui/helpCommunity.spec.ts` 取回。

const QQ_GROUP_NUMBER = '372521584';

const openHelp = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
        // @fork 原用例在这里劫持 window.open 记录 Discord 邀请；社区入口删除后该脚手架一并撤掉。
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('help');
    });
};

test('the help page exposes no community capsule and no Discord or QQ entry', async ({ page }) => {
    await openHelp(page);

    // 胶囊本体与它的菜单都不该存在（角色名来自 en 文案 "Join the community"）。
    await expect(page.getByRole('button', { name: 'Join the community', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Join the community' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Join our Discord/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Discord server/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /QQ self-help group/ })).toHaveCount(0);

    // 群号不该以任何形式回落到 DOM 文本里。
    await expect(page.getByText(QQ_GROUP_NUMBER)).toHaveCount(0);
});

// @fork 第二步（2026-10-11）：帮助页的「遇到问题？」（AI 提示词弹窗入口）与「版本更新」卡也一并删除，
// 这条用例从「AI 入口仍在」改为「两个入口都不在，但帮助页本体还在」。
test('the help page keeps its shortcut list and ponder entry, with no AI or release-notes entry', async ({ page }) => {
    await openHelp(page);

    // 被删掉的两个入口：按钮与弹窗都不该存在。
    await expect(page.getByRole('button', { name: 'Need help?' })).toHaveCount(0);
    await expect(page.getByTestId('help-release-notes')).toHaveCount(0);
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0);

    // 保留项：思索入口（卡片）与快捷键说明表（Space 是「播放/暂停」那一行）。
    await expect(page.getByTestId('help-page-ponder')).toBeVisible();
    await expect(page.getByText('Space')).toBeVisible();
});

// @fork 第三步（2026-10-12）：帮助页底部的「Project: folia-major」署名行与版本信息按钮（点一下复制版本串）整块删除。
// 外层容器改为只在检测到新版本时才渲染，所以无更新可用时这里连分隔线都不该留。
test('the help page footer carries no author line and no version-info button', async ({ page }) => {
    await openHelp(page);

    // 署名按钮的可访问名正是 en 文案 help.madeBy（"Project:"），版本按钮的可访问名是 versionCopiedHint。
    await expect(page.getByRole('button', { name: 'Project:', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Click to copy version info' })).toHaveCount(0);

    // 仓库名也不该以任何形式回落到帮助页文本里。
    await expect(page.getByText('folia-major')).toHaveCount(0);

    // 帮助页本体没被删坏：快捷键说明仍在。
    await expect(page.getByText('Space')).toBeVisible();
});
