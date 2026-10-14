import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/settingsNavigation.spec.ts
// 设置侧栏的分组结构、搜索过滤和锚点注册只在真实浏览器里成立：IntersectionObserver、
// 延迟挂载的异步区块、以及 Tailwind v4 `space-x` 对隐藏兄弟节点的处理都不是单测能覆盖的。
// 侧栏曾常驻分区下的二级锚点目录，现已删除，故这里也断言目录不再出现。
// 探针见 dev/probes/settingsNavigation.probe.tsx。

const sidebarItem = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });

test.describe('settings navigation - wide layout', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('groups the sections under their headings', async ({ mount, page }) => {
        await mount('settingsNavigation');

        for (const heading of ['Appearance', 'Controls', 'Connections & Data', 'System']) {
            await expect(page.getByText(heading, { exact: true })).toBeVisible();
        }
    });

    test('lists sections only, with no anchor table of contents', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // The sidebar lists sections only: anchor labels never render as buttons, and the active
        // section is told out loud through aria-current instead of a highlighted anchor row.
        await expect(sidebarItem(page, 'Alpha Section')).toHaveCount(0);
        await expect(sidebarItem(page, 'visualSettings')).toHaveAttribute('aria-current', 'true');
        await expect(sidebarItem(page, 'desktopSettings')).toHaveCount(1);
    });

    test('moves the active card to the clicked section', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await sidebarItem(page, 'generalSettings').click();

        await expect(sidebarItem(page, 'generalSettings')).toHaveAttribute('aria-current', 'true');
        await expect(sidebarItem(page, 'visualSettings')).not.toHaveAttribute('aria-current');
        await expect(sidebarItem(page, 'Alpha Section')).toHaveCount(0);
    });

    test('filters the section list while searching', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // A query keeps only the matching section card; its anchors stay out of the sidebar.
        await page.locator('input[type="search"]').fill('desktopSettings');

        await expect(sidebarItem(page, 'desktopSettings')).toBeVisible();
        await expect(sidebarItem(page, 'visualSettings')).toHaveCount(0);
    });

    test('slots a late-arriving section into its document position', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // The late block lives in the content column; the sidebar never listed it as an anchor row.
        await expect(page.getByText('Bravo Late Section', { exact: true })).toBeVisible();
        await expect(page.locator('[data-settings-anchor="importExportTitle"]')).toBeVisible();
        await expect(sidebarItem(page, 'Bravo Late Section')).toHaveCount(0);

        const labels = await page.evaluate(() => (
            [...document.querySelectorAll('[data-settings-anchor]')].map(node => node.getAttribute('data-settings-anchor'))
        ));
        expect(labels).toEqual(['lyricsRenderer', 'themePresets', 'importExportTitle', 'stageTrackPill', 'grid3dCardStyle', 'latticeSettings']);
    });
});

test.describe('settings navigation - narrow layout', () => {
    test.use({ viewport: { width: 375, height: 720 } });

    test('keeps the chip strip flat, with no grouping and no table of contents', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(page.getByText('Appearance', { exact: true })).toHaveCount(0);
        await expect(sidebarItem(page, 'Alpha Section')).toHaveCount(0);
    });

    test('spaces adjacent chips exactly 8px apart', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // Tailwind v4 drops the :not([hidden]) guard on space-x, so a hidden group heading rendered
        // as a sibling would silently add a margin here. This pins the strip's real spacing.
        const gap = await page.evaluate(() => {
            const strip = document.querySelector('.space-x-2');
            if (!strip) return null;
            const [first, second] = [...strip.children].map(child => child.getBoundingClientRect());
            return second && first ? Math.round(second.left - first.right) : null;
        });

        expect(gap).toBe(8);
    });
});
