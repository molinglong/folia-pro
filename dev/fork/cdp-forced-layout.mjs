// dev/fork/cdp-forced-layout.mjs
// @fork 本地魔改版专用：抓「进播放页那一帧里，是谁在写完 DOM 后立刻读布局」。
//
// 为什么要它：冷进页那 ~180ms 阻塞里，trace 已经量到一次 58.2ms 的
// `Blink.ForcedStyleAndLayout.UpdateTime`（= 同步样式重算 31.2ms + 布局 26.6ms，
// 其中 `InlineNode::ShapeTextIncludingFirstLine` 16.4ms）。但打包版是压缩代码，
// trace 里没有 stack（`disabled-by-default-devtools.timeline.stack` 在 Electron 里没吐出帧），
// 归因不到调用点。所以换个办法：在页面里猴补丁所有"会强制刷新布局"的读接口 +
// ResizeObserver/IntersectionObserver 构造器，记录自身耗时 ≥0.2ms 的调用（真发生了 reflow 才会这么贵），带 JS 栈。
// 关键：补丁用 CDP `Page.addScriptToEvaluateOnNewDocument` 在**文档一开始**装好再 reload ——
// 否则 App 模块初始化期 new 出来的观察者拿的是原生构造器，"零命中"里混着"根本没探到"。
// 阳性对照（必须红才说明探针有效）：改 DOM 后读 offsetHeight → 记到 39.9ms。
//
// 用法: node dev/fork/cdp-forced-layout.mjs        （前置：Folia.exe --remote-debugging-port=9222）
// 注意: 本脚本会 reload 页面，量的是"热进程 / 冷页面"；进程冷态的 283ms 尖峰要另用 noreload 协议。
// 产物: C:/folia-build/perf/forced-layout-<ts>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'C:/folia-build/perf';
mkdirSync(OUT_DIR, { recursive: true });
const PLAYER_ENTRY = ['[aria-label="进入播放页"]', '[aria-label="回到播放页"]'];

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? ctx.pages()[0];
if (!page) { console.log('NO_PAGE'); process.exit(1); }

await page.bringToFront().catch(() => {});
// 探针必须在**应用代码之前**装好：上一版在 App 跑起来 18s 后才 evaluate 打补丁，
// 那时模块初始化期 new 出来的 ResizeObserver/IntersectionObserver 已经拿的是原生构造器，
// 回调没被包住 —— 所以"零命中"里混着"根本没探到"。改用 Page.addScriptToEvaluateOnNewDocument，
// 文档一开始就装，再 reload，所有构造点/读点都在网里。
const INSTALL = () => {
    // 文档一开始还没有 <audio>，所以静音只能常驻循环按住（App 会在 play 事件里把 volume 写回 1）。
    setInterval(() => {
        document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
    }, 100);
    const W = window;
    if (W.__flInstalled) return;
    W.__flInstalled = true;
    W.__fl = [];
    const rec = (method, cost, target) => {
        // 阈值 0.2ms：第一版用 2ms 时冷进页零命中，不能就此断定"没有 JS 读布局"，
        // 先把口子开全、阈值压低，再看命中分布。
        if (cost < 0.2) return;
        W.__fl.push({
            at: Math.round(performance.now()), method, ms: Number(cost.toFixed(2)),
            tag: target && target.tagName, cls: String(target && target.className || '').slice(0, 70),
            stack: new Error().stack.split('\n').slice(2, 12).join('\n'),
        });
    };
    const wrap = (obj, prop, kind) => {
        const d = Object.getOwnPropertyDescriptor(obj, prop);
        if (!d || !d.get) return;
        Object.defineProperty(obj, prop, {
            ...d,
            get() {
                const t0 = performance.now();
                const v = d.get.call(this);
                rec(`${kind}.${prop}`, performance.now() - t0, this);
                return v;
            },
        });
    };
    // 触发同步 reflow 的经典读接口
    for (const p of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'clientTop', 'scrollTop', 'scrollHeight']) {
        wrap(HTMLElement.prototype, p, 'el');
    }
    // 第二版补口：这些同样会强制刷新样式/布局，第一版漏了。
    for (const p of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight']) {
        wrap(Window.prototype, p, 'win');
    }
    wrap(Document.prototype, 'activeElement', 'doc');
    for (const p of ['getClientRects', 'checkVisibility']) {
        const orig = Element.prototype[p];
        if (typeof orig !== 'function') continue;
        Element.prototype[p] = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            rec(`Element.${p}`, performance.now() - t0, this);
            return r;
        };
    }
    for (const p of ['focus', 'scrollIntoView']) {
        const orig = Element.prototype[p];
        if (typeof orig !== 'function') continue;
        Element.prototype[p] = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            rec(`Element.${p}`, performance.now() - t0, this);
            return r;
        };
    }
    const rBCR = Range.prototype.getBoundingClientRect;
    if (typeof rBCR === 'function') {
        Range.prototype.getBoundingClientRect = function (...a) {
            const t0 = performance.now();
            const r = rBCR.apply(this, a);
            rec('Range.getBoundingClientRect', performance.now() - t0, this.startContainer);
            return r;
        };
    }
    const gBCR = Element.prototype.getBoundingClientRect;
    // 第三段：JS 侧读接口全零命中（阳性对照验过探针本身有效：改 DOM 后读 offsetHeight 记到 39.9ms），
    // 说明 trace 里那 58ms 的 ForcedStyleAndLayout 不是普通 JS 读属性触发的。
    // 剩下的常见来源是 **观察者投递**：ResizeObserver / IntersectionObserver 在回调前会强制
    // 刷新样式与布局（Blink 内部走同一条 UpdateStyleAndLayout），而 framer-motion / 虚拟列表 /
    // 懒加载都爱用它们。这里包一层构造器，记新建点 + 每次回调耗时。
    for (const name of ['ResizeObserver', 'IntersectionObserver']) {
        const Orig = window[name];
        if (typeof Orig !== 'function') continue;
        const Wrapped = function (cb) {
            const wrappedCb = function (...args) {
                const t0 = performance.now();
                const r = cb.apply(this, args);
                rec(`${name}.callback`, performance.now() - t0, args[0] && args[0][0] && args[0][0].target);
                return r;
            };
            try {
                return new Orig(wrappedCb);
            } catch {
                return new Orig(cb);
            }
        };
        Wrapped.prototype = Orig.prototype;
        window[name] = Wrapped;
    }

    Element.prototype.getBoundingClientRect = function (...a) {
        const t0 = performance.now();
        const r = gBCR.apply(this, a);
        rec('getBoundingClientRect', performance.now() - t0, this);
        return r;
    };
    const gCS = window.getComputedStyle.bind(window);
    window.getComputedStyle = function (...a) {
        const t0 = performance.now();
        const r = gCS(...a);
        rec('getComputedStyle', performance.now() - t0, a[0]);
        return r;
    };
};

const cdp = await ctx.newCDPSession(page);
await cdp.send('Page.enable');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${INSTALL.toString()})()` });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(12000);
await page.bringToFront().catch(() => {});
console.log('PROBE_INSTALLED', await page.evaluate(() => !!window.__flInstalled));
// 自校验：先造一次"改 DOM 后立刻读布局"的已知坏样本，探针必须抓到，否则后面的零命中没有意义。
const control = await page.evaluate(() => {
    const W = window;
    W.__fl.length = 0;
    const host = document.createElement('div');
    host.innerHTML = Array.from({ length: 400 }, (_, i) => `<p style="font-size:${12 + (i % 7)}px">对照文本对照文本${i}</p>`).join('');
    document.body.appendChild(host);
    void document.body.offsetHeight;
    const hits = W.__fl.length;
    document.body.removeChild(host);
    return { hits, top: W.__fl[0] && { m: W.__fl[0].method, ms: W.__fl[0].ms } };
});
console.log('CONTROL', JSON.stringify(control));
if (!control.hits) { console.log('ABORT: 探针没抓到已知强制回流，零命中不可信'); process.exit(2); }
await page.evaluate(() => { window.__fl.length = 0; });

const view = () => page.evaluate(() => (String(location.hash || '').replace(/^#/, '').trim() === '' ? 'home' : 'player'));
console.log('VIEW_BEFORE', await view());
// reload 后可能停在播放页；先回主页，保证量到的是"进播放页"这一刀。
if (await view() !== 'home') {
    await page.evaluate(() => document.querySelector('[aria-label="返回主页"]')?.click());
    await page.waitForTimeout(2500);
    console.log('VIEW_AFTER_GOHOME', await view());
}
// 与 trace 同场景：静音播放中（暂停态播放页是封面态，DOM 不一样）
await page.evaluate(() => {
    document.querySelectorAll('audio').forEach(a => { a.muted = true; a.volume = 0; a.play().catch(() => {}); });
});
await page.waitForTimeout(1200);
// 清空计数 → 点进播放页 → 等动画与首帧稳定 → 收栈
await page.evaluate(() => { window.__fl.length = 0; });
await page.evaluate((sels) => {
    for (const s of sels) { const el = document.querySelector(s); if (el) { el.click(); return; } }
}, PLAYER_ENTRY);
await page.waitForTimeout(3000);
const rows = await page.evaluate(() => ({ view: location.hash, fl: window.__fl }));
console.log('VIEW_AFTER', rows.view, 'forced-reads>=0.2ms:', rows.fl.length);
const byMethod = {};
for (const r of rows.fl) {
    const b = byMethod[r.method] ||= { n: 0, ms: 0, max: 0 };
    b.n += 1; b.ms += r.ms; b.max = Math.max(b.max, r.ms);
}
console.log('BY_METHOD', JSON.stringify(Object.fromEntries(
    Object.entries(byMethod).sort((a, b) => b[1].ms - a[1].ms))));
for (const r of [...rows.fl].sort((a, b) => b.ms - a.ms).slice(0, 12)) {
    console.log('----', r.at + 'ms', r.method, r.ms + 'ms', r.tag, r.cls);
    console.log(r.stack);
}
const file = `${OUT_DIR}/forced-layout-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log('FILE', file);
// 不调 browser.close()（会关掉用户的 App），也不靠自然退出（连接句柄吊住事件循环）。
process.exit(0);
