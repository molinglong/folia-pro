// Copyright (c) 2026 chthollyphile

// src/components/visualizer/rings/createRingsPixiRuntime.ts
// The rings stage: the current lyric line appears in the middle and lights up
// character by character, and a ring leaves its glyph outlines on every beat,
// spreading outward like a tree ring that records how loud that beat was.
// A song without lyrics grows its rings from random piths instead.
//
// Ported from the sample mod mods/visualizer52hz (Folium), with the mod host
// boundary swapped for the builtin renderer boundary:
// - Pixi comes from the app's own dependency via loadPixi (mod used vendor/pixi).
// - `ctx.getSettings()` becomes the RingsTuning tuning object; the mod's own
//   font-size setting is dropped in favour of the global lyric font scale.
// - `ctx.audio` becomes a per-frame normalized audio sample callback.
// - The host remounts on song changes; here the shell hands a new song to
//   setSong, which drops the record the same way a remount did.
//
// Everything is keyed to the song clock (currentTime), not the wall clock:
// pausing freezes the rings, seeking back clears the record, and the export
// window, which steps the clock itself, renders the same picture.

import { type MotionValue } from 'framer-motion';
import type { Line, RingsTuning, Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { loadPixi } from '../loadPixi';
import { createBeatDetector, createEnergyFollower, type RingsAudioSample } from './ringsBeatDetector';
import { buildLineField, layoutLine, type RingsFont, type RingsLineLayout } from './ringsLineLayout';
import { buildPithField } from './ringsPithShape';
import { createLyricText } from './ringsLyricText';
import { hashString } from './ringsRandom';
import {
    FAR_FROM_BEAT,
    HISTORY_RATE,
    HISTORY_SIZE,
    SLOT_COUNT,
    createFieldSource,
    createHistorySource,
    createRippleFilter,
} from './ringsRippleFilter';

type PixiModule = typeof import('pixi.js');

const TARGET_GRID = 480;          // field cells across the longer side
const OPEN_WINDOW_END = 1e9;
const UNUSED_WINDOW: [number, number] = [1, 0];
// The song clock moving this much (s) more or less than the wall clock between two
// frames is a seek, not playback: the ring record restarts. Comparing the two keeps
// a stalled frame (the clock and the wall both moved on) from wiping the record.
const SEEK_JUMP_SEC = 0.5;
const PITH_PERIOD_SEC = 11;       // an instrumental grows from a new pith this often
// How far back a beat marks the samples before it (their distance to the coming ring).
const BEAT_LOOKBACK_SAMPLES = Math.round(0.5 * HISTORY_RATE);
const STATIC_BEAT_SEC = 0.72;     // ring cadence of a static preview

const colorProbe = document.createElement('canvas').getContext('2d')!;
/** Any CSS color -> [r, g, b] in 0..1. */
const toRgb = (color: string | undefined, fallback: string): [number, number, number] => {
    colorProbe.fillStyle = fallback;
    if (color) colorProbe.fillStyle = color;
    const value = colorProbe.fillStyle;
    if (value.startsWith('#')) {
        return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number];
    }
    const parts = value.match(/[\d.]+/g) ?? ['255', '255', '255'];
    return parts.slice(0, 3).map(part => Number(part) / 255) as [number, number, number];
};

export interface RingsSongContext {
    lines: Line[];
    seed: string | number;
}

interface RingsRingSource {
    key: string;
    kind: 'line' | 'pith';
    lineIndex?: number;
    pithSeed?: number;
}

interface RingSlot {
    source: RingsRingSource | null;
    start: number;
    end: number;
}

export interface RingsRuntimeOptions {
    host: HTMLElement;
    song: RingsSongContext;
    tuning: RingsTuning;
    theme: Theme;
    isDaylight: boolean;
    lyricsFontScale: number;
    currentTime: MotionValue<number>;
    /** One audio sample per frame (normalized by the shell). */
    audio: () => RingsAudioSample;
    staticMode: boolean;
    lineIndex: number;
    showText: boolean;
    signal: AbortSignal;
}

export interface RingsPixiRuntime {
    setSong(song: RingsSongContext): void;
    setTuning(tuning: RingsTuning): void;
    setLook(theme: Theme, isDaylight: boolean, lyricsFontScale: number): void;
    setShowText(showText: boolean): void;
    setStaticMode(staticMode: boolean): void;
    setLineIndex(lineIndex: number): void;
    destroy(): void;
}

export const RingsPixiRuntime = {
    create: async (options: RingsRuntimeOptions): Promise<RingsPixiRuntime> => {
        const pixi: PixiModule = await loadPixi();
        if (options.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const { host } = options;
        const app = new pixi.Application();
        await app.init({
            width: Math.max(1, host.clientWidth),
            height: Math.max(1, host.clientHeight),
            backgroundAlpha: 0,
            antialias: false,
            preference: 'webgl',
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            autoStart: false,
            sharedTicker: false,
        });
        if (options.signal.aborted) {
            app.destroy(true, { children: true, texture: true });
            throw new DOMException('Aborted', 'AbortError');
        }
        app.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        host.appendChild(app.canvas);

        // ---- stage geometry and GPU resources (rebuilt on resize) ----
        let width = 1;
        let height = 1;
        let cell = 4;
        let gridWidth = 1;
        let gridHeight = 1;
        let fieldSources: ReturnType<typeof createFieldSource>[] = [];
        // Two strips over song time: growth energy, and seconds to the nearest beat (ring birth).
        const historySource = createHistorySource(pixi);
        const historyData = historySource.resource as Float32Array;
        const beatSource = createHistorySource(pixi);
        const beatData = beatSource.resource as Float32Array;
        beatData.fill(FAR_FROM_BEAT);
        const cellOf = (index: number) => ((index % HISTORY_SIZE) + HISTORY_SIZE) % HISTORY_SIZE;

        const ringSprite = new pixi.Sprite(pixi.Texture.WHITE);
        const textLayer = new pixi.Container();
        app.stage.addChild(ringSprite, textLayer);
        const text = createLyricText(pixi, textLayer);

        let ring: ReturnType<typeof createRippleFilter> | null = null;

        /*
         * Ring sources. A source is what rings grow from: a lyric line
         * `{ key, kind: 'line', lineIndex }` or a pith `{ key, kind: 'pith', pithSeed }`.
         * Each slot holds one source's field and the song-time window it emitted in.
         */
        const slots: RingSlot[] = Array.from({ length: SLOT_COUNT }, () => ({ source: null, start: 1, end: 0 }));
        let openSlot = -1;
        let shownKey: string | null;      // key of the source last switched to (null: none)

        // ---- ring record ----
        const follower = createEnergyFollower();
        const beats = createBeatDetector();
        let lastBeatTime = -Infinity;
        let historyStart = 0;
        let lastSampleIndex: number | null = null;
        let lastTime: number | null = null;
        let lastWall: number | null = null;

        // ---- live inputs ----
        let lines = options.song.lines;
        let seed = options.song.seed;
        let tuning = options.tuning;
        let theme = options.theme;
        let isDaylight = options.isDaylight;
        let lyricsFontScale = options.lyricsFontScale;
        let staticMode = options.staticMode;
        let lineIndex = options.lineIndex;
        let showText = options.showText;

        let hasLyrics = lines.some(line => line.fullText.trim().length > 0);

        const fontOf = (): RingsFont => ({
            family: resolveThemeFontStack(theme),
            weight: resolveThemeFontWeight(theme, 500),
        });

        const layoutFor = (index: number): RingsLineLayout | null => {
            const line = lines[index];
            if (!line || !line.fullText.trim()) return null;
            return layoutLine(line.fullText, fontOf(), width, height, lyricsFontScale);
        };

        const sourceAt = (time: number): RingsRingSource | null => {
            if (!hasLyrics) {
                const period = Math.floor(time / PITH_PERIOD_SEC);
                return {
                    key: `pith:${period}`,
                    kind: 'pith',
                    pithSeed: (hashString(String(seed)) ^ Math.imul(period + 1, 0x9e3779b1)) >>> 0,
                };
            }
            const index = lineIndex;
            if (!lines[index]?.fullText.trim()) return null;
            return { key: `line:${index}`, kind: 'line', lineIndex: index };
        };

        const buildField = (source: RingsRingSource | null): Float32Array | null => {
            if (source?.kind === 'line') {
                const layout = source.lineIndex !== undefined ? layoutFor(source.lineIndex) : null;
                return layout ? buildLineField(layout, cell, gridWidth, gridHeight) : null;
            }
            if (source?.kind === 'pith' && source.pithSeed !== undefined) {
                return buildPithField(source.pithSeed, width, height, cell, gridWidth, gridHeight);
            }
            return null;
        };

        const fillSlotField = (slotIndex: number) => {
            const target = fieldSources[slotIndex];
            const field = buildField(slots[slotIndex].source);
            if (field) target.resource = field;
            else (target.resource as Float32Array).fill(1e6);
            target.update();
        };

        const applyWindows = () => {
            if (!ring) return;
            slots.forEach((slot, index) => {
                // The uniform group also carries scalar entries (uCell...), so a keyed lookup
                // has to go through unknown before narrowing to the vec2 window arrays.
                const range = (ring!.uniforms as unknown as Record<string, Float32Array>)[`uWindow${index}`];
                const used = slot.source !== null && slot.end >= slot.start;
                range[0] = used ? slot.start : UNUSED_WINDOW[0];
                range[1] = used ? slot.end : UNUSED_WINDOW[1];
            });
        };

        const showLineText = (index: number, time: number) => {
            const layout = layoutFor(index);
            const line = lines[index];
            if (layout && line) text.show(line, index, layout, theme, app.renderer.resolution, time);
        };

        // Starts emitting rings from `source` (or stops, for null) at song time `time`.
        const switchSource = (source: RingsRingSource | null, time: number) => {
            shownKey = source?.key ?? null;
            if (openSlot >= 0) {
                slots[openSlot].end = time;
                openSlot = -1;
            }
            text.hide(time);
            if (!source) return;

            // Reuse a free slot, else the one that stopped emitting longest ago.
            let target = slots.findIndex(slot => slot.source === null);
            if (target < 0) {
                target = slots.reduce((oldest, slot, index) => (slot.end < slots[oldest].end ? index : oldest), 0);
            }
            slots[target].source = source;
            // A static preview has no playback: its one source has always been emitting.
            slots[target].start = staticMode ? -1e9 : time;
            slots[target].end = OPEN_WINDOW_END;
            openSlot = target;
            fillSlotField(target);
            if (source.kind === 'line' && source.lineIndex !== undefined && showText) {
                showLineText(source.lineIndex, time);
            }
        };

        // After a seek the old record no longer describes the past: start over at `time`, keeping
        // only the source on screen (re-emitting from now) and fading its text in again.
        const resetRecord = (time: number) => {
            historyData.fill(0);
            historySource.update();
            beatData.fill(FAR_FROM_BEAT);
            beatSource.update();
            historyStart = time;
            lastSampleIndex = Math.floor(time * HISTORY_RATE);
            follower.reset();
            beats.reset();
            lastBeatTime = -Infinity;
            slots.forEach((slot, index) => {
                if (index === openSlot) {
                    slot.start = time;
                } else {
                    slot.source = null;
                    slot.start = UNUSED_WINDOW[0];
                    slot.end = UNUSED_WINDOW[1];
                }
            });
            text.restart(time);
            applyWindows();
            dirty = true;
        };

        // A static preview has no playback to record; give it a plausible past.
        const seedStaticRecord = () => {
            for (let i = 0; i < HISTORY_SIZE; i += 1) {
                historyData[i] = 0.2 + 0.45 * (0.5 + 0.5 * Math.sin(i * 0.13)) * (0.5 + 0.5 * Math.sin(i * 0.031));
                const beatPhase = i / HISTORY_RATE / STATIC_BEAT_SEC;
                beatData[i] = Math.abs(beatPhase - Math.round(beatPhase)) * STATIC_BEAT_SEC;
            }
            historySource.update();
            beatSource.update();
            historyStart = -1e9;
        };

        const rebuildGeometry = () => {
            width = Math.max(1, host.clientWidth);
            height = Math.max(1, host.clientHeight);
            app.renderer.resize(width, height);
            cell = Math.max(2, Math.max(width, height) / TARGET_GRID);
            gridWidth = Math.ceil(width / cell);
            gridHeight = Math.ceil(height / cell);

            const previousFilter = ring?.filter;
            fieldSources.forEach(source => source.destroy());
            fieldSources = Array.from({ length: SLOT_COUNT }, () => createFieldSource(pixi, gridWidth, gridHeight));
            ring = createRippleFilter(pixi, { fieldSources, historySource, beatSource });
            ringSprite.filters = [ring.filter];
            previousFilter?.destroy();
            ringSprite.width = width;
            ringSprite.height = height;
            ring.uniforms.uScreen[0] = width;
            ring.uniforms.uScreen[1] = height;
            ring.uniforms.uCell = cell;

            slots.forEach((_, index) => fillSlotField(index));
            applyWindows();

            const shownIndex = text.lineIndex;
            const layout = shownIndex >= 0 ? layoutFor(shownIndex) : null;
            if (layout && shownIndex >= 0) text.rebuild(lines[shownIndex], layout, theme, app.renderer.resolution);
            dirty = true;
        };

        const applyLook = () => {
            if (!ring) return;
            const halfDiagonal = Math.hypot(width, height) / 2;
            // At speed 1 a ring takes ~10 s to reach the screen edge, where it has faded out.
            ring.uniforms.uSpeed = (halfDiagonal / 10) * tuning.reach;
            ring.uniforms.uFadeDistance = halfDiagonal;
            ring.uniforms.uOpacity = tuning.opacity;
            (ring.uniforms.uColorNear as Float32Array).set(toRgb(theme.accentColor, isDaylight ? '#000' : '#fff'));
            (ring.uniforms.uColorFar as Float32Array).set(toRgb(theme.primaryColor, isDaylight ? '#000' : '#fff'));
        };

        /*
         * Writes every history cell the clock moved past: the growth value, and how
         * long after the last beat it is. A beat then marks itself (0) and tells the
         * cells just before it how far ahead it came, so each ring has both edges.
         */
        const recordAudio = (time: number, wall: number) => {
            const dt = lastTime === null ? 0 : time - lastTime;
            const wallDt = lastWall === null ? 0 : (wall - lastWall) / 1000;
            const jumped = lastTime === null || dt < -1e-3 || Math.abs(dt - wallDt) > SEEK_JUMP_SEC;
            if (jumped) {
                resetRecord(time);
                return;
            }
            const sampleIndex = Math.floor(time * HISTORY_RATE);
            if (lastSampleIndex === null || sampleIndex === lastSampleIndex) return;
            const value = follower.step(options.audio(), tuning.sensitivity, dt);
            // A long stall (or a long pause of rendering) fills at most one full record.
            const first = Math.max(lastSampleIndex + 1, sampleIndex - HISTORY_SIZE + 1);
            for (let index = first; index <= sampleIndex; index += 1) {
                historyData[cellOf(index)] = value;
                beatData[cellOf(index)] = Math.min(FAR_FROM_BEAT, index / HISTORY_RATE - lastBeatTime);
            }
            if (beats.step(options.audio(), time, dt, tuning.beatSensitivity)) {
                lastBeatTime = sampleIndex / HISTORY_RATE;
                const oldest = Math.max(sampleIndex - BEAT_LOOKBACK_SAMPLES, Math.ceil(historyStart * HISTORY_RATE));
                for (let index = sampleIndex; index >= oldest; index -= 1) {
                    const cellIndex = cellOf(index);
                    beatData[cellIndex] = Math.min(beatData[cellIndex], (sampleIndex - index) / HISTORY_RATE);
                }
            }
            lastSampleIndex = sampleIndex;
            historySource.update();
            beatSource.update();
        };

        let dirty = true;
        let frame = 0;
        let renderedTime: number | null = null;

        const tick = () => {
            frame = requestAnimationFrame(tick);
            const time = options.currentTime.get();
            if (!staticMode) {
                const wall = performance.now();
                recordAudio(time, wall);
                lastTime = time;
                lastWall = wall;
            }
            const source = sourceAt(time);
            if ((source?.key ?? null) !== shownKey) {
                switchSource(source, time);
                applyWindows();
                dirty = true;
            }
            // Paused: the clock stands still and nothing needs repainting.
            if (!dirty && time === renderedTime) return;
            const fading = text.update(time, staticMode);
            if (ring) {
                ring.uniforms.uTime = time;
                ring.uniforms.uHistoryStart = historyStart;
            }
            app.render();
            renderedTime = time;
            dirty = fading;
        };

        rebuildGeometry();
        applyLook();
        if (staticMode) seedStaticRecord();

        // Font, glyph colors or font scale need the glyphs redrawn; the rest is uniforms.
        const glyphKey = () => {
            const font = fontOf();
            return `${font.family}|${font.weight}|${theme.primaryColor}|${theme.accentColor}|${lyricsFontScale}`;
        };
        let lastGlyphKey = glyphKey();
        const resizeObserver = new ResizeObserver(() => {
            if (host.clientWidth !== width || host.clientHeight !== height) {
                rebuildGeometry();
                applyLook();
            }
        });
        resizeObserver.observe(host);
        frame = requestAnimationFrame(tick);

        return {
            setSong(song: RingsSongContext) {
                lines = song.lines;
                seed = song.seed;
                hasLyrics = lines.some(line => line.fullText.trim().length > 0);
                const time = options.currentTime.get();
                // A new song invalidates every record the old one left behind — the same
                // picture a mod-host remount produced. Keep the GL context, drop the data.
                slots.forEach((slot) => {
                    slot.source = null;
                    slot.start = UNUSED_WINDOW[0];
                    slot.end = UNUSED_WINDOW[1];
                });
                openSlot = -1;
                shownKey = null;
                text.destroy();
                resetRecord(time);
                dirty = true;
            },

            setTuning(next: RingsTuning) {
                tuning = next;
                applyLook();
                dirty = true;
            },

            setLook(nextTheme: Theme, nextIsDaylight: boolean, nextFontScale: number) {
                theme = nextTheme;
                isDaylight = nextIsDaylight;
                lyricsFontScale = nextFontScale;
                if (glyphKey() !== lastGlyphKey) {
                    lastGlyphKey = glyphKey();
                    rebuildGeometry();
                }
                applyLook();
                dirty = true;
            },

            setShowText(next: boolean) {
                if (next === showText) return;
                showText = next;
                const time = options.currentTime.get();
                if (!next) {
                    text.hide(time);
                } else if (shownKey?.startsWith('line:')) {
                    const index = Number(shownKey.slice('line:'.length));
                    if (lines[index]?.fullText.trim()) showLineText(index, time);
                }
                dirty = true;
            },

            setStaticMode(next: boolean) {
                if (next === staticMode) return;
                staticMode = next;
                const time = options.currentTime.get();
                slots.forEach((slot) => {
                    slot.source = null;
                    slot.start = UNUSED_WINDOW[0];
                    slot.end = UNUSED_WINDOW[1];
                });
                openSlot = -1;
                shownKey = null;
                text.destroy();
                if (staticMode) seedStaticRecord();
                else resetRecord(time);
                dirty = true;
            },

            setLineIndex(next: number) {
                if (next === lineIndex) return;
                lineIndex = next;
                if (!staticMode) return; // playback re-derives the line from the clock every frame
                const time = options.currentTime.get();
                const source = sourceAt(time);
                if ((source?.key ?? null) !== shownKey) {
                    switchSource(source, time);
                    applyWindows();
                }
                dirty = true;
            },

            destroy() {
                cancelAnimationFrame(frame);
                resizeObserver.disconnect();
                text.destroy();
                fieldSources.forEach(source => source.destroy());
                historySource.destroy();
                beatSource.destroy();
                app.destroy(true, { children: true, texture: true });
            },
        };
    },
};
