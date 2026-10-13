// dev/fork/cdp-spine-shot.mjs
// @fork 本地魔改版专用（2026-10-12）：连到开发版 Folia 的 CDP 端口，先静音，再按 DOM 读窄缝/书脊的三处改版实况并截图。
// 用法: node dev/fork/cdp-spine-shot.mjs            → 只读状态 + 打印证据 + 截图
//       node dev/fork/cdp-spine-shot.mjs home       → 先点「返回主页」回到首页窄缝，再读再截
//       node dev/fork/cdp-spine-shot.mjs open       → 先把窄缝展开（点折叠钮），再读再截
//       node dev/fork/cdp-spine-shot.mjs fold       → 把窄缝折回书脊，再读再截
// 判据全部来自真实窗口的 DOM 与矩形，不靠截图估坐标。
import { chromium } from 'playwright-core';

const mode = process.argv[2] || 'dump';
const OUT_FULL = 'C:/folia-build/spine-full.png';
const OUT_SEAM = 'C:/folia-build/spine-seam.png';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 120_000 });
const ctx = browser.contexts()[0];
const pages = ctx.pages();
const page = pages.find(p => /localhost|index\.html|file:\/\//.test(p.url())) ?? pages[0];
console.log('URL', page.url());

// vite dev 首屏是全量转译，要几十秒：先等页面真的有内容，别在空白 body 上取证据（空白页上「元素不存在」是假的）。
await page.waitForFunction(() => document.querySelectorAll('*').length > 200, null, { timeout: 180_000 });
console.log('NODES', await page.evaluate(() => document.querySelectorAll('*').length));

// 静音 + 暂停：这是播放器，核验期间不许出声。
await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => {
        el.muted = true;
        el.volume = 0;
        if (typeof el.pause === 'function') el.pause();
    });
});

// 需要时回到首页窄缝（客户端会记住上次那页，可能是某张集合）。
if (mode === 'home') {
    const clicked = await page.evaluate(() => {
        const el = document.querySelector('[aria-label*="主页"], [title*="主页"], [data-bravais-seam-action="home"]');
        if (!el) return null;
        el.click();
        return (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-bravais-seam-action'));
    });
    console.log('HOME_CLICK', clicked);
    await page.waitForTimeout(2500);
}

// 需要切换窄缝开合（折叠钮的动作为 hide，与用例同一个钩子）。
if (mode === 'open' || mode === 'fold') {
    const handle = await page.locator('[data-bravais-home-seam] [data-bravais-seam-action="hide"]').handle();
    const box = await page.locator('[data-bravais-seam]').first().boundingBox();
    const isSpine = box !== null && box.width < 70;
    if ((mode === 'open') === isSpine) await page.locator('[data-bravais-home-seam] [data-bravais-seam-action="hide"]').click();
    await page.waitForTimeout(1200);
}

const evidence = await page.evaluate(() => {
    const box = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const root = document.querySelector('[data-bravais-home-seam]');
    const title = document.querySelector('.bravais-seam-home-title');
    const tabs = document.querySelector('.bravais-seam-home-nav .bravais-seam-tabs[role="tablist"]');
    const group = document.querySelector('.bravais-seam-home-nav [data-bravais-shortcuts]');
    const jumps = document.querySelector('[data-bravais-home-jumps]');
    // 账户入口有两档：宽一些时是 .bravais-account-entry，窄/矮时（fit=untitled|menu|short 或缝窄）走 compact 分支，
    // 那颗是 .bravais-account-spine。只查前者会在 compact 档假阴性（account:null 看着像"入口没了"，其实只是选错class）。
    const entry = document.querySelector('.bravais-account-entry, .bravais-account-spine');
    const style = el => (el ? getComputedStyle(el) : null);
    return {
        seam: box(root),
        seamWidth: root?.getBoundingClientRect().width ?? null,
        fit: root?.getAttribute('data-bravais-home-fit') ?? null,
        shortcutsAttr: root?.getAttribute('data-bravais-home-shortcuts') ?? null,
        suite: document.querySelector('[data-bravais-seam]') ? 'bravais' : 'other',
        title: title ? {
            text: title.textContent.trim(),
            state: title.getAttribute('data-bravais-home-title'),
            ...box(title),
        } : null,
        tabs: tabs ? {
            aria: tabs.getAttribute('aria-label'),
            writingMode: style(tabs.querySelector('[data-bravais-tab]'))?.writingMode,
            fontSize: style(tabs.querySelector('[data-bravais-tab]'))?.fontSize,
            ...box(tabs),
        } : null,
        shortcutGroup: group ? {
            role: group.getAttribute('role'),
            aria: group.getAttribute('aria-label'),
            inHead: group.closest('.bravais-seam-home-head') !== null,
            ...box(group),
        } : null,
        shortcuts: Array.from(document.querySelectorAll('.bravais-seam-home-nav [data-bravais-shortcut]')).map(el => ({
            kind: el.dataset.bravaisShortcut,
            text: el.textContent.trim(),
            aria: el.getAttribute('aria-label'),
            writingMode: getComputedStyle(el).writingMode,
            fontSize: getComputedStyle(el).fontSize,
            ...box(el),
        })),
        jumpsChildren: jumps ? jumps.childElementCount : null,
        account: entry ? {
            text: entry.textContent.trim(),
            names: entry.querySelectorAll('.is-name').length,
            aria: entry.getAttribute('aria-label'),
            title: entry.getAttribute('title'),
            ...box(entry),
        } : null,
        menuShortcutItems: Array.from(document.querySelectorAll('.bravais-seam-menu button.is-shortcut')).map(el => el.textContent.trim()),
    };
});
console.log(JSON.stringify(evidence, null, 2));

await page.screenshot({ path: OUT_FULL });
const seam = await page.locator('[data-bravais-seam]').first().boundingBox();
if (seam) {
    await page.screenshot({
        path: OUT_SEAM,
        clip: { x: Math.max(0, seam.x - 8), y: Math.max(0, seam.y - 8), width: seam.width + 16, height: Math.min(seam.height + 16, 1400) },
        scale: 'device',
    });
}
console.log('SHOTS', OUT_FULL, OUT_SEAM);
// 不用 browser.close()：这里是连进开发版窗口取证，窗口要给用户留着看。直接退出进程，断开 CDP 连接即可。
process.exit(0);
