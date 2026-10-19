import { cubicBezier } from 'framer-motion';
import { loadPixi } from '../../../visualizer/loadPixi';
import { clearMonetMeasurementCaches, type MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetTone } from '../../../visualizer/monet/monetLyricMotion';
import { createLatticeRaster } from './latticeLyricRaster';
import { layoutLatticeLine, resolveLatticeTypography, resolveLatticeLongLineOffset } from './latticeLyricLayout';
import { createLatticeLineView, type LatticeLineView } from './latticeLyricScene';
import { createLatticeEdgeFilter } from './latticeLyricFilters';
import { createLatticeTimeline, stackLatticeContextRows, type LatticeStackRow, stepLatticeSpring } from './latticeLyricTimeline';
import { createLatticeLyricFrameLoop } from './latticeLyricFrameLoop';
import { splitLatticeLinesToRows } from './latticeLyricRowSplit';
import { annotateLineTypes, type LineType } from '../../../../utils/lyrics/lineTypeDetector';
import { resolveLatticeBoost } from './latticeLyricBoost';
import type { LatticeLyricInput, LatticeLyricRuntime } from './types';
import { resolveSingleTrackSubtitleMode } from '../../../../utils/lyrics/alternateText';

// src/components/app/lattice/lyrics/createLatticeLyricRuntime.ts
interface Track { view: LatticeLineView; y: number; vy: number; scale: number; vs: number;
    alpha: number; blur: number; fromAlpha: number; fromBlur: number; elapsed: number;
    alphaTo: number; blurTo: number; hidden: boolean; lastTarget: number;
    status: MonetVisibleLineEntry['status']; offset: number; index: number; leaving: boolean; }
const ease = cubicBezier(0.32, 0.72, 0, 1);
// Softer than the shared Monet springs on purpose: those settle a line in ~0.4s, which on this
// wall reads as the next line lunging out of the queue. These glide the handover instead.
const LATTICE_SCROLL_SPRING = { stiffness: 92, damping: 20, mass: 1 };
const LATTICE_SCALE_SPRING = { stiffness: 96, damping: 20, mass: 1 };
// The anchor box height rewrites itself whenever the active line changes size; rebasing it in
// one frame drags every neighboring line along, so the rebase rides its own extra-slow spring.
const LATTICE_ANCHOR_SPRING = { stiffness: 70, damping: 17, mass: 1 };
const LATTICE_FADE_SECONDS = 0.42, LATTICE_BLUR_FADE_SECONDS = 0.5;
// The visual clock runs slightly ahead of the audio clock, so the handover has largely landed by
// the time the next line is actually sung; glyph sweep and glow stay on real time.
const LATTICE_LEAD_SECONDS = 0.18;
// Context rows only ever show their first row; the active row shows all of them.
const LATTICE_CONTEXT_ROWS = 1;
let initialization: Promise<unknown> = Promise.resolve();

/**
 * Device pixels per CSS pixel the canvas, its filter passes and its glyph textures are rendered at.
 *
 * Tied to the screen rather than fixed at 2: on a 1x display a fixed 2 pushed four times the
 * pixels the screen could show through every blur and edge pass per frame. Always a whole number:
 * the card is composited at camera scale, so a fractional ratio (4K at 125-175%) leaves too little
 * supersampling for that downscale and visibly softens glyph edges. Capped at 2 so a denser screen
 * never costs more than before.
 */
export const latticeLyricResolution = (devicePixelRatio: number) =>
    Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.ceil(devicePixelRatio) : 1));

// Passing boolean `true` makes Pixi release module-global pools shared with the Player renderer.
const destroyApplication = (app: import('pixi.js').Application) => {
    app.destroy({ removeView: true }, { children: true });
};

/** Serializes creation so a canceled async mount cannot temporarily allocate a second WebGL context. */
export function createLatticeLyricRuntime(host: HTMLElement, initial: LatticeLyricInput,
    signal: AbortSignal, onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pending = initialization.then(() => initialize(host, initial, signal, onError));
    initialization = pending.catch(() => undefined);
    return pending;
}

async function initialize(host: HTMLElement, initial: LatticeLyricInput, signal: AbortSignal,
    onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pixi = await loadPixi();
    if (signal.aborted) return null;
    const app = new pixi.Application();
    try { await app.init({ preference: 'webgl', backgroundAlpha: 0, antialias: true,
        width: 1, height: 1, resolution: latticeLyricResolution(window.devicePixelRatio), autoDensity: true, autoStart: false, sharedTicker: false }); }
    catch (error) {
        if (app.renderer) destroyApplication(app);
        else { app.ticker?.destroy(); app.stage.destroy({ children: true }); }
        throw error;
    }
    if (signal.aborted) { destroyApplication(app); return null; }
    try { return attachRuntime(pixi, app, host, initial, onError); }
    catch (error) { destroyApplication(app); throw error; }
}

/** Attaches a successfully initialized renderer; failures above this boundary release the WebGL context. */
function attachRuntime(pixi: typeof import('pixi.js'), app: import('pixi.js').Application, host: HTMLElement,
    initial: LatticeLyricInput, onError: (error: unknown) => void): LatticeLyricRuntime {
    const raster = createLatticeRaster(pixi);
    let input = initial, width = 1, height = 1, resolution = app.renderer.resolution, destroyed = false;
    let reportError = onError;
    let typography = resolveLatticeTypography(input, width, height, raster.measure);
    const stage = new pixi.Container(); stage.sortableChildren = true; app.stage.addChild(stage);
    const edge = createLatticeEdgeFilter(pixi, resolution); stage.filters = [edge.filter];
    host.appendChild(app.canvas); app.canvas.setAttribute('aria-hidden', 'true');
    let timeline = createLatticeTimeline(input.lines), lastTime = input.currentTime.get();
    // 段类型（副歌/说唱/普通）决定提亮基座，只在换歌/换词表/换尺寸时重算一遍。
    let lineTypes: LineType[] = annotateLineTypes(input.lines);
    // 一句只占一行：源句超出当前容量就就地切段，唱不完的那截不算"第二行"而是"下一句"，
    // 到它那几个字真正起唱的时刻才上场。宽度、字号、词表任一变动都要重切，所以跟着 rebuild 走。
    // 切段与排版必须共用同一个容量，否则切完还是会折行，这两处一旦飘开功能就静悄悄失效。
    const lyricCapacity = () => Math.max(1, width - typography.padding * 2);
    const rebuildRows = () => {
        const rows = width >= 2 ? splitLatticeLinesToRows(input.lines, lyricCapacity(), typography.font, raster.measure) : input.lines;
        timeline = createLatticeTimeline(rows);
        lineTypes = annotateLineTypes(rows);
    };
    let lastEntries: MonetVisibleLineEntry[] | null = null;
    const tracks = new Map<string, Track>();
    let anchorHeight = 0, anchorVelocity = 0, anchorSnap = true;
    const clear = () => {
        tracks.forEach(track => track.view.destroy()); tracks.clear(); lastEntries = null; anchorSnap = true;
    };
    const refreshEntries = (entries: MonetVisibleLineEntry[]) => {
        for (const track of tracks.values()) {
            track.leaving = true; track.fromAlpha = track.alpha; track.fromBlur = track.blur; track.elapsed = 0;
        }
        for (const entry of entries) {
            let track = tracks.get(entry.key);
            if (!track) {
                // Lattice draws the translation row inside its own lyric scene, not the shared bottom subtitle, so it
                // cannot stack two rows yet: the 'both' option falls back to translation only (phase 2 will add a track).
                const layout = layoutLatticeLine(entry.line, typography, lyricCapacity(), raster.measure,
                    resolveSingleTrackSubtitleMode(input.subtitleContentMode ?? 'translation') === 'romanization');
                const view = createLatticeLineView(pixi, raster, stage, entry, layout, typography, input, resolution);
                track = { view, y: height * 0.46 + (entry.offset >= 0 ? 34 : -34), vy: 0, scale: 0.7, vs: 0,
                    alpha: 0, blur: 5, fromAlpha: 0, fromBlur: 5, elapsed: 0, alphaTo: 0, blurTo: 5,
                    hidden: false, lastTarget: height * 0.46 + (entry.offset >= 0 ? 34 : -34),
                    status: entry.status, offset: entry.offset, index: entry.index, leaving: false };
                tracks.set(entry.key, track);
            }
            track.status = entry.status; track.offset = entry.offset; track.index = entry.index; track.leaving = false;
        }
        // Rapid seeks must not accumulate fading copies of every visited line.
        for (const [key, track] of tracks) if (track.leaving && tracks.size > 10) { track.view.destroy(); tracks.delete(key); }
    };
    const draw = (delta: number) => {
        try {
            if (destroyed || width < 2 || height < 2) return false;
            const time = input.currentTime.get(), quiet = Boolean(input.reducedMotion || input.staticMode);
            // 高潮/重音提亮：每帧读一次能量，各轨按自己的段类型换算倍数；静默档（减少动效/静态）不跟拍。
            const power = input.audioPower?.get() ?? 0;
            if (time < lastTime || Math.abs(time - lastTime) > 0.75) clear();
            lastTime = time;
            const entries = timeline(quiet ? time : time + LATTICE_LEAD_SECONDS);
            if (entries !== lastEntries) { refreshEntries(entries); lastEntries = entries; }
            const anchor = entries.find(e => e.offset === 0);
            const anchorTrack = anchor ? tracks.get(anchor.key) : undefined;
            const room = Math.max(typography.lineHeight, height - typography.padding * 2);
            const rawHeight = anchorTrack ? Math.min(room, anchorTrack.status === 'active' ? anchorTrack.view.layout.height
                : Math.min(anchorTrack.view.layout.textHeight, typography.lineHeight * LATTICE_CONTEXT_ROWS) * resolveMonetTone(anchorTrack.status, 0).scale) : 0;
            let moving = false;
            if (quiet || anchorSnap) { anchorHeight = rawHeight; anchorVelocity = 0; anchorSnap = false; }
            else {
                const sh = stepLatticeSpring(anchorHeight, anchorVelocity, rawHeight, delta, LATTICE_ANCHOR_SPRING);
                anchorHeight = sh.value; anchorVelocity = sh.velocity; moving ||= !quiet && !sh.settled;
            }
            const anchorY = Math.max(typography.padding, height * 0.46 - anchorHeight / 2);
            // Stack every context row outward from the anchor and let capacity decide visibility:
            // rows that no longer fit fade out, so compact verses show more context than wrapped ones.
            const activeGap = Math.max(18, typography.fontPx * 0.49);
            const contextGap = Math.max(14, typography.fontPx * 0.38);
            const before: LatticeStackRow[] = [], after: LatticeStackRow[] = [];
            for (const entry of entries) {
                if (entry.offset === 0) continue;
                const track = tracks.get(entry.key);
                if (!track || track.leaving) continue;
                const row: LatticeStackRow = { key: entry.key,
                    height: Math.min(track.view.layout.textHeight, typography.lineHeight * LATTICE_CONTEXT_ROWS),
                    scale: resolveMonetTone(entry.status, entry.offset).scale };
                if (entry.offset < 0) before.push(row); else after.push(row);
            }
            before.sort((a, b) => tracks.get(b.key)!.offset - tracks.get(a.key)!.offset);
            after.sort((a, b) => tracks.get(a.key)!.offset - tracks.get(b.key)!.offset);
            const slots = stackLatticeContextRows({ anchorY, anchorHeight, top: typography.padding,
                bottom: height - typography.padding, activeGap, contextGap, before, after });
            for (const [key, track] of tracks) {
                const tone = resolveMonetTone(track.status, track.offset);
                let targetY = track.lastTarget;
                if (track.offset === 0) {
                    targetY = anchorY;
                    if (track.status === 'active' && !track.leaving) targetY -= resolveLatticeLongLineOffset(track.view.layout, time, room, typography.lineHeight);
                    track.hidden = false;
                } else {
                    const slot = slots.get(key);
                    if (slot && !track.leaving) { targetY = slot.y; track.hidden = slot.hidden; }
                }
                if (track.leaving) targetY = track.lastTarget + (track.offset < 0 || track.status === 'passed' ? -38 : 38);
                track.lastTarget = targetY;
                const sy = stepLatticeSpring(track.y, track.vy, targetY, delta, LATTICE_SCROLL_SPRING);
                const ss = stepLatticeSpring(track.scale, track.vs, tone.scale, delta, LATTICE_SCALE_SPRING);
                track.y = quiet ? targetY : sy.value; track.vy = quiet ? 0 : sy.velocity;
                track.scale = quiet ? tone.scale : ss.value; track.vs = quiet ? 0 : ss.velocity;
                track.elapsed += delta;
                const targetAlpha = track.leaving || track.hidden ? 0 : tone.alpha;
                const targetBlur = tone.blur;
                // A mid-transition target change (capacity flipped, status moved) restarts the fade
                // from where the track actually is, so nothing ever snaps to the new curve.
                if (targetAlpha !== track.alphaTo || targetBlur !== track.blurTo) {
                    track.alphaTo = targetAlpha; track.blurTo = targetBlur;
                    track.fromAlpha = track.alpha; track.fromBlur = track.blur; track.elapsed = 0;
                }
                const fade = quiet ? 1 : ease(Math.min(1, track.elapsed / LATTICE_FADE_SECONDS));
                const blurFade = quiet ? 1 : ease(Math.min(1, track.elapsed / LATTICE_BLUR_FADE_SECONDS));
                track.alpha = track.fromAlpha + (targetAlpha - track.fromAlpha) * fade;
                track.blur = track.fromBlur + (targetBlur - track.fromBlur) * blurFade;
                if (track.leaving && fade === 1) { track.view.destroy(); tracks.delete(key); continue; }
                moving ||= !quiet && (!sy.settled || !ss.settled || track.elapsed < LATTICE_BLUR_FADE_SECONDS + 0.02);
                track.view.container.visible = track.alpha > 0.004;
                track.view.container.position.set(typography.padding, track.y);
                track.view.container.scale.set(track.scale); track.view.container.alpha = track.alpha;
                track.view.container.zIndex = track.status === 'active' ? 4 : track.status === 'waiting' ? 2 : 1;
                track.view.blur.strength = quiet ? 0 : track.blur;
                track.view.blur.enabled = !quiet && track.blur > 0.05;
                // Hidden rows keep their spring target (so they land in place when capacity returns)
                // but skip per-piece content work while invisible.
                if (track.view.container.visible) track.view.update(time, track.status, tone.baseAlpha, height, track.y, track.scale, quiet,
                    quiet ? 1 : resolveLatticeBoost(power, lineTypes[track.index] ?? 'normal'));
            }
            app.render();
            return moving;
        } catch (error) { reportError(error); return false; }
    };
    const loop = createLatticeLyricFrameLoop(draw);
    let unsubscribe = input.currentTime.on('change', loop.wake);
    const runtime: LatticeLyricRuntime = {
        attach(nextHost) {
            if (!destroyed && app.canvas.parentElement !== nextHost) nextHost.appendChild(app.canvas);
        },
        setErrorHandler(handler) { reportError = handler; },
        update(next) {
            if (destroyed) return;
            const rebuild = next.songKey !== input.songKey || next.lines !== input.lines || next.theme !== input.theme
                || next.subtitleTheme !== input.subtitleTheme || next.fontsEpoch !== input.fontsEpoch
                || next.keywordColoringEnabled !== input.keywordColoringEnabled || next.showSubtitleTranslation !== input.showSubtitleTranslation
                || next.hideTranslationSubtitle !== input.hideTranslationSubtitle || next.subtitleContentMode !== input.subtitleContentMode;
            if (next.currentTime !== input.currentTime) { unsubscribe(); unsubscribe = next.currentTime.on('change', loop.wake); }
            if (next.fontsEpoch !== input.fontsEpoch) { clearMonetMeasurementCaches(); raster.clearMeasureCache(); }
            input = next;
            if (rebuild) { clear(); typography = resolveLatticeTypography(input, width, height, raster.measure); rebuildRows(); }
            loop.wake();
        },
        resize(w, h, devicePixelRatio) {
            const nextResolution = latticeLyricResolution(devicePixelRatio);
            if (destroyed || (w === width && h === height && nextResolution === resolution)) return;
            width = w; height = h; resolution = nextResolution;
            app.renderer.resize(Math.max(1, width), Math.max(1, height), resolution);
            edge.filter.resolution = resolution;
            stage.filterArea = new pixi.Rectangle(0, 0, width, height);
            typography = resolveLatticeTypography(input, width, height, raster.measure);
            rebuildRows();
            clear(); loop.wake();
        },
        setVisible(visible) { loop.setVisible(visible); },
        destroy() {
            if (destroyed) return;
            destroyed = true; unsubscribe(); loop.destroy(); clear(); edge.filter.destroy(); destroyApplication(app);
        },
    };
    return runtime;
}
