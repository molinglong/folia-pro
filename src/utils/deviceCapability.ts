// src/utils/deviceCapability.ts
// A cheap, static read of "is this machine likely too weak for the full-fidelity visual experience".
//
// This deliberately does NOT run the tv-probe frame-timing benchmark (see c:/项目/folia/tv-probe):
// that suite needs the page in the foreground and several seconds of WebGL work, which would make
// first launch slower and flakier than the thing it is supposed to help with. Everything here is a
// one-shot read of already-available signals.
//
// Reliability caveat carried over from reading real probe reports: `deviceMemory` and a browser's
// self-reported UA can both be missing or spoofed (privacy extensions rewrite the UA string while
// the underlying engine never reports `deviceMemory` at all). A missing signal is therefore treated
// as "unknown", never as "low-end" — guessing wrong here would only ever show a dismissible
// suggestion (see useGraphicsPresetStore's initGraphicsPresetOnFirstRun), it never writes a switch,
// so a false "unknown" costs one missed hint while a false "low-end" costs one ignorable hint.
// Erring toward "unknown" is the safer side of that trade.

import type { GraphicsPresetId } from '../stores/useGraphicsPresetStore';

/** GPUs known to struggle with the full visualizer stack (per the HD 510-class probe findings). */
// Intel's own driver strings almost always carry the registered mark ("Intel(R) HD Graphics 520"),
// so the pattern has to tolerate it rather than only matching the bare "Intel HD Graphics" form.
const WEAK_RENDERER_PATTERN = /intel(?:\(r\))?\s*(?:hd|uhd)\s*graphics\s*(?:4\d\d|5\d\d|6\d\d)|swiftshader|llvmpipe|software|basic render/i;

/** Reads the unmasked GPU renderer string once, then releases the throwaway context immediately. */
const readGpuRenderer = (): string | null => {
    try {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
        if (!gl) return null;

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo
            ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
            : '';

        // Release right away: holding a second GL context alongside the visualizer's own has been
        // implicated in file-descriptor exhaustion on Linux (docs/linux-glyph-cache-fd-leak.md).
        const loseContext = gl.getExtension('WEBGL_lose_context');
        loseContext?.loseContext();

        return renderer || null;
    } catch {
        return null;
    }
};

/**
 * Suggests a starting tier from static capability signals. Returns `null` when the machine is not
 * recognisable as low- or mid-spec — the caller must treat `null` as "say nothing", not as a tier.
 */
export const detectDeviceTierHint = (): Exclude<GraphicsPresetId, 'custom'> | null => {
    const renderer = readGpuRenderer();
    if (renderer && WEAK_RENDERER_PATTERN.test(renderer)) {
        return 'smooth';
    }

    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    // navigator.deviceMemory is a non-standard, Chromium-only field absent from the DOM lib types.
    const deviceMemory = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
        : undefined;

    const looksLowCores = typeof cores === 'number' && cores <= 2;
    const looksLowMemory = typeof deviceMemory === 'number' && deviceMemory <= 2;

    if (looksLowCores && looksLowMemory) {
        return 'smooth';
    }

    // Software-render fallback with no other signal to go on still means "can't be sure"; only a
    // confirmed weak GPU or a confirmed 2-core/2GB machine earns a suggestion.
    return null;
};
