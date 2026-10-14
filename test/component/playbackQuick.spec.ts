import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/playbackQuick.spec.ts
// @fork 本地魔改版（2026-10-14）：播放胶囊右槽默认动作 playback-quick 与它的二级浮层（音量 + 静音 + 洗牌）。
// 这几项从 bravais 墙工具面板搬过来（墙面面板自此只管墙），探针见 dev/probes/playbackQuick.probe.tsx。
// 音量读写真的 useAudioSettingsStore；洗牌可用性读真的 usePlaybackStore（队列 ≥ 2 首），点击次数落在 data-probe-shuffle-calls。

const SLOT = (page: Page) => page.getByRole('button', { name: 'Playback quick', exact: true });
const PANEL = (page: Page) => page.getByRole('dialog', { name: 'Playback quick', exact: true });
const slider = (page: Page) => PANEL(page).getByRole('slider', { name: 'Volume', exact: true });

/** 悬浮展开胶囊（与标题探针同款：等 layout 弹簧落定由 locator 自带的重试兜住）。 */
async function expandCapsule(page: Page): Promise<void> {
    await page.locator('.rounded-full.cursor-pointer').first().hover();
    await expect(SLOT(page)).toBeVisible();
}

/** 给真 store 种一首以上队列，让洗牌行从禁用翻成可点。 */
const seedQueue = (page: Page, size: number) => page.evaluate(count => {
    // 路径写进变量 + @vite-ignore：避开 TS 把 '/src/...' 当模块静态解析。
    const storeModulePath = '/src/stores/usePlaybackStore.ts';
    return import(/* @vite-ignore */ storeModulePath).then((m: any) => {
        const queue = Array.from({ length: count }, (_, index) => ({ id: 9000 + index, name: `Probe Track ${index}` }));
        m.usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
    });
}, size);

/** 用 store 自己的 setter 把音量定到 0.4（顺带落地 player_volume），键盘段落才有确定的起点。 */
const seedVolume = (page: Page, value: number) => page.evaluate(val => {
    const storeModulePath = '/src/stores/useAudioSettingsStore.ts';
    return import(/* @vite-ignore */ storeModulePath).then((m: any) => {
        m.useAudioSettingsStore.getState().handleSetVolume(val);
    });
}, value);

test.beforeEach(async ({ mount }) => {
    await mount('playbackQuick');
});

test('the slot toggles the panel, Esc and an outside click close it', async ({ page }) => {
    await expandCapsule(page);
    await SLOT(page).click();
    await expect(PANEL(page)).toBeVisible();

    // 再点一次槽位：toggle 收起（按钮高亮跟着开关走，active 态来自同一个 store）。
    await expandCapsule(page);
    await SLOT(page).click();
    await expect(PANEL(page)).toHaveCount(0);

    await SLOT(page).click();
    await expect(PANEL(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(PANEL(page)).toHaveCount(0);

    await SLOT(page).click();
    await expect(PANEL(page)).toBeVisible();
    // 点浮层外任意处（无全屏背板，pointerdown 监听兼容触屏）。
    await page.mouse.click(10, 10);
    await expect(PANEL(page)).toHaveCount(0);
});

test('the volume row drives the app volume store: keys step it, the icon mutes and un-mutes', async ({ page }) => {
    // 起点定在 0.4：探针的缺省音量就是 1（readStoredVolume 无值回 1），不先落地就按 End / Home 可能根本不变化，
    // React 的 onChange 不会触发，storage 也就永远写不进去（真踩过）。
    await seedVolume(page, 0.4);
    await expandCapsule(page);
    await SLOT(page).click();

    await expect(slider(page)).toHaveValue('0.4');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '40%');

    // 键盘一步 5%（PageUp / Home / End 走原生 range 行为），每一下都直接写进同一个音量 store。
    await slider(page).focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('player_volume'))).toBe('0.45');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '45%');
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('player_volume'))).toBe('1');
    await page.keyboard.press('Home');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('player_volume'))).toBe('0');

    // 静音：滑条读 0、写作「Muted」，store 里 isMuted 翻真；图标按钮跟着换名。
    // 注意这颗按钮是 role="switch"（aria-checked 表达静音态），不是 button。
    await PANEL(page).getByRole('switch', { name: 'Mute', exact: true }).click();
    await expect(slider(page)).toHaveValue('0');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Muted');
    await expect(PANEL(page).getByRole('switch', { name: 'Unmute', exact: true })).toHaveAttribute('aria-checked', 'true');

    // 静音状态下往非零方向推一格：先解除静音再写值（拖到一个音量就是想听见它）。
    await slider(page).focus();
    await page.keyboard.press('ArrowUp');
    await expect(PANEL(page).getByRole('switch', { name: 'Mute', exact: true })).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('player_volume'))).toBe('0.05');
});

test('shuffle is gated on a two-song queue and keeps the panel open when it fires', async ({ page }) => {
    await expandCapsule(page);
    await SLOT(page).click();
    const shuffle = PANEL(page).getByRole('button', { name: 'Shuffle the queue', exact: true });

    // 探针页没有队列：禁用并写明原因。
    await expect(shuffle).toBeDisabled();
    await expect(shuffle).toHaveAttribute('title', /Needs two or more songs/);

    // 真 store 里种两首歌：可用性跟着翻，点了交给宿主，浮层不收起（洗完还能再洗）。
    await seedQueue(page, 3);
    await expect(shuffle).toBeEnabled();
    await shuffle.click();
    await expect(page.locator('[data-probe-shuffle-calls]')).toHaveAttribute('data-probe-shuffle-calls', '1');
    await expect(PANEL(page)).toBeVisible();
});
