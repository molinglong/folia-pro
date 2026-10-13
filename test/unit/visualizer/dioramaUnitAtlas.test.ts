import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Line } from '@/types';
import {
    dioramaUnitAtlasFits,
    rasterDioramaUnit,
    rasterDioramaUnitAtlas,
    resolveDioramaUnitRasterMode,
    type DioramaUnitAtlasRaster,
} from '@/components/visualizer/diorama/dioramaTextRaster';
import { layoutDioramaActiveUnits } from '@/components/visualizer/diorama/dioramaSceneLayout';
import { type LyricUnit } from '@/components/visualizer/diorama/dioramaSceneTypes';

// test/unit/visualizer/dioramaUnitAtlas.test.ts
// @fork 性能刀A-2（当前行单元图集）的结构不变量。
//
// 图集把「每单元两张画布」换成「整行两张画布 + 每格一个 clone」，省的是 GPU 上传次数（实测一行 30 次 → 2 次）。
// 这个优化只有在三件事同时成立时才成立，所以三件事全部钉住：
//   1) 每格纹理必须和图集本体共享同一个 `Texture.source` —— 否则 N 个 clone 各自上传，字节一点没省；
//   2) 格与格在图集里不得重叠，且格的像素尺寸必须等于原来那张逐张画布 —— 这是「辉光逐像素不变」的依据
//      （模糊外溢跨不出自己的格，超出格边的部分本来在旧路径里也是一张独立纹理）；
//   3) 字必须画在格的正中（advance 中心 = 格中心）—— 否则平面挪位置，跟唱对不上。
// 排版层（centerX / lineWidth）在两条路径之间必须逐位相等：图集只动纹理，不动版式。

/** 桩字体的确定宽度：一个字符 96px，测量与绘制共用同一口径。 */
const CHAR_PX = 96;
/** drawGlowGlyph 的离屏投影距离：影子落在 (x - OFFSCREEN) + OFFSCREEN = x，所以可见墨迹仍是 call.x + 本值。 */
const GLOW_SHADOW_OFFSCREEN = 10000;

interface DrawCall {
    text: string;
    x: number;
    y: number;
}

interface FakeCanvas {
    width: number;
    height: number;
    drawCalls: DrawCall[];
    getContext: () => FakeCtx;
}

interface FakeCtx {
    font: string;
    textAlign: string;
    textBaseline: string;
    fillStyle: string;
    globalCompositeOperation: string;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    measureText: (text: string) => { width: number };
    fillText: (text: string, x: number, y: number) => void;
    save: () => void;
    restore: () => void;
}

const canvases: FakeCanvas[] = [];

const makeCanvas = (): FakeCanvas => {
    const canvas: FakeCanvas = {
        width: 1,
        height: 1,
        drawCalls: [],
        getContext: () => ctx,
    };
    const ctx: FakeCtx = {
        font: '',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        fillStyle: '#000',
        globalCompositeOperation: 'source-over',
        shadowColor: 'transparent',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        measureText: (text: string) => ({ width: text.length * CHAR_PX }),
        fillText: (text: string, x: number, y: number) => {
            canvas.drawCalls.push({ text, x, y });
        },
        save: () => undefined,
        restore: () => undefined,
    };
    canvases.push(canvas);
    return canvas;
};

beforeEach(() => {
    canvases.length = 0;
    vi.stubGlobal('document', { createElement: makeCanvas });
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => undefined } });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const FONT_SPEC = `700 128px Test Font`;
const TEXTS = ['沧', '海', '一', '声', '笑'];
const ADVANCES = TEXTS.map((text) => text.length * CHAR_PX);

const fullLine = (texts: string[]): Line => ({
    fullText: texts.join(''),
    words: [{ text: texts.join(''), startTime: 0, endTime: 1 }],
    startTime: 0,
    endTime: 1,
});

const unitsOf = (texts: string[]): LyricUnit[] => texts.map((text, i) => ({
    text,
    charStart: i,
    charEnd: i + 1,
    startTime: i,
    endTime: i + 1,
}));

/** clone 的 offset/repeat 反解成图集画布像素矩形（flipY=true：v=0 是画布底边）。 */
const cellRectPx = (texture: THREE.Texture) => {
    const atlas = texture.image as unknown as FakeCanvas;
    return {
        x: texture.offset.x * atlas.width,
        y: (1 - texture.offset.y - texture.repeat.y) * atlas.height,
        w: texture.repeat.x * atlas.width,
        h: texture.repeat.y * atlas.height,
    };
};

const buildAtlas = (): DioramaUnitAtlasRaster => rasterDioramaUnitAtlas(TEXTS, ADVANCES, FONT_SPEC);

describe('diorama 当前行单元图集', () => {
    it('一行只交两张图集：每格纹理与图集本体共享 source', () => {
        const atlas = buildAtlas();
        expect(atlas.textures).toHaveLength(2);

        const baseSource = atlas.textures[0].source;
        const glowSource = atlas.textures[1].source;
        expect(baseSource).not.toBe(glowSource);

        atlas.units.forEach((cell) => {
            expect(cell.baseTexture.source).toBe(baseSource);
            expect(cell.glowTexture.source).toBe(glowSource);
            // clone 必须是独立纹理（各自有 offset/repeat），不能是同一个对象。
            expect(cell.baseTexture).not.toBe(atlas.textures[0]);
        });

        // 全行真正要上传的 GPU 资源只有 2 个 source（字身图集 + 辉光图集）；逐张老路是 2N 个。
        const baseSources = new Set(atlas.units.map((cell) => cell.baseTexture.source));
        const glowSources = new Set(atlas.units.map((cell) => cell.glowTexture.source));
        expect(baseSources.size).toBe(1);
        expect(glowSources.size).toBe(1);
        expect(baseSources.has(glowSource)).toBe(false);
        expect(glowSources.has(baseSource)).toBe(false);

        const perUnit = TEXTS.flatMap((text) => {
            const raster = rasterDioramaUnit(text, FONT_SPEC);
            return [raster.baseTexture.source, raster.glowTexture.source];
        });
        expect(new Set(perUnit).size).toBe(TEXTS.length * 2);
    });

    it('字画在格的正中：左右留白对称、垂直正中', () => {
        const atlas = buildAtlas();
        const baseCanvas = atlas.textures[0].image as unknown as FakeCanvas;
        expect(baseCanvas.drawCalls).toHaveLength(TEXTS.length);

        atlas.units.forEach((cell, i) => {
            const rect = cellRectPx(cell.baseTexture);
            const call = baseCanvas.drawCalls[i];
            const leftPad = call.x - rect.x;
            expect(call.text).toBe(TEXTS[i]);
            expect(rect.w - leftPad - ADVANCES[i]).toBeCloseTo(leftPad, 6);
            expect(call.y).toBeCloseTo(rect.y + rect.h / 2, 6);
        });

        // 辉光：四次模糊 pass 都落在同一格的中心（影子位置 = call.x + 离屏距离）。
        const glowCanvas = atlas.textures[1].image as unknown as FakeCanvas;
        atlas.units.forEach((cell, i) => {
            const rect = cellRectPx(cell.glowTexture);
            const calls = glowCanvas.drawCalls.slice(i * 4, i * 4 + 4);
            expect(calls).toHaveLength(4);
            calls.forEach((call) => {
                const leftPad = call.x + GLOW_SHADOW_OFFSCREEN - rect.x;
                expect(rect.w - leftPad - ADVANCES[i]).toBeCloseTo(leftPad, 6);
                expect(call.y).toBeCloseTo(rect.y + rect.h / 2, 6);
            });
        });
    });

    it('格与格互不重叠，且辉光格尺寸等于逐张画布尺寸', () => {
        const atlas = buildAtlas();
        const baseAtlas = atlas.textures[0].image as unknown as FakeCanvas;
        const glowAtlas = atlas.textures[1].image as unknown as FakeCanvas;

        const rects = atlas.units.map((cell) => cellRectPx(cell.baseTexture));
        rects.forEach((rect, i) => {
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.w).toBeLessThanOrEqual(baseAtlas.width + 1e-6);
            expect(rect.y + rect.h).toBeLessThanOrEqual(baseAtlas.height + 1e-6);
            const next = rects[i + 1];
            if (next) expect(rect.x + rect.w).toBeLessThanOrEqual(next.x + 1e-6);
        });

        atlas.units.forEach((cell, i) => {
            const legacy = rasterDioramaUnit(TEXTS[i], FONT_SPEC);
            const glowRect = cellRectPx(cell.glowTexture);
            expect(glowRect.w).toBe(legacy.canvasWidthPx);
            expect(glowRect.h).toBe(legacy.canvasHeightPx);
            legacy.baseTexture.dispose();
            legacy.glowTexture.dispose();
        });

        // 字身格比辉光格小：边距收回到普通行的量级，字节才降得下来。
        const baseRect = cellRectPx(atlas.units[0].baseTexture);
        const glowRect = cellRectPx(atlas.units[0].glowTexture);
        expect(baseRect.w).toBeLessThan(glowRect.w);
        expect(glowAtlas.height).toBeGreaterThan(baseAtlas.height);
    });

    it('排版与逐张路径逐位相等（centerX / lineWidth 不受图集影响）', () => {
        const layoutWith = (flag: string | null) => {
            vi.stubGlobal('window', {
                localStorage: { getItem: () => flag, setItem: () => undefined },
            });
            const result = layoutDioramaActiveUnits(fullLine(TEXTS), unitsOf(TEXTS), FONT_SPEC);
            expect(result).not.toBeNull();
            return result as NonNullable<ReturnType<typeof layoutDioramaActiveUnits>>;
        };

        const atlasLayout = layoutWith(null);
        expect(atlasLayout.textures).toHaveLength(2);
        const legacyLayout = layoutWith('off');
        expect(legacyLayout.textures).toHaveLength(TEXTS.length * 2);

        expect(legacyLayout.lineWidth).toBe(atlasLayout.lineWidth);
        expect(legacyLayout.units.map((u) => u.centerX)).toEqual(atlasLayout.units.map((u) => u.centerX));
        // 逐张路两张同尺寸；图集路辉光比字身大。
        legacyLayout.units.forEach((u) => {
            expect(u.baseWidth).toBe(u.glowWidth);
            expect(u.baseHeight).toBe(u.glowHeight);
        });
        atlasLayout.units.forEach((u) => {
            expect(u.glowWidth).toBeGreaterThan(u.baseWidth);
        });

        atlasLayout.dispose();
        legacyLayout.dispose();
    });

    it('释放：每格 clone 先收，两张图集本体最后收', () => {
        const atlas = buildAtlas();
        const order: string[] = [];
        const tag = (name: string) => (texture: THREE.Texture) => {
            texture.addEventListener('dispose', () => order.push(name));
        };
        atlas.units.forEach((cell, i) => {
            tag(`base-${i}`)(cell.baseTexture);
            tag(`glow-${i}`)(cell.glowTexture);
        });
        tag('atlas-base')(atlas.textures[0]);
        tag('atlas-glow')(atlas.textures[1]);

        atlas.dispose();
        expect(order).toHaveLength(TEXTS.length * 2 + 2);
        expect(order.slice(-2)).toEqual(['atlas-base', 'atlas-glow']);
    });

    it('档位手柄：只有显式 off/0/per-unit 才回到逐张', () => {
        const resolveWith = (raw: string | null) => {
            vi.stubGlobal('window', { localStorage: { getItem: () => raw, setItem: () => undefined } });
            return resolveDioramaUnitRasterMode();
        };
        expect(resolveWith(null)).toBe('atlas');
        expect(resolveWith('')).toBe('atlas');
        expect(resolveWith('OFF')).toBe('per-unit');
        expect(resolveWith(' 0 ')).toBe('per-unit');
        expect(resolveWith('per-unit')).toBe('per-unit');
    });

    it('装不下的超长行退回逐张：图集高度受画布上限约束', () => {
        expect(dioramaUnitAtlasFits(ADVANCES)).toBe(true);
        // 每格 ≈ 96+2*90px 宽，6000 格 ≈ 62 万 px → 约 153 行 × 359px，远超 4096。
        expect(dioramaUnitAtlasFits(Array.from({ length: 6000 }, () => CHAR_PX))).toBe(false);
        expect(dioramaUnitAtlasFits([])).toBe(true);
    });
});
