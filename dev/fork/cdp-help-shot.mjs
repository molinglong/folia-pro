// dev/fork/cdp-help-shot.mjs
// @fork 本地魔改版专用：连到自打包 Folia 的 CDP 端口，静音后打开 设置 -> 帮助 并截图。
// 用法: node dev/fork/cdp-help-shot.mjs dump|help
import { chromium } from 'playwright-core';

const mode = process.argv[2] || 'dump';
const OUT = 'C:/folia-build/cdp-help.png';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
const page = pages.find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? pages[0];
console.log('PAGES', pages.map(p => p.url()).join(' | '));

await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => {
        el.muted = true;
        el.volume = 0;
        if (typeof el.pause === 'function') el.pause();
    });
    window.__forkMuted = true;
});

if (mode === 'dump') {
    const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
        .slice(0, 200)
        .map(b => {
            const r = b.getBoundingClientRect();
            return [b.getAttribute('data-testid'), b.getAttribute('aria-label'), b.getAttribute('title'),
                (b.textContent || '').trim().slice(0, 20), `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`]
                .filter(v => v !== null && v !== '').join(' | ');
        }));
    console.log(buttons.join('\n'));
} else {
    await page.getByRole('button', { name: /settings|设置/i }).first().click();
    await page.waitForTimeout(1500);
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"], button'))
        .map(b => (b.textContent || '').trim()).filter(t => t && t.length < 24).slice(0, 60));
    console.log('TABS', JSON.stringify(tabs).replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16)));
    // 帮助页入口可能是 role=tab 也可能是普通按钮，两种都试。
    const help = page.getByRole('tab', { name: /help|帮助/i }).first();
    if (await help.count()) await help.click();
    else await page.locator('button', { hasText: /^(帮助|Help)$/ }).first().click();
    await page.waitForTimeout(2500);
    const helpText = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="settings-modal"]') ?? document.body;
        return (modal.innerText || '').slice(0, 1200);
    });
    console.log('HELPTEXT', JSON.stringify(helpText).replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16)));
    const facts = await page.evaluate(() => ({
        releaseNotesEntry: document.querySelectorAll('[data-testid="help-release-notes"]').length,
        ponderEntry: document.querySelectorAll('[data-testid="help-page-ponder"]').length,
        releaseNotesDialog: document.querySelectorAll('[data-testid="release-notes-dialog"]').length,
        needHelpButtons: Array.from(document.querySelectorAll('button')).filter(b => /need help|遇到问题/i.test(b.textContent || '')).length,
        communityCapsule: Array.from(document.querySelectorAll('button')).filter(b => /join the community|加入社区/i.test(b.textContent || '')).length,
        qqNumber: document.body.innerText.includes('372521584'),
    }));
    console.log('FACTS', JSON.stringify(facts));
    await page.screenshot({ path: OUT, fullPage: false });
    console.log('SHOT', OUT);
}
await browser.close();
