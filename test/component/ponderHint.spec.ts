import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/ponderHint.spec.ts
// 思索的进入链路。这里覆盖的全是只有真实浏览器才暴露的东西：600ms/400ms 两个时间门、
// G 在输入框里有没有漏进去，以及光标跟随有没有真的绕开 React。
// 见 dev/probes/ponderHint.probe.tsx。
//
// @fork 本地魔改版（用户：「把这个删了」→「彻底删掉胶囊 + 摘掉设置项」）：
// 跟随光标的 PonderHintCapsule 不再渲染，设置里那档三选一的可见性也一起摘了。
// 原本围着胶囊写的四条用例（600ms 才出、不可点击、可见性设为关闭、z-index 压过导航页）
// 失去对象，删掉；两颗按钮本身还在 —— 悬停满 600ms 命中目标、长按满 400ms 进教程 ——
// 所以同步点从「胶囊可见」换成探针写下的 data-probe-hovered，它是悬停探测在浏览器里
// 唯一剩下的可观测出口，也正是长按 G 的前置条件。
// 另补一条反向断言：命中目标之后屏幕上依旧不该长出胶囊。用例是红的还是绿的，
// 取决于胶囊有没有被加回来，不是取决于这里写着什么。

/** mount fixture 的结构类型，照 automixTransitionSwitches.spec.ts。 */
type Mount = (component: string) => Promise<unknown>;

const STATE = '[data-probe-state]';
/** 只用于反向断言：这颗胶囊在本版本里应当永远不在 DOM 上。 */
const CAPSULE = '[data-testid="ponder-hint-capsule"]';
const STAGE = '[data-testid="ponder-stage"]';
const TOGGLE = '[data-testid="panel-toggle"]';

const hoveredOf = (page: Page) => page.locator(STATE).getAttribute('data-probe-hovered');

/** 把指针放到替身开关中心，并留在那里。 */
async function hoverToggle(page: Page): Promise<{ x: number; y: number }> {
    const box = (await page.locator(TOGGLE).boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    return point;
}

/** 等到悬停探测真的命中 panel-slide —— 没有胶囊之后这是唯一的同步点。 */
async function waitHoverArmed(page: Page): Promise<void> {
    await expect(page.locator(STATE)).toHaveAttribute('data-probe-hovered', 'panel-slide', { timeout: 2000 });
}

test.beforeEach(async ({ mount }) => {
    await (mount as unknown as Mount)('ponderHint');
});

test.describe('悬停探测', () => {
    test('不到 600ms 不命中目标，满了才命中，且全程没有胶囊', async ({ page }) => {
        await hoverToggle(page);

        await page.waitForTimeout(350);
        expect(await hoveredOf(page)).toBe('');
        await expect(page.locator(CAPSULE)).toHaveCount(0);

        await waitHoverArmed(page);
        // 反向断言：命中了目标也不该有胶囊。把 PonderHost 里那段渲染加回来，这一条就红。
        await expect(page.locator(CAPSULE)).toHaveCount(0);
    });

    test('指针离开后不再命中', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);

        await page.mouse.move(5, 5);
        await expect(page.locator(STATE)).toHaveAttribute('data-probe-hovered', '', { timeout: 2000 });
        await expect(page.locator(CAPSULE)).toHaveCount(0);
    });

    test('帮助导航页里悬停卡片：能长按进教程，但同样不弹胶囊', async ({ page }) => {
        await page.locator('[data-probe-open-navigation]').click();

        const navigation = page.locator('[data-testid="ponder-navigation"]');
        await expect(navigation).toBeVisible();

        await page.locator('[data-ponder-nav-target="panel-slide"]').hover();
        await expect(page.locator(STATE)).toHaveAttribute('data-probe-hovered', 'panel-slide', { timeout: 2000 });
        await expect(page.locator(CAPSULE)).toHaveCount(0);

        await page.keyboard.down('g');
        await expect(page.locator(STAGE)).toBeVisible({ timeout: 2000 });
        await page.keyboard.up('g');
    });
});

test.describe('长按 G', () => {
    test('不到 400ms 松手会取消', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);

        await page.keyboard.down('g');
        await page.waitForTimeout(150);
        await page.keyboard.up('g');

        await page.waitForTimeout(500);
        await expect(page.locator(STAGE)).toHaveCount(0);
        expect(await page.locator(STATE).getAttribute('data-probe-session')).toBe('');
    });

    test('按满 400ms 打开教程层', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);

        await page.keyboard.down('g');
        await expect(page.locator(STAGE)).toBeVisible({ timeout: 2000 });
        await page.keyboard.up('g');

        // 教程开着时屏幕上也不该有胶囊 —— 它本来就不存在，这条是给它留的门。
        await expect(page.locator(CAPSULE)).toHaveCount(0);
    });

    test('Esc 退出教程层', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);
        await page.keyboard.down('g');
        await expect(page.locator(STAGE)).toBeVisible({ timeout: 2000 });
        await page.keyboard.up('g');

        await page.keyboard.press('Escape');
        await expect(page.locator(STAGE)).toHaveCount(0);
    });

    test('屏幕上的下一关键帧会停住时间线，退出按钮关闭教程', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);
        await page.keyboard.down('g');
        await expect(page.locator(STAGE)).toBeVisible({ timeout: 2000 });
        await page.keyboard.up('g');

        // 触屏没有方向键：这对按钮是关键帧跳转唯一按得准的入口，跳完要停在那一拍上。
        await page.locator('[data-testid="ponder-next-keyframe"]').click();
        await page.waitForTimeout(1200);
        const fill = page.locator('[data-testid="ponder-progress-fill"]');
        const settled = await fill.getAttribute('style');
        await page.waitForTimeout(800);
        expect(await fill.getAttribute('style')).toBe(settled);
        await expect(page.locator(`${STAGE} .lucide-play`)).toHaveCount(1);

        await page.locator('[data-testid="ponder-exit"]').click();
        await expect(page.locator(STAGE)).toHaveCount(0);
    });

    test('焦点在输入框时 G 只是打字，不开教程', async ({ page }) => {
        await page.locator('[data-probe-input]').click();
        await page.keyboard.type('g');

        await page.waitForTimeout(600);
        await expect(page.locator(STAGE)).toHaveCount(0);
        await expect(page.locator('[data-probe-input]')).toHaveValue('g');
    });
});

/**
 * 触屏入口。它在桌面上根本不渲染，所以这一组必须自己开一个 coarse pointer 的 context ——
 * 默认那个里面它 0 个元素，用例会「通过」而什么都没验到。
 */
test.describe('触屏上的思索按钮', () => {
    test.use({ hasTouch: true, isMobile: true });

    const BULB = '[data-testid="page-ponder-touch-button"]';

    test('贴右上角，不落在右下角那堆操作按钮上', async ({ page }) => {
        const bulb = page.locator(BULB);
        await expect(bulb).toBeVisible();

        const box = (await bulb.boundingBox())!;
        const viewport = page.viewportSize()!;
        expect(box.y, '按钮跑到下半屏去了').toBeLessThan(viewport.height / 2);
        expect(box.x, '按钮不在右侧').toBeGreaterThan(viewport.width / 2);
    });

    test('露几秒自己收起来，点右上角又回来', async ({ page }) => {
        const bulb = page.locator(BULB);
        await expect(bulb).toHaveAttribute('data-ponder-touch-revealed', 'true');

        // 收起来之后不可点：留着可点的话，右上角会变成一块看不见却能按的地方。
        await expect(bulb).not.toHaveAttribute('data-ponder-touch-revealed', 'true', { timeout: 8000 });
        await expect(bulb).toHaveCSS('pointer-events', 'none');

        const viewport = page.viewportSize()!;
        await page.touchscreen.tap(viewport.width - 24, 24);
        await expect(bulb).toHaveAttribute('data-ponder-touch-revealed', 'true');
    });

    test('设置里关掉之后它整个不在', async ({ page }) => {
        await expect(page.locator(BULB)).toBeVisible();

        await page.evaluate(async () => {
            const storePath = '/src/stores/usePonderStore.ts';
            const { usePonderStore } = await import(storePath);
            usePonderStore.getState().setShowPonderTouchButton(false);
        });

        // 不是淡出，是整个不渲染 —— 关掉之后右上角那块热区也该一起失效。
        await expect(page.locator(BULB)).toHaveCount(0);
        const viewport = page.viewportSize()!;
        await page.touchscreen.tap(viewport.width - 24, 24);
        await page.waitForTimeout(300);
        await expect(page.locator(BULB)).toHaveCount(0);
    });

    test('点右上角以外的地方不会把它叫出来', async ({ page }) => {
        const bulb = page.locator(BULB);
        await expect(bulb).not.toHaveAttribute('data-ponder-touch-revealed', 'true', { timeout: 8000 });

        const viewport = page.viewportSize()!;
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.waitForTimeout(300);
        await expect(bulb).not.toHaveAttribute('data-ponder-touch-revealed', 'true');
    });
});

test.describe('guardrails', () => {
    test('移动 100 次指针不产生任何 PonderHost 重渲染', async ({ page }) => {
        await hoverToggle(page);
        await waitHoverArmed(page);

        await page.evaluate(() => {
            (window as unknown as { __renderCounts?: Record<string, number> }).__renderCounts = {};
        });

        const box = (await page.locator(TOGGLE).boundingBox())!;
        for (let step = 0; step < 100; step += 1) {
            await page.mouse.move(box.x + 2 + (step % 20), box.y + 2 + (step % 10));
        }

        const counts = await page.evaluate(() => (
            (window as unknown as { __renderCounts?: Record<string, number> }).__renderCounts ?? {}
        ));
        expect(counts.PonderHost ?? 0).toBe(0);
    });
});

test.describe('章节', () => {
    /** 打开教程层并停在第一章。 */
    async function openStage(page: Page): Promise<void> {
        await hoverToggle(page);
        await waitHoverArmed(page);
        await page.keyboard.down('g');
        await expect(page.locator(STAGE)).toBeVisible({ timeout: 2000 });
        await page.keyboard.up('g');
    }

    test('[ ] 在章节之间循环切换', async ({ page }) => {
        await openStage(page);
        const counter = page.locator(STAGE).getByText('1 / 3').first();
        await expect(counter).toBeVisible();

        await page.keyboard.press(']');
        await expect(page.locator(STAGE).getByText('2 / 3').first()).toBeVisible();

        await page.keyboard.press('[');
        await expect(page.locator(STAGE).getByText('1 / 3').first()).toBeVisible();

        // 往回越界绕到最后一章。
        await page.keyboard.press('[');
        await expect(page.locator(STAGE).getByText('3 / 3').first()).toBeVisible();
    });

    test('一章播完出「下一章」箭头，点它进入下一章', async ({ page }) => {
        await openStage(page);
        // 切到最短的那一章（键盘那章）再等它播完，省去第一章的十几秒。
        await page.keyboard.press(']');
        await page.keyboard.press(']');
        await expect(page.locator(STAGE).getByText('3 / 3').first()).toBeVisible();

        // 末章不该有「下一章」箭头，只有一行静默提示。
        await expect(page.locator('[data-testid="ponder-chapters-done"]')).toBeVisible({ timeout: 30000 });
        await expect(page.locator('[data-testid="ponder-next-chapter"]')).toHaveCount(0);

        // 回到第一章，播完应当给出指向第二章的按钮。
        await page.keyboard.press(']');
        await expect(page.locator(STAGE).getByText('1 / 3').first()).toBeVisible();
        const next = page.locator('[data-testid="ponder-next-chapter"]');
        await expect(next).toBeVisible({ timeout: 40000 });
        await next.click();
        await expect(page.locator(STAGE).getByText('2 / 3').first()).toBeVisible();
    });
});
