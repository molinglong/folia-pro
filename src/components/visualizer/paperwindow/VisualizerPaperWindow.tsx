import React, { useEffect, useMemo, useRef } from 'react';
import type { Line } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';

// src/components/visualizer/paperwindow/VisualizerPaperWindow.tsx
// 纸窗：字是幕布上剪出来的洞，一盏小灯在幕后游走。
// 与其它模式"光照在字上、字变亮"的关系相反——字不带颜色，亮度全部来自洞后的光场：
// 灯走到哪两个字附近，只有那两三个字透亮，影子从字身斜向上拖出（皮影戏几何）。
// 画面是 f(t) 纯函数：拖进度条随时精确倒带，暂停时画面自然凝固。

const TAU = Math.PI * 2;
/* 逻辑坐标：高度恒为 428，宽度按容器等比换算（21:9 带鱼屏只是多露出两侧幕布）。 */
const LOGICAL_H = 428;
const SLOT = { next: { y: 0.72, px: 30 }, cur: { y: 0.46, px: 52 }, prev: { y: 0.22, px: 30 } };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => { const c = clamp01(v); return c * c * (3 - 2 * c); };
const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const fract = (v: number) => v - Math.floor(v);
const hash1 = (v: number) => fract(Math.sin(v * 127.1) * 43758.5453);

/* 镜头与色温：每两句一镜，切换 0.9s 交叉渐变。 */
const PALETTES = [
    { core: [255, 236, 192], mid: [255, 196, 110] },
    { core: [216, 230, 255], mid: [140, 170, 255] },
    { core: [255, 246, 224], mid: [255, 214, 150] },
    { core: [255, 196, 128], mid: [255, 122, 64] },
] as const;
const SHOTS = [
    { bx: 0.32, by: 0.34, pal: 0 },
    { bx: 0.66, by: 0.58, pal: 1 },
    { bx: 0.42, by: 0.30, pal: 2 },
    { bx: 0.60, by: 0.44, pal: 3 },
] as const;

interface ShowGlyph { ch: string; s: number; e: number; k: number; cx: number; }
interface ShowLine { s: number; e: number; chorus: boolean; glyphs: ShowGlyph[]; }

/** 编译节目单：歌词行 → 幕布行（真实逐字时刻表，无 syllables 时工具内部自动均分）。 */
const compileLines = (lines: Line[]): ShowLine[] => lines.map(line => {
    const timeline = buildLineGraphemeTimeline(line);
    const glyphs: ShowGlyph[] = [];
    let visible = 0;
    for (const g of timeline) {
        if (g.char.trim() === '') continue; // 空格只占位不剪洞
        glyphs.push({ ch: g.char, s: g.startTime, e: g.endTime, k: visible, cx: 0 });
        visible += 1;
    }
    return { s: line.startTime, e: line.endTime, chorus: line.isChorus === true, glyphs };
});

const activeIndexOf = (show: ShowLine[], t: number) => {
    let idx = 0;
    for (let i = 0; i < show.length; i++) if (t >= show[i].s) idx = i;
    return idx;
};

function shotBlend(show: ShowLine[], t: number) {
    const cur = activeIndexOf(show, t);
    const idx = Math.min(SHOTS.length - 1, Math.floor(cur / 2));
    const prev = Math.max(0, idx - 1);
    const boundary = show[idx * 2]?.s ?? show[show.length - 1]?.s ?? 0;
    const p = smoothstep(boundary - 0.45, boundary + 0.45, t);
    const a = SHOTS[prev], b = SHOTS[idx];
    const palA = PALETTES[a.pal], palB = PALETTES[b.pal];
    const mix3 = (u: readonly number[], v: readonly number[]) => [lerp(u[0], v[0], p), lerp(u[1], v[1], p), lerp(u[2], v[2], p)];
    return { bx: lerp(a.bx, b.bx, p), by: lerp(a.by, b.by, p), core: mix3(palA.core, palB.core), mid: mix3(palA.mid, palB.mid) };
}

/** 行的一生：未唱在下方候场 → 开唱前滑升放大 → 唱完滑退缩小。影子/剪口/洞共用这条轨迹。 */
function rowPose(line: ShowLine, t: number) {
    const rise = smoothstep(line.s - 0.55, line.s + 0.05, t);
    const set = smoothstep(line.e, line.e + 0.6, t);
    return {
        y: LOGICAL_H * lerp(lerp(SLOT.next.y, SLOT.cur.y, rise), SLOT.prev.y, set),
        px: lerp(lerp(SLOT.next.px, SLOT.cur.px, rise), SLOT.prev.px, set),
    };
}
/** 行的可见度：提前 1.6s 隐约入场，唱完 0.9s 后开始淡出。 */
function rowFade(line: ShowLine, t: number) {
    return smoothstep(line.s - 1.6, line.s - 0.7, t) * (1 - smoothstep(line.e + 0.9, line.e + 1.8, t));
}

/** 行内排版（水平居中于当前视口逻辑宽）：行宽超出视口时等比缩小字号，返回 fit 后的 px。 */
function rowLayout(line: ShowLine, px: number, vw: number): { glyphs: ShowGlyph[]; px: number } {
    const gap = px * 0.14;
    const chars = line.glyphs;
    const raw = chars.length * (px + gap) - gap;
    const fitted = raw > vw * 0.94 ? px * (vw * 0.94) / raw : px;
    const fGap = fitted * 0.14;
    let width = chars.length * (fitted + fGap) - fGap;
    let x = (vw - width) / 2;
    const out = chars.map(c => {
        const cx = x + fitted / 2;
        x += fitted + fGap;
        return { ...c, cx };
    });
    return { glyphs: out, px: fitted };
}

interface WindowRow { line: ShowLine; y: number; px: number; fade: number; }
const windowRows = (show: ShowLine[], t: number): WindowRow[] => {
    const cur = activeIndexOf(show, t);
    const rows: WindowRow[] = [];
    for (let i = Math.max(0, cur - 2); i <= Math.min(show.length - 1, cur + 2); i++) {
        const fade = rowFade(show[i], t);
        if (fade <= 0.01) continue;
        const pose = rowPose(show[i], t);
        rows.push({ line: show[i], y: pose.y, px: pose.px, fade });
    }
    return rows;
};

const flashOf = (s: number, t: number) => {
    const age = t - s;
    if (age <= 0) return 0;
    return age < 0.12 ? smooth(age / 0.12) : Math.exp(-(age - 0.12) / 0.55);
};
/** 洞开度：未唱微透 → 正唱至少半开（进度 + 剪开闪峰）→ 唱过余光。 */
function glyphOpen(line: ShowLine, g: ShowGlyph, t: number) {
    const cutK = smoothstep(0, 0.35, t - line.s - g.k * 0.045);
    let target;
    if (t < line.s) target = 0.16;
    else if (t <= line.e) target = 0.55 + 0.45 * clamp01((t - g.s) / Math.max(g.e - g.s, 0.08)) + 0.30 * flashOf(g.s, t);
    else target = 0.62;
    return Math.max(t < line.s ? 0.16 : 0, cutK * Math.min(1, target));
}

const VisualizerPaperWindow: React.FC<VisualizerSharedProps> = ({
    currentTime,
    lines,
    theme,
    showText = true,
    audioPower,
    audioBands,
    lyricsFontScale = 1,
    ...sharedProps
}) => {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    /* 逐帧可变状态走 ref，避免 rAF 循环随 props 重建。 */
    const showRef = useRef<ShowLine[]>([]);
    const fontRef = useRef({ stack: 'sans-serif', weight: 700 });
    const showTextRef = useRef(true);
    const pausedRef = useRef(false);

    const show = useMemo(() => compileLines(lines), [lines]);

    useEffect(() => {
        showRef.current = show;
        fontRef.current = {
            stack: resolveThemeFontStack(theme),
            weight: resolveThemeFontWeight(theme, 700),
        };
    }, [show, theme]);

    useEffect(() => {
        showTextRef.current = showText;
    }, [showText]);

    useEffect(() => {
        pausedRef.current = sharedProps.paused === true;
    }, [sharedProps.paused]);

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return;

        const mk = () => {
            const c = document.createElement('canvas');
            const x = c.getContext('2d')!;
            return { c, x };
        };
        const field = mk(); // A 灯场
        const glyphs = mk(); // C 文字开度
        const hole = mk(); // B = A × C（destination-in 合成）
        const ctx = canvas.getContext('2d')!;

        let cssW = 0, cssH = 0, dpr = 1, scale = 1, vw = 760;
        /* shadowBlur/shadowOffset 按规范不受 CTM 影响（设备像素），手动乘 K 补偿缩放。 */
        let shadowK = 1;

        const resize = () => {
            cssW = Math.max(wrap.clientWidth, 1);
            cssH = Math.max(wrap.clientHeight, 1);
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            scale = cssH / LOGICAL_H;
            vw = cssW / scale;
            shadowK = dpr * scale;
            for (const layer of [field, glyphs, hole]) {
                layer.c.width = Math.round(cssW * dpr);
                layer.c.height = Math.round(cssH * dpr);
                layer.x.setTransform(shadowK, 0, 0, shadowK, 0, 0);
            }
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
            ctx.setTransform(shadowK, 0, 0, shadowK, 0, 0);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(wrap);

        /* ── 灯 ── */
        /** 提灯目标：沿行连续滑动的演唱位置（字内进度插值，无逐字阶跃）。 */
        const singTarget = (t: number) => {
            const rows = showRef.current;
            if (rows.length === 0) return null;
            const line = rows[activeIndexOf(rows, t)];
            const pose = rowPose(line, t);
            const items = rowLayout(line, pose.px, vw).glyphs;
            if (items.length === 0) return { x: vw / 2, y: pose.y, k: 0 };
            let gi = items.length - 1;
            for (let i = 0; i < items.length; i++) if (t < items[i].e) { gi = i; break; }
            const it = items[gi];
            const next = items[gi + 1], prev = items[gi - 1];
            const p = clamp01((t - it.s) / Math.max(it.e - it.s, 0.08));
            const endX = next ? next.cx : it.cx + (prev ? it.cx - prev.cx : 44);
            const k = smoothstep(line.s - 0.2, line.s + 0.6, t) * (1 - smoothstep(line.e, line.e + 1.0, t));
            return { x: lerp(it.cx, endX, p), y: pose.y, k };
        };

        /** 灯位：主歌被演唱位置吸引但稳在字后下方（皮影戏标准位），副歌自由飞。 */
        const lampAt = (t: number) => {
            const shot = shotBlend(showRef.current, t);
            const chorus = showRef.current[activeIndexOf(showRef.current, t)]?.chorus ?? false;
            const bx = (shot.bx + 0.16 * Math.sin(TAU * 0.055 * t + 1.2)) * vw;
            const by = (shot.by + 0.20 * Math.sin(TAU * 0.041 * t + 3.1)) * LOGICAL_H;
            const tg = singTarget(t);
            const attract = (chorus ? 0.35 : 1) * 0.7 * (tg?.k ?? 0);
            /* 灯退到演唱位后下方：影子从字身斜向上拖出，不再贴着行轴水平乱窜 */
            const ty = tg ? tg.y + 0.16 * LOGICAL_H : LOGICAL_H * 0.6;
            const tx = tg ? tg.x : vw / 2;
            const breathe = 0.8 + 0.2 * Math.sin(TAU * 0.13 * t + 1);
            const bass = clamp01(audioBands.bass.get() / 255);
            return {
                x: lerp(bx, tx, attract), y: lerp(by, ty, attract),
                /* 光圈随低频微胀、亮度随整轨能量脉冲 */
                r: 0.16 * LOGICAL_H * 1.35 * (chorus ? 1.3 : 1) * (1 + bass * 0.15),
                boost: Math.min(1.6, breathe * (chorus ? 1.5 : 1) + clamp01(audioPower.get() / 255) * 0.35),
                chorus, core: shot.core, mid: shot.mid,
            };
        };

        const drawField = (t: number) => {
            const lamp = lampAt(t);
            const x = field.x;
            x.clearRect(0, 0, vw, LOGICAL_H);
            x.globalCompositeOperation = 'lighter';
            const [cr, cg, cb] = lamp.core, [mr, mg, mb] = lamp.mid;
            const spot = (px: number, py: number, r: number, a: number) => {
                const g = x.createRadialGradient(px, py, 0, px, py, r);
                g.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`);
                g.addColorStop(0.45, `rgba(${mr | 0},${mg | 0},${mb | 0},${a * 0.5})`);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                x.fillStyle = g;
                x.fillRect(px - r, py - r, r * 2, r * 2);
            };
            spot(lamp.x, lamp.y, lamp.r, lamp.boost);
            const hr = lamp.r * 0.34;
            const hg = x.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, hr);
            hg.addColorStop(0, `rgba(255,255,250,${0.75 * lamp.boost})`);
            hg.addColorStop(1, 'rgba(255,255,250,0)');
            x.fillStyle = hg;
            x.fillRect(lamp.x - hr, lamp.y - hr, hr * 2, hr * 2);
            for (let j = 0; j < 2; j++) {
                const px = lamp.x + Math.cos(TAU * (0.035 + j * 0.019) * t + j * 2.4) * vw * (0.20 + j * 0.10);
                const py = lamp.y + Math.sin(TAU * (0.029 + j * 0.023) * t + j * 1.1) * LOGICAL_H * (0.22 + j * 0.10);
                spot(px, py, (0.10 + j * 0.03) * LOGICAL_H * 1.35, 0.55 * lamp.boost);
            }
            const amb = x.createRadialGradient(vw / 2, LOGICAL_H / 2, 0, vw / 2, LOGICAL_H / 2, LOGICAL_H * 0.75);
            amb.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${0.15 * lamp.boost})`);
            amb.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = amb;
            x.fillRect(0, 0, vw, LOGICAL_H);
            x.globalCompositeOperation = 'source-over';
            return lamp;
        };

        const drawTextAlpha = (t: number) => {
            const x = glyphs.x;
            x.clearRect(0, 0, vw, LOGICAL_H);
            if (!showTextRef.current) return;
            x.textAlign = 'center'; x.textBaseline = 'middle';
            const { stack, weight } = fontRef.current;
            for (const row of windowRows(showRef.current, t)) {
                const { glyphs, px } = rowLayout(row.line, row.px, vw);
                x.font = `${weight} ${px * lyricsFontScale}px ${stack}`;
                for (const g of glyphs) {
                    const open = glyphOpen(row.line, g, t) * row.fade;
                    if (open <= 0.004) continue;
                    x.fillStyle = `rgba(255,255,255,${open})`;
                    x.fillText(g.ch, g.cx, row.y);
                }
            }
        };

        const compositeHole = () => {
            const x = hole.x;
            x.clearRect(0, 0, vw, LOGICAL_H);
            x.drawImage(field.c, 0, 0, vw, LOGICAL_H);
            x.globalCompositeOperation = 'destination-in';
            x.drawImage(glyphs.c, 0, 0, vw, LOGICAL_H);
            x.globalCompositeOperation = 'source-over';
        };

        const drawSparks = (t: number, lamp: ReturnType<typeof lampAt>) => {
            const rows = showRef.current;
            if (rows.length === 0) return;
            const line = rows[activeIndexOf(rows, t)];
            const pose = rowPose(line, t);
            const [cr, cg, cb] = lamp.core;
            const sparks = rowLayout(line, pose.px, vw);
            for (const g of sparks.glyphs) {
                const cs = line.s + g.k * 0.045 + 0.12;
                const seed = g.k * 7.13 + line.s;
                for (let j = 0; j < 3; j++) {
                    const age = t - cs - j * 0.02;
                    if (age <= 0 || age > 0.8) continue;
                    const h1 = hash1(seed + j * 3.7), h2 = hash1(seed + j * 9.1);
                    const vx = (h1 - 0.5) * 100, vy = -60 - h2 * 60;
                    const px = g.cx + vx * age;
                    const py = pose.y - sparks.px * 0.4 + vy * age + 95 * age * age;
                    const a = Math.pow(1 - age / 0.8, 1.5);
                    ctx.fillStyle = `rgba(255,255,250,${a * 0.95})`;
                    ctx.beginPath();
                    ctx.arc(px, py, 1.6 + h1 * 1.2, 0, TAU);
                    ctx.fill();
                    ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a * 0.35})`;
                    ctx.beginPath();
                    ctx.arc(px, py, 3.2 + h2 * 2.2, 0, TAU);
                    ctx.fill();
                }
            }
        };

        const drawShadows = (t: number, lamp: ReturnType<typeof lampAt>, rows: WindowRow[]) => {
            ctx.save();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const { stack, weight } = fontRef.current;
            for (const row of rows) {
                const { glyphs, px } = rowLayout(row.line, row.px, vw);
                ctx.font = `${weight} ${px * lyricsFontScale}px ${stack}`;
                for (const g of glyphs) {
                    const dx = g.cx - lamp.x, dy = row.y - lamp.y;
                    const d = Math.max(Math.hypot(dx, dy), 1);
                    const soft = clamp01(d / 300);
                    const len = Math.min(26 + 4200 / d, 110) * (row.line.chorus ? 1.5 : 1) * (0.9 + 0.1 * Math.sin(TAU * 0.09 * t + 2));
                    ctx.shadowColor = `rgba(0,0,0,${0.62 * row.fade})`;
                    ctx.shadowBlur = (5 + 16 * soft) * shadowK;
                    ctx.shadowOffsetX = (dx / d) * len * shadowK;
                    ctx.shadowOffsetY = ((dy / d) * len + 5) * shadowK;
                    ctx.fillStyle = `rgba(5,6,10,${(0.6 - 0.3 * soft) * row.fade})`;
                    ctx.fillText(g.ch, g.cx, row.y);
                }
            }
            ctx.restore();
        };

        let raf = 0;
        const frame = () => {
            if (pausedRef.current) {
                /* 暂停时 f(t) 纯函数画面自然凝固，但仍消费掉时间源变化后的一帧以防恢复时闪帧 */
                drawField(currentTime.get());
            }
            const t = currentTime.get();
            const lamp = drawField(t);
            drawTextAlpha(t);
            compositeHole();

            ctx.clearRect(0, 0, vw, LOGICAL_H);
            ctx.save();
            /* 幕布风拂：微平移 + 微转，洞里的光跟着纸动而幕后灯不动，自带错位呼吸 */
            ctx.translate(vw / 2 + Math.sin(TAU * 0.06 * t) * 1.6, LOGICAL_H / 2 + Math.sin(TAU * 0.043 * t + 1) * 1.2);
            ctx.rotate(Math.sin(TAU * 0.05 * t + 2) * 0.002);
            ctx.translate(-vw / 2, -LOGICAL_H / 2);

            ctx.fillStyle = '#090a0f';
            ctx.fillRect(-8, -8, vw + 16, LOGICAL_H + 16);
            const vg = ctx.createRadialGradient(vw / 2, LOGICAL_H * 0.45, LOGICAL_H * 0.2, vw / 2, LOGICAL_H * 0.45, LOGICAL_H * 0.95);
            vg.addColorStop(0, 'rgba(24,28,40,0.5)');
            vg.addColorStop(1, 'rgba(4,5,8,0)');
            ctx.fillStyle = vg;
            ctx.fillRect(-8, -8, vw + 16, LOGICAL_H + 16);

            /* 灯透过纸背的亮区：影子只有落在这里才显形（皮影戏的物理） */
            const back = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, LOGICAL_H * 0.42);
            const [cr0, cg0, cb0] = lamp.core;
            back.addColorStop(0, `rgba(${cr0 | 0},${cg0 | 0},${cb0 | 0},${0.13 * lamp.boost})`);
            back.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = back;
            ctx.fillRect(0, 0, vw, LOGICAL_H);

            const rows = showTextRef.current ? windowRows(showRef.current, t) : [];
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (rows.length > 0) drawShadows(t, lamp, rows);
            ctx.drawImage(hole.c, 0, 0, vw, LOGICAL_H);
            if (rows.length > 0) drawSparks(t, lamp);

            /* 剪口：亮度跟透光量挂钩，没有光透出的洞不勾亮边 */
            if (rows.length > 0) {
                ctx.save();
                ctx.lineWidth = 1.4;
                const { stack, weight } = fontRef.current;
                for (const row of rows) {
                    const { glyphs, px } = rowLayout(row.line, row.px, vw);
                    ctx.font = `${weight} ${px * lyricsFontScale}px ${stack}`;
                    for (const g of glyphs) {
                        const open = glyphOpen(row.line, g, t) * row.fade;
                        if (open < 0.25) continue;
                        ctx.strokeStyle = `rgba(255,240,210,${0.05 + 0.17 * open})`;
                        ctx.strokeText(g.ch, g.cx, row.y);
                    }
                }
                ctx.restore();
            }

            /* 画框暗角 */
            const fr = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
            fr.addColorStop(0, 'rgba(0,0,0,0.45)'); fr.addColorStop(0.18, 'rgba(0,0,0,0)');
            fr.addColorStop(0.82, 'rgba(0,0,0,0)'); fr.addColorStop(1, 'rgba(0,0,0,0.5)');
            ctx.fillStyle = fr;
            ctx.fillRect(0, 0, vw, LOGICAL_H);
            ctx.restore();

            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [currentTime, audioPower, audioBands, lyricsFontScale]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={sharedProps}
            renderBackground={false}
            className="visualizer-paperwindow"
        >
            <div ref={wrapRef} className="absolute inset-0 z-0 pointer-events-none">
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            </div>
        </VisualizerShell>
    );
};

export default VisualizerPaperWindow;
