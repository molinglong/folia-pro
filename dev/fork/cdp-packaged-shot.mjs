// dev/fork/cdp-packaged-shot.mjs
// 打包版外观补一张：smoke 脚本的 clip 算窄了，把常驻那颗截掉了。这里回到墙面重截一张能看清两颗的。
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9223';
const OUT = 'C:/folia-build';

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('index.html')) ?? context.pages()[0];

// 静音：这是用户真实听歌环境。
await page.evaluate(() => {
    for (const el of document.querySelectorAll('audio, video')) {
        el.muted = true;
        el.pause?.();
    }
});

// 回到首页墙：Escape 直到 layer 是 home:*，退出 Lattice。
for (let i = 0; i < 8; i++) {
    const state = await page.evaluate(() => ({
        lattice: Boolean(document.querySelector('.lattice')),
        layer: document.querySelector('[data-bravais-layer]')?.getAttribute('data-bravais-layer') ?? '',
        companion: document.querySelectorAll('[data-wall-tools-companion]').length,
    }));
    if (state.companion === 1) break;
    if (state.lattice) {
        await page.evaluate(() => document.querySelector('.lattice-back')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    } else {
        await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(700);
}

const box = await page.evaluate(() => {
    const r = document.querySelector('[data-wall-tools-companion]')?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
});
if (!box) {
    console.log('NO-COMPANION 没回到有常驻那颗的墙面');
} else {
    // 以常驻那颗为右下角基准，往上/往左各留足空间，把两颗和面板都框进来。
    await page.screenshot({
        path: `${OUT}/packaged-corner.png`,
        clip: { x: Math.max(0, box.x - 300), y: Math.max(0, box.y - 240), width: 340, height: 400 },
    });
    console.log('SHOT', JSON.stringify(box));
}
await browser.close().catch(() => null);
process.exit(0);
