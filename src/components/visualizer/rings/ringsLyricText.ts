// Copyright (c) 2026 chthollyphile

// src/components/visualizer/rings/ringsLyricText.ts
// The lyric text layer. A line appears whole but dim; each character then
// lights up at its own time (word timings when the lyric has them): it brightens
// into a glowing copy with a small swell. Lines fade in and out as a whole.
//
// Every glyph is a container of two sprites, the dim base and the lit copy, so
// lighting is only an alpha change — no redraw per frame. Progress follows the
// song clock; the whole-line fades also follow the wall clock so they finish
// while playback is paused.

import type { Line, Theme } from '../../../types';
import { renderGlyphCanvas, type RingsLineLayout } from './ringsLineLayout';
import { buildCharTimings } from './ringsCharTimings';

type PixiModule = typeof import('pixi.js');

const LINE_FADE_SEC = 0.45;
const DIM_ALPHA = 0.3;
const LIGHT_MIN_SEC = 0.12;
const LIGHT_MAX_SEC = 0.45;
const SWELL = 0.12;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

const fadeProgress = (time: number, songStart: number, wallStart: number): number => Math.min(1, Math.max(
    0,
    (time - songStart) / LINE_FADE_SEC,
    (performance.now() - wallStart) / 1000 / LINE_FADE_SEC,
));

const makeSprite = (pixi: PixiModule, canvas: HTMLCanvasElement, side: number, dpr: number) => {
    const texture = new pixi.Texture({ source: new pixi.CanvasSource({ resource: canvas, resolution: dpr }) });
    const sprite = new pixi.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = side;
    sprite.height = side;
    return sprite;
};

interface GlyphEntry {
    holder: import('pixi.js').Container;
    litSprite: import('pixi.js').Sprite;
    glyph: import('./ringsLineLayout').RingsGlyph;
    timing: { start: number; end: number } | null;
}

export const createLyricText = (pixi: PixiModule, layer: import('pixi.js').Container) => {
    let current: {
        container: import('pixi.js').Container;
        glyphs: GlyphEntry[];
        line: Line;
        lineIndex: number;
        layout: RingsLineLayout;
        theme: Theme;
        dpr: number;
        shownAt: number;
        shownAtWall: number;
    } | null = null;
    const fading: { container: import('pixi.js').Container; hiddenAt: number; hiddenAtWall: number }[] = [];

    const destroyContainer = (container: import('pixi.js').Container) => {
        container.destroy({ children: true, texture: true, textureSource: true });
    };

    const build = (
        line: Line,
        lineIndex: number,
        layout: RingsLineLayout,
        theme: Theme,
        dpr: number,
        shownAt: number,
        shownAtWall: number,
    ) => {
        const timings = buildCharTimings(line);
        const container = new pixi.Container();
        container.alpha = 0;
        const glyphs = layout.glyphs.map((glyph) => {
            const holder = new pixi.Container();
            holder.position.set(glyph.x, glyph.y);
            holder.rotation = glyph.rotation;
            holder.scale.set(glyph.scale);
            const base = renderGlyphCanvas(glyph, layout, dpr, theme.primaryColor, null);
            const lit = renderGlyphCanvas(glyph, layout, dpr, theme.primaryColor, theme.accentColor);
            const baseSprite = makeSprite(pixi, base.canvas, base.side, dpr);
            const litSprite = makeSprite(pixi, lit.canvas, lit.side, dpr);
            baseSprite.alpha = DIM_ALPHA;
            litSprite.alpha = 0;
            holder.addChild(baseSprite, litSprite);
            container.addChild(holder);
            return { holder, litSprite, glyph, timing: timings[glyph.charIndex] ?? null };
        });
        layer.addChild(container);
        return { container, glyphs, line, lineIndex, layout, theme, dpr, shownAt, shownAtWall };
    };

    return {
        get lineIndex() {
            return current?.lineIndex ?? -1;
        },

        /** Replaces the shown line (fading the old one out) at song time `time`. */
        show(line: Line, lineIndex: number, layout: RingsLineLayout, theme: Theme, dpr: number, time: number) {
            this.hide(time);
            current = build(line, lineIndex, layout, theme, dpr, time, performance.now());
        },

        hide(time: number) {
            if (!current) return;
            fading.push({ container: current.container, hiddenAt: time, hiddenAtWall: performance.now() });
            current = null;
        },

        /** Redraws the shown line with a new layout/theme (resize), keeping its fade state. */
        rebuild(line: Line, layout: RingsLineLayout, theme: Theme, dpr: number) {
            fading.splice(0).forEach(({ container }) => destroyContainer(container));
            if (!current) return;
            const { lineIndex, shownAt, shownAtWall } = current;
            destroyContainer(current.container);
            current = build(line, lineIndex, layout, theme, dpr, shownAt, shownAtWall);
        },

        /** After a seek: drop fading lines and fade the shown one in again. */
        restart(time: number) {
            fading.splice(0).forEach(({ container }) => destroyContainer(container));
            if (current) {
                current.shownAt = time;
                current.shownAtWall = performance.now();
            }
        },

        /** Applies fades and lighting for song time `time`; true while a fade is running. */
        update(time: number, staticMode: boolean): boolean {
            let running = false;
            if (current) {
                const appear = staticMode ? 1 : fadeProgress(time, current.shownAt, current.shownAtWall);
                current.container.alpha = appear;
                running = appear < 1;
                current.glyphs.forEach(({ holder, litSprite, glyph, timing }) => {
                    let progress = 1;
                    if (!staticMode && timing) {
                        const duration = Math.min(LIGHT_MAX_SEC, Math.max(LIGHT_MIN_SEC, timing.end - timing.start));
                        progress = Math.min(1, Math.max(0, (time - timing.start) / duration));
                    }
                    litSprite.alpha = easeOutCubic(progress);
                    const swell = progress > 0 && progress < 1 ? SWELL * Math.sin(Math.PI * progress) : 0;
                    holder.scale.set(glyph.scale * (1 + swell));
                });
            }
            for (let i = fading.length - 1; i >= 0; i -= 1) {
                const entry = fading[i];
                const progress = fadeProgress(time, entry.hiddenAt, entry.hiddenAtWall);
                if (progress >= 1) {
                    destroyContainer(entry.container);
                    fading.splice(i, 1);
                } else {
                    entry.container.alpha = Math.min(entry.container.alpha, 1 - progress);
                    running = true;
                }
            }
            return running;
        },

        destroy() {
            fading.splice(0).forEach(({ container }) => destroyContainer(container));
            if (current) destroyContainer(current.container);
            current = null;
        },
    };
};
