import { expect, test } from './fixtures';

// test/component/classicMvFrost.spec.ts
// classic 的 MV 毛玻璃变体链路：probe 冻结在活跃行、注入一首带 mvId 的在线歌并拦截 mv/url，
// 词下应出现 mask 成字形的毛玻璃贴片；同一 probe 不带 mvfrost 时不应出现。贴片本身（backdrop
// 模糊 + 字形 mask）在真实 Chromium 里验证，jsdom 覆盖不了。

const MV_STREAM_URL = 'https://mv.test/stream.mp4';

test('classic paints glyph frost patches under words when the MV background is live', async ({ page }) => {
    await page.route('**/mv/url**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, data: [{ id: 54321, url: MV_STREAM_URL, r: 1080 }] }),
    }));
    await page.route('https://mv.test/**', route => route.abort());
    await page.goto('/dev-probe.html?probe=visualizerMemory&vis=classic&freeze=1&cjk=1&lines=24&mvfrost=1');

    const stage = page.locator('[data-probe-mode="classic"]');
    // MvBackground mounts the MV stream element: store injection -> provider resolution -> background entry all work.
    await expect(stage.locator('video')).toHaveCount(1);

    // The frost patch under each word: backdrop blur on, mask fed by the canvas glyph dataURL.
    const frost = stage.locator('[data-glow-word-frost]');
    await expect(frost.first()).toBeAttached();
    const styles = await frost.first().evaluate(element => ({
        backdropFilter: element.style.backdropFilter,
        maskImage: element.style.maskImage,
        opacity: element.style.opacity,
    }));
    expect(styles.backdropFilter).toContain('blur(16px)');
    expect(styles.maskImage).toContain('data:image/');
    expect(Number(styles.opacity)).toBeCloseTo(0.9, 5);
});

test('classic skips the frost patches without a live MV', async ({ page }) => {
    await page.goto('/dev-probe.html?probe=visualizerMemory&vis=classic&freeze=1&cjk=1&lines=24');

    const stage = page.locator('[data-probe-mode="classic"]');
    await expect(stage.locator('video')).toHaveCount(0);
    await expect(stage.locator('[data-glow-word-frost]')).toHaveCount(0);
});
