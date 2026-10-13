// dev/fork/cdp-transition-perf.mjs
// @fork 本地魔改版专用：连到打包版 Folia 的 CDP 端口，实测「主页 ↔ 播放页」切换动画的掉帧归因。
// 用法:
//   node dev/fork/cdp-transition-perf.mjs dump
//   node dev/fork/cdp-transition-perf.mjs run [rounds]     // 静音播放下跑切换实测
// 前置: Folia.exe --remote-debugging-port=9222
// 采样口径:
//   - 帧间隔用原生 rAF（window.__foliaNativeRequestAnimationFrame），不受设置里的帧率限制影响；
//   - LoAF（long-animation-frame）带脚本归因，判断是不是主线程 JS 卡住；
//   - CDP Performance.getMetrics 取 FrameCount / DroppedFrames / Script / RecalcStyle / Layout 的增量，
//     区分「主线程忙」与「合成器丢帧（GPU 侧）」。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const mode = process.argv[2] || 'dump';
const rounds = Number(process.argv[3] || 5);
const OUT_DIR = 'C:/folia-build/perf';
mkdirSync(OUT_DIR, { recursive: true });

// 主页进播放页的按钮在不同墙/入口下 aria-label 不同（实测主页是『进入播放页』，另有场景是『回到播放页』），
// 所以按候选列表依次找。
const PLAYER_ENTRY_CANDIDATES = ['[aria-label="进入播放页"]', '[aria-label="回到播放页"]'];
const HOME_ENTRY = '[aria-label="返回主页"]';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
const page = pages.find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? pages[0];
if (!page) { console.log('NO_PAGE'); process.exit(1); }

// 第四个参数：临时改 localStorage 档位再量（A/B 归因），跑完自动还原并复核。
//   单档：solid                       （等价 library_wall_look=solid）
//   任意 key=value，逗号分隔可一次给多档：diorama_prewarm=off,diorama_unit_atlas=off
// 第五个参数 `noreload`：设完档位不 reload。diorama 的两把档位（预热预算 / 单元图集）都是**每次用到时**
// 现读 localStorage 的，不 reload 也能生效；而 reload 会顺手把字体、shader、Monet 全都预热一遍 —— 想量
// 「冷启动第一次进播放页」那个尖峰（红基线 283ms）就必须跳过 reload，否则量的是热身后的小尖峰（实测 66–133ms）。
// 还原口径：原来没有这个 key 的必须 removeItem —— 早先写成 setItem(k, null) 会落下字符串 "null"，
// 于是「还原成功」的回执底下藏着一条脏档位（实测踩过，见 perf-plan §四.7）。
const lookOverride = process.argv[4] || '';
const noReload = (process.argv[5] || '').includes('noreload');
const overrides = lookOverride
    .split(',')
    .map(pair => (pair.includes('=') ? { k: pair.slice(0, pair.indexOf('=')), v: pair.slice(pair.indexOf('=') + 1) } : { k: 'library_wall_look', v: pair }))
    .filter(o => o.k && o.v !== '');
const overridesApplied = [];
for (const o of overrides) {
    const prev = await page.evaluate((k) => localStorage.getItem(k), o.k);
    await page.evaluate(({ k, v }) => localStorage.setItem(k, v), o);
    overridesApplied.push({ ...o, prev });
}
if (overridesApplied.length && !noReload) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(9000);
}

const snap = await page.evaluate(() => {
    // 静音：实测不能让音乐出声。
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
    const store = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        const v = window.localStorage.getItem(k) ?? '';
        if (/frame|visual|blur|static|motion|reduce|suite|transparent|veil|look|theme|dynamic|wall|lyric/i.test(k)) {
            store[k] = v.length > 200 ? `${v.slice(0, 200)}...(${v.length})` : v;
        }
    }
    return {
        hash: window.location.hash,
        domNodes: document.querySelectorAll('*').length,
        canvases: Array.from(document.querySelectorAll('canvas')).map(c => {
            const r = c.getBoundingClientRect();
            return { buf: `${c.width}x${c.height}`, css: `${Math.round(r.width)}x${Math.round(r.height)}` };
        }),
        audio: Array.from(document.querySelectorAll('audio')).map(a => ({
            src: (a.src || '').slice(0, 30), paused: a.paused, muted: a.muted, dur: a.duration,
        })),
        blurredLayers: Array.from(document.querySelectorAll('[style*="filter"]')).length,
        store,
    };
});

if (mode === 'dump') {
    const clickables = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"],[data-testid]'))
        .map(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return null;
            return {
                testid: el.getAttribute('data-testid'),
                aria: el.getAttribute('aria-label') ?? el.getAttribute('title'),
                text: (el.textContent || '').trim().slice(0, 16),
                rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
            };
        })
        .filter(Boolean).slice(0, 150));
    writeFileSync(`${OUT_DIR}/dump.json`, JSON.stringify({ snap, clickables }, null, 2));
    console.log('DUMP_WRITTEN nodes', snap.domNodes, 'canvases', snap.canvases.length);
    await browser.close().catch(() => {});
    process.exit(0);
}

// ---- run：安装采样器 ----
await page.evaluate(() => {
    const raf = (window.__foliaNativeRequestAnimationFrame ?? window.requestAnimationFrame).bind(window);
    const W = window.__forkPerf = { marks: [], frames: [], loafs: [], on: false, dom: 0 };
    try {
        new PerformanceObserver(list => {
            if (!W.on) return;
            for (const e of list.getEntries()) {
                W.loafs.push({
                    t: Math.round(e.startTime),
                    dur: Math.round(e.duration),
                    block: Math.round(e.blockingDuration ?? 0),
                    // renderStart 距帧起点的毫秒：>0 说明这段时间在跑脚本，不是渲染
                    toRender: Math.round((e.renderStart ?? 0) - e.startTime),
                    styleLayout: Math.round((e.styleAndLayoutStart ?? 0) - e.startTime),
                    forced: Math.round((e.scripts ?? []).reduce((a, s) => a + (s.forcedStyleAndLayoutDuration ?? 0), 0)),
                    top: (e.scripts ?? []).map(s => ({
                        invoker: s.invoker,
                        fn: s.sourceFunctionName || '(anon)',
                        src: (s.sourceURL || '').split(/[\\/]/).pop(),
                        dur: Math.round(s.duration),
                        forced: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
                    })).sort((a, b) => b.dur - a.dur).slice(0, 5),
                });
            }
        }).observe({ type: 'long-animation-frame', buffered: false });
    } catch (err) { W.loafError = String(err); }
    const tick = (now) => {
        if (W.on) W.frames.push(now);
        raf(tick);
    };
    raf(tick);
});

const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => {
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    const pick = name => m.find(x => x.name === name)?.value ?? null;
    return {
        timestamp: pick('Timestamp'),
        frames: pick('Frames'),
        dropped: pick('DroppedFrames') ?? pick('FrameCount'),
        script: pick('ScriptDuration'),
        style: pick('RecalcStyleDuration'),
        layout: pick('LayoutDuration'),
        task: pick('TaskDuration'),
        v8HeapMB: (pick('JSHeapSize') ?? 0) / 1048576,
        nodes: pick('Nodes'),
    };
};

const ensurePlaying = async () => {
    const before = await page.evaluate(() => Array.from(document.querySelectorAll('audio')).map(a => a.paused));
    if (before.some(p => p === true)) {
        // 先按 aria-label 走 React 的播放入口（同样绕过命中测试），没有再直接 play()。
        const clicked = await page.evaluate(() => {
            const el = document.querySelector('[aria-label="播放"], [aria-label="继续播放"], [title="播放"]');
            if (!el) return false;
            el.click();
            return true;
        });
        if (!clicked) {
            await page.evaluate(() => document.querySelectorAll('audio').forEach(a => { a.muted = true; a.volume = 0; void a.play().catch(() => {}); }));
        }
    }
    await page.waitForTimeout(1200);
    return page.evaluate(() => Array.from(document.querySelectorAll('audio')).map(a => ({ paused: a.paused, muted: a.muted, vol: a.volume })));
};

const sample = async (label, ms, before = null) => {
    // 每段采样前把窗口拉回前台（窗口被遮挡时 Chromium 把 rAF 压到 1Hz，帧率数字全部作废），
    // 并重新按静音：App 会在播放事件里把 volume 写回 1，只在开头 mute 一次不够（实测 playback 快照里
    // 出现过 muted:false/vol:1 —— 这是用户真机，绝不能出声）。
    await page.bringToFront().catch(() => {});
    await page.evaluate(() => {
        document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
    });
    const m0 = await metrics();
    await page.evaluate(() => {
        const W = window.__forkPerf;
        W.frames = []; W.loafs = []; W.on = true;
        W.dom = document.querySelectorAll('*').length;
    });
    // 触发切换必须在「采样已开表」之后：早先写法是先 click 再 sample，切换只有一两帧，
    // 等采样器装好（一次 CDP 往返）常常已经错过了最脏的那一帧，量到的是切换后的稳态
    // （实测：同一轮里 domStart 一会儿 772 一会儿 204，就是这个错位）。
    if (before) await before();
    await page.waitForTimeout(ms);
    const m1 = await metrics();
    const raw = await page.evaluate(() => {
        const W = window.__forkPerf;
        W.on = false;
        const f = W.frames;
        const gaps = [];
        for (let i = 1; i < f.length; i += 1) gaps.push(f[i] - f[i - 1]);
        const sorted = [...gaps].sort((a, b) => a - b);
        const q = p => (sorted.length ? Number(sorted[Math.floor((sorted.length - 1) * p)].toFixed(1)) : null);
        return {
            frames: f.length,
            // 采样期间页面是否真的可见：窗口被遮挡/最小化时 Chromium 把 rAF 压到 1fps，
            // 这时帧率数字（无论好坏）都无效。实测有一次 A/B 尾部两行 p50=1000ms 就是这么废的。
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            audible: Array.from(document.querySelectorAll('audio'))
                .filter(a => !a.paused && !a.muted && a.volume > 0).length,
            fps: gaps.length ? Number((gaps.length * 1000 / (f.at(-1) - f[0])).toFixed(1)) : null,
            p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.length ? Number(sorted.at(-1).toFixed(1)) : null,
            over33: gaps.filter(g => g > 33.4).length,
            over50: gaps.filter(g => g > 50).length,
            loafs: W.loafs,
            domStart: W.dom,
            domEnd: document.querySelectorAll('*').length,
        };
    });
    const d = (a, b) => (a == null || b == null ? null : Number((b - a).toFixed(3)));
    return {
        label,
        ...raw,
        dFrames: d(m0.frames, m1.frames),
        dDropped: d(m0.dropped, m1.dropped),
        scriptMs: d(m0.script, m1.script),
        styleMs: d(m0.style, m1.style),
        layoutMs: d(m0.layout, m1.layout),
        taskMs: d(m0.task, m1.task),
        heapMB: Number(m1.v8HeapMB.toFixed(1)),
        nodeCount: m1.nodes,
    };
};

// 当前在哪个面：主页有墙（bravais-field / lattice-field），播放页整棵 Home 已卸载。
// 视图判定以路由 hash 为准：主页 hash 空，播放页/歌单页是 #player / #collection/…（实测）。
// 早先用 .bravais-field/.lattice-field/.grid-view 类名存在与否会误判 —— 这些是常驻背景层，播放页也留着，
// 曾把 player 认成 home、再按 home 去找入口按钮直接 MISSING。单靠 aria-label 也不准（『返回主页』两边都在工具条里）。
const currentView = () => page.evaluate(() => (
    String(location.hash || '').replace(/^#/, '').trim() === '' ? 'home' : 'player'
));

// 墙面上层会 intercept pointer events，所以直接对元素派发 click：走同一套 React onClick，
// 导航与动画路径完全一致，只是跳过浏览器的命中测试。传数组时按候选顺序找第一个存在的。
const clickEntry = async (sel) => {
    const sels = Array.isArray(sel) ? sel : [sel];
    const ok = await page.evaluate((list) => {
        for (const s of list) {
            const el = document.querySelector(s);
            if (el) { el.click(); return true; }
        }
        return false;
    }, sels);
    if (!ok) throw new Error(`MISSING ${sels.join(' | ')}`);
};

const runRounds = async () => {
    // 窗口被遮挡/最小化时 Chromium 把 rAF 压到 1Hz，整段采样作废（实测：A/B 里连续几行 p50=1000ms）。
    // 每段采样前都会再 bringToFront 一次；`Browser.getWindowForTarget` 在 Electron 的 page session 上不支持。
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(1200);
    const playback = await ensurePlaying();
    const view = await currentView();
    const results = [];
    results.push(await sample(`baseline-${view}`, 2000));
    for (let i = 0; i < rounds; i += 1) {
        await page.waitForTimeout(900);
        const from = await currentView();
        const sel = from === 'home' ? PLAYER_ENTRY_CANDIDATES : HOME_ENTRY;
        const label = from === 'home' ? 'home -> player' : 'player -> home';
        results.push(await sample(label, 2200, () => clickEntry(sel)));
        await page.waitForTimeout(1400);
    }
    // 稳态播放页也要采一段：diorama 每次换行都会重建/上传几十张纹理，切换动画只是它最扎眼的一次。
    // 不知道这一项，就没法判断「把活挪出切换帧」到底是省了总量还是只换了地方（实测：预热把主页打到 21fps
    // 就是靠这两行才发现的）。
    if ((await currentView()) !== 'player') await clickEntry(PLAYER_ENTRY_CANDIDATES);
    await page.waitForTimeout(2500);
    results.push(await sample('steady-player', 2500));

    // 回到稳定态：停在主页
    if ((await currentView()) === 'player') await clickEntry(HOME_ENTRY);
    await page.waitForTimeout(1500);

    const out = {
        startedAt: new Date().toISOString(),
        snap, playback, startView: view,
        rounds,
        // 这一档跑了什么临时档位、每项跑前的原值（复盘 A/B 时先看这里，别信终端回执的记忆）。
        flags: overridesApplied,
        results,
    };
    const file = `${OUT_DIR}/transition-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('FLAGS', overridesApplied.length ? overridesApplied.map(o => `${o.k}=${o.v}`).join(',') : '(none)');
    console.log('ROWS');
    for (const r of results) {
        console.log(`${r.label.padEnd(24)} vis=${r.visibility}${r.focused ? '' : '/unfocused'} audible=${r.audible} fps=${r.fps} p50=${r.p50} p95=${r.p95} p99=${r.p99} max=${r.max} >33=${r.over33} >50=${r.over50} loaf=${r.loafs.length} drop=${r.dDropped}/${r.dFrames} script=${r.scriptMs} style=${r.styleMs} layout=${r.layoutMs} dom=${r.domStart}->${r.domEnd}`);
    }
    const throttled = results.filter(r => r.visibility !== 'visible' || r.fps < 10);
    if (throttled.length) console.log('THROTTLED_ROWS', throttled.map(r => `${r.label}(${r.fps}fps)`).join(' | '), '=> 采样作废（窗口被挡或 rAF 被压到 1Hz），重跑');
    if (results.some(r => r.audible > 0)) console.log('WARN_NOT_MUTED', results.filter(r => r.audible > 0).map(r => r.label).join(','));
    console.log('FILE', file);
    return file;
};

// 中途抛异常也必须把档位还原（实测教训：一次 MISSING 异常跳过了还原，`diorama_prewarm=off` 就留在用户机器上
// 当成了「原值」，下一轮对照全废）。
let runError = null;
try {
    await runRounds();
} catch (err) {
    runError = err;
}

// 还原被临时改掉的档位（A/B 之后必须回到用户原值，并逐 key 复核落盘）。
if (overridesApplied.length) {
    for (const o of overridesApplied) {
        if (o.prev === null) {
            await page.evaluate((k) => localStorage.removeItem(k), o.k);
        } else {
            await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: o.k, v: o.prev });
        }
    }
    await page.waitForTimeout(4000);
    const after = await page.evaluate((keys) => keys.map(k => [k, localStorage.getItem(k)]), overridesApplied.map(o => o.k));
    after.forEach(([k, v], i) => {
        const expected = overridesApplied[i].prev;
        console.log(v === expected ? 'RESTORED' : 'RESTORE_MISMATCH', k, '=', v, expected === null ? '(原无此 key)' : `(应为 ${expected})`);
    });
    // localStorage 落盘是异步的：还原完立刻 taskkill 会把写入丢掉，下一档读到的「原值」就是脏的
    // （实测：冷启动 A/B 三轮之间就是这么串味的）。这里再等 6s 让它 flush，调用方也别在跑完马上强杀。
    await page.waitForTimeout(6000);
}
if (runError) throw runError;
await browser.close().catch(() => {});
