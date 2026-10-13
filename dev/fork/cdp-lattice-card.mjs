// dev/fork/cdp-lattice-card.mjs
// @fork 本地魔改版专用（2026-10-13 第八刀，配 cdp-lattice-entries.mjs 的第二半）：
// 在真窗口里下钻进一个歌单，展开一张「不是正在播放」的歌曲聚焦卡，证明那颗 open-lattice 已经不再要求正在播放。
// 用法: node dev/fork/cdp-lattice-card.mjs
// 为什么要下钻：首页墙上的磁贴是歌单（data-library-card="card:playlist:…"），带 data-library-entry 的歌曲磁贴在歌单层里；
// 展开点在磁贴内的 article 上（与 test/component/bravaisPlayingCard.spec.ts 的 expandSong 同一个打法），点 tile 本身不算。
import { chromium } from 'playwright-core';

const OUT = 'C:/folia-build';
const problems = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
    if (!ok) problems.push(name);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts()[0].pages();
const page = pages.find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? pages[0];
console.log('URL', page.url());

await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => {
        el.muted = true;
        el.volume = 0;
        if (typeof el.pause === 'function') el.pause();
    });
});

const layer = () => page.evaluate(() => document.querySelector('[data-library-stage]')?.getAttribute('data-bravais-layer') ?? null);

// 停在资料库墙上（可能开在 #lattice 或 #player）。
for (let step = 0; step < 3 && !(await layer())?.startsWith('home:'); step++) {
    await page.evaluate(() => {
        document.querySelector('.lattice-back')?.click();
        [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === '返回主页')?.click();
    });
    await page.waitForTimeout(2500);
}
if (!(await layer())?.startsWith('home:')) {
    console.log('RESULT FAIL 没停在家层的 bravais 墙上', await layer());
    process.exit(1);
}

// 点一张完整可见的歌单磁贴 → 进集合层。
const playlist = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.bravais-tile[data-library-card^="card:playlist"]')].find(element => {
        const r = element.getBoundingClientRect();
        return r.left > 220 && r.top > 160 && r.right < window.innerWidth - 220 && r.bottom < window.innerHeight - 160;
    });
    if (!tile) return { found: false };
    const article = tile.querySelector('article') ?? tile;
    const r = article.getBoundingClientRect();
    return { found: true, card: tile.getAttribute('data-library-card'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (playlist.found) await page.mouse.click(playlist.x, playlist.y);
await page.waitForFunction(() => (document.querySelector('[data-library-stage]')?.getAttribute('data-bravais-layer') ?? '').startsWith('collection'), null, { timeout: 15_000 }).catch(() => null);
await page.waitForTimeout(1500);
const inCollection = await page.evaluate(() => ({
    layer: document.querySelector('[data-library-stage]')?.getAttribute('data-bravais-layer') ?? null,
    songs: document.querySelectorAll('.bravais-tile[data-library-entry]').length,
}));
check('进到歌单层且里面有歌曲磁贴', inCollection.layer?.startsWith('collection') && inCollection.songs > 1, { playlist, inCollection });

// 挑一张不在屏幕中心区以外、且不是正在播放的歌曲磁贴，点它的 article 展开聚焦卡。
const song = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.bravais-tile[data-library-entry]')].find(element => {
        const r = element.getBoundingClientRect();
        return r.left > 220 && r.top > 160 && r.right < window.innerWidth - 220 && r.bottom < window.innerHeight - 160
            && element.getAttribute('data-bravais-current') !== 'true';
    });
    if (!tile) return { found: false, songs: document.querySelectorAll('.bravais-tile[data-library-entry]').length };
    const article = tile.querySelector('article') ?? tile;
    const r = article.getBoundingClientRect();
    return { found: true, entry: tile.getAttribute('data-library-entry'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (song.found) await page.mouse.click(song.x, song.y);
await page.waitForFunction(() => document.querySelectorAll('[data-bravais-expanded]').length > 0, null, { timeout: 10_000 }).catch(() => null);
await page.waitForTimeout(1500);

const card = await page.evaluate(() => {
    const open = document.querySelector('[data-bravais-expanded]');
    const button = open?.querySelector('[data-bravais-action="open-lattice"]');
    const r = button?.getBoundingClientRect();
    return {
        expanded: Boolean(open),
        entry: open?.getAttribute('data-library-entry') ?? null,
        isCurrent: open?.getAttribute('data-bravais-current') === 'true',
        button: Boolean(button),
        label: button?.getAttribute('aria-label') ?? null,
        buttonSize: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        actions: open ? [...open.querySelectorAll('[data-bravais-action]')].map(b => b.getAttribute('data-bravais-action')) : null,
    };
});
check('展开的这张不是正在播放的那首', song.found && card.expanded && !card.isCurrent && card.entry === song.entry, { song, card });
check('非正在播放的聚焦卡上仍画着那颗', card.button && card.label === '播放并进入 Lattice', card);
await page.screenshot({ path: `${OUT}/lattice-entries-focus-card.png` }).catch(() => null);

console.log(problems.length ? `RESULT FAIL ${problems.join(' | ')}` : 'RESULT PASS 全部通过');
await browser.close().catch(() => {});
process.exit(problems.length ? 1 : 0);
