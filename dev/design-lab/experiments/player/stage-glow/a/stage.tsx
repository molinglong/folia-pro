import React, { useEffect, useRef } from 'react';

// 方案 A · 环绕舞台聚光：以封面为中心放射光刃 + 核心辉光（真墙 LightsStageGlow 的浓缩版）。
// 光层压在封面 DOM 之下（层级隔离），所以光永远不叠卡面——这是用户红线，接线时同理靠抠洞/层级解决。
// 亮度与光程跟模拟节拍包络走（快起峰 30ms / 慢衰减 350ms）；真 App 里信号源换成全局 audioPower/bass。
const RAYS = 14;
const DUST = 60;
const DOWNSCALE = 3;

type Props = { anchorRef: React.RefObject<HTMLElement | null>; enabled: boolean; gain: number };

export default function StageGlowCanvas({ anchorRef, enabled, gain }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0, W = 0, H = 0, DPR = 1, time = 0, last = performance.now();
        let env = 0, level = 0, beat = -1, clock = 0;
        let seed = 20261014;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        const rays = Array.from({ length: RAYS }, () => ({
            a: rnd() * Math.PI * 2, w: 0.05 + rnd() * 0.08, phase: rnd() * 6.28,
            f1: 0.08 + rnd() * 0.16, f2: 0.05 + rnd() * 0.1, lenBias: 0.8 + rnd() * 0.4,
        }));
        const motes = Array.from({ length: DUST }, () => ({
            x: rnd(), y: rnd(), z: rnd(), vy: 0.012 + rnd() * 0.03,
            swayF: 0.2 + rnd() * 0.5, swayA: 0.012 + rnd() * 0.03, phase: rnd() * 6.28, tw: 0.6 + rnd() * 2,
        }));
        const buf = document.createElement('canvas');
        const bctx = buf.getContext('2d')!;
        const resize = () => {
            const r = canvas.getBoundingClientRect();
            DPR = Math.min(1.5, window.devicePixelRatio || 1);
            W = Math.max(1, r.width * DPR); H = Math.max(1, r.height * DPR);
            canvas.width = W; canvas.height = H;
            buf.width = Math.max(1, W / DOWNSCALE); buf.height = Math.max(1, H / DOWNSCALE);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        const acc = [255, 150, 110]; // 主题强调色近似；真墙里用 CSS 变量解析，每 2s 刷新

        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!enabled) { ctx.clearRect(0, 0, W, H); return; } // 开灯态：完全不绘制
            time += dt;

            // —— 模拟节拍源（接线时整段替换为读 audioPower/bass）——
            clock += dt;
            const period = 60 / 96;
            while (clock >= period) {
                clock -= period;
                beat = (beat + 1) % 4;
                level = beat === 0 ? 1 : beat === 2 ? 0.78 : 0.4;
            }
            level *= Math.exp(-dt / 0.16);
            const lfo = 0.5 + 0.5 * Math.sin(time * 0.25);
            const target = Math.min(1, level * (0.72 + 0.28 * lfo));
            env += (target - env) * (target > env ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.35));
            const g = env * gain;

            const anchor = anchorRef.current;
            if (!anchor) return;
            const cr = canvas.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
            const cx = (ar.left + ar.width / 2 - cr.left) * DPR;
            const cy = (ar.top + ar.height / 2 - cr.top) * DPR;
            const cw = ar.width * DPR;
            const bright = 0.85 + 0.55 * g;                       // 整体亮度跟包络
            const maxL = cw * 3.4 * (0.92 + 0.16 * g);            // 光程一吸一吐

            // 1) 光刃 + 核心辉光画进 1/DOWNSCALE 离屏缓冲，加性混合
            bctx.clearRect(0, 0, buf.width, buf.height);
            bctx.globalCompositeOperation = 'lighter';
            for (const ray of rays) {
                const breathe = 0.34 + 0.66 * (0.5 + 0.5 * Math.sin(time * ray.f1 * 2 + ray.phase));
                const width = ray.w * (0.7 + 0.45 * Math.sin(time * ray.f2 * 2 + ray.phase * 1.7));
                const L = maxL * ray.lenBias / DOWNSCALE;
                const x0 = cx / DOWNSCALE, y0 = cy / DOWNSCALE;
                const grad = bctx.createLinearGradient(x0, y0, x0 + Math.cos(ray.a) * L, y0 + Math.sin(ray.a) * L);
                const peak = 0.46 * bright * breathe;
                grad.addColorStop(0, `rgba(${acc},${peak.toFixed(4)})`);
                grad.addColorStop(0.5, `rgba(${acc},${(peak * 0.5).toFixed(4)})`);
                grad.addColorStop(1, `rgba(${acc},0)`);
                bctx.fillStyle = grad;
                bctx.beginPath();
                bctx.moveTo(x0, y0);
                bctx.lineTo((cx / DOWNSCALE) + Math.cos(ray.a - width) * L, (cy / DOWNSCALE) + Math.sin(ray.a - width) * L);
                bctx.lineTo((cx / DOWNSCALE) + Math.cos(ray.a + width) * L, (cy / DOWNSCALE) + Math.sin(ray.a + width) * L);
                bctx.closePath();
                bctx.fill();
            }
            {
                const r = maxL * 0.34 / DOWNSCALE;
                const core = bctx.createRadialGradient(cx / DOWNSCALE, cy / DOWNSCALE, 0, cx / DOWNSCALE, cy / DOWNSCALE, r);
                core.addColorStop(0, `rgba(${acc},${((0.5 + 0.5 * g) * 0.9).toFixed(4)})`);
                core.addColorStop(0.45, `rgba(${acc},${(0.2 * bright).toFixed(4)})`);
                core.addColorStop(1, `rgba(${acc},0)`);
                bctx.fillStyle = core;
                bctx.fillRect(0, 0, buf.width, buf.height);
            }

            // 2) 主画布：放大离屏（自带柔化）→ 浮尘（落在光刃角度里才点亮）
            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(buf, 0, 0, W, H);
            ctx.globalCompositeOperation = 'lighter';
            for (const m of motes) {
                m.y -= m.vy * dt * 3;
                if (m.y < -0.02) m.y = 1.02;
                const px = (m.x + Math.sin(time * m.swayF + m.phase) * m.swayA) * W;
                const py = m.y * H;
                const dx = px - cx, dy = py - cy;
                const dist = Math.hypot(dx, dy);
                let lit = 0;
                const ang = Math.atan2(dy, dx);
                for (const ray of rays) {
                    const da = Math.atan2(Math.sin(ang - ray.a), Math.cos(ang - ray.a));
                    const edge = 1 - Math.min(1, Math.abs(da) / (ray.w * 1.9));
                    if (edge > lit && dist < maxL * ray.lenBias) lit = edge * edge;
                }
                const alpha = (0.02 + lit * 0.5) * (0.4 + m.z * 0.6) * bright * (1 + 0.5 * g);
                if (alpha < 0.008) continue;
                const s = (1.5 + (1 - m.z) * 6) * DPR;
                ctx.globalAlpha = Math.min(0.85, alpha) * (0.72 + 0.28 * Math.sin(time * m.tw + m.phase));
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(px, py, s / 2, 0, 6.2832);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        };
        raf = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, [anchorRef, enabled, gain]);

    // inline 样式压过 `.album > *` 的层级规则，保证光在封面之下、背景之上
    return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', inset: '-45%', pointerEvents: 'none', mixBlendMode: 'screen', zIndex: 0 }} />;
}
