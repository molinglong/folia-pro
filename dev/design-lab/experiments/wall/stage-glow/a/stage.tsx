import React, { useEffect, useRef } from 'react';

// 方案 A · 环绕舞台聚光（lattice 无形状雾感版）：以当前播放卡为灯位，弥漫光雾 + 核心辉光 + 浮尘，
// 光直接覆盖在其他卡片封面上（screen 混合只提亮），仅灯位那张卡每帧抠穿——它盖住光、卡面保持干净。
// 细做点（无形状雾感版）：①光不画形状——每根光是一串沿轴向互相叠印的软烟斑（蛇形游走/沿程
// 变宽/变淡），边界溶进雾里，只剩亮淡渐变；②缓冲叠三次（强模糊雾底/中模糊辉光/少量原样）；
// ③雾团层：大尺寸高斯软斑慢漂+呼吸缩放，束内被点亮、束外只留薄霾；④浮尘软颗粒三层景深；
// ⑤卡缘背光描边（shadowBlur rim）；⑥鼓点起峰核心泛光过冲（flare）后快衰。
// 亮度/光程跟模拟节拍包络（起峰 30ms / 衰减 350ms）；真墙接线时整段节拍换成读 audioPower/bass。
const RAYS = 18;
const FOG = 30;           // 雾团数：大尺寸软斑，雾感主体
const DUST = 220;
const DOWNSCALE = 2;      // 细做后靠双层叠加控制柔度，缓冲可以更精细
const CARD_REACH = 7;     // 光程 = 当前卡宽 × 倍数
const BASE_BRIGHT = 1.1;  // 峰值比旧版低：光现在会真实铺在卡面上，靠叠加与热芯出量感而非硬提亮度

const ACC = '253,130,96';     // 主题强调色近似；真墙每 2s 解析 --text-accent
const WARM = '255,213,170';   // 灯丝暖白：热芯与近景尘偏它

type Props = { hostRef: React.RefObject<HTMLElement | null>; enabled: boolean; gain: number };

export default function WallGlowCanvas({ hostRef, enabled, gain }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const host = hostRef.current;
        if (!canvas || !host) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0, W = 0, H = 0, DPR = 1, time = 0, last = performance.now();
        let env = 0, flare = 0, level = 0, beat = -1, clock = 0;
        let lastOx = 0, lastOy = 0, lastCw = 0, lastCh = 0, seen = false;
        let seed = 987654321;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

        // 每根光刃一套独立“性格”：基础角、双频摇曳、宽度呼吸、多频闪烁、长短、暖度
        const rays = Array.from({ length: RAYS }, () => ({
            a: rnd() * Math.PI * 2,
            swayA: 0.012 + rnd() * 0.05, swayF: 0.05 + rnd() * 0.16, swayP: rnd() * 6.28,
            swayA2: 0.004 + rnd() * 0.014, swayF2: 0.2 + rnd() * 0.5, swayP2: rnd() * 6.28,
            w: 0.03 + rnd() * 0.055, wF: 0.08 + rnd() * 0.22, wP: rnd() * 6.28,
            f1: 0.11 + rnd() * 0.3, p1: rnd() * 6.28, f2: 0.07 + rnd() * 0.19, p2: rnd() * 6.28,
            lenBias: 0.62 + rnd() * 0.55, warm: rnd(),
        }));
        // 雾团：坐标/尺寸都以“当前卡宽倍数”计，慢漂+横向摆动+呼吸缩放
        const fogs = Array.from({ length: FOG }, () => ({
            ox: (rnd() - 0.5) * CARD_REACH * 2.4, oy: (rnd() - 0.5) * CARD_REACH * 1.8,
            size: 0.7 + rnd() * 1.9, rise: 0.006 + rnd() * 0.02,
            swayF: 0.05 + rnd() * 0.22, swayA: 0.06 + rnd() * 0.22, phase: rnd() * 6.28,
            pulseF: 0.04 + rnd() * 0.14, pulseP: rnd() * 6.28, warm: rnd(),
        }));
        // 浮尘：z=景深（0 远 1 近），坐标以“当前卡宽倍数”存储跟随缩放（真墙同款）
        const motes = Array.from({ length: DUST }, () => ({
            ox: (rnd() - 0.5) * CARD_REACH * 2.2, oy: (rnd() - 0.5) * CARD_REACH * 1.6, z: rnd(),
            rise: 0.016 + rnd() * 0.05, swayF: 0.25 + rnd() * 0.9, swayA: 0.03 + rnd() * 0.11,
            phase: rnd() * 6.28, tw: 0.6 + rnd() * 2.2, warm: rnd(),
        }));

        // 预渲染软颗粒精灵：中心亮边缘全透的高斯感圆点，drawImage 缩放代替逐颗径向渐变
        const sprite = document.createElement('canvas');
        {
            sprite.width = sprite.height = 64;
            const s = sprite.getContext('2d')!;
            const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            s.fillStyle = g;
            s.fillRect(0, 0, 64, 64);
        }
        // 雾团精灵：比尘更缓的衰减曲线（中心就不打满，边缘长尾）——大尺寸铺开后才是“雾”不是“斑”
        const fogSprite = document.createElement('canvas');
        {
            fogSprite.width = fogSprite.height = 128;
            const s = fogSprite.getContext('2d')!;
            const g = s.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,0.55)');
            g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
            g.addColorStop(0.72, 'rgba(255,255,255,0.08)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            s.fillStyle = g;
            s.fillRect(0, 0, 128, 128);
        }

        // 烟斑精灵：与雾团同款长尾曲线但带色相（暖白/强调色）——“无形状”体积光的笔刷
        const tintedSprite = (rgb: string) => {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const s = c.getContext('2d')!;
            const g = s.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, `rgba(${rgb},0.5)`);
            g.addColorStop(0.4, `rgba(${rgb},0.26)`);
            g.addColorStop(0.72, `rgba(${rgb},0.07)`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            s.fillStyle = g;
            s.fillRect(0, 0, 128, 128);
            return c;
        };
        const smokeWarm = tintedSprite(WARM);
        const smokeAcc = tintedSprite(ACC);

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

        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!enabled) { ctx.clearRect(0, 0, W, H); return; } // 开灯态完全不绘制
            time += dt;

            // —— 模拟节拍（真墙接线时整段替换为 audioPower/bass）——
            clock += dt;
            const period = 60 / 96;
            while (clock >= period) {
                clock -= period;
                beat = (beat + 1) % 4;
                level = beat === 0 ? 1 : beat === 2 ? 0.78 : 0.4;
                if (beat === 0) flare = 1; // 小节头：核心泛光过冲
            }
            level *= Math.exp(-dt / 0.16);
            flare *= Math.exp(-dt / 0.12);
            const lfo = 0.5 + 0.5 * Math.sin(time * 0.25);
            const target = Math.min(1, level * (0.72 + 0.28 * lfo));
            env += (target - env) * (target > env ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.35));
            const g = env * gain;
            const bright = BASE_BRIGHT * (0.82 + 0.58 * g) * (1 + 0.22 * flare * gain);

            // 灯位：当前播放卡；丢失时沿用最后位置不闪失（真墙同款）
            const current = host.querySelector<HTMLElement>('[data-poster][data-current]');
            const hr = host.getBoundingClientRect();
            if (current) {
                const cr = current.getBoundingClientRect();
                lastOx = (cr.left + cr.width / 2 - hr.left) * DPR;
                lastOy = (cr.top + cr.height / 2 - hr.top) * DPR;
                lastCw = cr.width * DPR; lastCh = cr.height * DPR;
                seen = true;
            }
            if (!seen) return; // 还没有有效灯位
            const ox = lastOx, oy = lastOy, cw = lastCw;
            const maxL = cw * CARD_REACH * (0.92 + 0.16 * g + 0.05 * flare);

            // 1) 体积光（无形状版）：每根光不再画三角束，而是一串沿轴向互相叠印的软烟斑——
            //    斑位蛇形游走、斑径沿程变大、透明度沿程衰减，边界完全溶进雾里，只剩“亮淡渐变”
            bctx.clearRect(0, 0, buf.width, buf.height);
            bctx.globalCompositeOperation = 'lighter';
            const x0 = ox / DOWNSCALE, y0 = oy / DOWNSCALE;
            const STEPS = 8;
            for (const ray of rays) {
                const ang = ray.a
                    + Math.sin(time * ray.swayF * 2 + ray.swayP) * ray.swayA
                    + Math.sin(time * ray.swayF2 * 2 + ray.swayP2) * ray.swayA2;
                const flick = (0.5 + 0.5 * Math.sin(time * ray.f1 * 2 + ray.p1))
                    * (0.62 + 0.38 * Math.sin(time * ray.f2 * 2 + ray.p2));
                if (flick < 0.05) continue;
                const L = maxL * ray.lenBias * (1 + 0.05 * g) / DOWNSCALE;
                const smoke = ray.warm > 0.55 ? smokeWarm : smokeAcc;
                const cA = Math.cos(ang), sA = Math.sin(ang);
                for (let i = 0; i < STEPS; i++) {
                    const t = (i + 0.65) / STEPS;
                    // 横向蛇形沿程放大：光路像烟一样拧动，“中轴”本身在漂，不存在固定直线
                    const lateral = Math.sin(time * ray.f2 * 1.6 + i * 1.9 + ray.p1) * L * 0.085 * t
                        + Math.sin(time * ray.swayF2 * 2 + i * 0.8 + ray.swayP2) * L * 0.03 * t;
                    const along = L * t * (0.92 + 0.08 * Math.sin(time * ray.f1 * 2 + i + ray.p2));
                    const px = x0 + cA * along - sA * lateral;
                    const py = y0 + sA * along + cA * lateral;
                    const size = (cw / DOWNSCALE) * (0.9 + 3.4 * t);   // 沿程变宽：远端散开没形，近灯才稍浓
                    const a = 0.15 * bright * flick * Math.pow(1 - t, 1.45);
                    if (a < 0.004) continue;
                    bctx.globalAlpha = a;
                    bctx.drawImage(smoke, px - size / 2, py - size / 2, size, size);
                }
                bctx.globalAlpha = 1;
            }
            // 2) 核心辉光：热白小核 + 暖色大晕（鼓点时小核泛光过冲）
            {
                const r1 = cw * (0.62 + 0.1 * flare) / DOWNSCALE;
                const hot = bctx.createRadialGradient(x0, y0, 0, x0, y0, r1);
                hot.addColorStop(0, `rgba(${WARM},${((0.5 + 0.45 * g + 0.3 * flare) * 0.9).toFixed(4)})`);
                hot.addColorStop(0.5, `rgba(${WARM},${(0.16 * bright).toFixed(4)})`);
                hot.addColorStop(1, 'rgba(255,213,170,0)');
                bctx.fillStyle = hot;
                bctx.fillRect(0, 0, buf.width, buf.height);
                const r2 = cw * 2.1 / DOWNSCALE;
                const halo = bctx.createRadialGradient(x0, y0, 0, x0, y0, r2);
                halo.addColorStop(0, `rgba(${ACC},${(0.2 * bright).toFixed(4)})`);
                halo.addColorStop(0.55, `rgba(${ACC},${(0.07 * bright).toFixed(4)})`);
                halo.addColorStop(1, `rgba(${ACC},0)`);
                bctx.fillStyle = halo;
                bctx.fillRect(0, 0, buf.width, buf.height);
            }

            // 3) 主画布：缓冲叠三次拉开雾感层次——强模糊当雾底为主、中模糊当辉光、原样只留少量
            //    骨架（清晰层压到最低：形状感主要来自它，无形状诉求下宁缺勿多）
            ctx.clearRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'lighter';
            ctx.filter = `blur(${(10 * DPR).toFixed(1)}px)`;
            ctx.globalAlpha = 0.62;
            ctx.drawImage(buf, 0, 0, W, H);
            ctx.filter = `blur(${(3.2 * DPR).toFixed(1)}px)`;
            ctx.globalAlpha = 0.6;
            ctx.drawImage(buf, 0, 0, W, H);
            ctx.filter = 'none';
            ctx.globalAlpha = 0.45;
            ctx.drawImage(buf, 0, 0, W, H);
            ctx.globalAlpha = 1;

            // 4) 环境洗光：内层暖晕 + 外层大范围薄霾，被照亮的空气不止光束本身
            {
                const rw = maxL * 0.85;
                const wash = ctx.createRadialGradient(ox, oy, cw * 0.4, ox, oy, rw);
                wash.addColorStop(0, `rgba(${ACC},${(0.05 + 0.05 * g).toFixed(4)})`);
                wash.addColorStop(1, `rgba(${ACC},0)`);
                ctx.fillStyle = wash;
                ctx.beginPath();
                ctx.arc(ox, oy, rw, 0, 6.2832);
                ctx.fill();
                const rw2 = maxL * 1.5;
                const haze = ctx.createRadialGradient(ox, oy, 0, ox, oy, rw2);
                haze.addColorStop(0, `rgba(${WARM},${(0.028 + 0.03 * g).toFixed(4)})`);
                haze.addColorStop(0.6, `rgba(${WARM},0.012)`);
                haze.addColorStop(1, 'rgba(255,213,170,0)');
                ctx.fillStyle = haze;
                ctx.beginPath();
                ctx.arc(ox, oy, rw2, 0, 6.2832);
                ctx.fill();
            }

            // 4.5) 雾团：大软斑慢漂+横向摆动+呼吸缩放；束内被点亮、束外只留薄霾（雾感主体）
            for (const fg of fogs) {
                fg.oy -= fg.rise * dt;
                if (fg.oy < -CARD_REACH * 0.95) fg.oy = CARD_REACH * 0.95;
                const px = ox + (fg.ox + Math.sin(time * fg.swayF + fg.phase) * fg.swayA) * cw;
                const py = oy + fg.oy * cw;
                const dx = px - ox, dy = py - oy;
                const dist = Math.hypot(dx, dy);
                const ang = Math.atan2(dy, dx);
                let lit = 0;
                for (const ray of rays) {
                    const da = Math.atan2(Math.sin(ang - ray.a), Math.cos(ang - ray.a));
                    const edge = 1 - Math.min(1, Math.abs(da) / (ray.w * 3.2));   // 雾接光角比尘宽：散射更弥散
                    if (edge > lit && dist < maxL * ray.lenBias * 1.1) lit = edge * edge;
                }
                const fall = Math.max(0, 1 - dist / (maxL * 1.15));
                const alpha = (0.008 + lit * 0.13 * fall + fall * fall * 0.016) * bright * (1 + 0.35 * g);
                if (alpha < 0.004) continue;
                const s = fg.size * cw * (1 + 0.14 * Math.sin(time * fg.pulseF * 2 + fg.pulseP));
                ctx.globalAlpha = Math.min(0.5, alpha) * (0.8 + 0.2 * Math.sin(time * 0.3 + fg.phase));
                ctx.drawImage(fogSprite, px - s / 2, py - s / 2, s, s);
            }
            ctx.globalAlpha = 1;

            // 5) 浮尘：软颗粒精灵，三层景深；只有漂进光刃角内才被点亮（丁达尔因果）
            for (const m of motes) {
                m.oy -= m.rise * dt * 2.2;
                if (m.oy < -CARD_REACH * 0.8) m.oy = CARD_REACH * 0.8;
                const px = ox + (m.ox + Math.sin(time * m.swayF + m.phase) * m.swayA) * cw;
                const py = oy + m.oy * cw;
                const dx = px - ox, dy = py - oy;
                const dist = Math.hypot(dx, dy);
                const ang = Math.atan2(dy, dx);
                let lit = 0;
                for (const ray of rays) {
                    const da = Math.atan2(Math.sin(ang - ray.a), Math.cos(ang - ray.a));
                    const edge = 1 - Math.min(1, Math.abs(da) / (ray.w * 2.3));
                    if (edge > lit && dist < maxL * ray.lenBias) lit = edge * edge;
                }
                const fall = Math.max(0, 1 - dist / maxL);
                const depth = 0.35 + m.z * 0.65;
                const alpha = ((0.014 + lit * 0.5 * fall) * bright * (1 + 0.5 * g) + lit * 0.06) * depth;
                if (alpha < 0.006) continue;
                const s = (2.2 + m.z * m.z * 11) * DPR;   // 近处尘大而软，远处细而密
                ctx.globalAlpha = Math.min(0.85, alpha) * (0.72 + 0.28 * Math.sin(time * m.tw + m.phase));
                ctx.drawImage(sprite, px - s / 2, py - s / 2, s, s);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';

            // 6) 只抠灯位卡：当前播放卡盖住光保持卡面干净，光铺在其他卡片封面上
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000';
            for (const card of Array.from(host.querySelectorAll<HTMLElement>('[data-poster]'))) {
                if (!card.hasAttribute('data-current')) continue;
                const cr = card.getBoundingClientRect();
                ctx.beginPath();
                ctx.roundRect((cr.left - hr.left) * DPR, (cr.top - hr.top) * DPR, cr.width * DPR, cr.height * DPR, 8 * DPR);
                ctx.fill();
            }

            // 7) 卡缘背光：沿抠穿的洞描一圈带辉光的暖边——“光正从这张卡背后往外顶”
            ctx.globalCompositeOperation = 'source-over';
            {
                const rx = ox - lastCw / 2, ry = oy - lastCh / 2;
                ctx.save();
                ctx.shadowColor = `rgba(${WARM},${(0.5 + 0.4 * g).toFixed(3)})`;
                ctx.shadowBlur = 14 * DPR;
                ctx.strokeStyle = `rgba(${WARM},${(0.22 + 0.3 * g + 0.2 * flare).toFixed(3)})`;
                ctx.lineWidth = 1.6 * DPR;
                ctx.beginPath();
                ctx.roundRect(rx, ry, lastCw, lastCh, 8 * DPR);
                ctx.stroke();
                ctx.restore();
            }
        };
        raf = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, [hostRef, enabled, gain]);

    return <canvas ref={canvasRef} aria-hidden="true" className="wall-glow-canvas"
        style={{ position: 'absolute', inset: 0, zIndex: 3, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'screen' }} />;
}
