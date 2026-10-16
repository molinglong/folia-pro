import { describe, expect, it } from 'vitest';
import { stackLatticeContextRows, type LatticeStackRow } from '../../../src/components/app/lattice/lyrics/latticeLyricTimeline';

// test/unit/lattice/latticeLyricStack.test.ts
const row = (key: string, height = 30, scale = 1): LatticeStackRow => ({ key, height, scale });
const base = { anchorY: 100, anchorHeight: 60, top: 10, bottom: 400, activeGap: 20, contextGap: 14 };

describe('stackLatticeContextRows', () => {
    it('stacks queued rows one at a time outward below the anchor', () => {
        const targets = stackLatticeContextRows({ ...base, before: [], after: [row('a'), row('b'), row('c')] });
        expect(targets.get('a')).toEqual({ y: 180, hidden: false });
        expect(targets.get('b')).toEqual({ y: 224, hidden: false });
        expect(targets.get('c')).toEqual({ y: 268, hidden: false });
    });
    it('stacks passed rows upward from the anchor with the same cumulative gaps', () => {
        const targets = stackLatticeContextRows({ ...base, before: [row('x'), row('y')], after: [] });
        expect(targets.get('x')).toEqual({ y: 50, hidden: false });
        expect(targets.get('y')).toEqual({ y: 6, hidden: true });
    });
    it('scales each row height before stacking', () => {
        const targets = stackLatticeContextRows({ ...base, before: [], after: [row('a', 40, 0.72)] });
        expect(targets.get('a')).toEqual({ y: 180, hidden: false });
        // The next slot starts after the scaled height of the row above, not its unscaled layout.
        const two = stackLatticeContextRows({ ...base, before: [], after: [row('a', 40, 0.72), row('b', 40, 0.68)] });
        expect(two.get('b')!.y).toBeCloseTo(180 + 40 * 0.72 + 14, 6);
    });
    it('flags only rows that spill past the bounds, keeping the exact-fit edge visible', () => {
        const exact = stackLatticeContextRows({ ...base, bottom: 210, before: [], after: [row('a')] });
        expect(exact.get('a')).toEqual({ y: 180, hidden: false });
        const spilled = stackLatticeContextRows({ ...base, before: [], after: [row('a', 100), row('b', 100), row('c', 100)] });
        expect(spilled.get('a')!.hidden).toBe(false);
        expect(spilled.get('b')!.hidden).toBe(false);
        expect(spilled.get('c')!.hidden).toBe(true);
    });
    it('lets capacity decide the visible count: compact lines show more context than wrapped ones', () => {
        const wide = { anchorY: 150, anchorHeight: 30, top: 10, bottom: 330, activeGap: 18, contextGap: 14 };
        // Compact CJK-style rows: one measured row each.
        const compact = stackLatticeContextRows({ ...wide, before: [], after: [row('1', 30, 0.72), row('2', 30, 0.648), row('3', 30, 0.583)] });
        expect([...compact.values()].every(t => !t.hidden)).toBe(true);
        // English-style rows: the same window but each line wraps to two measured rows.
        const wrapped = stackLatticeContextRows({ ...wide, before: [], after: [row('1', 60, 0.72), row('2', 60, 0.648), row('3', 60, 0.583)] });
        expect(wrapped.get('1')!.hidden).toBe(false);
        expect(wrapped.get('2')!.hidden).toBe(false);
        expect(wrapped.get('3')!.hidden).toBe(true);
    });
});
