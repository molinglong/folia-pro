// dev/fork/cdp-wave2-verify.mjs —— 临时取证脚本（跑完删）：在真页面里复核这一刀的三处删除。
// 1) 全新档案首启：不弹「版本更新」、不弹「认识思索模式」，只剩两页提问；
// 2) 设置→帮助底部：没有 Project 署名行、没有版本信息按钮、没有 folia-major 字样。
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3000/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const out = {};

// vite 首次全量转译要几十秒，固定 sleep 会拍到空白页（实测 9s 时 body 只有标题）。一律轮询到挂载。
const waitForApp = async (label) => {
    await page.waitForFunction(() => document.querySelectorAll('*').length > 200, null, { timeout: 120_000 })
        .catch(() => console.log(`WARN ${label} 等挂载超时`));
    await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="playback-entry-view-prompt"], [data-library-stage], [data-library-suite], .bravais-seam-home-tab').length > 0,
        null, { timeout: 120_000 },
    ).catch(() => console.log(`WARN ${label} 等首屏界面超时`));
    await page.waitForTimeout(2500);
};

// —— 第一步：模拟全新档案 ——
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForApp('fresh');
out.fresh = await page.evaluate(() => ({
    releaseNotes: document.querySelectorAll('[data-testid="release-notes-dialog"]').length,
    ponderGate: document.querySelectorAll('[data-testid="ponder-onboarding"]').length,
    prompt: document.querySelectorAll('[data-testid="playback-entry-view-prompt"]').length,
    promptPage: document.querySelector('[data-onboarding-page]')?.getAttribute('data-onboarding-page') ?? null,
    bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 90),
}));
await page.screenshot({ path: 'C:/folia-build/wave2-fresh.png' });

// —— 第二步：把首启标记种成"都答过"，进设置→帮助 ——
await page.evaluate(() => {
    localStorage.setItem('library_suite_prompt_seen', 'true');
    localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('static_mode', 'true');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForApp('seeded');
out.afterSeed = await page.evaluate(async () => {
    const { USER_GUIDE_AUTO_OPEN_VERSION } = await import('/src/components/modal/userGuideContent.ts');
    const { useSettingsModalStore } = await import('/src/stores/useSettingsModalStore.ts');
    useSettingsModalStore.getState().setLastSeenGuideVersion(USER_GUIDE_AUTO_OPEN_VERSION);
    localStorage.setItem('folia_last_seen_guide_version', USER_GUIDE_AUTO_OPEN_VERSION);
    useSettingsModalStore.getState().openSettings('help');
    return { guideVersion: USER_GUIDE_AUTO_OPEN_VERSION };
});
await page.waitForTimeout(7000);
out.helpPage = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
        helpPonderEntry: document.querySelectorAll('[data-testid="help-page-ponder"]').length,
        projectButton: [...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || '').trim() === 'Project:').length,
        copyVersionButton: [...document.querySelectorAll('button')].filter(b => /copy version info/i.test(b.getAttribute('aria-label') || '')).length,
        mentionsRepo: text.includes('folia-major'),
        mentionsProject: text.includes('Project:'),
        hasShortcutTable: text.includes('Space'),
        releaseNotesStillMounted: document.querySelectorAll('[data-testid="release-notes-dialog"]').length,
    };
});
await page.screenshot({ path: 'C:/folia-build/wave2-help-footer.png' });

console.log('RESULT ' + JSON.stringify(out, null, 1));
const bad = [];
if (out.fresh.releaseNotes !== 0) bad.push('首启仍弹版本更新');
if (out.fresh.ponderGate !== 0) bad.push('首启仍弹思索引导');
if (out.fresh.prompt !== 1) bad.push('两页提问没有打开（应保留）');
if (out.helpPage.projectButton !== 0) bad.push('帮助页仍有 Project 署名按钮');
if (out.helpPage.copyVersionButton !== 0) bad.push('帮助页仍有版本信息按钮');
if (out.helpPage.mentionsRepo) bad.push('帮助页文本里仍有 folia-major');
if (out.helpPage.helpPonderEntry !== 1) bad.push('帮助页思索入口丢了（不该删）');
if (!out.helpPage.hasShortcutTable) bad.push('帮助页快捷键说明丢了（不该删）');
console.log(bad.length ? 'RESULT FAIL ' + JSON.stringify(bad) : 'RESULT PASS');
await browser.close();
process.exit(bad.length ? 1 : 0);
