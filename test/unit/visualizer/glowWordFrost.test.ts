import { describe, expect, it } from 'vitest';
import { buildWordFrostMaskUrl, resolveClassicMvFrostActive } from '../../../src/components/visualizer/glowWordFrost';

// test/unit/visualizer/glowWordFrost.test.ts
// MV 毛玻璃变体的纯函数层：激活判定四象限 + mask 生成的环境兜底与缓存幂等。
// jsdom 没有 2d canvas 实现，这里重点防"运行时炸"：有 canvas 时必须出有效 dataURL，
// 无 canvas 时必须干净地退回 null，两条路都不得抛异常。

describe('resolveClassicMvFrostActive', () => {
    it('activates only when the background mode is mv and a stream url exists', () => {
        expect(resolveClassicMvFrostActive('mv', 'https://mv.test/stream.mp4')).toBe(true);
        expect(resolveClassicMvFrostActive('mv', null)).toBe(false);
        expect(resolveClassicMvFrostActive('mv', '')).toBe(false);
        expect(resolveClassicMvFrostActive('common', 'https://mv.test/stream.mp4')).toBe(false);
        expect(resolveClassicMvFrostActive(null, 'https://mv.test/stream.mp4')).toBe(false);
        expect(resolveClassicMvFrostActive(undefined, null)).toBe(false);
    });
});

describe('buildWordFrostMaskUrl', () => {
    it('returns a valid data url or a clean null without throwing', () => {
        const url = buildWordFrostMaskUrl('雾', 36, '"Segoe UI", sans-serif', 700);
        expect(url === null || url.startsWith('data:image/')).toBe(true);
    });

    it('is idempotent for repeated calls with the same inputs', () => {
        const first = buildWordFrostMaskUrl('星河', 36, 'monospace', 700);
        const second = buildWordFrostMaskUrl('星河', 36, 'monospace', 700);
        expect(second).toBe(first);
    });

    it('keeps different sizes in separate cache slots', () => {
        const small = buildWordFrostMaskUrl('风', 24, 'monospace', 700);
        const large = buildWordFrostMaskUrl('风', 48, 'monospace', 700);
        // 无 canvas 时两者都为 null；有 canvas 时都是独立生成的 dataURL。
        expect(small === null || small.startsWith('data:image/')).toBe(true);
        expect(large === null || large.startsWith('data:image/')).toBe(true);
        expect(buildWordFrostMaskUrl('风', 48, 'monospace', 700)).toBe(large);
    });
});
