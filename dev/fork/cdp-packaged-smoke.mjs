// dev/fork/cdp-packaged-smoke.mjs
// @fork 本地魔改版专用（2026-10-13）：对**打包产物**本体做 smoke test —— skills/fork-build-package 的第 1、2 条。
// 用法: node dev/fork/cdp-packaged-smoke.mjs [profileDir] [port]
// 为什么要独立档案: 用户机器上可能有一个 dev 电子壳（node_modules/electron ... --remote-debugging-port=9222）占着
// %APPDATA%\Folia 的单实例锁，直接 Start-Process Folia.exe 会秒退（本次实测踩过）。给它自己的 user-data-dir 就绕开了，
// 也不碰用户真实档案。代价：这个档案没登录、没有在线曲库，只能验 UI 骨架与两颗入口的存在/几何/进出。
import { chromium } from 'playwright-core';

const PROFILE = process.argv[2] ?? 'C:\\folia-dev-profile';
const PORT = process.argv[3] ?? '9223';
const OUT = 'C:/folia-build';
const problems = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
    if (!ok) problems.push(name);
};

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const pages = browser.contexts()[0].pages();
const page = pages.find(p => !/devtools:/.test(p.url())) ?? pages[0];
console.log('URL', page.url());

await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; el.pause?.(); });
});

// 独立档案首启会挡引导层：资料库用哪种界面 / 思索卡。逐层按「关闭」与「就这样」，最多六轮。
for (let step = 0; step < 6; step++) {
    const clicked = await page.evaluate(() => {
        const wanted = ['关闭', '就这样', '下一步', '完成', '开始使用'];
        const hit = [...document.querySelectorAll('button')].find(b => {
            const name = b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent || '').trim();
            return wanted.includes(name) && b.getBoundingClientRect().width > 0;
        });
        if (!hit) return null;
        const name = hit.getAttribute('aria-label') || hit.getAttribute('title') || (hit.textContent || '').trim();
        hit.click();
        return name;
    });
    if (!clicked) break;
    console.log('DISMISS', clicked);
    await page.waitForTimeout(1200);
}

const wall = await page.waitForSelector('.lattice-tools', { timeout: 90_000 }).catch(() => null);
const state = await page.evaluate(() => ({
    hash: location.hash,
    stage: document.querySelector('[data-library-stage]')?.getAttribute('data-library-stage') ?? null,
    layer: document.querySelector('[data-library-stage]')?.getAttribute('data-bravais-layer') ?? null,
    tools: document.querySelectorAll('.lattice-tools').length,
    companion: document.querySelectorAll('[data-wall-tools-companion]').length,
    suiteOptions: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => t && t.length < 18).slice(0, 18),
}));
if (!wall) {
    console.log('RESULT FAIL 打包版没等到 .lattice-tools', JSON.stringify(state, null, 1));
    process.exit(1);
}
check('打包版起得来、渲染出墙面', state.tools >= 1, state);
check('常驻那颗在打包版里也画了', state.companion === 1, state);

const geometry = await page.evaluate(() => {
    const box = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const companion = document.querySelector('[data-wall-tools-companion]');
    const tools = document.querySelector('.lattice-tools button:not([data-wall-tools-companion])');
    return companion && tools ? { companion: box(companion), tools: box(tools), stack: box(document.querySelector('.lattice-tools')), label: companion.getAttribute('aria-label') } : null;
});
check('几何与 dev 壳一致（48×48、正上方 10px、容器没被撑高）', Boolean(geometry
    && geometry.companion.w === 48 && geometry.companion.h === 48
    && Math.abs(geometry.tools.y - (geometry.companion.y + geometry.companion.h) - 10) < 1
    && geometry.stack.w === 48 && geometry.stack.h === 48), geometry);

if (geometry) {
    await page.screenshot({ path: `${OUT}/packaged-corner.png`, clip: {
        x: Math.max(0, geometry.stack.x - 340), y: Math.max(0, geometry.stack.y - 340), width: 360, height: 360,
    } }).catch(() => null);
}

// 点它 → 进 Lattice（打包版没登录，队列空，落到 Lattice 的空态也算进得去）。
await page.evaluate(() => document.querySelector('[data-wall-tools-companion]')?.click());
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({
    hash: location.hash,
    lattice: document.querySelectorAll('#lattice, [data-wall-handoff-layer="lattice"]').length,
    empty: document.querySelectorAll('.lattice-empty').length,
    companion: document.querySelectorAll('[data-wall-tools-companion]').length,
}));
check('点了真的进 Lattice', after.hash === '#lattice' || after.lattice > 0, after);
check('进了 Lattice 这颗不再画', after.companion === 0, after);
await page.screenshot({ path: `${OUT}/packaged-lattice.png` }).catch(() => null);

console.log(problems.length ? `RESULT FAIL ${problems.join(' | ')}` : 'RESULT PASS 全部通过');
await browser.close().catch(() => {});
process.exit(problems.length ? 1 : 0);
