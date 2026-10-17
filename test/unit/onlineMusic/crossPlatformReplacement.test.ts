import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import {
    findCrossPlatformCandidates,
    invalidateCrossReplacementCache,
} from '@/services/onlineMusic/crossPlatformReplacement';

// test/unit/onlineMusic/crossPlatformReplacement.test.ts

const h = vi.hoisted(() => ({
    providers: [] as unknown[],
    accounts: {} as Record<string, { status?: string; user?: unknown }>,
    qqSession: true,
}));

vi.mock('@/services/onlineMusic/providerRegistry', () => ({
    listOnlineMusicProviders: () => h.providers,
}));
vi.mock('@/services/onlineMusic/qqTransport', () => ({
    hasQqSession: () => h.qqSession,
}));
vi.mock('@/stores/useOnlineProviderAccountStore', () => ({
    useOnlineProviderAccountStore: { getState: () => ({ accounts: h.accounts }) },
}));
vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: { __meta: unknown }) => song.__meta,
}));

let mediaCounter = 0;

/** Songs carry their provider metadata in __meta here; the service's getProviderSongMetadata is
 *  mocked to read exactly that, which keeps the scoring tests free of the whole provider stack. */
const makeSong = (
    providerId: string,
    mediaId: string,
    name: string,
    artistNames: string[],
    durationMs: number,
): SongResult => ({
    id: `${providerId}-${mediaId}-${(mediaCounter += 1)}`,
    name,
    artists: artistNames.map((artistName, index) => ({ id: index + 1, name: artistName })),
    album: { id: 1, name: 'Album' },
    durationMs,
    sourceRef: { kind: 'online', providerId, mediaId } as SongResult['sourceRef'],
    __meta: {
        artists: artistNames.map((artistName, index) => ({ id: index + 1, name: artistName })),
        album: { id: 1, name: 'Album' },
        durationMs,
        aliases: [],
        translatedNames: [],
    },
} as unknown as SongResult);

interface ProviderMock {
    id: string;
    shortName: string;
    displayName: string;
    capabilities: { search: boolean; auth: boolean };
    getAvailability: () => { configured: boolean };
    search: { searchSongs: ReturnType<typeof vi.fn> };
    playback: { getAudioSource: ReturnType<typeof vi.fn> };
}

const makeProvider = (id: string, shortName: string): ProviderMock => ({
    id,
    shortName,
    displayName: shortName,
    capabilities: { search: true, auth: true },
    getAvailability: () => ({ configured: true }),
    search: { searchSongs: vi.fn(async () => ({ items: [] as SongResult[] })) },
    playback: { getAudioSource: vi.fn(async (song: SongResult) => ({ url: `https://stream.test/${song.id}` })) },
});

const makeTarget = (): SongResult => makeSong('netease', `target-${(mediaCounter += 1)}`, '晴天', ['周杰伦'], 269_000);

let qq: ProviderMock;
let kugou: ProviderMock;

beforeEach(() => {
    qq = makeProvider('qq', 'QQ');
    kugou = makeProvider('kugou', '酷狗');
    const netease = makeProvider('netease', '网易云');
    h.providers = [netease, qq, kugou];
    h.accounts = {
        qq: { status: 'authenticated' },
        kugou: { status: 'authenticated' },
        netease: { status: 'authenticated' },
    };
    h.qqSession = true;
    invalidateCrossReplacementCache();
});

describe('cross-platform replacement candidate lookup', () => {
    it('tiers candidates by duration difference and sorts exact before near', async () => {
        qq.search.searchSongs.mockResolvedValue({ items: [
            makeSong('qq', 'q-exact', '晴天', ['周杰伦'], 269_000 + 8_000),   // boundary: still exact
            makeSong('qq', 'q-near', '晴天', ['周杰伦'], 269_000 + 20_000),   // boundary: still near
            makeSong('qq', 'q-far', '晴天', ['周杰伦'], 269_000 + 20_001),    // beyond near: dropped
        ] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates.map(candidate => [candidate.song.sourceRef!.mediaId, candidate.confidence, candidate.durationDiffMs])).toEqual([
            ['q-exact', 'exact', 8_000],
            ['q-near', 'near', 20_000],
        ]);
    });

    it('treats a candidate without duration as exact (identity matched, no evidence against it)', async () => {
        qq.search.searchSongs.mockResolvedValue({ items: [makeSong('qq', 'q-nodur', '晴天', ['周杰伦'], 0)] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates).toHaveLength(1);
        expect(candidates[0]!.confidence).toBe('exact');
    });

    it('matches artists by normalized containment and carries the provider label', async () => {
        qq.search.searchSongs.mockResolvedValue({ items: [
            makeSong('qq', 'q-cover', '晴天', ['翻唱歌手'], 269_000),          // different artist: dropped
            makeSong('qq', 'q-bilingual', '晴天', ['周杰伦 Jay Chou'], 269_002), // romanized suffix still matches
        ] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates).toHaveLength(1);
        expect(candidates[0]!.song.sourceRef!.mediaId).toBe('q-bilingual');
        expect(candidates[0]!.providerLabel).toBe('QQ');
    });

    it('accepts a small display suffix on the title but never a different title', async () => {
        // Slack is measured on the normalized title: punctuation is stripped first, so the
        // 4-character budget here is spent on "live" itself.
        qq.search.searchSongs.mockResolvedValue({ items: [
            makeSong('qq', 'q-suffix', '晴天live', ['周杰伦'], 269_000),
            makeSong('qq', 'q-other', '雨天', ['周杰伦'], 269_000),
        ] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates.map(candidate => candidate.song.sourceRef!.mediaId)).toEqual(['q-suffix']);
    });

    it('keeps searching lower-priority platforms when only near matches are found, exact first in the result', async () => {
        qq.search.searchSongs.mockResolvedValue({ items: [makeSong('qq', 'q-near', '晴天', ['周杰伦'], 269_000 + 10_000)] });
        kugou.search.searchSongs.mockResolvedValue({ items: [makeSong('kugou', 'k-exact', '晴天', ['周杰伦'], 269_000 + 2_000)] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(kugou.search.searchSongs).toHaveBeenCalledTimes(1);
        expect(candidates.map(candidate => candidate.song.sourceRef!.mediaId)).toEqual(['k-exact', 'q-near']);
    });

    it('short-circuits remaining platforms once the preferred platform returns an exact match', async () => {
        qq.search.searchSongs.mockResolvedValue({ items: [makeSong('qq', 'q-exact', '晴天', ['周杰伦'], 269_000)] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates.map(candidate => candidate.providerId)).toEqual(['qq']);
        expect(kugou.search.searchSongs).not.toHaveBeenCalled();
    });

    it('drops a platform whose search rejects and continues with the others', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        qq.search.searchSongs.mockRejectedValue(new Error('rate limited'));
        kugou.search.searchSongs.mockResolvedValue({ items: [makeSong('kugou', 'k-exact', '晴天', ['周杰伦'], 269_000)] });
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates.map(candidate => candidate.providerId)).toEqual(['kugou']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('returns nothing and searches nobody when no other platform is logged in', async () => {
        h.qqSession = false;
        delete h.accounts.kugou;
        const candidates = await findCrossPlatformCandidates(makeTarget());
        expect(candidates).toEqual([]);
        expect(qq.search.searchSongs).not.toHaveBeenCalled();
        expect(kugou.search.searchSongs).not.toHaveBeenCalled();
    });

    it('ignores songs without an online source reference', async () => {
        // Without a sourceRef a plain song falls back to the legacy netease-online branch, so the
        // local marker is what actually keeps a local file out of the cross-platform lookup.
        const localSong = makeSong('local', 'l-1', '晴天', ['周杰伦'], 269_000);
        delete (localSong as { sourceRef?: unknown }).sourceRef;
        (localSong as { localRef?: unknown }).localRef = { songId: 'local-file-1' };
        const candidates = await findCrossPlatformCandidates(localSong);
        expect(candidates).toEqual([]);
        expect(qq.search.searchSongs).not.toHaveBeenCalled();
    });

    it('discards candidates that fail the playability probe when validatePlayability is set', async () => {
        const qqCandidate = makeSong('qq', 'q-vip', '晴天', ['周杰伦'], 269_000 + 10_000);
        qq.search.searchSongs.mockResolvedValue({ items: [qqCandidate] });
        kugou.search.searchSongs.mockResolvedValue({ items: [makeSong('kugou', 'k-ok', '晴天', ['周杰伦'], 269_000 + 2_000)] });
        qq.playback.getAudioSource.mockResolvedValue({ url: '' }); // VIP-only track, non-VIP QQ account: streams empty
        const target = makeTarget();
        const candidates = await findCrossPlatformCandidates(target, { validatePlayability: true });
        expect(candidates.map(candidate => candidate.song.sourceRef!.mediaId)).toEqual(['k-ok']);
        expect(qq.playback.getAudioSource).toHaveBeenCalledWith(qqCandidate, 'standard');
    });

    it('caches empty answers across lookups and re-searches after invalidation', async () => {
        const target = makeTarget();
        await findCrossPlatformCandidates(target);
        await findCrossPlatformCandidates(target);
        expect(qq.search.searchSongs).toHaveBeenCalledTimes(1);
        expect(kugou.search.searchSongs).toHaveBeenCalledTimes(1);

        invalidateCrossReplacementCache(target);
        await findCrossPlatformCandidates(target);
        expect(qq.search.searchSongs).toHaveBeenCalledTimes(2);
    });
});
