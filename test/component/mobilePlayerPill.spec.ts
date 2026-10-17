import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/mobilePlayerPill.spec.ts
// 触屏迷你胶囊（方向四 · Apple Music 式）。这里覆盖的都是只有真实浏览器才暴露的东西：
// 播放页短路（同一处不挂两个播放器）、点胶囊本体的去向、点播放键只切态不跳转、
// 左右滑过阈值切歌且松手补发的 click 不能再触发跳转。见 dev/probes/mobilePlayerPill.probe.tsx。

const ROOT = '[data-probe-view]';
const PILL = '[data-mobile-pill]';

const attr = (page: Page, name: string) => page.locator(ROOT).getAttribute(name);
const num = async (page: Page, name: string) => Number(await attr(page, name));

async function settle(page: Page): Promise<void> {
    await page.waitForTimeout(120);
}

/**
 * 在胶囊标题区（避开右侧播放键）横向拖 rawDelta 像素。
 * 组件按 SWIPE_FOLLOW_RATIO=0.55 折算，过阈值 56 需要 raw 位移约 ≥102px，这里取到 220 稳过。
 */
async function swipePill(page: Page, rawDelta: number): Promise<void> {
    const box = (await page.locator(PILL).boundingBox())!;
    const x = box.x + 24;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(x + (rawDelta * step) / 6, y);
    }
    await page.mouse.up();
}

test.beforeEach(async ({ mount, page }) => {
    await mount('mobilePlayerPill');
    await expect(page.locator(ROOT)).toBeAttached();
});

test.describe('render gating', () => {
    test('shows on a browsing view with a current song', async ({ page }) => {
        await expect(page.locator(PILL)).toBeVisible();
    });

    test('renders nothing on the player view — one screen, one player', async ({ page }) => {
        // 方向四的核心规则：进播放页后页面自带全套控件，胶囊不再存在。
        await page.locator('[data-probe-action="view-player"]').click();
        await expect(page.locator(PILL)).toHaveCount(0);
    });

    test('renders nothing without a current song', async ({ page }) => {
        await page.locator('[data-probe-action="song-none"]').click();
        await expect(page.locator(PILL)).toHaveCount(0);
    });

    test('renders nothing when the control bar is hidden', async ({ page }) => {
        await page.locator('[data-probe-action="toggle-hide"]').click();
        await expect(page.locator(PILL)).toHaveCount(0);
    });

    test('back on a browsing view brings the pill back', async ({ page }) => {
        await page.locator('[data-probe-action="view-player"]').click();
        await expect(page.locator(PILL)).toHaveCount(0);
        await page.locator('[data-probe-action="view-home"]').click();
        await expect(page.locator(PILL)).toBeVisible();
    });
});

test.describe('capsule navigation', () => {
    test('tapping the body on home opens the player page', async ({ page }) => {
        await page.locator(PILL).click({ position: { x: 40, y: 26 } });
        expect(await num(page, 'data-probe-navigations')).toBe(1);
        expect(await num(page, 'data-probe-lattice-focuses')).toBe(0);
    });

    test('tapping the body on lattice anchors back to the current card', async ({ page }) => {
        await page.locator('[data-probe-action="view-lattice"]').click();
        await page.locator(PILL).click({ position: { x: 40, y: 26 } });
        expect(await num(page, 'data-probe-lattice-focuses')).toBe(1);
        expect(await num(page, 'data-probe-navigations')).toBe(0);
    });

    test('the play button toggles playback without navigating', async ({ page }) => {
        await page.locator(PILL).getByRole('button', { name: /pause|play/i }).click();
        expect(await num(page, 'data-probe-toggles')).toBe(1);
        expect(await num(page, 'data-probe-navigations')).toBe(0);
    });
});

test.describe('swipe to change track', () => {
    test('swiping left past the threshold plays the next track and does not navigate', async ({ page }) => {
        await swipePill(page, -220);
        await settle(page);
        expect(await num(page, 'data-probe-nexts')).toBe(1);
        expect(await num(page, 'data-probe-prevs')).toBe(0);
        // 松手补发的那次 click 必须被真实位移挡掉，否则切歌的同时又跳了播放页。
        expect(await num(page, 'data-probe-navigations')).toBe(0);
    });

    test('swiping right past the threshold plays the previous track', async ({ page }) => {
        await swipePill(page, 220);
        await settle(page);
        expect(await num(page, 'data-probe-prevs')).toBe(1);
        expect(await num(page, 'data-probe-nexts')).toBe(0);
        expect(await num(page, 'data-probe-navigations')).toBe(0);
    });

    test('a swipe below the threshold is not a track change', async ({ page }) => {
        await swipePill(page, -20);
        await settle(page);
        expect(await num(page, 'data-probe-nexts')).toBe(0);
        expect(await num(page, 'data-probe-prevs')).toBe(0);
    });

    test('swipe is ignored when neighbours are unavailable', async ({ page }) => {
        await page.locator('[data-probe-action="block-nav"]').click();
        await swipePill(page, -220);
        await settle(page);
        expect(await num(page, 'data-probe-nexts')).toBe(0);
        expect(await num(page, 'data-probe-prevs')).toBe(0);
    });
});
