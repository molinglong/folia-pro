import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisSettingsGroup.spec.ts
// 「Bravais 墙面」分组（2026-10-19 随主页外观整组从界面设置搬到主页样式浮层 HomeStylePanel）：
// - bravais 生效时，浮层里出现这一组，含透光三档、部分透明时的每块窗数与集合叠页边开关；
// - 切换都写进 useLibraryWallLookStore 并持久化，叠页边开关立刻作用到墙（stage 根节点的 has-stack-edges）；
// - grid 生效时整组不出现。

test.use({ screenshot: 'only-on-failure' });

const bootHome = async (page: Page, suite: 'bravais' | 'grid') => {
    // 保留真实的 matchMedia：设置弹窗的宽版布局（侧栏 + 内容列）按 (min-width: 768px) 分支，桩会把它算成窄版。
    await installBaseState(page, { neteaseMode: 'guest', preserveNativeMediaQueries: true });
    await page.addInitScript((suiteId) => {
        localStorage.setItem('library_suite', suiteId);
        // 打开设置弹窗要这两个桥接方法（与 bravaisVisualizerMount 同一份最小桥）。
        Object.assign((window as Window & { electron?: Record<string, unknown> }).electron ?? {}, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
    }, suite);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

// 主页外观现在由 HomeStylePanel 现场调（App 挂在首页层同级，读 useHomeStylePanelStore.isOpen），
// 不再从设置弹窗里进；这里直接拉浮层，底下的墙保持可见。
const openHomeStylePanelDrawer = (page: Page) => page.evaluate(async () => {
    const path = '/src/stores/useHomeStylePanelStore.ts';
    const { openHomeStylePanel } = await import(/* @vite-ignore */ path);
    openHomeStylePanel();
});

const group = (page: Page) => page.locator('[data-bravais-settings]');

test('the Bravais group holds the transparency, the windows per block and the stack edges', async ({ page }) => {
    await bootHome(page, 'bravais');
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveClass(/\bhas-stack-edges\b/);
    await openHomeStylePanelDrawer(page);

    await expect(page.getByRole('heading', { name: 'Bravais wall', exact: true })).toBeVisible();
    await expect(group(page)).toBeVisible();
    // 透光与窗数都在分组里；浮层不再嵌 suite 选择（那是「资料库界面」那一节，仍留在通用设置）。
    await expect(group(page).locator('[data-library-wall-look-settings]')).toHaveCount(1);

    // 透光：部分透明时才有每块窗数。
    await group(page).locator('[data-library-wall-look="solid"]').click();
    await expect(group(page).locator('[data-library-wall-windows]')).toHaveCount(0);
    await group(page).locator('[data-library-wall-look="partial"]').click();
    await expect(group(page).locator('[data-library-wall-windows]')).toHaveCount(6);
    await group(page).locator('[data-library-wall-windows="4"]').click();
    expect(await page.evaluate(() => [localStorage.getItem('library_wall_look'), localStorage.getItem('library_wall_windows_per_block')])).toEqual(['partial', '4']);
    await expect(stage).toHaveAttribute('data-bravais-look', 'partial');

    // 集合叠页边：默认开，关掉后墙上立刻不画，存储里记成 false。
    const toggle = page.getByRole('switch', { name: 'Collection stack edges' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(stage).not.toHaveClass(/\bhas-stack-edges\b/);
    expect(await page.evaluate(() => localStorage.getItem('library_wall_stack_edges'))).toBe('false');
    await toggle.click();
    await expect(stage).toHaveClass(/\bhas-stack-edges\b/);
});

test('the Bravais group stays out of the panel while the grid wall is the effective suite', async ({ page }) => {
    // 浮层是主页外观唯一阵地，grid 生效时不该出现 bravais 那一组（组件自带 suite 门控）。
    await bootHome(page, 'grid');
    await openHomeStylePanelDrawer(page);
    await expect(group(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Bravais wall', exact: true })).toHaveCount(0);
});

// 2026-10-09：信息条的材质（始终透明 / 实色预设，互斥）与墙后画面的两个开关也在分组里。
test('the Bravais group switches the info strip material and the backdrop', async ({ page }) => {
    await bootHome(page, 'bravais');
    const stage = page.locator('[data-library-stage="bravais"]');
    await openHomeStylePanelDrawer(page);
    await expect(group(page)).toBeVisible();

    // 信息条始终透明默认开（2026-10-09）：先关掉，下面的实色预设才作用到缝。
    const clear = page.getByRole('switch', { name: 'See-through info strip' });
    await expect(clear).toHaveAttribute('aria-checked', 'true');
    await expect(stage).toHaveClass(/\bhas-clear-seam\b/);
    await clear.click();
    await expect(clear).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => localStorage.getItem('library_wall_seam_clear'))).toBe('false');

    // 预设：8 个色样，默认主题纸色；点「纯白印刷」写进存储，墙上的缝换样式。
    const options = group(page).locator('[data-bravais-seam-style-option]');
    await expect(options).toHaveCount(8);
    await expect(group(page).locator('[data-bravais-seam-style-option="paper"]')).toHaveAttribute('aria-checked', 'true');
    await group(page).locator('[data-bravais-seam-style-option="white"]').click();
    await expect(group(page).locator('[data-bravais-seam-style-option="white"]')).toHaveAttribute('aria-checked', 'true');
    await expect(stage).toHaveAttribute('data-bravais-seam-style', 'white');
    expect(await page.evaluate(() => localStorage.getItem('library_wall_seam_style'))).toBe('white');

    // 再打开始终透明：开着时预设整组禁用（值保留），缝换成透明的纱。
    await expect(clear).toHaveAttribute('aria-checked', 'false');
    await clear.click();
    await expect(clear).toHaveAttribute('aria-checked', 'true');
    await expect(stage).toHaveClass(/\bhas-clear-seam\b/);
    await expect(stage).toHaveAttribute('data-bravais-seam-style', 'clear');
    await expect(group(page).locator('[data-bravais-seam-style-option="dots"]')).toBeDisabled();
    expect(await page.evaluate(() => [localStorage.getItem('library_wall_seam_clear'), localStorage.getItem('library_wall_seam_style')])).toEqual(['true', 'white']);
    await clear.click();
    await expect(stage).toHaveAttribute('data-bravais-seam-style', 'white');
    await expect(group(page).locator('[data-bravais-seam-style-option="dots"]')).toBeEnabled();

    // 墙后画面：两个开关默认关，切换写进存储。
    for (const [name, key] of [['Lyrics behind the wall', 'library_wall_backdrop_lyrics'], ['Blur behind the wall', 'library_wall_backdrop_blur']] as const) {
        const toggle = page.getByRole('switch', { name });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('true');
    }
});
