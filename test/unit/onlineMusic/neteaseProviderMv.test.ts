import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/neteaseProviderMv.test.ts
// The MV capability: NetEase's own `mv` field must survive normalization into
// sourceRef.providerData (0/missing stays absent), and getMvUrl must collapse "no id",
// "empty stream" and "lookup failure" to null instead of throwing into the video layer.

const neteaseApi = vi.hoisted(() => ({
    normalizeSongResult: (raw: unknown) => raw,
    getMvUrl: vi.fn(),
    getSongDetail: vi.fn(),
}));
vi.mock('@/services/netease', () => ({
    neteaseApi,
    getNeteaseRemoteApiBase: () => null,
    isSongMarkedUnavailable: () => false,
}));

vi.mock('@/stores/usePersonalFmModeStore', () => ({ getPersonalFmRequestOptions: () => ({}) }));
vi.mock('@/services/onlineMusic/providerStorage', () => ({
    readProviderSessionValue: () => null,
    writeProviderSessionValue: () => {},
}));
vi.mock('@/services/onlineMusic/loginBackendDiagnostics', () => ({
    collectLoginBackendDiagnostics: vi.fn(async () => ({})),
}));
vi.mock('@/services/onlineMusic/loginSelfCheck', () => ({
    canRunLoginSelfCheck: () => false,
    runLoginSelfCheck: vi.fn(async () => null),
}));
vi.mock('@/utils/qrLoginDiagnosticReport', () => ({ formatDiagnosticClock: () => '' }));

const { neteaseProvider, normalizeNeteaseSong } = await import('@/services/onlineMusic/neteaseProvider');

type AnySourceRef = { kind: string; providerId?: string; providerData?: Record<string, unknown> };

const songOf = (raw: Record<string, unknown>) => normalizeNeteaseSong(raw);
const sourceRefOf = (raw: Record<string, unknown>): AnySourceRef => songOf(raw).sourceRef as AnySourceRef;
const localSong = { sourceRef: { kind: 'local', mediaId: 'file-1' } } as unknown as Parameters<NonNullable<typeof neteaseProvider.mv>['getMvUrl']>[0];

describe('neteaseProvider mv capability', () => {
    beforeEach(() => {
        neteaseApi.getMvUrl.mockReset();
        neteaseApi.getSongDetail.mockReset();
    });

    it('declares the mv capability', () => {
        expect(neteaseProvider.capabilities.mv).toBe(true);
    });

    it('passes the MV id through into sourceRef.providerData', () => {
        expect(sourceRefOf({ id: 30953009, name: 'Song', mv: 54321 })).toMatchObject({
            kind: 'online',
            providerId: 'netease',
            providerData: { mvId: 54321 },
        });
    });

    it('omits providerData when mv is 0 or missing', () => {
        expect(sourceRefOf({ id: 1, name: 'A', mv: 0 }).providerData).toBeUndefined();
        expect(sourceRefOf({ id: 2, name: 'B' }).providerData).toBeUndefined();
    });

    it('keeps the MV id when the package normalize drops it', () => {
        const original = neteaseApi.normalizeSongResult;
        neteaseApi.normalizeSongResult = () => ({ id: 7, name: 'C', t: 0 });
        try {
            expect(sourceRefOf({ id: 7, name: 'C', mv: 999 }).providerData).toEqual({ mvId: 999 });
        } finally {
            neteaseApi.normalizeSongResult = original;
        }
    });

    it('keeps the MV id when the raw song is already an API-layer normalized SongResult', () => {
        // Real chain: neteaseApi.getSongDetail/cloudSearch run mergeSongsWithPrivileges (which
        // whitelist-normalizes each song) BEFORE the provider sees it, so the provider's "raw"
        // is an already-normalized song carrying only the top-level `mv` field — not NetEase's
        // raw JSON. The provider must read the id from either shape.
        const alreadyNormalized = {
            id: 287398,
            name: 'Song',
            mv: 5293234,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '287398' },
        } as unknown as Record<string, unknown>;
        expect(sourceRefOf(alreadyNormalized).providerData).toEqual({ mvId: 5293234 });
    });

    it('resolves an MV url and forwards the mv id', async () => {
        neteaseApi.getMvUrl.mockResolvedValue({ url: 'https://mv.example/stream.mp4', r: 1080 });
        const song = songOf({ id: 30953009, name: 'Song', mv: 54321 });
        const source = await neteaseProvider.mv!.getMvUrl(song as never);
        expect(neteaseApi.getMvUrl).toHaveBeenCalledWith(54321);
        expect(source).toMatchObject({ url: 'https://mv.example/stream.mp4', quality: 1080 });
    });

    it('falls back to a song-detail lookup when the persisted song has no mvId', async () => {
        // Songs restored from queues/collections persisted before the passthrough carry no mvId;
        // the detail endpoint's normalize keeps the top-level mv, so the lookup still succeeds.
        neteaseApi.getSongDetail.mockResolvedValue({ songs: [{ id: 420144, name: 'Song', mv: 420144 }] });
        neteaseApi.getMvUrl.mockResolvedValue({ url: 'https://mv.example/stream.mp4', r: 480 });
        const song = songOf({ id: 420144, name: 'Song' });
        const source = await neteaseProvider.mv!.getMvUrl(song as never);
        expect(neteaseApi.getSongDetail).toHaveBeenCalledWith(420144);
        expect(neteaseApi.getMvUrl).toHaveBeenCalledWith(420144);
        expect(source).toMatchObject({ url: 'https://mv.example/stream.mp4' });
    });

    it('returns null without a stream lookup when the detail fallback finds no mv either', async () => {
        neteaseApi.getSongDetail.mockResolvedValue({ songs: [{ id: 1, name: 'A', mv: 0 }] });
        const song = songOf({ id: 1, name: 'A', mv: 0 });
        expect(await neteaseProvider.mv!.getMvUrl(song as never)).toBeNull();
        expect(neteaseApi.getMvUrl).not.toHaveBeenCalled();
    });

    it('returns null when the detail fallback itself fails', async () => {
        neteaseApi.getSongDetail.mockRejectedValue(new Error('offline'));
        const song = songOf({ id: 1, name: 'A' });
        expect(await neteaseProvider.mv!.getMvUrl(song as never)).toBeNull();
        expect(neteaseApi.getMvUrl).not.toHaveBeenCalled();
    });

    it('returns null for a song from another source kind', async () => {
        expect(await neteaseProvider.mv!.getMvUrl(localSong)).toBeNull();
        expect(neteaseApi.getMvUrl).not.toHaveBeenCalled();
    });

    it('returns null when the upstream issues no stream', async () => {
        neteaseApi.getMvUrl.mockResolvedValue({ url: '', r: 1080 });
        const song = songOf({ id: 30953009, name: 'Song', mv: 54321 });
        expect(await neteaseProvider.mv!.getMvUrl(song as never)).toBeNull();
    });

    it('returns null when the lookup fails', async () => {
        neteaseApi.getMvUrl.mockRejectedValue(new Error('offline'));
        const song = songOf({ id: 30953009, name: 'Song', mv: 54321 });
        expect(await neteaseProvider.mv!.getMvUrl(song as never)).toBeNull();
    });
});
