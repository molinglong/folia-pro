import React, { useEffect, useRef } from 'react';

// 方案 C · 顶部追光（lattice 覆光版）：虚拟灯位在场地上沿、压在当前卡正上方，扇形光锥向下洒落；
// 光锥随慢摆轻摇、随鼓点增亮，光直接铺在其他卡片封面上，仅当前播放卡每帧抠穿——它盖住光、卡面保持干净。
// 与 A 的差别：光源在卡外（外打内），叙事是"追光灯照着这块区域"，而非"卡本身是灯"。
const RAYS = 13;
const DUST = 120;
const DOWNSCALE = 3;
const REACH_H = 1.5;      // 光程 = 场地高 × 倍数（从顶上打到全场还有余）
const BASE_BRIGHT = 1.3;

type Props = { hostRef: React.RefObject<HTMLElement | null>; enabled: boolean; gain: number };

export default function WallBeamCanvas({ hostRef, enabled, gain }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const host = hostRef.current;
        if (!canvas || !host) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0, W = 0, H = 0, DPR = 1, time = 0, last = performance.now();
        let env = 0, level = 0, beat = -1, clock = 0;
        let lastCx = 0, seen = false;
        let seed = 555777;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        // 扇内光刃：off 为相对垂直向下的偏角，边缘刃更细更暗，中心刃粗亮
        const rays = Array.from({ length: RAYS }, (_, i) => {
            const t = i / (RAYS - 1) - 0.5;
            return {
                off: t * 1.15,                                   // ±33° 扇形
                w: 0.028 + (0.5 - Math.abs(t)) * 0.05 + rnd() * 0.018,
                phase: rnd() * 6.28, f1: 0.06 + rnd() * 0.14, f2: 0.05 + rnd() * 0.1,
                lenBias: 0.88 + rnd() * 0.2, dim: 0.55 + (0.5 - Math.abs(t)) * 0.9,
            };
        });
        const motes = Array.from({ length: DUST }, () => ({
            x: rnd(), y: rnd(), z: rnd(), vy: 0.02 + rnd() * 0.05,
            swayF: 0.3 + rnd() * 0.8, swayA: 0.008 + rnd() * 0.02, phase: rnd() * 6.28, tw: 0.6 + rnd() * 2,
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

        const acc = [255, 198, 148]; // 追光偏暖白；真墙接 --text-accent

        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!enabled) { ctx.clearRect(0, 0, W, H); return; }
            time += dt;

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
            const bright = BASE_BRIGHT * (0.82 + 0.58 * g);

            // 灯位横坐标追着当前卡（丢失沿用最后值）
            const current = host.querySelector<HTMLElement>('[data-poster][data-current]');
            const hr = host.getBoundingClientRect();
            if (current) lastCx = (current.getBoundingClientRect().left + current.getBoundingClientRect().width / 2 - hr.left) / hr.width;
            if (!seen && current) seen = true;
            if (!seen) return;
            const lx = lastCx * W, ly = -H * 0.08;               // 灯在场地上沿之外
            const maxL = H * REACH_H;
            const sway = Math.sin(time * 0.35) * 0.05 + Math.sin(time * 0.9) * 0.015;   // 慢摆 + 微颤

            bctx.clearRect(0, 0, buf.width, buf.height);
            bctx.globalCompositeOperation = 'lighter';
            for (const ray of rays) {
                const breathe = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * ray.f1 * 2 + ray.phase));
                const a = Math.PI / 2 + ray.off + sway;
                const width = ray.w * (0.75 + 0.35 * Math.sin(time * ray.f2 * 2 + ray.phase * 1.7));
                const L = maxL * ray.lenBias / DOWNSCALE;
                const x0 = lx / DOWNSCALE, y0 = ly / DOWNSCALE;
                const grad = bctx.createLinearGradient(x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L);
                const peak = 0.4 * bright * breathe * ray.dim;
                grad.addColorStop(0, `rgba(${acc},${peak.toFixed(4)})`);
                grad.addColorStop(0.55, `rgba(${acc},${(peak * 0.45).toFixed(4)})`);
                grad.addColorStop(1, `rgba(${acc},0)`);
                bctx.fillStyle = grad;
                bctx.beginPath();
                bctx.moveTo(x0, y0);
                bctx.lineTo(x0 + Math.cos(a - width) * L, y0 + Math.sin(a - width) * L);
                bctx.lineTo(x0 + Math.cos(a + width) * L, y0 + Math.sin(a + width) * L);
                bctx.closePath();
                bctx.fill();
            }
            {   // 灯头辉光：贴在顶沿的一团，光锥"有出处"
                const r = maxL * 0.2 / DOWNSCALE;
                const core = bctx.createRadialGradient(lx / DOWNSCALE, ly / DOWNSCALE, 0, lx / DOWNSCALE, ly / DOWNSCALE, r);
                core.addColorStop(0, `rgba(${acc},${((0.5 + 0.5 * g) * 0.9).toFixed(4)})`);
                core.addColorStop(1, `rgba(${acc},0)`);
                bctx.fillStyle = core;
                bctx.fillRect(0, 0, buf.width, buf.height);
            }

            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(buf, 0, 0, W, H);

            // 浮尘：缓慢下坠（顶部光的灰），落在光锥角内才被点亮
            ctx.globalCompositeOperation = 'lighter';
            for (const m of motes) {
                m.y += m.vy * dt * 0.6;
                if (m.y > 1.02) m.y = -0.02;
                const px = (m.x + Math.sin(time * m.swayF + m.phase) * m.swayA) * W;
                const py = m.y * H;
                const dx = px - lx, dy = py - ly;
                const dist = Math.hypot(dx, dy);
                const ang = Math.atan2(dy, dx);
                let lit = 0;
                for (const ray of rays) {
                    const a = Math.PI / 2 + ray.off + sway;
                    const da = Math.atan2(Math.sin(ang - a), Math.cos(ang - a));
                    const edge = 1 - Math.min(1, Math.abs(da) / (ray.w * 2.1));
                    if (edge > lit && dist < maxL * ray.lenBias) lit = edge * edge * ray.dim;
                }
                const fall = Math.max(0, 1 - dist / maxL);
                const alpha = (0.015 + lit * 0.5 * fall) * bright * (1 + 0.5 * g);
                if (alpha < 0.008) continue;
                const s = (1.3 + (1 - m.z) * 5) * DPR;
                ctx.globalAlpha = Math.min(0.85, alpha) * (0.72 + 0.28 * Math.sin(time * m.tw + m.phase));
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(px, py, s / 2, 0, 6.2832);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // 只抠灯位卡：当前播放卡盖住光保持卡面干净，光铺在其他卡片封面上
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000';
            for (const card of Array.from(host.querySelectorAll<HTMLElement>('[data-poster]'))) {
                if (!card.hasAttribute('data-current')) continue;
                const cr = card.getBoundingClientRect();
                ctx.beginPath();
                ctx.roundRect((cr.left - hr.left) * DPR, (cr.top - hr.top) * DPR, cr.width * DPR, cr.height * DPR, 8 * DPR);
                ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
        };
        raf = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, [hostRef, enabled, gain]);

    return <canvas ref={canvasRef} aria-hidden="true"
        style={{ position: 'absolute', inset: 0, zIndex: 3, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'screen' }} />;
}
