import { describe, expect, it } from 'vitest';
import { LATTICE_BOOST_PRESETS, resolveLatticeBoost, scaleColor01 } from '../../../src/components/app/lattice/lyrics/latticeLyricBoost';

// test/unit/lattice/latticeLyricBoost.test.ts
describe('Lattice chorus/loud brightness gain', () => {
    it('rises with audio power and stays capped per line type', () => {
        expect(resolveLatticeBoost(0, 'normal')).toBeCloseTo(LATTICE_BOOST_PRESETS.normal.base);
        expect(resolveLatticeBoost(0, 'chorus')).toBeCloseTo(LATTICE_BOOST_PRESETS.chorus.base);
        // 副歌基座应高于普通行唱满的亮度，保证一进副歌就看得出落差。
        expect(resolveLatticeBoost(0, 'chorus')).toBeGreaterThan(resolveLatticeBoost(255, 'normal'));
        expect(resolveLatticeBoost(8, 'chorus')).toBeLessThan(resolveLatticeBoost(64, 'chorus'));
        // 唱满只走到"基座 + 权重"，封顶是给更激进的档位留的余量（此处 1.85 < 2.00）。
        expect(resolveLatticeBoost(255, 'chorus')).toBeCloseTo(LATTICE_BOOST_PRESETS.chorus.base + LATTICE_BOOST_PRESETS.chorus.weight);
        expect(resolveLatticeBoost(255, 'chorus')).toBeLessThan(LATTICE_BOOST_PRESETS.chorus.cap);
        expect(resolveLatticeBoost(255, 'rap')).toBeLessThan(resolveLatticeBoost(255, 'chorus'));
    });
    it('treats missing, negative and oversized readings as silence or full scale', () => {
        for (const power of [NaN, -20, 1000]) {
            expect(resolveLatticeBoost(power, 'normal')).toBeLessThanOrEqual(LATTICE_BOOST_PRESETS.normal.cap);
            expect(resolveLatticeBoost(power, 'normal')).toBeGreaterThanOrEqual(LATTICE_BOOST_PRESETS.normal.base);
        }
        expect(resolveLatticeBoost(1000, 'chorus')).toBe(resolveLatticeBoost(255, 'chorus'));
    });
});

describe('per-channel scaling of the 0..1 uniform color', () => {
    it('clamps each channel instead of overflowing and keeps alpha alone', () => {
        const out: number[] = [];
        expect(scaleColor01([0.5, 0.8, 0.2, 0.68], 2, out)).toEqual([1, 1, 0.4, 0.68]);
        expect(scaleColor01([0.1, 0.2, 0.3, 1], 1, out)).toEqual([0.1, 0.2, 0.3, 1]);
    });
    it('never compounds when the same scratch array is reused', () => {
        const source = [0.4, 0.5, 0.6, 1];
        const scratch = [...source];
        scaleColor01(source, 1.5, scratch);
        const first = [...scratch];
        scaleColor01(source, 1.5, scratch);
        expect(scratch).toEqual(first);
        expect(source).toEqual([0.4, 0.5, 0.6, 1]);
    });
});
