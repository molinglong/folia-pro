// dev/fork/cdp-wall-gear.mjs
// @fork 本地魔改版专用：连到桌面开发态 Folia 的 CDP（9222），先静音，再在真窗口里验墙面工具面板底部那颗「设置」齿轮，并截图留证。
// 用法: node dev/fork/cdp-wall-gear.mjs
// 前提: vite 在 3000、electron 用 --remote-debugging-port=9222 起（见 skills/fork-build-package 的 dev 段）。
// 判据（与 test/component/bravaisChrome.spec.ts 同一条路，只是换成真桌面壳）：齿轮可见 → 点了面板收起 → 设置窗真的出现（DOM 节点跳变 + 侧栏分组标题）→ Esc 能关。
import { chromium } from 'playwright-core';

const OUT = 'C:/folia-build';
const fail = messages => { console.log('RESULT FAIL ' + JSON.stringify(messages, null, 1)); process.exit(1); };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts()[0].pages();
const page = pages.find(p => /localhost:3000|index\.html/.test(p.url())) ?? pages[0];
if (!page) fail(['CDP 上没有可用页面', pages.map(p => p.url())]);
console.log('URL', page.url());

// 先静音：真窗口里可能已经恢复了上次的播放状态。
await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => {
        el.muted = true;
        el.volume = 0;
        if (typeof el.pause === 'function') el.pause();
    });
    window.__forkMuted = true;
});

// 空档案首次启动会弹「版本更新」（z-[210] 遮罩），它盖在墙面上会让截图看不见面板。先按它自己的「关闭」按钮。
const dismissed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '关闭'
        && b.closest('div.fixed.inset-0')?.className.includes('z-[210]'));
    if (!btn) return false;
    btn.click();
    return true;
});
await page.waitForTimeout(700);

const wall = await page.waitForSelector('.lattice-tools', { timeout: 90_000 }).catch(() => null);
if (!wall) {
    const headings = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 12));
    fail(['没等到 .lattice-tools（可能停在引导页 / 不是 bravais 层）', headings]);
}

const openPanel = async () => {
    await page.evaluate(() => document.querySelector('.lattice-tools button')?.click());
    await page.waitForSelector('[data-wall-tools-settings]', { timeout: 8_000 }).catch(() => null);
    return page.evaluate(() => {
        const gear = document.querySelector('[data-wall-tools-settings]');
        const section = gear?.closest('.lattice-tools-help-section');
        return {
            gear: !!gear,
            label: gear?.getAttribute('aria-label'),
            row: section ? [...section.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) : null,
            stage: document.querySelector('[data-library-stage]')?.getAttribute('data-library-stage') ?? null,
        };
    });
};

const first = await openPanel();
if (!first.gear) fail(['面板里没有齿轮', first]);
await page.screenshot({ path: `${OUT}/wall-gear-open.png` });

const before = await page.evaluate(() => document.querySelectorAll('*').length);
await page.evaluate(() => document.querySelector('[data-wall-tools-settings]').click());
const panelGone = await page.waitForFunction(() => !document.querySelector('.lattice-tools-panel'), null, { timeout: 5_000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1_800);
const after = await page.evaluate(() => document.querySelectorAll('*').length);
const settings = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('h1,h2,h3,h4,[class*="heading"]')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 10),
    stillOnWall: !!document.querySelector('[data-library-stage]'),
}));
await page.screenshot({ path: `${OUT}/wall-gear-settings.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(1_200);
const afterEsc = await page.evaluate(() => ({
    settingsHeadings: [...document.querySelectorAll('h1,h2,h3,h4,[class*="heading"]')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 6),
    onWall: !!document.querySelector('[data-library-stage]'),
}));
// 收尾：把墙上的音视频再压一遍，确认没东西在响。
const audioState = await page.evaluate(() => [...document.querySelectorAll('audio, video')].map(el => ({ muted: el.muted, paused: el.paused })));

const opened = after > before + 100;
console.log('RESULT ' + JSON.stringify({ dismissed, first, panelGone, nodes: { before, after }, opened, settings, afterEsc, audioState }, null, 1));
if (!panelGone || !opened || !settings.stillOnWall) fail(['齿轮行为不符预期']);
console.log('SHOTS ' + `${OUT}/wall-gear-open.png, ${OUT}/wall-gear-settings.png`);
await browser.close();
process.exit(0);
