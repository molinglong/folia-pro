// dev/fork/cdp-transition-trace.mjs
// @fork 本地魔改版专用：给「主页 ↔ 播放页」切换抓一段 DevTools trace，聚合出每帧开销的去向。
// 用法: node dev/fork/cdp-transition-trace.mjs [切换次数] [outName]
// 前置: Folia.exe --remote-debugging-port=9222，且停在主页。
// 输出: C:/folia-build/perf/trace-<name>.json（原始 trace，DevTools 可直接加载）+ 终端聚合表。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const times = Number(process.argv[2] || 3);
const name = process.argv[3] || `run-${Date.now()}`;
const OUT_DIR = 'C:/folia-build/perf';
mkdirSync(OUT_DIR, { recursive: true });

const PLAYER_ENTRY = '[aria-label="进入播放页"], [aria-label="回到播放页"]';
const HOME_ENTRY = '[aria-label="返回主页"]';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? ctx.pages()[0];

// 静音看门狗：App 会在 play/playing 事件里把 volume 写回 1、把 muted 关掉（实测），
// 单次 mute 拦不住 —— 这是用户真实听歌环境，必须页面内 100ms 循环按住，并统计"曾可发声"的采样数。
await page.evaluate(() => {
    const W = window;
    if (W.__muteGuard) clearInterval(W.__muteGuard);
    W.__muteAudibleSamples = 0;
    W.__muteGuard = setInterval(() => {
        let aud = 0;
        document.querySelectorAll('audio, video').forEach(el => {
            if (!el.paused && !el.muted && el.volume > 0) aud += 1;
            el.muted = true; el.volume = 0;
        });
        if (aud > 0) W.__muteAudibleSamples += 1;
    }, 100);
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
});

// 视图判定用 hash（主页空、播放页 #player/#collection/…）；类名判定会被常驻背景层骗到。
const view = () => page.evaluate(() => (
    String(location.hash || '').replace(/^#/, '').trim() === '' ? 'home' : 'player'
));
const click = async (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`MISSING ${s}`);
    el.click();
}, sel);

const cdp = await ctx.newCDPSession(page);
const chunks = [];
cdp.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));

// 静音播放中采样（visualizer 在跑，贴近真实使用）。
// 起播：mini-player 的播放按钮没有 aria-label（实测），直接对 deck 调 play() 最稳，
// App 的状态同步挂在 audio 自身的 play 事件上（App.tsx:2441+）。暂停态播放页会退回无歌词封面态，
// 那样 trace 到的就不是 diorama 建层那一帧，白抓。
await page.evaluate(() => {
    document.querySelectorAll('audio').forEach(a => { a.muted = true; a.volume = 0; a.play().catch(() => {}); });
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
});
console.log('DECK', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('audio'))
    .map(a => ({ t: Number(a.currentTime.toFixed(2)), paused: a.paused })))));

await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    includedCategories: [
        'devtools.timeline',
        'benchmark',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
    ],
});

const timeline = [];
for (let i = 0; i < times; i += 1) {
    const from = await view();
    await page.evaluate((t) => window.__t0 = performance.now(), 0);
    await click(from === 'home' ? PLAYER_ENTRY : HOME_ENTRY);
    timeline.push({ dir: from === 'home' ? 'home->player' : 'player->home', t: Date.now() });
    await page.waitForTimeout(2600);
}

const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
await cdp.send('Tracing.end');
await done;

const file = `${OUT_DIR}/trace-${name}.json`;
writeFileSync(file, JSON.stringify(chunks));
console.log('TRACE', file, 'events', chunks.length);
console.log('TIMELINE', JSON.stringify(timeline));

// 聚合：按事件名汇总墙钟耗时（微秒），并对脚本类事件带上 url:line 与调用栈叶子帧。
const byName = new Map();
for (const e of chunks) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const rec = byName.get(e.name) ?? { total: 0, count: 0, max: 0 };
    rec.total += e.dur; rec.count += 1; rec.max = Math.max(rec.max, e.dur);
    byName.set(e.name, rec);
}
const rows = [...byName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 18);
console.log('AGGREGATE(totalMs, count, maxMs, name)');
for (const [k, v] of rows) {
    console.log(`${(v.total / 1000).toFixed(1).padStart(8)}  ${String(v.count).padStart(5)}  ${(v.max / 1000).toFixed(1).padStart(7)}  ${k}`);
}

// 最长的 12 个 X 事件，附归因（脚本帧 / 布局对象尺寸）。
const longest = chunks.filter(e => e.ph === 'X' && typeof e.dur === 'number')
    .sort((a, b) => b.dur - a.dur).slice(0, 12);
console.log('LONGEST');
for (const e of longest) {
    const stack = (e.args?.data?.stackTrace ?? e.args?.data?.stack ?? []);
    const leaf = stack.length ? `${stack.at(-1).functionName || '(anon)'} @${(stack.at(-1).url || '').split(/[\\/]/).pop()}:${stack.at(-1).lineNumber}` : '';
    const extra = e.name === 'Layout' || e.name === 'UpdateLayoutTree'
        ? `dirty=${e.args?.begin?.data?.dirtyObjects ?? e.args?.data?.nodeCount ?? '?'} total=${e.args?.begin?.data?.startObjects ?? e.args?.data?.totalObjects ?? '?'}`
        : `${e.args?.data?.functionName ?? ''} ${(e.args?.data?.url || '').split(/[\\/]/).pop()}:${e.args?.data?.lineNumber ?? ''}`;
    console.log(`${(e.dur / 1000).toFixed(1).padStart(7)}ms ${e.name.padEnd(22)} ${extra} ${leaf}`);
}
// 绝不调 browser.close()：connectOverCDP 的 close 等于给 Electron 发 Browser.close，会把用户这台
// 真实听歌环境整个关掉（实测踩过）。而且光靠"自然退出"也不行 —— playwright 的连接句柄会让事件
// 循环一直活着，进程永不结束，所以显式 process.exit。
process.exit(0);
