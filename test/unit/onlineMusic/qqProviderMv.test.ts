import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProviderMv.test.ts
// The QQ MV capability: the mv vid must survive normalization into sourceRef.providerData
// (search SongResult, raw item_song and cached shapes), and getMvUrl must resolve the best
// stream tier through the backend session (mv_play) — anonymous upstream responses carry
// empty freeflow_url arrays on every tier and must collapse to null instead of a dead URL.

const requestQqMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
    getQqRemoteApiBase: () => 'https://qq.example.test',
    hasQqSession: () => true,
    clearQqSession: vi.fn(),
    requestQq: requestQqMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: vi.fn(),
}));

const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
const { normalizeQqSong } = await import('@/services/onlineMusic/qqNormalize');

// Field shape of the `item_song[].mv` node captured during the protocol probe; the vid
// belongs to the same public MV documented by the qq-music-api routes.
const MV_VID = 'g0022q7z0um';
const RAW_ITEM = {
    id: 5105918,
    mid: '003rJSwm3TechU',
    title: '海阔天空',
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: 'Beyond' }],
    album: { id: 8112, mid: '0016l2F430zMux', name: '乐与怒' },
    file: { media_mid: '001MediaMidFixture' },
    interval: 326,
};
// The QQ search returns an already-flattened SongResult; mvVid rides top-level (the doSearchQQ
// passthrough), while raw payloads nest the vid under `mv`. Both must normalize identically.
const SEARCH_RESULT = {
    ...RAW_ITEM,
    title: RAW_ITEM.title,
    mvVid: MV_VID,
};

const streamUrl = (tier: number, secure = false) =>
    `http${secure ? 's' : ''}://dl.stream.test/qmmv_abcd.f98${tier}.mp4?guid=0&vkey=1`;
const tierEntry = (filetype: number, code: number, urls: string[]) => ({ code, filetype, freeflow_url: urls });
// Real response shape of GET /getMvPlay with a backend session (requestQq returns the raw body).
const mvPlayBody = (mp4: unknown[]) => ({
    response: {
        code: 0,
        getMVUrl: { code: 0, data: { [MV_VID]: { mp4, hls: [] } } },
    },
});
// Anonymous shape: HTTP 200 with per-tier error codes and no URLs at all.
const ANONYMOUS_MP4 = [
    tierEntry(0, 2000, []),
    tierEntry(10, 1000, []),
    tierEntry(20, 1000, []),
    tierEntry(30, 0, []),
];

type AnySourceRef = { kind: string; providerId?: string; providerData?: Record<string, unknown> };
const sourceRefOf = (raw: Record<string, unknown>): AnySourceRef => normalizeQqSong(raw).sourceRef as AnySourceRef;
const songOf = (raw: Record<string, unknown>) => normalizeQqSong(raw) as unknown as Parameters<NonNullable<typeof qqProvider.mv>['getMvUrl']>[0];
const localSong = { sourceRef: { kind: 'local', mediaId: 'file-1' } } as unknown as Parameters<NonNullable<typeof qqProvider.mv>['getMvUrl']>[0];

describe('qqProvider mv capability', () => {
    beforeEach(() => {
        requestQqMock.mockReset();
    });

    it('declares the mv capability', () => {
        expect(qqProvider.capabilities.mv).toBe(true);
    });

    it('passes the mv vid through into sourceRef.providerData from the search SongResult shape', () => {
        expect(sourceRefOf(SEARCH_RESULT).providerData).toMatchObject({ mvVid: MV_VID });
    });

    it('passes the mv vid through from the raw item_song mv node', () => {
        expect(sourceRefOf({ ...RAW_ITEM, mv: { id: 1067783, vid: MV_VID, vt: 0 } }).providerData).toMatchObject({ mvVid: MV_VID });
    });

    it('omits the mvVid key for numeric, empty and missing mv nodes', () => {
        // Legacy songs carry a numeric `mv` id that cannot be exchanged for a vid.
        expect(sourceRefOf({ ...RAW_ITEM, mv: 1067783 }).providerData).not.toHaveProperty('mvVid');
        expect(sourceRefOf({ ...RAW_ITEM, mv: { id: 0, vid: '', vt: 0 } }).providerData).not.toHaveProperty('mvVid');
        expect(sourceRefOf(RAW_ITEM).providerData).not.toHaveProperty('mvVid');
    });

    it('keeps the mvVid when a normalized song round-trips through the normalizer', () => {
        const normalized = normalizeQqSong(SEARCH_RESULT);
        expect(sourceRefOf(normalized as unknown as Record<string, unknown>).providerData).toMatchObject({ mvVid: MV_VID });
    });

    it('resolves the 1080p tier through mv_play and prefers https', async () => {
        requestQqMock.mockResolvedValue(mvPlayBody([
            tierEntry(10, 0, [streamUrl(10)]),
            tierEntry(30, 0, [streamUrl(30), streamUrl(30, true)]),
        ]));
        const song = songOf(SEARCH_RESULT);
        const source = await qqProvider.mv!.getMvUrl(song);
        expect(requestQqMock).toHaveBeenCalledWith('mv_play', { vid: MV_VID });
        expect(source).toMatchObject({ url: streamUrl(30, true) });
    });

    it('steps down to 720p/480p when 1080p is absent or rejected', async () => {
        requestQqMock.mockResolvedValue(mvPlayBody([
            tierEntry(10, 0, [streamUrl(10)]),
            tierEntry(30, 1000, []),
        ]));
        const song = songOf(SEARCH_RESULT);
        expect(await qqProvider.mv!.getMvUrl(song)).toMatchObject({ url: streamUrl(10) });
    });

    it('falls back to an unknown usable tier rather than giving up', async () => {
        requestQqMock.mockResolvedValue(mvPlayBody([tierEntry(50, 0, [streamUrl(50, true)])]));
        const song = songOf(SEARCH_RESULT);
        expect(await qqProvider.mv!.getMvUrl(song)).toMatchObject({ url: streamUrl(50, true) });
    });

    it('returns null for the anonymous response shape (every tier empty or rejected)', async () => {
        requestQqMock.mockResolvedValue(mvPlayBody(ANONYMOUS_MP4));
        const song = songOf(SEARCH_RESULT);
        expect(await qqProvider.mv!.getMvUrl(song)).toBeNull();
    });

    it('returns null when the vid is absent from the stream map', async () => {
        requestQqMock.mockResolvedValue(mvPlayBody([]));
        const song = songOf(SEARCH_RESULT);
        expect(await qqProvider.mv!.getMvUrl(song)).toBeNull();
    });

    it('returns null without a stream lookup when the song has no vid', async () => {
        const song = songOf(RAW_ITEM);
        expect(await qqProvider.mv!.getMvUrl(song)).toBeNull();
        expect(requestQqMock).not.toHaveBeenCalled();
    });

    it('returns null for a song from another source kind', async () => {
        expect(await qqProvider.mv!.getMvUrl(localSong)).toBeNull();
        expect(requestQqMock).not.toHaveBeenCalled();
    });

    it('returns null when the transport fails', async () => {
        requestQqMock.mockRejectedValue(new Error('offline'));
        const song = songOf(SEARCH_RESULT);
        expect(await qqProvider.mv!.getMvUrl(song)).toBeNull();
    });
});
