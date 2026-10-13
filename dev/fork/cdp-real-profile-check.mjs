// dev/fork/cdp-real-profile-check.mjs —— 真档案（%APPDATA%\Folia）桌面壳实测：
// 1) 首启三处删除在真实档案里同样成立；2) 墙面齿轮在真曲库里可用；3) 记录档案确实带来了内容。
// 前提：vite 在 3000，electron 用 --remote-debugging-port=9222 起。只开/关面板与设置窗，不改任何设置、不点播放。
import { chromium } from 'playwright-core';

const OUT = 'C:/folia-build';
const fail = msgs => { console.log('RESULT FAIL ' + JSON.stringify(msgs, null, 1)); process.exit(1); };

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts()[0].pages();
const page = pages.find(p => /localhost:3000|index\.html/.test(p.url())) ?? pages[0];
if (!page) fail(['CDP 上没有页面', pages.map(p => p.url())]);

// 先静音：真实档案很可能恢复了上次的播放。
await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; el.pause?.(); });
});

await page.waitForSelector('.lattice-tools', { timeout: 90_000 }).catch(() => null);

const out = {};
out.library = await page.evaluate(() => ({
    stage: document.querySelector('[data-library-stage]')?.getAttribute('data-library-stage') ?? null,
    posters: document.querySelectorAll('[data-poster-tile], .bravais-tile, [data-wall-tile]').length,
    tabs: [...document.querySelectorAll('.bravais-seam-home-tab')].map(b => b.textContent.trim()).slice(0, 6),
    devStrip: [...document.querySelectorAll('*')].map(e => e.textContent).find(t => /Collection view|集合视图/.test(t || ''))?.replace(/\s+/g, ' ').slice(0, 60) ?? null,
    accounts: (document.body.innerText || '').includes('Connect a streaming service') || (document.body.innerText || '').includes('连接在线平台'),
}));

out.removals = await page.evaluate(() => ({
    releaseNotes: document.querySelectorAll('[data-testid="release-notes-dialog"]').length,
    ponderGate: document.querySelectorAll('[data-testid="ponder-onboarding"]').length,
    prompt: document.querySelectorAll('[data-testid="playback-entry-view-prompt"]').length,
}));

// —— 齿轮：开面板 → 点齿轮 → 设置窗出现 → Esc 关掉 ——
await page.evaluate(() => document.querySelector('.lattice-tools button')?.click());
await page.waitForSelector('[data-wall-tools-settings]', { timeout: 8_000 }).catch(() => null);
out.gear = await page.evaluate(() => {
    const g = document.querySelector('[data-wall-tools-settings]');
    const row = g?.closest('.lattice-tools-help-section');
    return { present: !!g, label: g?.getAttribute('aria-label') ?? null, row: row ? [...row.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) : null };
});
if (!out.gear.present) fail(['真档案窗口里没有齿轮', out]);

const before = await page.evaluate(() => document.querySelectorAll('*').length);
await page.evaluate(() => document.querySelector('[data-wall-tools-settings]').click());
const panelGone = await page.waitForFunction(() => !document.querySelector('.lattice-tools-panel'), null, { timeout: 5_000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1800);
out.settings = await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    groupTitles: [...document.querySelectorAll('h1,h2,h3,h4,[class*="heading"]')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 8),
}));
await page.screenshot({ path: `${OUT}/real-profile-settings.png` });

// 帮助页：三处删除要在真档案里同样成立。
out.help = await page.evaluate(async () => {
    const { useSettingsModalStore } = await import('/src/stores/useSettingsModalStore.ts');
    useSettingsModalStore.getState().openSettings('help');
    return true;
});
await page.waitForTimeout(2500);
out.helpPage = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
        helpPonderEntry: document.querySelectorAll('[data-testid="help-page-ponder"]').length,
        projectButton: [...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || '').trim() === 'Project:').length,
        copyVersionButton: [...document.querySelectorAll('button')].filter(b => /copy version info/i.test(b.getAttribute('aria-label') || '')).length,
        mentionsRepo: text.includes('folia-major'),
        releaseNotes: document.querySelectorAll('[data-testid="release-notes-dialog"]').length,
    };
});
await page.screenshot({ path: `${OUT}/real-profile-help.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
out.afterEsc = await page.evaluate(() => ({
    onWall: !!document.querySelector('[data-library-stage]') || !!document.querySelector('.lattice-tools'),
    nodes: document.querySelectorAll('*').length,
}));
out.audio = await page.evaluate(() => [...document.querySelectorAll('audio, video')].map(el => ({ muted: el.muted, paused: el.paused })));

console.log('RESULT ' + JSON.stringify({ ...out, nodesBefore: before }, null, 1));
const bad = [];
if (out.removals.releaseNotes !== 0) bad.push('真档案里仍弹版本更新');
if (out.removals.ponderGate !== 0) bad.push('真档案里仍弹思索引导');
if (out.helpPage.projectButton !== 0 || out.helpPage.copyVersionButton !== 0 || out.helpPage.mentionsRepo) bad.push('帮助页仍有署名/版本信息');
if (!panelGone || out.settings.nodes < before + 100) bad.push('点齿轮后面板没收起或设置窗没出现');
if (out.helpPage.helpPonderEntry !== 1) bad.push('帮助页思索入口丢了');
console.log(bad.length ? 'RESULT FAIL ' + JSON.stringify(bad) : 'RESULT PASS');
await browser.close();
process.exit(bad.length ? 1 : 0);
