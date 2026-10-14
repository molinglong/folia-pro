import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp, svgDataUrl } from './helpers/appFixtures';

// test/ui/bravaisToolsPanel.spec.ts
// bravais 右下角工具面板在真实应用里的接线（设计稿 §7.5「浮层控件」）：快捷动作经 stage 契约的 tools 端口落到命令面板的
// 同一条命令（生成主题 theme-generate-current，可用性也是命令面板那一份）。前往 Lattice 的翻牌交接在 wallHandoff.spec。
// @fork 本地魔改版（2026-10-14）：队列洗牌与音量滑条已搬进播放胶囊的「播放快捷」二级浮层（PlaybackQuickPanel），
// 这里改而守护「墙上不再带播放项」；浮层自身的真实接线见 test/component/playbackQuick.spec。

test.use({ screenshot: 'only-on-failure' });

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const panel = (page: Page) => page.getByRole('menu', { name: 'Wall tools', exact: true });
const quick = (page: Page, id: string) => panel(page).locator(`[data-wall-tools-quick="${id}"]`);
// @fork 本地魔改版（2026-10-14）：洗牌断言用的 queueIds / 音量断言用的 volumeState helper 随旧段落一起删。

const boot = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(() => {
        localStorage.setItem('library_suite', 'bravais');
        localStorage.setItem('player_volume', '0.5');
    });
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', /^home:/, { timeout: 20_000 });
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
};

/** 播放 store 的队列（12 首、第一首在播、没有歌词）与当前状态。 */
const seedQueue = (page: Page) => page.evaluate(async (covers) => {
    const path = '/src/stores/usePlaybackStore.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ path);
    const queue = covers.map((coverUrl, index) => ({
        id: 7000 + index,
        name: `Tools Track ${index + 1}`,
        artists: [{ id: 1, name: 'Tools Artist' }],
        album: { id: 1, name: 'Tools Album', coverUrl },
        durationMs: 180_000,
    }));
    usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
}, Array.from({ length: 12 }, (_, index) => svgDataUrl(String(index + 1), `hsl(${(index * 37) % 360} 60% 42%)`)));

test('[bravais] the tools panel gates the theme on lyrics and no longer carries playback items', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Wall tools', exact: true }).click();
    await expect(panel(page)).toBeVisible();

    // @fork 洗牌格与音量滑条已搬进胶囊的播放快捷浮层：墙上不应再出现它们（防偷偷长回来）。
    await expect(quick(page, 'shuffle-queue')).toHaveCount(0);
    await expect(panel(page).getByRole('slider')).toHaveCount(0);

    // 有歌但没有歌词（也不是纯音乐）：生成主题不可用，写原因（命令 theme-generate-current 的同一个判定）。
    await seedQueue(page);
    await expect(quick(page, 'generate-theme')).toBeDisabled();
    await expect(quick(page, 'generate-theme')).toHaveAttribute('aria-description', 'Needs a playing song with lyrics (or pure music)');
});
