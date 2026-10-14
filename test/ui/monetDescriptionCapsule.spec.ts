import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/monetDescriptionCapsule.spec.ts
// @fork 本地魔改版（2026-10-14）：Monet 左下的「主题描述胶囊」（强调色圆点 + theme.description 一句话）
// 与设置面板上的「显示歌曲描述」开关都已删除。本文件是「入口不存在」的回归断言，
// 判据设计成可致死的：把 VisualizerMonet.tsx 里注释掉的胶囊 JSX 放回来 → 第一条用例必红；
// 把 MonetSettingsPanel.tsx 的 PresetGroup 挂回来 → 第二条用例必红。
// 用例把主题描述塞成一个绝不会出现在别处的字符串（走 AI 主题持久层：last_dual_theme +
// last-applied pointer，启动 restore 把 bgMode 起手定在 ai），这样断言的不是「屏幕空」
// 而是「这句话没被画出来」。

const DESCRIPTION = 'MONET-CAPSULE-SENTINEL-余温还留在指尖';
const THEME_NAME = 'MONET-CAPSULE-SENTINEL-NAME';

const SENTINEL_THEME = {
    name: THEME_NAME,
    description: DESCRIPTION,
    backgroundColor: '#14100c',
    primaryColor: '#f7f4f2',
    secondaryColor: '#b9ada2',
    accentColor: '#42eaeb',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: [],
    provider: 'AI',
};

const seedAiThemeWithDescription = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        // pointer 每次导航都要在（addInitScript 会 clear 再种，reload 也不例外）：
        // 启动 restore 看到 'ai' 才会去 IndexedDB 捞 last_dual_theme。首启库还是空的，
        // 落回 default 无妨；写库后的 reload 才是 sentinel 真正生效的那次。
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('visualizer_mode', 'monet');
        localStorage.setItem(guideKey, version);
        localStorage.setItem('last_applied_theme_pointer', 'ai');
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);
};

// sentinel 主题经 AI 持久层生效：写 last_dual_theme 后重载，让启动 restore 把它应用
// （bgMode 'ai'，theme.description 于是真的进到 visualizer 的 props）。不这么种，
// 胶囊的文案分支压根走不到。
const applySentinelTheme = async (page: import('@playwright/test').Page) => {
    await expect.poll(async () => page.evaluate(async () => {
        try {
            const dbPath = '/src/services/db.ts';
            const { saveToCache } = await import(/* @vite-ignore */ dbPath);
            await saveToCache('last_dual_theme', { light: SENTINEL_THEME, dark: SENTINEL_THEME });
            return true;
        } catch {
            return false;
        }
    })).toBe(true);
    await page.reload();
    await waitForAppMounted(page);
};

const openPlayerWithSong = async (page: import('@playwright/test').Page) => {
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await applySentinelTheme(page);
    await mountPlayer(page);
};

// reload 之后也要重跑：view 不持久化，store 注入在每次挂载后各来一遍。
const mountPlayer = async (page: import('@playwright/test').Page) => {
    await expect.poll(async () => page.evaluate(async () => {
        try {
            const song = {
                id: 91001,
                name: 'Capsule Probe Song',
                artists: [{ id: 1, name: 'Probe Singer' }],
                album: { id: 1, name: 'Probe Album' },
                durationMs: 180_000,
            };
            const playbackPath = '/src/stores/usePlaybackStore.ts';
            const viewPath = '/src/stores/useAppViewStore.ts';
            const settingsPath = '/src/stores/useVisualizerSettingsStore.ts';
            const [{ usePlaybackStore }, { useAppViewStore }, { useVisualizerSettingsStore }] = await Promise.all([
                import(/* @vite-ignore */ playbackPath),
                import(/* @vite-ignore */ viewPath),
                import(/* @vite-ignore */ settingsPath),
            ]);
            usePlaybackStore.setState({ playQueue: [song], currentSong: song });
            useVisualizerSettingsStore.getState().handleSetVisualizerMode('monet');
            useAppViewStore.getState().setView('player');
            return true;
        } catch {
            return false;
        }
    })).toBe(true);
};

test('the monet poster draws no theme-description capsule', async ({ page }) => {
    await seedAiThemeWithDescription(page);
    await openPlayerWithSong(page);

    // 播放页与 monet 视觉层都在（否则下面两条 toHaveCount(0) 全是空断言，判据就是假的）。
    // 歌名在 monet 海报和底部「现在播放」胶囊里各一份，必须拿视觉层那一份做锚点。
    const surface = page.getByTestId('player-visual-surface');
    await expect(surface.getByText('Capsule Probe Song')).toBeVisible();

    // 胶囊里写的是 theme.description，文案是唯一可判定的抓手。
    await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
    // 旧实现文案空着时回退到 theme.name；名字在主题预设卡上还会有一份，所以只看视觉层里那一份。
    await expect(surface.getByText(THEME_NAME)).toHaveCount(0);
});

test('the monet panel no longer offers the song-description switch', async ({ page }) => {
    await seedAiThemeWithDescription(page);
    await openPlayerWithSong(page);

    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(/* @vite-ignore */ path);
        useSettingsModalStore.getState().openSettings('options', 'visualizer', 'visualizer');
    });

    // 面板确实开着，而且只是“那一组”里删了东西：同组的 Keyword Coloring 区块标题（SectionLabel 是 div，
    // 不是按钮）还在。缺了这个锚点，下面那条 toHaveCount(0) 就只是「面板根本没渲染」。
    // exact：面板副标题（monetSettingsDesc）里也提到了 keyword coloring。
    await expect(page.getByText('Monet Tuning')).toBeVisible();
    await expect(page.getByText('Keyword Coloring', { exact: true })).toBeVisible();

    // 开关本体：标题与它的两个选项（label 来自 en 文案 options.monetShowDescription，
    // 选项复用 partitaGuideLines* 的 Show / Hide）。
    await expect(page.getByText('Show Song Description')).toHaveCount(0);
});
