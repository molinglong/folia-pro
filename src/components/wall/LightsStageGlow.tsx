// src/components/wall/LightsStageGlow.tsx — 关灯态"舞台聚光"层（无形状雾感版，源自 design-lab wall/stage-glow 方案 A）。
// 自包含 canvas 覆盖层：不接 props、不进 store，每帧在 DOM 里选灯位卡（展开带歌词的 .is-current 优先，
// 都没有则取视口中央最近的那张，屏外副本排除），相机平移/缩放/换曲自动跟随（世界层 transform 会体现在
// getBoundingClientRect 上）；锁不到任何卡时绝不画灯（短丢 1.2s 内淡尽、长丢彻底不画——中心兜底已废除，
// 它会在没锁到卡时凭空点出一团“太阳”）。
// 视觉构成（雾感，无具体形状）：①18 缕弥漫光雾——每缕是一串沿轴向互相叠印的软烟斑（蛇形游走、沿程
// 变宽变淡），边界溶进雾里，不画任何三角束形；②缓冲叠三次（强模糊雾底为主/中模糊辉光/少量清晰骨架）；
// ③30 团高斯雾慢漂呼吸，束内被点亮、束外只留薄霾；④外围薄霾 + 核心辉光；⑤软颗粒浮尘三层景深；
// ⑥卡缘背光描边（与 wall.css 的静态 drop-shadow 发光叠加，它跟音乐脉动）。
// 叠光规则（2026-10-14 用户修正）：光直接铺在其他卡片封面上（screen 只提亮），只抠穿当前播放卡——它盖住光、卡面保持干净。
// 音乐跟随：读 motionSignals 的 audioPower/bass（0..255 量纲，桥接层 usePlaybackVisualizerBridge 持续喂值）；
// 非播放态目标直接归零并拉长衰减到 900ms——暂停后雾感慢慢散掉而不是停在薄雾闪烁。快起峰 30ms / 慢衰减 350ms；能量差分峰触发核心泛光过冲。
// 降级：开灯态完全不绘制；<html data-reduce-motion~='lattice'>（含画质档"流畅优先"）时时间冻结成静态光形、
// 同时不跟音乐——这就是"流畅优先关闭跟随"的挂点，不需要读档位 store；is-daylight 亮度乘 0.8。
// 光色与聚光发光同源：--text-accent → --text-primary → 白，每 2s 采样、再以 τ≈0.4s 交叉淡化过渡过去
// （换肤不跳色）；烟斑/雾团共用一条暖白→强调色的 6 档渐变精灵带，按离灯位的距离取色，颜色在雾里连续过渡。
import React, { useEffect, useRef } from 'react';
import { audioPower, bass } from '../../stores/motionSignals';
import { usePlaybackStore, selectDisplayPlayerState } from '../../stores/usePlaybackStore';
import { PlayerState } from '../../types';

const RAYS = 18;
const FOG = 30;           // 雾团数：大尺寸软斑，雾感主体
const DUST = 220;
const DOWNSCALE = 2;      // 光雾缓冲的降采样倍率：模糊层次靠叠印控制，缓冲精细一档边缘更顺
const CARD_REACH = 7;     // 光程 = 当前卡宽 × 倍数
const BASE_BRIGHT = 1.1;  // 光会真实铺在卡面上，量感靠三层叠印与烟斑密度，不硬提峰值
const MUSIC_GAIN: number = 1; // 音乐跟随总增益（0 = 关闭）
const PAL = 6;                // 暖白→强调色渐变档数：烟斑/雾团按离灯位的距离取色

type RGB = [number, number, number];

const LightsStageGlow: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const host = canvas?.parentElement;
        const root = host?.closest<HTMLElement>('.lattice-root') ?? null;
        if (!canvas || !host) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0, W = 0, H = 0, DPR = 1, time = 0, last = performance.now();
        let env = 0, flare = 0, prevPower = 0, lastFlareAt = -1;
        let lastOx = 0, lastOy = 0, lastCw = 0, lastCh = 0, seen = false, anchorAge = 0;
        let seed = 987654321;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

        const rays = Array.from({ length: RAYS }, () => ({
            a: rnd() * Math.PI * 2,
            swayA: 0.012 + rnd() * 0.05, swayF: 0.05 + rnd() * 0.16, swayP: rnd() * 6.28,
            swayA2: 0.004 + rnd() * 0.014, swayF2: 0.2 + rnd() * 0.5, swayP2: rnd() * 6.28,
            w: 0.03 + rnd() * 0.055,
            f1: 0.11 + rnd() * 0.3, p1: rnd() * 6.28, f2: 0.07 + rnd() * 0.19, p2: rnd() * 6.28,
            lenBias: 0.62 + rnd() * 0.55, warm: rnd(),
        }));
        const fogs = Array.from({ length: FOG }, () => ({
            ox: (rnd() - 0.5) * CARD_REACH * 2.4, oy: (rnd() - 0.5) * CARD_REACH * 1.8,
            size: 0.7 + rnd() * 1.9, rise: 0.006 + rnd() * 0.02,
            swayF: 0.05 + rnd() * 0.22, swayA: 0.06 + rnd() * 0.22, phase: rnd() * 6.28,
            pulseF: 0.04 + rnd() * 0.14, pulseP: rnd() * 6.28, warm: rnd(),
        }));
        // 浮尘坐标以“当前卡宽倍数”存储：相机缩放时跟着灯走
        const motes = Array.from({ length: DUST }, () => ({
            ox: (rnd() - 0.5) * CARD_REACH * 2.2, oy: (rnd() - 0.5) * CARD_REACH * 1.6, z: rnd(),
            rise: 0.016 + rnd() * 0.05, swayF: 0.25 + rnd() * 0.9, swayA: 0.03 + rnd() * 0.11,
            phase: rnd() * 6.28, tw: 0.6 + rnd() * 2.2,
        }));

        // 着色软斑精灵：中心不打满、边缘长尾的曲线——烟斑/雾团共用这支“无形状”笔刷。
        // 只在换肤时重建（rgbStr 声明在后，调用时机上已初始化）
        const tintedSprite = (c: RGB, size = 128) => {
            const cv = document.createElement('canvas');
            cv.width = cv.height = size;
            const s = cv.getContext('2d')!;
            const g = s.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            g.addColorStop(0, `rgba(${rgbStr(c)},0.5)`);
            g.addColorStop(0.4, `rgba(${rgbStr(c)},0.26)`);
            g.addColorStop(0.72, `rgba(${rgbStr(c)},0.07)`);
            g.addColorStop(1, `rgba(${rgbStr(c)},0)`);
            s.fillStyle = g;
            s.fillRect(0, 0, size, size);
            return cv;
        };

        // —— 精灵与色相：随主题色每 2s 重建（换肤罕见，重建开销可忽略） ——
        const probe = document.createElement('canvas').getContext('2d')!;
        const toRgb = (raw: string, fallback: RGB): RGB => {
            const s = raw.trim();
            if (!s) return fallback;
            probe.fillStyle = '#000000';
            probe.fillStyle = s;               // 非法值会被 canvas 忽略，读回仍是黑
            const v = probe.fillStyle as string;
            if (/^#[0-9a-f]{6}$/i.test(v)) {
                const n = parseInt(v.slice(1), 16);
                return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
            }
            const m = v.match(/([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
            return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : fallback;
        };
        const mix = (a: RGB, b: RGB, t: number): RGB => [
            Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t),
        ];
        const rgbStr = (c: RGB) => `${c[0]},${c[1]},${c[2]}`;

        let accRGB: RGB = [253, 130, 96];
        let warmRGB: RGB = [255, 213, 170];
        let accTarget: RGB = accRGB;
        let warmTarget: RGB = warmRGB;
        // 暖白→强调色的 6 档渐变精灵带：烟斑沿光程、雾团离灯位越远取色越靠强调色——颜色在雾里
        // 连续过渡，不是两色拼贴；雾团/烟斑同曲线，尺寸靠 drawImage 缩放拉开
        let palette: HTMLCanvasElement[] = [];
        const buildPalette = () => {
            palette = Array.from({ length: PAL }, (_, k) => tintedSprite(mix(warmRGB, accRGB, k / (PAL - 1))));
        };
        const dustSprite = document.createElement('canvas');
        {
            dustSprite.width = dustSprite.height = 64;
            const s = dustSprite.getContext('2d')!;
            const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            s.fillStyle = g;
            s.fillRect(0, 0, 64, 64);
        }
        const refreshColor = () => {
            const cs = getComputedStyle(root ?? document.documentElement);
            const accent = cs.getPropertyValue('--text-accent') || cs.getPropertyValue('--text-primary');
            accTarget = toRgb(accent, [253, 130, 96]);
            warmTarget = mix(accTarget, [255, 255, 255], 0.55);
        };
        refreshColor();
        accRGB = accTarget; warmRGB = warmTarget; buildPalette();
        const colorTimer = window.setInterval(refreshColor, 2000);

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
            const lightsOut = !!root?.classList.contains('is-lights-out');
            if (!lightsOut) {                       // 开灯态：完全不绘制，CSS 层 700ms 淡出
                ctx.clearRect(0, 0, W, H);
                canvas.classList.remove('is-active');
                return;
            }
            canvas.classList.add('is-active');

            // 降级面：流畅优先/系统减弱都会把 lattice 登记进 data-reduce-motion——时间冻结、不跟音乐
            const rm = document.documentElement.getAttribute('data-reduce-motion') || '';
            const reduced = MUSIC_GAIN === 0 || rm.split(/\s+/).includes('lattice');

            if (!reduced) time += dt;

            // —— 音乐包络：audioPower/bass 是 0..255 量纲；暂停时桥接层还在喂呼吸值，故非播放态目标直接归零、慢散 ——
            let g = 0;
            if (!reduced) {
                const playing = selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING;
                const p = playing ? Math.min(1, audioPower.get() / 255) : 0;
                const b = playing ? Math.min(1, bass.get() / 255) : 0;
                const drive = playing ? Math.min(1, Math.pow(p * 0.7 + b * 0.3, 1.15) * 1.6) : 0;
                // 快起峰 30ms；播放中慢衰减 350ms；暂停后降到 900ms——雾感慢慢消失而不是闷掉
                env += (drive - env) * (1 - Math.exp(-dt / (drive > env ? 0.03 : playing ? 0.35 : 0.9)));
                if (p - prevPower > 0.16 && time - lastFlareAt > 0.16) { flare = 1; lastFlareAt = time; }
                prevPower = p;
                flare *= Math.exp(-dt / 0.12);
                g = env * MUSIC_GAIN;
            } else {
                env += (0 - env) * (1 - Math.exp(-dt / 0.35));
                flare *= Math.exp(-dt / 0.12);
                prevPower = 0;
            }
            const daylight = !!root?.classList.contains('is-daylight');
            const anchorFade = anchorAge === 0 ? 1 : Math.max(0, 1 - anchorAge / 1.2);
            const bright = BASE_BRIGHT * (0.82 + 0.58 * g) * (1 + 0.22 * flare) * (daylight ? 0.8 : 1) * anchorFade;

            // 灯位：正在播放那张。同一首歌在队列里出现两次就会命中多张 .is-current，而歌词只长在展开那张上
            // （LatticePoster：expanded && isCurrent 才挂 LatticeLyrics）——统一锁展开卡；都没有展开时
            // 取视口中央附近那张，避免抓到屏外副本。一张都找不到（资料库墙换架后当前歌未挂载）时：
            // 从没锁过就用场地中心当台灯位；锁过则钉在最后位置不闪失。抠洞/卡缘背光只在真锁到卡时画。
            const hr = host.getBoundingClientRect();
            let current: HTMLElement | null = null;
            {
                const cands = host.querySelectorAll<HTMLElement>('.lattice-poster.is-current');
                let bestScore = Infinity;
                for (const el of Array.from(cands)) {
                    if (el.classList.contains('is-expanded')) { current = el; break; }
                    const r = el.getBoundingClientRect();
                    if (r.width < 1) continue;
                    const score = Math.hypot(r.left + r.width / 2 - (hr.left + hr.width / 2), r.top + r.height / 2 - (hr.top + hr.height / 2));
                    if (score < bestScore) { bestScore = score; current = el; }
                }
            }
            if (current) {
                const cr = current.getBoundingClientRect();
                lastOx = (cr.left + cr.width / 2 - hr.left) * DPR;
                lastOy = (cr.top + cr.height / 2 - hr.top) * DPR;
                lastCw = cr.width * DPR; lastCh = cr.height * DPR;
                seen = true; anchorAge = 0;
            } else {
                // 没锁到卡就没有灯——绝不凭空点中心光（那是“主页太阳”的根源）。
                // 短暂丢失（展开/换卡瞬间重挂载）则在 1.2s 内淡尽，超过 1.6s 彻底不画
                anchorAge += dt;
                if (!seen || anchorAge > 1.6) {
                    ctx.clearRect(0, 0, W, H);
                    return;
                }
            }
            if (!seen) return;
            const ox = lastOx, oy = lastOy, cw = lastCw;
            const maxL = cw * CARD_REACH * (0.92 + 0.16 * g + 0.05 * flare);
            // 换肤交叉淡化：当前色缓缓逼近主题新色（τ≈0.4s）并随手重建精灵带，雾色不跳变
            const drift = Math.abs(accRGB[0] - accTarget[0]) + Math.abs(accRGB[1] - accTarget[1]) + Math.abs(accRGB[2] - accTarget[2])
                + Math.abs(warmRGB[0] - warmTarget[0]) + Math.abs(warmRGB[1] - warmTarget[1]) + Math.abs(warmRGB[2] - warmTarget[2]);
            if (drift > 1.5) {
                const k = 1 - Math.exp(-dt / 0.4);
                accRGB = mix(accRGB, accTarget, k);
                warmRGB = mix(warmRGB, warmTarget, k);
                buildPalette();
            }
            const acc = rgbStr(accRGB), warm = rgbStr(warmRGB);

            // 1) 弥漫光雾：每缕一串沿轴向叠印的软烟斑（蛇形游走/沿程变宽变淡），无三角束形
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
                const bias = (ray.warm - 0.5) * 0.5; // 每缕带一点暖/冷偏移，档间仍是连续渐变
                const cA = Math.cos(ang), sA = Math.sin(ang);
                for (let i = 0; i < STEPS; i++) {
                    const t = (i + 0.65) / STEPS;
                    const lateral = Math.sin(time * ray.f2 * 1.6 + i * 1.9 + ray.p1) * L * 0.085 * t
                        + Math.sin(time * ray.swayF2 * 2 + i * 0.8 + ray.swayP2) * L * 0.03 * t;
                    const along = L * t * (0.92 + 0.08 * Math.sin(time * ray.f1 * 2 + i + ray.p2));
                    const px = x0 + cA * along - sA * lateral;
                    const py = y0 + sA * along + cA * lateral;
                    const size = (cw / DOWNSCALE) * (0.9 + 3.4 * t);
                    const a = 0.15 * bright * flick * Math.pow(1 - t, 1.45);
                    if (a < 0.004) continue;
                    // 沿程从暖白滑向强调色：颜色在雾里连续过渡而不是两色拼贴
                    const blend = Math.min(1, Math.max(0, t + bias));
                    bctx.globalAlpha = a;
                    bctx.drawImage(palette[Math.round(blend * (PAL - 1))], px - size / 2, py - size / 2, size, size);
                }
                bctx.globalAlpha = 1;
            }
            // 2) 核心辉光：暖白小核 + 强调色大晕（强拍泛光过冲）
            {
                const r1 = cw * (0.62 + 0.1 * flare) / DOWNSCALE;
                const hot = bctx.createRadialGradient(x0, y0, 0, x0, y0, r1);
                hot.addColorStop(0, `rgba(${warm},${((0.5 + 0.45 * g + 0.3 * flare) * 0.9).toFixed(4)})`);
                hot.addColorStop(0.5, `rgba(${warm},${(0.16 * bright).toFixed(4)})`);
                hot.addColorStop(1, `rgba(${warm},0)`);
                bctx.fillStyle = hot;
                bctx.fillRect(0, 0, buf.width, buf.height);
                const r2 = cw * 2.1 / DOWNSCALE;
                const halo = bctx.createRadialGradient(x0, y0, 0, x0, y0, r2);
                halo.addColorStop(0, `rgba(${acc},${(0.2 * bright).toFixed(4)})`);
                halo.addColorStop(0.55, `rgba(${acc},${(0.07 * bright).toFixed(4)})`);
                halo.addColorStop(1, `rgba(${acc},0)`);
                bctx.fillStyle = halo;
                bctx.fillRect(0, 0, buf.width, buf.height);
            }

            // 3) 主画布叠三层：强模糊雾底为主、中模糊辉光、清晰骨架只留少量（雾感层次）
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

            // 4) 环境洗光 + 外围薄霾：被照亮的空气不止光雾本身
            {
                const rw = maxL * 0.85;
                const wash = ctx.createRadialGradient(ox, oy, cw * 0.4, ox, oy, rw);
                wash.addColorStop(0, `rgba(${acc},${(0.05 + 0.05 * g).toFixed(4)})`);
                wash.addColorStop(1, `rgba(${acc},0)`);
                ctx.fillStyle = wash;
                ctx.beginPath();
                ctx.arc(ox, oy, rw, 0, 6.2832);
                ctx.fill();
                const rw2 = maxL * 1.5;
                const haze = ctx.createRadialGradient(ox, oy, 0, ox, oy, rw2);
                haze.addColorStop(0, `rgba(${warm},${(0.028 + 0.03 * g).toFixed(4)})`);
                haze.addColorStop(0.6, `rgba(${warm},0.012)`);
                haze.addColorStop(1, `rgba(${warm},0)`);
                ctx.fillStyle = haze;
                ctx.beginPath();
                ctx.arc(ox, oy, rw2, 0, 6.2832);
                ctx.fill();
            }

            // 5) 雾团：慢漂+摆动+呼吸缩放；缕内被点亮、缕外只留薄霾
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
                    const edge = 1 - Math.min(1, Math.abs(da) / (ray.w * 3.2));
                    if (edge > lit && dist < maxL * ray.lenBias * 1.1) lit = edge * edge;
                }
                const fall = Math.max(0, 1 - dist / (maxL * 1.15));
                const alpha = (0.008 + lit * 0.13 * fall + fall * fall * 0.016) * bright * (1 + 0.35 * g);
                if (alpha < 0.004) continue;
                const s = fg.size * cw * (1 + 0.14 * Math.sin(time * fg.pulseF * 2 + fg.pulseP));
                ctx.globalAlpha = Math.min(0.5, alpha) * (0.8 + 0.2 * Math.sin(time * 0.3 + fg.phase));
                // 雾团同样按距离取色：近灯位偏暖白、外围薄雾沉向强调色
                const midx = Math.min(PAL - 1, Math.max(0, Math.round((1 - fall) * (PAL - 1) + (fg.warm - 0.5))));
                ctx.drawImage(palette[midx], px - s / 2, py - s / 2, s, s);
            }
            ctx.globalAlpha = 1;

            // 6) 浮尘：软颗粒三层景深，漂进缕角内才被点亮
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
                const s = (2.2 + m.z * m.z * 11) * DPR;
                ctx.globalAlpha = Math.min(0.85, alpha) * (0.72 + 0.28 * Math.sin(time * m.tw + m.phase));
                ctx.drawImage(dustSprite, px - s / 2, py - s / 2, s, s);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';

            // 7) 只抠当前播放卡：它盖住光、卡面干净；光铺在其他卡片封面上（无灯位卡时不抠不描）
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000';
            if (current) {
                const cr = current.getBoundingClientRect();
                ctx.beginPath();
                ctx.roundRect((cr.left - hr.left) * DPR, (cr.top - hr.top) * DPR, cr.width * DPR, cr.height * DPR, 8 * DPR);
                ctx.fill();
            }

            // 8) 卡缘背光：沿抠穿的洞描一圈带辉光的暖边（与 wall.css 静态 drop-shadow 叠加，它随音乐脉动）
            ctx.globalCompositeOperation = 'source-over';
            if (current) {
                ctx.save();
                ctx.shadowColor = `rgba(${warm},${(0.5 + 0.4 * g).toFixed(3)})`;
                ctx.shadowBlur = 14 * DPR;
                ctx.strokeStyle = `rgba(${warm},${(0.22 + 0.3 * g + 0.2 * flare).toFixed(3)})`;
                ctx.lineWidth = 1.6 * DPR;
                ctx.beginPath();
                ctx.roundRect(ox - lastCw / 2, oy - lastCh / 2, lastCw, lastCh, 8 * DPR);
                ctx.stroke();
                ctx.restore();
            }
        };
        raf = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); window.clearInterval(colorTimer); };
    }, []);

    return <canvas ref={canvasRef} className="lattice-stage-glow" aria-hidden="true" />;
};

export default LightsStageGlow;
