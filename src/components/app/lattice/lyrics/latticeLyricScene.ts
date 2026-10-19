import type { Container, Mesh, MeshGeometry, Shader, Sprite, Texture } from 'pixi.js';
import type { MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetSweepEdgeSoftness, resolveMonetSweepEnd } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetFillWidth, resolveMonetGlow, clampMonetProgress } from '../../../visualizer/monet/monetLyricMotion';
import { buildWordColorRangesFromMatchers, prepareWordColorMatchers, resolveTokenColorMap } from '../../../visualizer/wordColoring';
import { colorWithAlpha, mixColors } from '../../../visualizer/colorMix';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import { scaleColor01, LATTICE_CHORUS_BASE_DIM, LATTICE_PLAIN_HALO_ALPHA } from './latticeLyricBoost';
import type { LatticeLyricInput } from './types';
import type { LatticeLineLayout, LatticeTypography, LyricPiece } from './latticeLyricLayout';
import type { LatticeRaster } from './latticeLyricRaster';
import { createLatticeQuadGeometry, createLatticeSweepShader, type LatticeSweep } from './latticeLyricFilters';

// src/components/app/lattice/lyrics/latticeLyricScene.ts
type Pixi = typeof import('pixi.js');
interface PieceView { sprite: Mesh<MeshGeometry, Shader>; glow: Sprite[]; texture: Texture; sweep: LatticeSweep;
    pad: number; width: number; height: number; piece: LyricPiece; color: string; base: number[]; word: number[]; lit: number[]; dimBase: number[]; born: number; }

/** Builds only the rows near the card viewport; a long lyric never allocates a song-sized texture. */
export function createLatticeLineView(pixi: Pixi, raster: LatticeRaster, parent: Container,
    entry: MonetVisibleLineEntry, layout: LatticeLineLayout, type: LatticeTypography, input: LatticeLyricInput, resolution: number) {
    const container = new pixi.Container(); parent.addChild(container);
    const near = new pixi.Container(), far = new pixi.Container(), text = new pixi.Container();
    container.addChild(far, near, text);
    const chorus = Boolean(entry.line.isChorus);
    // 副歌的光晕本来就比普通行大一圈，高潮提亮主要靠它变实、变叠（加性合成），半径再推一档只是把光铺得更开。
    const radii = [Math.round(type.fontPx * (chorus ? 0.52 : 0.28)), Math.round(type.fontPx * (chorus ? 1.05 : 0.65))];
    const glowFilters = radii.map(strength => new pixi.BlurFilter({ strength, quality: 3, resolution: 1 }));
    near.filters = [glowFilters[0]]; far.filters = [glowFilters[1]];
    const blur = new pixi.BlurFilter({ strength: 0, quality: 2 }); container.filters = [blur];
    const pieces = new Map<number, PieceView>();
    // Translation rows ride a 0..1 focus blend instead of snapping when the line activates: queued
    // lines park the blend at 0 under the clipped row, activation slides and fades them into place.
    let lastStatus = entry.status, shift = entry.status === 'active' ? 1 : 0, shiftFrom = shift, shiftAt = 0;
    const quad = createLatticeQuadGeometry(pixi);
    const matchers = prepareWordColorMatchers(input.theme.wordColors, input.keywordColoringEnabled);
    const colors = resolveTokenColorMap(layout.pieces.map(p => p.token), buildWordColorRangesFromMatchers(entry.line.fullText, matchers));
    const accent = chorus ? mixColors(input.theme.primaryColor, input.theme.accentColor, 0.48) : colorWithAlpha(input.theme.primaryColor, 0.98);
    const destroyPiece = (view: PieceView) => {
        view.sprite.destroy(); view.sweep.shader.destroy(); view.glow.forEach(sprite => sprite.destroy()); view.texture.destroy(true);
    };
    const createPiece = (piece: LyricPiece): PieceView => {
        const px = piece.translation ? type.translationPx : type.fontPx;
        const image = raster.rasterize(piece.text, piece.translation ? type.translationFont : type.font, px, resolution);
        const color = piece.translation ? (input.subtitleTheme ?? input.theme).primaryColor : colors.get(piece.token.key) ?? accent;
        const base = new pixi.Color(input.theme.primaryColor).toArray();
        // word 永远是原始字色（提亮的取用源），lit 是每帧按倍数缩放后的交付数组：直接改 word 会把倍数复乘上去。
        const word = new pixi.Color(color).toArray();
        const sweep = createLatticeSweepShader(pixi, base, word, image.texture);
        sweep.uniforms.uGlyphRange = [(image.pad - piece.tokenOffset) / image.width, (piece.offsets.at(-1) ?? piece.width) / image.width];
        const sprite = new pixi.Mesh({ geometry: quad, shader: sweep.shader, texture: image.texture });
        sprite.scale.set(image.width, image.height);
        sprite.position.set(piece.x - image.pad, piece.y - image.pad); text.addChild(sprite);
        const glow = [near, far].map(layer => {
            const clone = new pixi.Sprite(image.texture); clone.position.copyFrom(sprite.position);
            // 副歌行的晕走加性合成：两层白晕互相累加、再往背景上叠光，这才是白字场景下还能往上涨的亮度。
            // 普通行保持正常合成，否则整面墙都会亮起来，副歌的落差就没了。
            if (chorus) clone.blendMode = 'add';
            layer.addChild(clone); return clone;
        });
        return { ...image, sprite, glow, sweep, piece, color, base, word, lit: [...word], dimBase: [...base], born: 0 };
    };
    const smoothstep = (p: number) => p * p * (3 - 2 * p);
    const update = (time: number, status: MonetVisibleLineEntry['status'], baseAlpha: number, viewportHeight: number,
        top: number, scale: number, quiet: boolean, boost = 1) => {
        const maxText = status === 'active' ? Infinity : type.lineHeight;
        const activeTarget = status === 'active' ? 1 : 0;
        if (status !== lastStatus) { lastStatus = status; shiftFrom = shift; shiftAt = time; }
        shift = quiet ? activeTarget
            : shiftFrom + (activeTarget - shiftFrom) * smoothstep(clampMonetProgress((time - shiftAt) / 0.3));
        let glowing = false;
        for (let i = 0; i < layout.pieces.length; i++) {
            const piece = layout.pieces[i];
            const placeholder = Math.min(layout.textHeight, maxText === Infinity ? layout.textHeight : maxText)
                + type.fontPx * 0.3 + piece.row * type.translationLineHeight;
            const y = piece.translation ? placeholder + (piece.y - placeholder) * shift : piece.y;
            const visible = (piece.translation ? shift > 0.01 : piece.y < maxText) && (top + y * scale > -type.lineHeight * 2)
                && (top + y * scale < viewportHeight + type.lineHeight * 2);
            const old = pieces.get(i);
            if (!visible) { if (old) { destroyPiece(old); pieces.delete(i); } continue; }
            const view = old ?? createPiece(piece); pieces.set(i, view);
            if (!old) view.born = time;
            // Rows that only appear on activation (past the queued single row) develop in over a
            // quarter second instead of materializing at full brightness.
            const reveal = quiet || time - view.born >= 0.25 ? 1 : smoothstep(clampMonetProgress((time - view.born) / 0.25));
            view.sprite.alpha = reveal * (piece.translation ? shift : 1);
            view.sprite.y = y - view.pad; view.glow.forEach(sprite => { sprite.y = view.sprite.y; });
            const token = piece.token, start = token.startTime ?? Infinity, end = token.endTime ?? Infinity;
            const passed = token.timed && (status === 'passed' || (status === 'active' && time > end));
            const progress = status === 'active' && token.timed ? clampMonetProgress((time - start) / Math.max(0.001, end - start)) : 0;
            const width = status === 'active' ? resolveMonetFillWidth(time, start, end, piece.offsets, token.graphemeTimings) : 0;
            const softness = resolveMonetSweepEdgeSoftness(type.fontPx);
            const front = resolveMonetSweepEnd(width, piece.offsets.at(-1) ?? 0, softness);
            const uniforms = view.sweep.uniforms;
            if (piece.translation) {
                uniforms.uBase = uniforms.uWord;
                uniforms.uBase[3] = 0.68;
            } else {
                view.base[3] = baseAlpha;
                // 副歌行把未唱的墨色压一档：正文字色已接近纯白提不上去，"唱到的比没唱到的亮多少"才是看得见的亮度。
                uniforms.uBase = chorus ? scaleColor01(view.base, LATTICE_CHORUS_BASE_DIM, view.dimBase) : view.base;
            }
            uniforms.uProgress = progress; uniforms.uPassed = passed ? 1 : 0;
            uniforms.uFront = (front - piece.tokenOffset + view.pad) / view.width;
            uniforms.uSoftness = softness / view.width;
            const clipped = status !== 'active' && piece.row === 1 && layout.rows > 2;
            uniforms.uVerticalFade[0] = clipped ? (view.pad + type.lineHeight * 0.55) / view.height : 2;
            uniforms.uVerticalFade[1] = clipped ? (view.pad + type.lineHeight) / view.height : 3;
            const glow = !quiet && !piece.translation && token.timed && status !== 'waiting'
                ? resolveMonetGlow(time, start, end, getLineRenderEndTime(entry.line)) : 0;
            glowing ||= glow > 0;
            // 高潮/重音提亮：字色按倍数缩放（只对彩色主题有余量），晕同时往"更实"走一档——
            // 副歌行本来就是满不透明度加加性合成，这里让它提前饱和、亮窗更宽；普通行只微涨。
            // 译文字行不动，否则小字先糊。
            const word = piece.translation ? uniforms.uWord : (uniforms.uWord = scaleColor01(view.word, boost, view.lit));
            const r = Math.round((view.base[0] + (word[0] - view.base[0]) * glow) * 255);
            const g = Math.round((view.base[1] + (word[1] - view.base[1]) * glow) * 255);
            const b = Math.round((view.base[2] + (word[2] - view.base[2]) * glow) * 255);
            const ceiling = chorus ? 1 : LATTICE_PLAIN_HALO_ALPHA;
            const denseness = 1 + (boost - 1) * (chorus ? 0.6 : 0.35);
            for (const sprite of view.glow) {
                sprite.alpha = Math.min(ceiling, glow * reveal * ceiling * denseness);
                sprite.tint = (r << 16) | (g << 8) | b;
            }
        }
        near.renderable = far.renderable = glowing;
    };
    return { container, blur, layout, entry, update,
        // quad.destroy(true) 连顶点 / 索引缓冲一起删；不传 true 时 Geometry 不动缓冲，要等 Pixi 的 GC 空闲 60 秒才删。
        destroy() { pieces.forEach(destroyPiece); pieces.clear(); blur.destroy(); glowFilters.forEach(f => f.destroy()); container.destroy({ children: true }); quad.destroy(true); },
    };
}
export type LatticeLineView = ReturnType<typeof createLatticeLineView>;
