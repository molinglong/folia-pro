import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clampMvIntroOffset,
    resolveMvAlignedSeekTarget,
    useMvIntroOffsetStore,
} from '@/stores/useMvIntroOffsetStore';

// test/unit/stores/mvIntroOffsetStore.test.ts
// 每首歌自己的 MV 片头跳过表：夹取、落盘、超长让位循环的判定。
// 改动欠账登记：新键 mv_intro_offsets 已按字母序写进 storeContract 快照。

describe('mv intro offset store', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useMvIntroOffsetStore.setState({ offsets: {} });
    });

    afterEach(() => {
        useMvIntroOffsetStore.setState({ offsets: {} });
        vi.unstubAllGlobals();
    });

    it('clamps to whole seconds inside the bounds', () => {
        expect(clampMvIntroOffset(4.4)).toBe(4);
        expect(clampMvIntroOffset(4.6)).toBe(5);
        expect(clampMvIntroOffset(-3)).toBe(0);
        expect(clampMvIntroOffset(999)).toBe(30);
        expect(clampMvIntroOffset(NaN)).toBe(0);
    });

    it('writes the table and drops songs whose offset returns to 0', () => {
        useMvIntroOffsetStore.getState().setOffset('online:netease:1', 5);
        expect(JSON.parse(values.get('mv_intro_offsets')!.toString())).toEqual({ 'online:netease:1': 5 });

        useMvIntroOffsetStore.getState().setOffset('online:netease:2', 8);
        useMvIntroOffsetStore.getState().setOffset('online:netease:1', 0);
        expect(JSON.parse(values.get('mv_intro_offsets')!.toString())).toEqual({ 'online:netease:2': 8 });
    });

    it('starts empty when the stored blob is broken', async () => {
        values.set('mv_intro_offsets', '{not json');
        vi.resetModules();
        const fresh = await import('@/stores/useMvIntroOffsetStore');
        expect(fresh.useMvIntroOffsetStore.getState().offsets).toEqual({});
    });

    it('aligns the seek target with the offset, and defers to the loop past the end', () => {
        expect(resolveMvAlignedSeekTarget(100, 5, 300)).toBe(105);
        // 长度未知（metadata 未就绪）时按原样放行。
        expect(resolveMvAlignedSeekTarget(100, 5, NaN)).toBe(105);
        // MV 比歌曲位置短：null 表示"别追了，让视频自己循环"。
        expect(resolveMvAlignedSeekTarget(298, 5, 300)).toBeNull();
        expect(resolveMvAlignedSeekTarget(-1, 0, 300)).toBe(0);
    });
});
