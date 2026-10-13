// dev/fork/cdp-diorama-parity.mjs
// @fork 本地魔改版专用：证明「当前行单元图集」（性能刀A-2）视觉零变化。
//
// 为什么不直接比两张截图的差：diorama 的粒子、相机、辉光呼吸都是按 clock 动的，
// 同一档位隔 1.2s 的两张图本来就不一样。所以每次对照都先量**自己的噪声地板**：
//   同档位两枪（A1 vs A2 / B1 vs B2）= 噪声；跨档位（A vs B）= 图集带来的差异。
//   判据：跨档位差异 ≈ 噪声地板 ⇒ 视觉上分不出来。
// 另外把歌词行文本一起抓出来（DOM 字幕层），两枪必须是同一句，否则比的是不同的字，结论作废。
//
// 用法: node dev/fork/cdp-diorama-parity.mjs        （前置：Folia.exe --remote-debugging-port=9222）
// 产物: C:/folia-build/perf/parity-{perunit,atlas}-{1,2}.png + parity-<ts>.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { chromium } from 'playwright-core';

const OUT_DIR = 'C:/folia-build/perf';
mkdirSync(OUT_DIR, { recursive: true });

const PLAYER_ENTRY = ['[aria-label="进入播放页"]', '[aria-label="回到播放页"]'];
const HOME_ENTRY = '[aria-label="返回主页"]';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? ctx.pages()[0];
if (!page) { console.log('NO_PAGE'); process.exit(1); }

// 任何一步炸了都要留下堆栈（上一版跑完只留两行日志、零报错，白跑一轮无法归因）。
process.on('uncaughtException', e => { console.log('FATAL', e && (e.stack || String(e))); process.exit(1); });
process.on('unhandledRejection', e => { console.log('FATAL_REJECT', e && (e.stack || String(e))); process.exit(1); });

// 静音但**保持播放**：暂停时播放页会退回无歌词的封面态（实测：paused 状态下两档截图一模一样，白测——
// shotTimes 恒为 [75,75] 就是铁证）。所以这里 seek 完必须真的把 deck 播起来，再按静音。
// App 会在 play/时间更新事件里把 volume 写回 1，所以每次按快门前面都要重新 mute，并抓 audible 计数：
// audible 必须恒为 0（这是用户真实听歌环境，绝不能出声）。
const quiet = async () => page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
});

// 页面内静音看门狗：App 会在 play/playing 事件里把 volume 写回 1、把 muted 关掉
// （实测 atlas 臂 playMuted 刚读完状态，deck 就变回 muted:false/vol:1）。
// 这是用户真实听歌环境，"按快门前 mute 一次"根本不够 —— 必须全程 100ms 一次按住，
// 并把"曾经可发声"的采样次数如实计进报告（samples*100ms 是上界近似，不是精确时长）。
const startMuteGuard = () => page.evaluate(() => {
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

const muteGuardStats = () => page.evaluate(() => ({
    audibleSamples: window.__muteAudibleSamples || 0,
    approxAudibleMs: (window.__muteAudibleSamples || 0) * 100,
}));

const stopMuteGuard = () => page.evaluate(() => {
    clearInterval(window.__muteGuard); window.__muteGuard = null;
    document.querySelectorAll('audio, video').forEach(el => { el.muted = true; el.volume = 0; });
});

const audibleCount = () => page.evaluate(() => Array.from(document.querySelectorAll('audio'))
    .filter(a => !a.paused && !a.muted && a.volume > 0).length);

const deckState = () => page.evaluate(() => Array.from(document.querySelectorAll('audio'))
    .map(a => ({ t: Number(a.currentTime.toFixed(2)), paused: a.paused, muted: a.muted, vol: a.volume })));

const seekTo = async (t) => {
    const st = await page.evaluate((sec) => {
        document.querySelectorAll('audio').forEach(a => {
            try { a.currentTime = sec; } catch { /* 未缓冲则忽略 */ }
        });
        return Array.from(document.querySelectorAll('audio'))
            .map(a => ({ t: Number(a.currentTime.toFixed(2)), paused: a.paused }));
    }, t);
    return st;
};

// 用 element.play() 而不是点按钮：Space 键会 toggle，但按下时到底是播放还是暂停态不可知，
// 而 play() 是幂等的。App 的状态同步挂在 audio 自身的 play 事件上（App.tsx:2441+），所以这样能真的进入播放态。
const playMuted = async () => {
    await quiet();
    await page.evaluate(() => {
        document.querySelectorAll('audio').forEach(a => { a.muted = true; a.volume = 0; a.play().catch(() => {}); });
    });
    await page.waitForTimeout(800);
    await quiet();
    return deckState();
};

const goHome = async () => {
    // 主页只是"下一臂的起点"，回不去不该把整轮测试判废（实测：App 在这一步被外力关掉过，
    // 四张图其实已经落盘，却因为 goHome 抛错整轮 FATAL）。所以这里失败只告警。
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            await page.evaluate((sel) => document.querySelector(sel)?.click(), HOME_ENTRY);
            await page.waitForTimeout(2500);
            if (!(await onPlayer())) return true;
        } catch (e) { console.log('GO_HOME_FAIL', e.message); return false; }
    }
    console.log('GO_HOME_NOT_REACHED');
    return false;
};

const onPlayer = () => page.evaluate(() => String(location.hash || '').replace(/^#/, '').trim() !== '');

// 进播放页：reload 之后 12s 里入口按钮不一定已经渲染出来（实测第一版静默点了个空，四张图全是主页）。
// 所以这里带重试 + 落点校验，进不去就直接抛错，绝不拿错的截图算差异。
const enterPlayer = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const found = await page.evaluate((sels) => {
            for (const s of sels) { const el = document.querySelector(s); if (el) { el.click(); return true; } }
            return false;
        }, PLAYER_ENTRY);
        await page.waitForTimeout(3500);
        if (await onPlayer()) return;
        console.log('enterPlayer retry', attempt, 'foundEntry', found);
    }
    throw new Error('NO_PLAYER_ENTRY_OR_NOT_REACHED');
};

// 字幕层里的当前行文本（DOM 侧），用来确认两个档位看到的是同一句。
const lyricText = () => page.evaluate(() => {
    const guess = document.querySelector('[data-testid="subtitle-line-active"], .subtitle-active, .lyric-active, [data-current-line]');
    if (guess) return (guess.textContent || '').trim();
    const nodes = Array.from(document.querySelectorAll('div,span,p'))
        .filter(el => el.children.length === 0 && (el.textContent || '').trim().length > 1 && el.getBoundingClientRect().width > 40);
    return nodes.slice(-6).map(el => (el.textContent || '').trim()).join(' / ');
});

const SEEK_SECONDS = 75;

const capture = async (flagValue, tag) => {
    console.log('CAPTURE_START', tag, new Date().toISOString());
    await page.evaluate(({ k, v }) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
        { k: 'diorama_unit_atlas', v: flagValue });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(12000);
    // 档位回读：这一臂的 flag 必须真的落进 localStorage，否则两臂跑的是同一条代码路径，
    // "差异≈0"是假的平局（vacuous parity）。
    const flag = await page.evaluate(() => localStorage.getItem('diorama_unit_atlas'));
    console.log('ARM_FLAG', tag, JSON.stringify(flag));
    if (flag !== flagValue) throw new Error(`FLAG_MISMATCH_${tag}: 期望 ${flagValue} 实际 ${flag}`);
    await page.bringToFront().catch(() => {});
    await quiet();
    await startMuteGuard();
    await enterPlayer();
    await seekTo(SEEK_SECONDS);
    const played = await playMuted();
    console.log('ARM_PLAYED', tag, JSON.stringify(played));
    if (played.every(x => x.paused)) { await stopMuteGuard(); throw new Error(`NOT_PLAYING_${tag}: 没能进入播放态，diorama 歌词层不会渲染`); }
    await page.waitForTimeout(2000);
    // 每枪前把播放头钉回同一个时间点：两档比的必须是同一句字、同一套字形布局，
    // 剩下的差异只能是 clock 驱动的粒子/相机/辉光呼吸 —— 噪声地板用同样方式量，才可比。
    const shot = async (name) => {
        const file = `${OUT_DIR}/parity-${name}.png`;
        await seekTo(SEEK_SECONDS);
        await quiet();
        await page.waitForTimeout(900);
        const times = await deckState();
        const aud = await audibleCount();
        if (times.every(x => x.paused)) { await stopMuteGuard(); throw new Error(`PAUSED_${tag}_${name}: 封面态截图无效`); }
        if (aud > 0) { await stopMuteGuard(); throw new Error(`NOT_MUTED_${tag}_${name}: 看门狗没按住，立即停`); }
        await page.screenshot({ path: file });
        return { file, times, audible: aud, lyric: await lyricText() };
    };
    const a = await shot(`${tag}-1`);
    const shots = [a];
    // 4 枪而不是 2 枪：卡拉OK 逐字高亮是按播放头走的，两臂不可能抓到同一瞬间，
    // 单对比较会被"相位差"污染。多取几枪后改判**最近邻**：
    //   跨臂最小差异 ≈ 同臂最小差异 ⇒ 图集没带来可测差异（相位对齐的那一对自然胜出）。
    for (let i = 2; i <= 4; i += 1) {
        await page.waitForTimeout(700);
        shots.push(await shot(`${tag}-${i}`));
    }
    const guard = await muteGuardStats();
    console.log('MUTE_GUARD', tag, JSON.stringify(guard));
    await stopMuteGuard();
    await goHome();
    return { flag, played, guard, shots };
};

// 前置自检：确认**当前正在跑的这份包**里真的有图集分支。
// 装的是旧包时两臂都会跑 per-unit，差异=0 是"两臂同一条路径"造成的假平局（vacuous parity）。
// 页面里 fetch(file://) 会被拒（实测 hit=[]），所以直接从磁盘读 asar 找字符串——asar 就是拼接的明文，
// 字符串字面量 'diorama_unit_atlas' 不会被压缩器改名，命中即证明这份包带图集代码柄。
const preflight = async () => {
    const asar = 'C:/folia-build/win-unpacked/resources/app.asar';
    let inBundle = null;
    try {
        inBundle = readFileSync(asar).includes('diorama_unit_atlas');
    } catch (e) { inBundle = `READ_FAIL ${e.message}`; }
    const flagWorks = await page.evaluate(() => {
        localStorage.setItem('diorama_unit_atlas', '__probe__');
        const read = localStorage.getItem('diorama_unit_atlas');
        localStorage.removeItem('diorama_unit_atlas');
        return read === '__probe__';
    });
    const target = await page.evaluate(() => location.href);
    console.log('PREFLIGHT', JSON.stringify({ inBundle, flagWorks, target }));
    if (inBundle !== true || !flagWorks) {
        console.log('ABORT: 包里没有图集代码柄 / 档位写不进去 —— 两臂会同一条路径，平局不作数');
        process.exit(2);
    }
};
await preflight();

const run = async (flag, tag) => {
    try { return await capture(flag, tag); }
    catch (e) { console.log('ARM_FAIL', tag, e.message); return null; }
};

const perunit = await run('off', 'perunit');
const atlas = await run('atlas', 'atlas');

if (!perunit || !atlas) {
    console.log('PARTIAL: 有一臂没跑完，四张图不齐，本次不做判定（shots 已落盘可复用）');
    try { await page.evaluate(() => localStorage.removeItem('diorama_unit_atlas')); } catch { /* App 已关，档位随页面一起没了 */ }
    process.exit(3);
}

// 档位残留清干净（图集是新缺省，用户机器上不该留着测试 key）。
await page.evaluate(() => localStorage.removeItem('diorama_unit_atlas'));

const diffStats = (fileA, fileB) => {
    const A = PNG.sync.read(readFileSync(fileA));
    const B = PNG.sync.read(readFileSync(fileB));
    if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
    const band = (f0, f1) => {
        const y0 = Math.floor(A.height * f0);
        const y1 = Math.floor(A.height * f1);
        let changed = 0;
        let maxDelta = 0;
        let sumDelta = 0;
        let pixels = 0;
        for (let y = y0; y < y1; y += 1) {
            for (let x = 0; x < A.width; x += 1) {
                const i = (A.width * y + x) << 2;
                let d = 0;
                for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]));
                pixels += 1;
                sumDelta += d;
                if (d > maxDelta) maxDelta = d;
                if (d > 8) changed += 1;
            }
        }
        return {
            band: `${A.width}x${y1 - y0}`,
            changedPx: changed,
            changedPct: Number((100 * changed / pixels).toFixed(2)),
            meanDelta: Number((sumDelta / pixels).toFixed(2)),
            maxDelta,
        };
    };
    // wide：歌词平面所在的横带。line：当前行字面本身所在的窄带 —— 图集若画偏/画糊，
    // 信号一定先出现在窄带里，窄带比宽带更敏感，也更能说明"差异来自粒子还是来自字"。
    return { wide: band(0.34, 0.66), line: band(0.45, 0.55) };
};

const compare = (a, b) => diffStats(a.file, b.file);
const tagOf = (list, i, j) => `${i + 1}v${j + 1}`;
const withinPairs = (shots) => {
    const out = [];
    for (let i = 0; i < shots.length; i += 1) {
        for (let j = i + 1; j < shots.length; j += 1) out.push({ pair: tagOf(shots, i, j), ...compare(shots[i], shots[j]) });
    }
    return out;
};
const crossPairs = (A, B) => {
    const out = [];
    for (let i = 0; i < A.length; i += 1) {
        for (let j = 0; j < B.length; j += 1) out.push({ pair: `p${i + 1}xa${j + 1}`, ...compare(A[i], B[j]) });
    }
    return out;
};
const stat = (list, band, key) => {
    const v = list.map(p => p?.[band]?.[key]).filter(x => typeof x === 'number');
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    return { min: s[0], median: s[Math.floor((s.length - 1) / 2)], max: s.at(-1) };
};

const wp = withinPairs(perunit.shots);
const wa = withinPairs(atlas.shots);
const w = wp.concat(wa);
const x = crossPairs(perunit.shots, atlas.shots);
const report = {
    at: new Date().toISOString(),
    seekSeconds: SEEK_SECONDS,
    flag: { perunit: perunit.flag, atlas: atlas.flag },
    played: { perunit: perunit.played, atlas: atlas.played },
    muteGuard: { perunit: perunit.guard, atlas: atlas.guard },
    shots: {
        perunit: perunit.shots.map(s => ({ times: s.times, audible: s.audible, lyric: s.lyric })),
        atlas: atlas.shots.map(s => ({ times: s.times, audible: s.audible, lyric: s.lyric })),
    },
    // 判据（最近邻）：跨臂最小值 ≤ 同臂最小值 ⇒ 存在一对"相位对齐"的跨臂图，
    // 它们的差异不比同臂两张图更大 ⇒ 图集没带来可测的视觉差异。
    noiseFloorWithin: { perunit: withinPairs(perunit.shots), atlas: withinPairs(atlas.shots) },
    crossArm: x,
    summary: {
        within_min_wide: stat(w, 'wide', 'changedPct')?.min,
        within_min_line: stat(w, 'line', 'changedPct')?.min,
        within_max_wide: stat(w, 'wide', 'changedPct')?.max,
        cross_min_wide: stat(x, 'wide', 'changedPct')?.min,
        cross_min_line: stat(x, 'line', 'changedPct')?.min,
        cross_median_wide: stat(x, 'wide', 'changedPct')?.median,
    },
    note: '每枪前 seek 回同一秒；两臂字面内容/布局同一，剩余差异来自 clock 驱动的粒子与卡拉OK逐字高亮相位。',
};
const file = `${OUT_DIR}/parity-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
// 控制台只打高信号部分（40 对的明细留在 JSON 里可复查）。
console.log(JSON.stringify({
    flag: report.flag, muteGuard: report.muteGuard, summary: report.summary,
    shots: report.shots,
    within_min: { perunit: stat(wp, 'wide', 'changedPct').min, atlas: stat(wa, 'wide', 'changedPct').min },
    cross: stat(x, 'wide', 'changedPct'), cross_line_min: stat(x, 'line', 'changedPct').min,
}, null, 2));
console.log('FILE', file);

// 收尾：测试期间是我把用户真实播放队列播起来的（静音），跑完按回暂停，档位 key 清干净并回读复核。
let residue = 'PAGE_GONE';
try {
    await page.evaluate(() => { document.querySelectorAll('audio').forEach(a => a.pause()); localStorage.removeItem('diorama_unit_atlas'); });
    await page.waitForTimeout(1500);
    residue = await page.evaluate(() => ({
        atlas: localStorage.getItem('diorama_unit_atlas'),
        prewarm: localStorage.getItem('diorama_prewarm'),
        paused: Array.from(document.querySelectorAll('audio')).map(a => a.paused),
    }));
} catch (e) { console.log('CLEANUP_FAIL', e.message); }
console.log('RESIDUE', JSON.stringify(residue));
process.exit(0);
// 绝不调 browser.close()：connectOverCDP 拿到的 browser 一 close 就给 Electron 发 Browser.close，
// 会把用户这台真实听歌环境整个关掉（实测：跑完一轮 App 就没了）。用 process.exit 断开 websocket，
// 也不能只靠自然退出——playwright 的连接句柄会让事件循环一直活着，进程永不结束。
