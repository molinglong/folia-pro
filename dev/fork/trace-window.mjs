// dev/fork/trace-window.mjs — 从原始 trace 里以「点击」为锚点切一个时间窗，按墙钟顺序列出主线程开销。
// 为什么需要它：cdp-transition-trace.mjs 的聚合表是整段的，启动噪声（MajorGC、chunk 首次解析）
// 会把切换那一帧的信号盖掉；要归因某一帧，必须先按事件锚定时刻再开窗。
// 用法: node dev/fork/trace-window.mjs <trace.json> [anchorIndex=0] [windowMs=600]
import fs from 'node:fs';

const file = process.argv[2];
const anchorIdx = Number(process.argv[3] ?? 0);
const windowMs = Number(process.argv[4] ?? 600);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const evs = raw.traceEvents ?? raw;

const clicks = evs.filter(e => e.name === 'EventDispatch' && e.args?.data?.type === 'click');
console.log('click anchors:', clicks.map(c => c.ts).join(', '));
if (!clicks.length) { console.log('NO_CLICK_ANCHOR'); process.exit(1); }
const t0 = clicks[anchorIdx].ts;
const t1 = t0 + windowMs * 1000;

const keep = e => e.ts >= t0 && e.ts < t1 && e.dur && e.dur / 1000 >= 1
    // 只要主线程的活：这些类别之外多是 GPU/工作线程/基座计时器，会淹没信号。
    && /devtools\.timeline|blink|v8|cc|loading|benchmark/.test(e.cat || '');
const rows = evs.filter(keep).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

const argStr = (e) => {
    const d = (e.args && e.args.data) || {};
    const st = Array.isArray(d.stackTrace) && d.stackTrace.length
        ? ` <- ${st0(d.stackTrace)}` : '';
    const parts = [];
    for (const k of ['functionName', 'url', 'lineNumber', 'type', 'nodeName', 'id']) {
        if (d[k] !== undefined) parts.push(`${k}=${String(d[k]).split(/[\\/]/).pop()}`);
    }
    return parts.join(' ') + st;
};
function st0(stack) {
    const f = stack.filter(s => s.url && !/node:|chrome:/.test(s.url));
    return f.slice(0, 3).map(s => `${s.functionName || '(anon)'}@${String(s.url).split(/[\\/]/).pop()}:${s.lineNumber}`).join(' <- ');
}
console.log(`window ${windowMs}ms from click #${anchorIdx}, events>=1ms: ${rows.length}`);
for (const e of rows) {
    console.log(`${((e.ts - t0) / 1000).toFixed(1).padStart(7)}ms ${(e.dur / 1000).toFixed(1).padStart(7)}ms ${e.name.slice(0, 40).padEnd(40)} ${argStr(e)}`);
}
