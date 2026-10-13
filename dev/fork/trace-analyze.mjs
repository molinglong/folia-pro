// dev/fork/trace-analyze.mjs — 从 cdp-transition-trace.mjs 落的原始 trace 里挖长帧构成
// 用法: node dev/fork/trace-analyze.mjs <trace.json> [minMs=15]
import fs from 'node:fs';

const file = process.argv[2];
const minMs = Number(process.argv[3] ?? 15);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const evs = raw.traceEvents ?? raw;

const num = (v) => (typeof v === 'number' ? v : 0);
const top = [];
for (const e of evs) {
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.dur / 1000 < minMs) continue;
    top.push(e);
}
top.sort((a, b) => a.ts - b.ts);
const argStr = (e) => {
    const d = (e.args && e.args.data) || {};
    const parts = [];
    for (const k of ['functionName', 'url', 'fileName', 'lineNumber', 'columnNumber', 'type', 'layer', 'nodeName', 'taskId']) {
        if (d[k] !== undefined) parts.push(`${k}=${String(d[k]).slice(-90)}`);
    }
    return parts.join(' ');
};
console.log(`events>=${minMs}ms: ${top.length} (total ${evs.length})`);
for (const e of top) {
    console.log(`${(e.dur / 1000).toFixed(1).padStart(8)}ms ${String(e.ts).padStart(16)} ${e.cat.padEnd(18)} ${String(e.name).slice(0, 46).padEnd(46)} ${argStr(e)}`);
}

// 按名字聚合，看谁贡献最多
const agg = new Map();
for (const e of top) {
    const d = (e.args && e.args.data) || {};
    const key = `${e.name} ${(d.functionName || d.fileName || d.url || '').slice(-60)}`;
    const cur = agg.get(key) || { ms: 0, n: 0, max: 0 };
    cur.ms += num(e.dur) / 1000;
    cur.n += 1;
    cur.max = Math.max(cur.max, num(e.dur) / 1000);
    agg.set(key, cur);
}
console.log('\nAGG');
[...agg.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 20)
    .forEach(([k, v]) => console.log(`${v.ms.toFixed(1).padStart(9)}ms n=${String(v.n).padStart(4)} max=${v.max.toFixed(1)} ${k}`));
