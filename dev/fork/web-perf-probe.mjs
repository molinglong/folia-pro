// dev/fork/web-perf-probe.mjs
// @fork 本地魔改版专用：网页版性能归因（第零波）。自己拉一个真 Chrome（CDP 9333，独立 user-data-dir，
// 不碰用户日常 Chrome），在同一个浏览器、同一段采样窗口里量两个 URL，做「构建模式」单变量对照：
//   dev(3000) vs prod preview(4180)。
// 用法:
//   node dev/fork/web-perf-probe.mjs <url> [seconds]   // 单个 URL
//   node dev/fork/web-perf-probe.mjs ab <urlA> <urlB> [seconds]  // 对照，同口径各跑一遍
// 口径:
//   - 帧间隔用 rAF（页面自带的限帧猴补丁不管 rAF 本身，且这里是纯测量不触发动画）；
//   - LoAF（long-animation-frame）拆 scriptDuration / styleLayoutDuration，直接对上「58ms 强制样式+布局」那条已知结论；
//   - WebGL 渲染器字符串判断是不是走了软渲染。
// 铁律：CDP 脚本绝不 browser.close()（会把用户环境带走），收尾一律 process.exit(0)；采样前 bringToFront。
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = 9333;
const USER_DATA = 'C:/folia-build/chrome-perf-profile';
const OUT_DIR = 'C:/folia-build/perf';
mkdirSync(OUT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const isAb = argv[0] === 'ab';
const targets = isAb ? argv.slice(1, 3) : argv.slice(0, 1);
const seconds = Number((isAb ? argv[3] : argv[1]) || 8);
const reuseExisting = argv.includes('reuse');
if (!targets.length || !targets.every(t => /^https?:/.test(t))) {
    console.log('用法: node dev/fork/web-perf-probe.mjs <url> [s] | ab <urlA> <urlB> [s]');
    process.exit(1);
}
if (!existsSync(CHROME)) { console.log('CHROME_NOT_FOUND', CHROME); process.exit(1); }

// 0) 清掉上一轮残留的探针 Chrome。第二次 launch 同一个 user-data-dir 时，Chrome 不会新起实例，
//    而是把请求转给已有实例后自己退出 —— 于是 connectOverCDP 连上的是一台正在关闭的浏览器，
//    报 "Failed to open a new tab"（实测踩过）。先按命令行特征杀干净，再删单例锁。
//    只按 user-data-dir 特征匹配，绝不会碰到用户日常用的 Chrome 进程。
const killProbeChrome = async () => {
    try {
        const pids = execFileSync('powershell', ['-NoProfile', '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*chrome-perf-profile*' } | Select-Object -ExpandProperty ProcessId",
        ], { encoding: 'utf8' }).trim();
        for (const pid of pids.split(/\r?\n/).filter(Boolean)) {
            execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { encoding: 'utf8' });
        }
        if (pids.trim()) await new Promise(r => setTimeout(r, 2500));
    } catch { /* 没有残留也正常 */ }
    for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        try { rmSync(`${USER_DATA}/${lock}`, { force: true }); } catch { /* ignore */ }
    }
};
// reuse 模式下不能杀：要连的正是那台已在 9333 上的实例。
if (reuseExisting) {
    const probe = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(r => r.ok).catch(() => false);
    if (!probe) { console.log(`REUSE_FAIL 9333 上没有 Chrome，先拉起：nohup chrome.exe --remote-debugging-port=9333 --user-data-dir=${USER_DATA} …`); process.exit(1); }
} else await killProbeChrome();

// 1) 需要一台 headful Chrome（无头会换渲染后端，GPU/合成侧数字不可比）。
//    两种来源：① 传第三参数 `reuse` 时直接连已在 9333 上的实例（由外层脚本用 nohup 拉起 ——
//      实测在托管终端里用 node child_process 直接 spawn chrome，浏览器会在跑完第一个目标后自己退出，
//      报 "Target page, context or browser has been closed"，两次都栽在这）；
//    ② 自己 spawn 一份。occluded/backgrounding 两个开关必须带：窗口被别的窗口压住时 Chromium
//      会把 rAF 压到 1Hz，帧率数字全废。
let spawned = null;
if (!reuseExisting) {
    spawned = spawn(CHROME, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${USER_DATA}`,
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
        '--disable-features=Translate', '--window-size=1440,900',
        'about:blank',
    ], { stdio: 'ignore', detached: false });
    spawned.on('error', e => { console.log('CHROME_SPAWN_FAIL', e.message); process.exit(1); });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser = null;
for (let i = 0; i < 60 && !browser; i += 1) {
    await sleep(500);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`); } catch { /* 还没起 */ }
}
if (!browser) { console.log('CDP_CONNECT_FAIL'); process.exit(1); }

const ctx = browser.contexts()[0];

const PROBE = async ({ ms }) => {
    // 静音看门狗：这个页面可能正在放歌，采样期间绝不能出声。App 会在 play 事件里把 muted:false 写回，
    // 所以不是按一次，是 100ms 循环按住，并计「曾可发声」的采样次数如实上报。
    let audible = 0;
    const kick = () => {
        for (const el of document.querySelectorAll('audio, video')) {
            if (!el.muted || el.volume > 0) audible += 1;
            el.muted = true; el.volume = 0;
        }
    };
    kick();
    const watchdog = setInterval(kick, 100);

    const gpu = (() => {
        try {
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl2') || c.getContext('webgl');
            if (!gl) return { ok: false };
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                ok: true,
                vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
                renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            };
        } catch (e) { return { ok: false, err: String(e) }; }
    })();

    const loaf = [];
    const longtasks = [];
    let loafSupported = true;
    try {
        const po = new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
                loaf.push({
                    total: Math.round(e.duration),
                    blocking: Math.round(e.blockingDuration || 0),
                    script: Math.round(e.scriptDuration || 0),
                    styleLayout: Math.round(e.styleLayoutDuration || 0),
                });
            }
        });
        po.observe({ type: 'long-animation-frame', buffered: true });
        var poLoaf = po;
    } catch { loafSupported = false; }
    try {
        const po2 = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longtasks.push(Math.round(e.duration));
        });
        po2.observe({ type: 'longtask', buffered: true });
        var poTask = po2;
    } catch { /* ignore */ }

    // 帧间隔直方图：用真实 rAF 循环，采样窗口内不做任何 DOM 改动。
    const deltas = [];
    const measured = await new Promise(resolve => {
        const start = performance.now();
        let last = 0;
        const step = () => {
            const now = performance.now();
            if (last) deltas.push(now - last);
            last = now;
            if (now - start < ms) requestAnimationFrame(step); else resolve(now - start);
        };
        requestAnimationFrame(step);
    });

    await new Promise(r => setTimeout(r, 60));
    clearInterval(watchdog);
    try { poLoaf && poLoaf.disconnect(); } catch { /* ignore */ }
    try { poTask && poTask.disconnect(); } catch { /* ignore */ }

    const sorted = [...deltas].sort((a, b) => a - b);
    const q = p => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10 : null);
    const frames = sorted.length;
    const over60 = deltas.filter(d => d > 60).length;
    const over150 = deltas.filter(d => d > 150).length;

    return {
        url: location.href,
        hash: location.hash,
        visibility: document.visibilityState,
        frames,
        fps: frames ? Math.round(frames / (measured / 1000) * 10) / 10 : 0,
        p50: q(0.5), p90: q(0.9), p99: q(0.99), max: Math.round(sorted[sorted.length - 1] || 0),
        over60, over150,
        loafSupported, loaf: loaf.sort((a, b) => b.total - a.total).slice(0, 12),
        longtaskCount: longtasks.length,
        longtaskMax: longtasks.length ? Math.max(...longtasks) : 0,
        gpu,
        domNodes: document.querySelectorAll('*').length,
        canvases: Array.from(document.querySelectorAll('canvas')).map(c => {
            const r = c.getBoundingClientRect();
            return { buf: `${c.width}x${c.height}`, css: `${Math.round(r.width)}x${Math.round(r.height)}` };
        }),
        audibleSamples: audible,
        scripts: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name)).length,
        cssBytes: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'css' || /\.css(\?|$)/.test(r.name))
            .reduce((s, r) => s + (r.transferSize || 0), 0),
    };
};

const results = [];
for (const url of targets) {
    const page = await ctx.newPage();
    await page.bringToFront();
    try {
        await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    } catch (e) { console.log('GOTO_FAIL', url, e.message); }
    // 等首屏稳定：dev 模式下冷启动要转十几秒，量早了量的是编译等待。
    await page.waitForTimeout(12_000);
    // 冷→热各一次：第一次带 JIT/样式冷启动，第二次才是用户「用起来了还卡」的那个体感。
    let cold = null;
    let warm = null;
    try {
        cold = await page.evaluate(PROBE, { ms: seconds * 1000 });
        await page.waitForTimeout(3000);
        warm = await page.evaluate(PROBE, { ms: seconds * 1000 });
    } catch (e) {
        console.log('PROBE_FAIL', url, e.message);
        results.push({ url, error: e.message });
        await page.close().catch(() => { });
        continue;
    }
    results.push({ url, cold, warm });
    await page.close().catch(() => { });
}

const file = `${OUT_DIR}/web-probe-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(results, null, 2));
console.log('\nWROTE', file);
console.log('\n摘要');
for (const r of results) {
    if (!r.cold) { console.log(`${r.url}\n  失败: ${r.error}`); continue; }
    console.log(`${r.url}\n  cold: fps=${r.cold.fps} p50=${r.cold.p50} p90=${r.cold.p90} max=${r.cold.max} dom=${r.cold.domNodes} js=${r.cold.scripts} cssKB=${Math.round(r.cold.cssBytes / 1024)} visible=${r.cold.visibility} gpu=${r.cold.gpu.renderer || 'n/a'}`);
    console.log(`  warm: fps=${r.warm.fps} p50=${r.warm.p50} p90=${r.warm.p90} max=${r.warm.max} loafTop=${JSON.stringify(r.warm.loaf[0] || null)} longtasks=${r.warm.longtaskCount}/${r.warm.longtaskMax}ms`);
}
// 收尾：只杀**我们自己拉起来的探针实例**（按 chrome-perf-profile 特征匹配），绝不 browser.close()
// ——connectOverCDP 的 close 会发 Browser.close，用户日常 Chrome 要是有实例在同一 profile 上就被带走了。
if (!reuseExisting) { await killProbeChrome(); console.log('PROBE_CHROME_CLEANED'); }
process.exit(0);
