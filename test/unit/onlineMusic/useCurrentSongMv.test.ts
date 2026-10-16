import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/onlineMusic/useCurrentSongMv.test.ts
// The hook is the video layer's MV gate: cache hits within the TTL must not re-call the provider,
// a slow response for an old song must not paint after the user moved on, and every dead end
// (local song, no capability, empty url, failed lookup) collapses to null.
// The repo's vitest runs on node with no jsdom and no testing-library, so this reuses the minimal
// React runtime pattern from useNeteaseScrobbleReporter.test.ts with a hand-rolled render loop.

const runtime = vi.hoisted(() => ({
    stateSlots: [] as { value: unknown }[],
    stateCursor: 0,
    refSlots: [] as { current: any }[],
    refCursor: 0,
    effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', () => ({
    useRef: (initial: unknown) => {
        const index = runtime.refCursor++;
        runtime.refSlots[index] ??= { current: initial };
        return runtime.refSlots[index];
    },
    useState: (initial: unknown) => {
        const index = runtime.stateCursor++;
        runtime.stateSlots[index] ??= { value: initial };
        const slot = runtime.stateSlots[index];
        return [slot.value, (next: unknown) => { slot.value = next; }];
    },
    useEffect: (effect: () => void | (() => void)) => { runtime.effects.push(effect); },
}));

const registry = vi.hoisted(() => ({
    provider: null as null | { mv?: { getMvUrl: (song: SongResult) => Promise<{ url: string; quality?: number } | null> } },
    getMvUrl: vi.fn(),
}));
vi.mock('@/services/onlineMusic/providerRegistry', () => ({
    getOnlineMusicProviderForSong: () => registry.provider,
}));

const { useCurrentSongMvUrl } = await import('@/services/onlineMusic/useCurrentSongMv');

const onlineSong = (mediaId: string): SongResult => ({
    id: mediaId,
    name: 'Song',
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId },
} as SongResult);

const localSong = { sourceRef: { kind: 'local', mediaId: 'file-1' } } as unknown as SongResult;

// Minimal render loop: run pending cleanups, then the hook, then its effects in order.
const cleanups: Array<() => void> = [];
const renderOnce = (song: SongResult | null): string | null => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    runtime.stateCursor = 0;
    runtime.refCursor = 0;
    runtime.effects.splice(0);
    const value = useCurrentSongMvUrl(song);
    for (const effect of runtime.effects.splice(0)) {
        const maybeCleanup = effect();
        if (typeof maybeCleanup === 'function') cleanups.push(maybeCleanup);
    }
    return value;
};

const flushMicrotasks = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
};

const resetInstanceState = () => {
    runtime.stateSlots.splice(0);
    runtime.refSlots.splice(0);
    cleanups.splice(0);
};

// The URL cache is module-level and cannot be cleared from tests; advancing the fake clock past
// the TTL before every case makes anything a previous case wrote stale.
let testClockMs = 0;

describe('useCurrentSongMvUrl', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        testClockMs += 10 * 60 * 1000;
        vi.setSystemTime(testClockMs);
        resetInstanceState();
        registry.provider = null;
        registry.getMvUrl.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null for a song without an online source', async () => {
        renderOnce(localSong);
        await flushMicrotasks();
        expect(renderOnce(localSong)).toBeNull();
        expect(registry.getMvUrl).not.toHaveBeenCalled();
    });

    it('returns null when the provider has no mv capability', async () => {
        registry.provider = {};
        const song = onlineSong('30953009');
        renderOnce(song);
        await flushMicrotasks();
        expect(renderOnce(song)).toBeNull();
        expect(registry.getMvUrl).not.toHaveBeenCalled();
    });

    it('resolves the mv url and serves a remount from the cache', async () => {
        registry.provider = { mv: { getMvUrl: registry.getMvUrl } };
        registry.getMvUrl.mockResolvedValue({ url: 'https://mv.test/stream.mp4', quality: 1080 });
        const song = onlineSong('30953009');

        renderOnce(song);
        await flushMicrotasks();

        expect(registry.getMvUrl).toHaveBeenCalledTimes(1);
        expect(renderOnce(song)).toBe('https://mv.test/stream.mp4');
        expect(registry.getMvUrl).toHaveBeenCalledTimes(1);

        // A fresh mount (state slots reset) reads the warm cache instead of re-requesting.
        resetInstanceState();
        expect(renderOnce(song)).toBe('https://mv.test/stream.mp4');
        expect(registry.getMvUrl).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after the cache TTL expires', async () => {
        registry.provider = { mv: { getMvUrl: registry.getMvUrl } };
        registry.getMvUrl.mockResolvedValue({ url: 'https://mv.test/stream.mp4' });
        const song = onlineSong('30953009');
        renderOnce(song);
        await flushMicrotasks();
        expect(registry.getMvUrl).toHaveBeenCalledTimes(1);

        vi.setSystemTime(testClockMs + 6 * 60 * 1000); // past the 5-minute TTL
        resetInstanceState();
        renderOnce(song);
        await flushMicrotasks();
        expect(registry.getMvUrl).toHaveBeenCalledTimes(2);
    });

    it('ignores a stale response after the song changed', async () => {
        registry.provider = { mv: { getMvUrl: registry.getMvUrl } };
        let resolveA!: (value: { url: string } | null) => void;
        let resolveB!: (value: { url: string } | null) => void;
        registry.getMvUrl
            .mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
            .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));

        const songA = onlineSong('1001');
        const songB = onlineSong('1002');

        renderOnce(songA); // request A pending
        renderOnce(songB); // cleanup cancels A, request B starts
        resolveA({ url: 'https://mv.test/a.mp4' });
        await flushMicrotasks(); // A resolves late and must be dropped
        resolveB({ url: 'https://mv.test/b.mp4' });
        await flushMicrotasks();

        expect(renderOnce(songB)).toBe('https://mv.test/b.mp4');
        // The dropped song never poisoned the cache; switching back re-requests it.
        resetInstanceState();
        renderOnce(songA);
        await flushMicrotasks();
        expect(registry.getMvUrl).toHaveBeenCalledTimes(3);
    });

    it('collapses an empty stream to null', async () => {
        registry.provider = { mv: { getMvUrl: registry.getMvUrl } };
        registry.getMvUrl.mockResolvedValue({ url: '' });
        const song = onlineSong('30953009');
        renderOnce(song);
        await flushMicrotasks();
        expect(renderOnce(song)).toBeNull();
    });

    it('survives a failed lookup', async () => {
        registry.provider = { mv: { getMvUrl: registry.getMvUrl } };
        registry.getMvUrl.mockRejectedValue(new Error('offline'));
        const song = onlineSong('30953009');
        renderOnce(song);
        await flushMicrotasks();
        expect(renderOnce(song)).toBeNull();
    });
});
