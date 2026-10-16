import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frame = (page: Page, id = 'baseline') => page.frameLocator(`[data-variant="${id}"] iframe`);
const labRoot = new URL('..', import.meta.url);

test('十类模板、三种尺寸、所有场景、无外部业务与存储写入', async ({ page, context }) => {
    test.setTimeout(120_000);
    const external: string[] = [];
    const business: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); return route.abort(); }
        if (/\/src\/|\/api\/|service-worker|sw\.js/.test(url.pathname)) business.push(url.pathname);
        return route.continue();
    });
    await context.addInitScript(() => {
        Storage.prototype.setItem = () => { throw new Error('禁止写入正式存储'); };
        Storage.prototype.removeItem = () => { throw new Error('禁止删除正式存储'); };
        Storage.prototype.clear = () => { throw new Error('禁止清空正式存储'); };
        indexedDB.open = () => { throw new Error('禁止打开正式数据库'); };
    });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: '页面模板' }).getByRole('button')).toHaveCount(10);
    const pages = ['home', 'player', 'settings', 'collection', 'search', 'capsule', 'playback-quick', 'wall-tools', 'home-style', 'wall'];
    for (const id of pages) {
        await page.goto(`/?page=${id}`);
        await expect(frame(page).locator(`[data-template="${id}"]`)).toBeVisible();
        for (const [device, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['phone', 390, 844]] as const) {
            await page.getByLabel('画布尺寸').selectOption(device);
            await expect.poll(() => frame(page).locator('body').evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
            await expect.poll(() => frame(page).locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.getByLabel('预览主题').selectOption('dark');
        await expect(frame(page).locator('html')).toHaveAttribute('data-theme', 'dark');
        const scenes = await page.getByLabel('示例场景').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
        for (const scene of scenes) {
            await page.getByLabel('示例场景').selectOption(scene);
            await expect(frame(page).locator(`[data-template="${id}"]`)).toBeVisible();
            await expect(frame(page).getByRole('alert')).toHaveCount(0);
        }
        await expect.poll(() => frame(page).locator('body').evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    }
    expect(external).toEqual([]);
    expect(business).toEqual([]);
    expect(errors).toEqual([]);
});

test('设置四案隔离、主题场景重置、URL 恢复与响应式布局', async ({ page }, testInfo) => {
    await page.goto('/?page=settings&experiment=layout-study&mode=grid');
    await expect(page.locator('iframe')).toHaveCount(4);
    for (const id of ['baseline', 'a', 'b', 'c']) await expect(frame(page, id).getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('settings-comparison.png'), fullPage: true });
    const baselineToggle = frame(page).getByRole('switch').first();
    const before = await baselineToggle.getAttribute('aria-checked');
    await baselineToggle.click();
    expect(await baselineToggle.getAttribute('aria-checked')).not.toBe(before);
    expect(await frame(page, 'a').getByRole('switch').first().getAttribute('aria-checked')).toBe(before);
    await frame(page, 'b').locator('body').evaluate(() => { document.body.style.backgroundColor = 'rgb(255, 0, 0)'; });
    expect(await frame(page).locator('body').evaluate(el => el.style.backgroundColor)).toBe('');
    await page.getByLabel('重置所有可见方案').click();
    await expect(baselineToggle).toHaveAttribute('aria-checked', before!);
    await page.getByLabel('示例场景').selectOption('graphics');
    await page.getByLabel('预览主题').selectOption('dark');
    for (const id of ['baseline', 'a', 'b', 'c']) {
        await expect(frame(page, id).getByRole('heading', { name: '图形', exact: true })).toBeVisible();
        await expect(frame(page, id).locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    const dimensions = await frame(page, 'b').getByRole('navigation').evaluate(el => ({ direction: getComputedStyle(el).flexDirection }));
    expect(dimensions.direction).toBe('row');
    for (const [device, width] of [['desktop', 1440], ['tablet', 768], ['phone', 390]] as const) {
        await page.getByLabel('画布尺寸').selectOption(device);
        for (const id of ['baseline', 'a', 'b', 'c']) {
            await expect.poll(() => frame(page, id).locator('body').evaluate(() => innerWidth)).toBe(width);
            await expect.poll(() => frame(page, id).locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
    }
    await page.reload();
    await expect(page.getByLabel('示例场景')).toHaveValue('graphics');
    await expect(page.getByLabel('预览主题')).toHaveValue('dark');
    for (const id of ['baseline', 'a', 'b', 'c']) {
        await expect(frame(page, id).getByRole('heading', { name: '图形', exact: true })).toBeVisible();
        await expect(frame(page, id).locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect.poll(() => frame(page, id).locator('body').evaluate(() => innerWidth)).toBe(390);
    }
    await page.screenshot({ path: testInfo.outputPath('settings-phone.png'), fullPage: true });
    await page.getByRole('button', { name: '双栏对比', exact: true }).click();
    await page.getByLabel('左侧方案').selectOption('b');
    await page.getByLabel('右侧方案').selectOption('c');
    await expect(page.locator('iframe')).toHaveCount(2);
    await page.getByRole('button', { name: '单独查看', exact: true }).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(frame(page, 'b').getByRole('dialog')).toBeVisible();
});

test('同一时钟驱动可见方案，暂停与减少动态效果，拒收伪造来源', async ({ page }) => {
    await page.goto('/?page=settings&experiment=layout-study');
    await expect(frame(page).getByRole('dialog')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: { channel: 'folia-design-lab', version: 1, type: 'action', command: { action: 'toggle' } } })));
    await expect(page.getByLabel('播放模拟动画')).toBeVisible();
    await page.getByLabel('播放模拟动画').click();
    for (const id of ['baseline', 'a']) await expect(frame(page, id).locator('html')).toHaveAttribute('data-playing', 'true');
    await page.getByLabel('暂停模拟动画').click();
    await page.getByRole('navigation', { name: '页面模板' }).getByRole('button', { name: /播放器与歌词/ }).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(frame(page).getByLabel('播放进度')).toHaveValue('42');
    await page.getByLabel('模拟时间').fill('96');
    await expect(frame(page).getByLabel('播放进度')).toHaveValue('96');
    await frame(page).getByLabel('播放', { exact: true }).click();
    await expect.poll(() => frame(page).getByLabel('播放进度').inputValue().then(Number)).toBeGreaterThan(96);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByLabel('播放模拟动画')).toBeDisabled();
    await expect(frame(page).locator('html')).toHaveAttribute('data-reduced-motion', 'true');
});

test('搜索、空列表、浮层 Esc、音量与样式选择', async ({ page }) => {
    await page.goto('/?page=search');
    await frame(page).getByLabel('搜索音乐').fill('不存在');
    await frame(page).getByRole('button', { name: '搜索', exact: true }).click();
    await expect(frame(page).getByRole('heading', { name: '没有找到相关音乐' })).toBeVisible();
    await frame(page).getByRole('button', { name: '查看全部示例' }).click();
    await expect(frame(page).getByLabel('搜索结果')).toBeVisible();
    await page.goto('/?page=collection&scene=empty');
    await expect(frame(page).getByRole('heading', { name: '还没有歌曲' })).toBeVisible();
    await page.goto('/?page=playback-quick');
    await frame(page).getByLabel('静音', { exact: true }).click();
    await expect(frame(page).getByLabel('音量')).toHaveValue('0');
    await frame(page).getByLabel('音量').fill('80');
    await expect(frame(page).getByLabel('静音', { exact: true })).toHaveAttribute('aria-pressed', 'false');
    await frame(page).getByLabel('音量').press('Escape');
    await expect(frame(page).getByRole('dialog')).toHaveCount(0);
    await frame(page).getByLabel('打开播放快捷').click();
    await expect(frame(page).getByRole('dialog')).toBeVisible();
    await page.goto('/?page=home-style');
    await frame(page).getByRole('button', { name: '卡片', exact: true }).click();
    await expect(frame(page).getByRole('status')).toContainText('卡片样式');
});

test('错误单案不会拖垮相邻方案，无效链接给出提示', async ({ page }) => {
    await page.goto('/?page=settings&experiment=layout-study');
    await expect(frame(page, 'a').getByRole('dialog')).toBeVisible();
    await frame(page).locator('body').evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: '测试用局部错误' })));
    await expect(frame(page).getByRole('alert')).toContainText('测试用局部错误');
    await expect(frame(page, 'a').getByRole('dialog')).toBeVisible();
    await page.goto('/frame.html?entry=/src/App.tsx');
    await expect(page.getByRole('alert')).toContainText('未登记');
    await page.goto('/?page=unknown&experiment=unknown&device=bad');
    await expect(page.getByRole('alert')).toContainText('找不到页面');
});

test('只改 B 热更新，基准 A C 的文件及交互状态不变', async ({ page }) => {
    const file = fileURLToPath(new URL('experiments/settings/layout-study/b/View.tsx', labRoot));
    const original = readFileSync(file, 'utf8');
    const others = ['baseline', 'a', 'c'].map(id => ({ id, file: fileURLToPath(new URL(`experiments/settings/layout-study/${id}/View.tsx`, labRoot)) })).map(item => ({ ...item, content: readFileSync(item.file, 'utf8') }));
    await page.goto('/?page=settings&experiment=layout-study&mode=grid');
    await expect(frame(page, 'b').getByRole('dialog')).toBeVisible();
    await frame(page, 'a').getByLabel('关闭设置').click();
    try {
        writeFileSync(file, original.replace('<h1>{selected.label}</h1>', '<h1>{selected.label} · HMR 验收</h1>'));
        await expect(frame(page, 'b').getByRole('heading', { name: /HMR 验收/ })).toBeVisible();
        await expect(frame(page, 'a').getByRole('button', { name: '打开设置' })).toBeVisible();
        for (const item of others) {
            expect(readFileSync(item.file, 'utf8')).toBe(item.content);
            await expect(frame(page, item.id).getByText('HMR 验收', { exact: false })).toHaveCount(0);
        }
    } finally { writeFileSync(file, original); }
});
