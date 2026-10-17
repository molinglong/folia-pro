import { describe, expect, it, vi } from 'vitest';
import type { Line } from '@/types';
import { LUMIERE_PROFILES } from '@/components/visualizer/lumiere/catalog';
import { createLyricWindow, type LyricWindowFrame, type WindowTypography } from '@/components/visualizer/lumiere/text/lyricWindow';
import { installFakeTextMeasure } from './lumiereFixtures';
import { fakePixi, fakeSprites } from './lumiereWindowFakes';

// test/unit/visualizer/lumiere/lumiereTextGlow.test.ts
// 垫在字后面的两团柔光（每行的追字光斑、每个字的下光晕）可以整体折掉：绘光的 MV 适配靠它把
// 「跟着歌词走的一块小背景」去掉。字身不受影响，也不改变字的位置；折回去随时恢复原样。
vi.mock('@/components/visualizer/lumiere/text/glyphLine', async importOriginal => (
    (await import('./lumiereWindowFakes')).fakeGlyphLineModule(await importOriginal())
));
installFakeTextMeasure();

const LINES: Line[] = ['光落在晨雾里', '我们走回去', '星河与风'].map((fullText, index) => {
    const startTime = 2 + index * 3;
    return { fullText, startTime, endTime: startTime + 2, words: [{ text: fullText, startTime, endTime: startTime + 2 }] };
});

const FRAME: LyricWindowFrame = {
    time: 3.2,
    beams: [],
    litColor: [1, 1, 1],
    unlitColor: [0.5, 0.5, 0.5],
    unlitAlpha: 0.22,
    intensity: 1,
};

interface Node {
    children: unknown[];
    visible: boolean;
    alpha: number;
}

const buildWindow = (typography: WindowTypography) => {
    const profile = LUMIERE_PROFILES[0]!;
    const window = createLyricWindow(fakePixi, {
        width: 1600,
        height: 900,
        lines: LINES,
        font: 'sans-serif',
        weight: 500,
        resolution: 1,
        region: { cx: profile.region.cx * 1600 / 900, cy: profile.region.cy, w: profile.region.w * 1600 / 900, h: profile.region.h },
        heroPx: profile.heroSize * 900,
        neighbors: 2,
        typography,
        decay: profile.decay,
        seed: 'text-glow',
        sprites: fakeSprites,
    });
    // 层的顺序在 lyricWindow 里定死：光斑、径迹、光晕、字、闪点。行与字的精灵是真 Pixi 对象，
    // 与假容器区分不开，于是按「看得见且透明度不到 1」认精灵（容器不写 alpha，一直是 1）。
    const layers = window.view.children as unknown[] as Node[];
    const showing = (node: Node): Node[] => (
        node.visible && node.alpha < 1 ? [node] : node.children.flatMap(child => showing(child as Node))
    );
    const alphas = (node: Node): number[] => (
        [node.alpha, ...node.children.flatMap(child => alphas(child as Node))]
    );
    return {
        window,
        spotLayer: layers[0]!,
        haloLayer: layers[2]!,
        glyphLayer: layers[3]!,
        litSpots: () => showing(layers[0]!),
        litHalos: () => showing(layers[2]!),
        glyphAlphas: () => alphas(layers[3]!),
    };
};

describe('字后面的柔光可整体折掉', () => {
    it('不给倍率时按原样画；折到 0 时光斑与光晕都不画，字身不动', () => {
        for (const typography of ['horizontal', 'crossed'] as const) {
            const { window, litSpots, litHalos, glyphAlphas } = buildWindow(typography);
            window.update(FRAME);
            const spotsBefore = litSpots().map(spot => spot.alpha);
            const halosBefore = litHalos().map(halo => halo.alpha);
            const glyphsBefore = glyphAlphas();
            expect(spotsBefore.length).toBeGreaterThan(0);
            expect(halosBefore.length).toBeGreaterThan(0);

            window.update({ ...FRAME, textGlowScale: 0 });
            expect(litSpots()).toHaveLength(0);
            expect(litHalos()).toHaveLength(0);
            // 字身一个数都没变：折掉的只有后面那两团。
            expect(glyphAlphas()).toEqual(glyphsBefore);

            // 折一半：两团的透明度跟着减半，字身仍不动。
            window.update({ ...FRAME, textGlowScale: 0.5 });
            expect(litHalos().map(halo => halo.alpha)).toEqual(halosBefore.map(alpha => alpha * 0.5));
            expect(litSpots().map(spot => spot.alpha)).toEqual(spotsBefore.map(alpha => alpha * 0.5));
            expect(glyphAlphas()).toEqual(glyphsBefore);

            // 回到原样：恢复得回去，不留状态。
            window.update(FRAME);
            expect(litHalos().map(halo => halo.alpha)).toEqual(halosBefore);
            expect(litSpots().map(spot => spot.alpha)).toEqual(spotsBefore);
            window.destroy();
        }
    });
});
