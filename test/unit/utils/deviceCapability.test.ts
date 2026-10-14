import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDeviceTierHint } from '@/utils/deviceCapability';

// test/unit/utils/deviceCapability.test.ts
// The hint drives a one-time, dismissible toast only — it never writes a setting — but the
// "missing signal" branch still matters: treating an absent `deviceMemory` (which a non-Chromium
// engine never reports at all, see the probe notes carried into src/utils/deviceCapability.ts) as
// "low-end" would suggest 流畅优先 to perfectly capable machines, and the whole point of keeping
// detection read-only is that a wrong guess should cost nothing. It shouldn't cost a wrong guess
// either, so "unknown" has to stay `null`, not fall through to a tier.

type FakeGl = {
    getParameter: (p: number) => unknown;
    getExtension: (name: string) => unknown;
};

const stubGpu = (renderer: string | null, loseContext = vi.fn()) => {
    const gl: FakeGl = {
        getParameter: (p: number) => (p === 0x9246 ? renderer : null),
        getExtension: (name: string) => {
            if (name === 'WEBGL_debug_renderer_info') return renderer === null ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
            if (name === 'WEBGL_lose_context') return { loseContext };
            return null;
        },
    };
    vi.stubGlobal('document', {
        createElement: () => ({ getContext: (kind: string) => (kind === 'webgl' ? gl : null) }),
    });
    return loseContext;
};

const stubNavigator = (hardwareConcurrency?: number, deviceMemory?: number) => {
    vi.stubGlobal('navigator', { hardwareConcurrency, deviceMemory });
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('detectDeviceTierHint', () => {
    it('suggests smooth for a known weak integrated GPU even when the CPU looks fine', () => {
        stubGpu('Intel(R) HD Graphics 520 (Sky Lake)');
        stubNavigator(8, 8);
        expect(detectDeviceTierHint()).toBe('smooth');
    });

    it('suggests smooth for a software rasteriser', () => {
        stubGpu('ANGLE (SwiftShader Low-Latency D3D11)');
        stubNavigator(16, 32);
        expect(detectDeviceTierHint()).toBe('smooth');
    });

    it('releases the throwaway GL context instead of leaving it open', () => {
        const loseContext = stubGpu('GeForce RTX 4090');
        stubNavigator(16, 32);
        detectDeviceTierHint();
        expect(loseContext).toHaveBeenCalledTimes(1);
    });

    it('suggests smooth for a confirmed 2-core / 2GB machine with no usable GPU signal', () => {
        stubGpu(null);
        stubNavigator(2, 2);
        expect(detectDeviceTierHint()).toBe('smooth');
    });

    // The regression this file exists to guard: deviceMemory is Chromium-only and silently absent
    // everywhere else. Absent must read as "not enough to go on", never as "must be low-end".
    it('says nothing when deviceMemory is missing, even on a low core count', () => {
        stubGpu(null);
        stubNavigator(2, undefined);
        expect(detectDeviceTierHint()).toBe(null);
    });

    it('says nothing for a healthy machine', () => {
        stubGpu('NVIDIA GeForce RTX 4080');
        stubNavigator(12, 16);
        expect(detectDeviceTierHint()).toBe(null);
    });

    it('says nothing when there is no canvas to probe and no core/memory signal to fall back on', () => {
        // No `document`, no `navigator` stubbed at all — this is the bare node environment the
        // util is expected to survive without throwing.
        expect(detectDeviceTierHint()).toBe(null);
    });

    it('says nothing when getContext returns a null WebGL context', () => {
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
        stubNavigator(2, 2);
        // A null context is not a weak GPU read; it's just an unavailable read, so the core/memory
        // fallback still gets its chance.
        expect(detectDeviceTierHint()).toBe('smooth');
    });
});
