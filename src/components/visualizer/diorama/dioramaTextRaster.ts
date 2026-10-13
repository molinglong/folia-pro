import * as THREE from 'three';

// src/components/visualizer/diorama/dioramaTextRaster.ts
// Canvas-rasterised lyric text for the diorama's 3D planes.
//
// WHY canvas and not an SDF text engine: CJK fonts build glyphs from OVERLAPPING stroke contours
// (unified by the fill winding rule). troika's GPU SDF generator mishandles those overlaps, drawing
// visible seams and translucent slabs inside every dense glyph - unfixable by resolution. The
// browser's own canvas text rasteriser is the same engine that renders the DOM subtitles: perfect
// shaping for every script, and it consumes the project's full CSS font STACK (theme font style,
// weight, the user's uploaded custom font, per-glyph fallback) via resolveThemeFontStack - so the 3D
// lyrics inherit the shared subtitle font settings exactly, with no single-font-file limitation.
//
// Each unit (CJK char / latin word) is rasterised TWICE into one shared canvas geometry:
// - base: the plain glyph (white - tinted per-frame by the material colour), and
// - glow: the glyph lit with cadenza (心象)'s drawShadowGlowText recipe (three stacked blurred
//   copies, composited 'lighter'), also white so the theme accent tints it live.
// Both rasters use the same canvas size and draw position, so the glow registers on the strokes
// EXACTLY, by construction - centring/misalignment is impossible (this is what fixes the interlude
// dot ● glow sitting high: the glow IS the blurred dot).

export const DIORAMA_RASTER_FONT_PX = 128;
const DEFAULT_FONT_WEIGHT = 700;
// Vertical band around the middle baseline (covers ascenders/descenders across fonts).
const LINE_BAND_EM = 1.4;
// Padding for the glow spread (must contain the widest shadow blur below plus ink overshoot).
const GLOW_PAD_EM = 0.7;
// Plain line rasters (neighbour lines, no glow) need only a small ink-overshoot pad.
const PLAIN_PAD_EM = 0.2;
// Stay under the guaranteed-safe texture edge for long lines.
const MAX_CANVAS_PX = 4096;
// Inner shadow blur as a fraction of the em; cadenza's 20/40/58px ladder scaled to the raster em.
const GLOW_BLUR_EM = 0.16;

// `fontStack` is the CSS font-family stack from resolveThemeFontStack(theme) - resolved by the
// caller so rasters only rebuild when the actual font selection changes, not on every theme tweak.
export const buildDioramaFontSpec = (fontStack: string, fontWeight = DEFAULT_FONT_WEIGHT): string =>
    `${fontWeight} ${DIORAMA_RASTER_FONT_PX}px ${fontStack}`;

let measureCtx: CanvasRenderingContext2D | null = null;
const getMeasureCtx = (): CanvasRenderingContext2D => {
    if (!measureCtx) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        measureCtx = canvas.getContext('2d')!;
    }
    return measureCtx;
};

/** Advance width in raster px of `text` under the diorama font spec (kerning included). */
export const measureDioramaText = (text: string, fontSpec: string): number => {
    const ctx = getMeasureCtx();
    ctx.font = fontSpec;
    return ctx.measureText(text).width;
};

const makeTexture = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

// Bakes a PURE HALO of the glyph (cadenza's blur ladder: tight core / mid halo / faint outer air) at
// FULL strength - live intensity/colour come from the additive material's opacity/colour per frame.
//
// Why not cadenza's exact fill alphas: a canvas shadow inherits its source shape's alpha, so
// cadenza's faint fills (0.11 x 0.86 shadow ≈ 0.09 alpha per pass) only work because the DOM canvas
// REDRAWS and accumulates them every frame. Baked once into a texture, that halo peaks near-invisible
// (~0.2 alpha, then multiplied by the runtime opacity). So here the glyph is drawn OFF-canvas with a
// large shadow offset - only its blurred shadow lands on the texture, at full source alpha - giving a
// strong, crisp-fill-free halo that spreads purely outward from the strokes.
const drawGlowGlyph = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, blur: number) => {
    const OFFSCREEN = 10000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    const haloPass = (passBlur: number, alpha: number) => {
        ctx.shadowColor = `rgba(255,255,255,${alpha})`;
        ctx.shadowBlur = passBlur;
        ctx.shadowOffsetX = OFFSCREEN;
        ctx.shadowOffsetY = 0;
        ctx.fillText(text, x - OFFSCREEN, y);
    };
    haloPass(blur, 0.95);
    haloPass(blur, 0.85);
    haloPass(blur * 2, 0.55);
    haloPass(blur * 2.9, 0.3);
    ctx.restore();
};

export interface DioramaUnitRaster {
    baseTexture: THREE.CanvasTexture;
    glowTexture: THREE.CanvasTexture;
    /** Full canvas extent in raster px (the plane's intrinsic size before world scaling). */
    canvasWidthPx: number;
    canvasHeightPx: number;
    /** Typographic advance of the unit in raster px (for layout). */
    advancePx: number;
}

/** Rasterise one lyric unit (base + glow layers share one canvas geometry). */
export const rasterDioramaUnit = (text: string, fontSpec: string): DioramaUnitRaster => {
    const em = DIORAMA_RASTER_FONT_PX;
    const pad = Math.ceil(em * GLOW_PAD_EM);
    const advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)));
    const canvasWidthPx = advancePx + pad * 2;
    const canvasHeightPx = Math.ceil(em * LINE_BAND_EM) + pad * 2;
    const drawX = pad;
    const drawY = canvasHeightPx / 2;

    const draw = (paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidthPx;
        canvas.height = canvasHeightPx;
        const ctx = canvas.getContext('2d')!;
        ctx.font = fontSpec;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        paint(ctx);
        return makeTexture(canvas);
    };

    const baseTexture = draw((ctx) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, drawX, drawY);
    });
    const glowTexture = draw((ctx) => {
        drawGlowGlyph(ctx, text, drawX, drawY, em * GLOW_BLUR_EM);
    });

    return { baseTexture, glowTexture, canvasWidthPx, canvasHeightPx, advancePx };
};

// ---------------------------------------------------------------------------------------------
// @fork 性能刀A-2：一行一张图集（atlas）。
//
// 上面逐单元那条路，一行十几个字就要交 2×N 张独立画布：实测单张 ≈308×360 RGBA（451KB），一行 ≈13.5MB、
// 30 次上传，全压在「进播放页」或「换行」那一帧 —— CDP trace 里每批 ~29ms 的 CommandBuffer::Flush 就是
// 显卡命令队列被这一堆小提交塞住。调度（预热带宽）实测只能把这笔固定的字节搬到别的帧，搬不掉它，
// 所以这里改**总量**：整行的字身画进同一张大画布、辉光画进另一张，每个单元用 `texture.clone()` +
// offset/repeat 取自己那一格。three 的 WebGLTextures 用 `_sources`（WeakMap，键是 `Texture.source`）
// 做 GL 资源复用，而 `copy()` 是 `this.source = source.source` —— 所以 N 个 clone 共享**一次**上传，
// dispose 也按 usedTimes 引用计数回收，一张都不会漏。
//
// 顺带把字身的边距从「陪辉光的 0.7em」收回到 `PLAIN_PAD_EM`（字身本来不需要给模糊留白）：两张图集各自
// 打包，字节再降一截。
//
// 为什么辉光仍然和逐张画**逐像素一致**：每个单元的字仍然画在自己那一格的正中（advance 中心 = 格中心），
// 格尺寸、pad、模糊阶梯全沿用原值；而模糊最大外扩 `GLOW_BLUR_EM × 2.9 ≈ 0.46em` 小于格边距 0.7em，
// 辉光外溢不会跨进邻格，所以同画布内 'lighter' 合成与原来「两张独立纹理在世界里叠加」结果相同。
//
// 档位开关（实测 A/B 手柄，不是功能开关）：`localStorage.diorama_unit_atlas = off` 回到逐张路径。

export type DioramaUnitRasterMode = 'atlas' | 'per-unit';
const UNIT_ATLAS_FLAG_KEY = 'diorama_unit_atlas';

export const resolveDioramaUnitRasterMode = (): DioramaUnitRasterMode => {
    try {
        const raw = (window.localStorage.getItem(UNIT_ATLAS_FLAG_KEY) ?? '').trim().toLowerCase();
        return raw === 'off' || raw === '0' || raw === 'per-unit' ? 'per-unit' : 'atlas';
    } catch {
        return 'atlas';
    }
};

interface AtlasCell {
    /** px, canvas 坐标系（y 从顶往下）。 */
    x: number;
    y: number;
    w: number;
    h: number;
}

interface BuiltAtlas {
    texture: THREE.CanvasTexture;
    cells: AtlasCell[];
    canvasWidthPx: number;
    canvasHeightPx: number;
}

/** 单行打包，放不下就换行（每格高度只取决于 em，所以行高一致）。 */
const packAtlasCells = (
    sizes: readonly { w: number; h: number }[],
    maxCanvasWidth: number,
) => {
    const origins: Array<{ x: number; y: number }> = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let width = 0;
    sizes.forEach((size) => {
        if (x > 0 && x + size.w > maxCanvasWidth) {
            x = 0;
            y += rowHeight;
            rowHeight = 0;
        }
        origins.push({ x, y });
        x += size.w;
        rowHeight = Math.max(rowHeight, size.h);
        width = Math.max(width, x);
    });
    return { origins, width, height: y + rowHeight };
};

const buildDioramaAtlas = (
    texts: readonly string[],
    advances: readonly number[],
    fontSpec: string,
    pad: number,
    paint: (ctx: CanvasRenderingContext2D, text: string, drawX: number, drawY: number, em: number) => void,
): BuiltAtlas => {
    const em = DIORAMA_RASTER_FONT_PX;
    const cellHeight = Math.ceil(em * LINE_BAND_EM) + pad * 2;
    const sizes = advances.map((advance) => ({ w: advance + pad * 2, h: cellHeight }));
    const { origins, width, height } = packAtlasCells(sizes, MAX_CANVAS_PX);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d')!;
    ctx.font = fontSpec;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const cells: AtlasCell[] = sizes.map((size, i) => {
        const origin = origins[i];
        // 与逐张路径同一套画法：字画在格子的水平 advance 中心、垂直正中。
        paint(ctx, texts[i], origin.x + pad, origin.y + size.h / 2, em);
        return { x: origin.x, y: origin.y, w: size.w, h: size.h };
    });
    return { texture: makeTexture(canvas), cells, canvasWidthPx: canvas.width, canvasHeightPx: canvas.height };
};

/** 一格 = 图集纹理的一个 clone（共享 source，所以共享同一次 GPU 上传），靠 offset/repeat 取自己那块。 */
const makeDioramaAtlasCellTexture = (atlas: BuiltAtlas, index: number): THREE.Texture => {
    const cell = atlas.cells[index];
    const texture = atlas.texture.clone();
    // flipY=true：v=0 是画布底边，所以画布矩形 [y, y+h] 对应 v ∈ [1-(y+h)/H, 1-y/H]。
    texture.offset.set(cell.x / atlas.canvasWidthPx, 1 - (cell.y + cell.h) / atlas.canvasHeightPx);
    texture.repeat.set(cell.w / atlas.canvasWidthPx, cell.h / atlas.canvasHeightPx);
    return texture;
};

/**
 * 图集装不装得下这一行（纯算术，不建画布）。
 *
 * 逐张路径每单元一张小画布，永远不越界；图集把整行拼进一张，行宽超 4096 会自动换行，于是**高度**成了
 * 新的约束。正常歌词行（几十字母/汉字）两张图集都在 3 行内，余量很大；但极端长行（比如把整段歌词塞进
 * 一行）理论上能把高度堆过安全上限。这里给调用方一个便宜的预判：装不下就退回逐张，保持老行为。
 */
export const dioramaUnitAtlasFits = (advances: readonly number[]): boolean => {
    const em = DIORAMA_RASTER_FONT_PX;
    const bandHeight = Math.ceil(em * LINE_BAND_EM);
    const fits = (pad: number): boolean => {
        const packed = packAtlasCells(
            advances.map((advance) => ({ w: Math.max(1, advance) + pad * 2, h: bandHeight + pad * 2 })),
            MAX_CANVAS_PX,
        );
        return packed.height <= MAX_CANVAS_PX;
    };
    return fits(Math.ceil(em * PLAIN_PAD_EM)) && fits(Math.ceil(em * GLOW_PAD_EM));
};

export interface DioramaUnitAtlasCell {
    baseTexture: THREE.Texture;
    glowTexture: THREE.Texture;
    /** 字身格尺寸（px）：摆字身/灵魂平面用。 */
    baseWidthPx: number;
    baseHeightPx: number;
    /** 辉光格尺寸（px）：摆辉光平面用（比字身大一圈，模糊才有地方铺）。 */
    glowWidthPx: number;
    glowHeightPx: number;
}

export interface DioramaUnitAtlasRaster {
    /** 与传入 texts 一一对应：每单元两张「格纹理」（同一张图集的 clone）。 */
    units: DioramaUnitAtlasCell[];
    /** 这一行真正的 GPU 资源（图集模式恒为 2 张）：预热看这个，别去数 clone。 */
    textures: THREE.Texture[];
    /** 释放：先收每单元的 clone（引用计数 -1），再收两张图集本体。 */
    dispose: () => void;
}

/**
 * 整行逐单元图集。`advances` 是每单元的排版宽度（px，由调用方测量，与逐张路径同一口径）。
 */
export const rasterDioramaUnitAtlas = (
    texts: readonly string[],
    advances: readonly number[],
    fontSpec: string,
): DioramaUnitAtlasRaster => {
    const em = DIORAMA_RASTER_FONT_PX;
    const basePad = Math.ceil(em * PLAIN_PAD_EM);
    const glowPad = Math.ceil(em * GLOW_PAD_EM);
    const base = buildDioramaAtlas(texts, advances, fontSpec, basePad, (ctx, text, drawX, drawY) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, drawX, drawY);
    });
    const glow = buildDioramaAtlas(texts, advances, fontSpec, glowPad, (ctx, text, drawX, drawY, blurEm) => {
        drawGlowGlyph(ctx, text, drawX, drawY, blurEm * GLOW_BLUR_EM);
    });

    const clones: THREE.Texture[] = [];
    const units: DioramaUnitAtlasCell[] = texts.map((_, i) => {
        const baseTexture = makeDioramaAtlasCellTexture(base, i);
        const glowTexture = makeDioramaAtlasCellTexture(glow, i);
        clones.push(baseTexture, glowTexture);
        return {
            baseTexture,
            glowTexture,
            baseWidthPx: base.cells[i].w,
            baseHeightPx: base.cells[i].h,
            glowWidthPx: glow.cells[i].w,
            glowHeightPx: glow.cells[i].h,
        };
    });

    return {
        units,
        textures: [base.texture, glow.texture],
        dispose: () => {
            clones.forEach((texture) => texture.dispose());
            base.texture.dispose();
            glow.texture.dispose();
        },
    };
};


export interface DioramaLineRaster {
    texture: THREE.CanvasTexture;
    canvasWidthPx: number;
    canvasHeightPx: number;
    advancePx: number;
    /** px of one em in THIS raster (long lines shrink to fit the max canvas edge). */
    fontPx: number;
}

/** Rasterise a whole (neighbour) line as one plain white texture - no glow, small pad. */
export const rasterDioramaLine = (text: string, fontStack: string, fontWeight = DEFAULT_FONT_WEIGHT): DioramaLineRaster => {
    let fontPx = DIORAMA_RASTER_FONT_PX;
    let fontSpec = buildDioramaFontSpec(fontStack, fontWeight);
    let advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)));
    const pad = Math.ceil(fontPx * PLAIN_PAD_EM);
    if (advancePx + pad * 2 > MAX_CANVAS_PX) {
        const shrink = (MAX_CANVAS_PX - pad * 2) / advancePx;
        fontPx = Math.max(24, Math.floor(fontPx * shrink));
        fontSpec = `${fontWeight} ${fontPx}px ${fontStack}`;
        advancePx = Math.max(1, Math.ceil(measureDioramaText(text, fontSpec)));
    }
    const canvasWidthPx = advancePx + pad * 2;
    const canvasHeightPx = Math.ceil(fontPx * LINE_BAND_EM) + pad * 2;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidthPx;
    canvas.height = canvasHeightPx;
    const ctx = canvas.getContext('2d')!;
    ctx.font = fontSpec;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, pad, canvasHeightPx / 2);

    return { texture: makeTexture(canvas), canvasWidthPx, canvasHeightPx, advancePx, fontPx };
};
