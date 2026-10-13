// dev/fork/parity-diff.mjs
// @fork 对已落盘的 parity-*.png 复算差异，不必重跑 App（截图是证据，判定逻辑可以复查）。
// 与 cdp-diorama-parity.mjs 同一套窄带/宽带口径：
//   wide = 画面 34%~66%（歌词平面所在横带），line = 45%~55%（当前行字面本身）。
// 判据：跨档位 ≤ 同档位噪声地板 ⇒ 视觉上分不出来。
// 用法: node dev/fork/parity-diff.mjs [目录]   （默认 C:/folia-build/perf）
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const DIR = process.argv[2] || 'C:/folia-build/perf';
const path = n => `${DIR}/parity-${n}.png`;

const stats = (fileA, fileB) => {
    const A = PNG.sync.read(readFileSync(fileA));
    const B = PNG.sync.read(readFileSync(fileB));
    if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
    const band = (f0, f1) => {
        const y0 = Math.floor(A.height * f0);
        const y1 = Math.floor(A.height * f1);
        let changed = 0; let maxDelta = 0; let sumDelta = 0; let pixels = 0;
        for (let y = y0; y < y1; y += 1) {
            for (let x = 0; x < A.width; x += 1) {
                const i = (A.width * y + x) << 2;
                let d = 0;
                for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(A.data[i + c] - B.data[i + c]));
                pixels += 1; sumDelta += d;
                if (d > maxDelta) maxDelta = d;
                if (d > 8) changed += 1;
            }
        }
        return { px: pixels, changedPct: Number((100 * changed / pixels).toFixed(2)), meanDelta: Number((sumDelta / pixels).toFixed(2)), maxDelta };
    };
    return { wide: band(0.34, 0.66), line: band(0.45, 0.55) };
};

const pairs = {
    'noiseFloor perunit 1v2': [path('perunit-1'), path('perunit-2')],
    'noiseFloor atlas 1v2': [path('atlas-1'), path('atlas-2')],
    'crossArm shot1': [path('perunit-1'), path('atlas-1')],
    'crossArm shot2': [path('perunit-2'), path('atlas-2')],
    // 交叉错配：拿 perunit 的图比 atlas 的另一枪，检验"档位差"会不会被时刻差放大。
    'crossArm mixed': [path('perunit-1'), path('atlas-2')],
};
const report = {};
for (const [k, [a, b]] of Object.entries(pairs)) report[k] = stats(a, b);
console.log(JSON.stringify(report, null, 2));
const f = `${DIR}/parity-diff-${Date.now()}.json`;
writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
console.log('FILE', f);
