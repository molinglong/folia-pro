// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { qrcDecrypt } from '@/utils/lyrics/providers/qrcDecrypt';
import {
    fetchQQLyrics,
    QQUpstreamRejectedError,
    searchQQLyrics,
    searchQQSongs,
} from '@/utils/lyrics/providers/qqLyricProvider';

// test/unit/lyrics/qqLyricProvider.test.ts
// Verifies QQ's anonymous lyric request parses the optional romanization track,
// and the egress selection (direct / backend lyric-proxy / fallback) behind it.

vi.mock('@/utils/lyrics/providers/qrcDecrypt', () => ({
    qrcDecrypt: vi.fn(),
}));

const song: SongResult = {
    id: 42,
    name: 'Test song',
    artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' },
    durationMs: 60_000,
    qqMid: 'qq-mid',
};

describe('QQ lyric provider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        delete (window as any).electron;
        window.localStorage.removeItem('folia_qq_api_base_url_v1');
    });

    it('fetches and parses QQ romanization anonymously', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
                code: 0,
                request: { code: 0, data: { lyric: 'orig', trans: 'trans', roma: 'roma', roma_t: 1 } },
            })));
        vi.stubGlobal('fetch', fetchMock);
        vi.mocked(qrcDecrypt).mockImplementation(async value => ({
            orig: '[00:01.00]君のことが好き',
            trans: '[00:01.00]我喜欢你',
            roma: '[00:01.00]Kimi no koto ga suki',
        })[String(value)] || '');

        const lyrics = await fetchQQLyrics(song);

        expect(lyrics?.lines[0]).toMatchObject({
            translation: '我喜欢你',
            romanization: 'Kimi no koto ga suki',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const lyricRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(lyricRequestBody.comm).toEqual(expect.objectContaining({ uid: '0' }));
        expect(lyricRequestBody.comm).not.toHaveProperty('sid');
        expect(lyricRequestBody.comm).not.toHaveProperty('userip');
        expect(lyricRequestBody.request.param).toMatchObject({ roma: 1, roma_t: 0 });
    });

    it('keeps QQ lyric searches anonymous', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 0,
            request: { code: 0, data: { body: { item_song: [] } } },
        })));
        vi.stubGlobal('fetch', fetchMock);

        await expect(searchQQLyrics('test')).resolves.toEqual([]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const searchRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(searchRequestBody.request.method).toBe('DoSearchForQQMusicLite');
    });

    it('normalizes QQ search covers and duration for metadata matching', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 0,
            request: {
                code: 0,
                data: {
                    body: {
                        item_song: [{
                            id: 42,
                            mid: 'song-mid',
                            title: 'Test song',
                            interval: 60,
                            singer: [{ id: 1, name: 'Artist' }],
                            album: { id: 2, mid: 'album-mid', name: 'Album' },
                        }],
                    },
                },
            },
        })));
        vi.stubGlobal('fetch', fetchMock);

        const [result] = await searchQQLyrics('Test song');

        expect(result).toMatchObject({
            durationMs: 60_000,
            album: {
                coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg?max_age=2592000',
            },
        });
    });

    // 出口选择：配了 QQ API 后端地址就改走它的同源 lyric-proxy（把出口 IP 换到服务器），
    // 没配继续直连；代理走不通回落直连，不能把搜索彻底打死。
    const QQ_UPSTREAM = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const emptySearchResponse = () => new Response(JSON.stringify({
        code: 0,
        request: { code: 0, data: { body: { item_song: [] } } },
    }));

    it('sends Electron anonymous requests through the configured backend lyric-proxy', async () => {
        (window as any).electron = {};
        window.localStorage.setItem('folia_qq_api_base_url_v1', 'https://music.example.test/qq');
        const fetchMock = vi.fn().mockResolvedValue(emptySearchResponse());
        vi.stubGlobal('fetch', fetchMock);

        await searchQQSongs('test');

        expect(fetchMock).toHaveBeenCalledWith(
            `https://music.example.test/api/lyric-proxy?url=${encodeURIComponent(QQ_UPSTREAM)}`,
            expect.anything(),
        );
    });

    it('keeps Electron direct when no backend address is configured', async () => {
        (window as any).electron = {};
        const fetchMock = vi.fn().mockResolvedValue(emptySearchResponse());
        vi.stubGlobal('fetch', fetchMock);

        await searchQQSongs('test');

        expect(fetchMock).toHaveBeenCalledWith(QQ_UPSTREAM, expect.anything());
    });

    it('falls back to direct egress when the configured proxy fails', async () => {
        (window as any).electron = {};
        window.localStorage.setItem('folia_qq_api_base_url_v1', 'https://music.example.test/qq');
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('proxy unreachable'))
            .mockResolvedValueOnce(emptySearchResponse());
        vi.stubGlobal('fetch', fetchMock);

        await expect(searchQQSongs('test')).resolves.toEqual([]);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1]?.[0])).toBe(QQ_UPSTREAM);
    });

    it('surfaces risk-control rejections (request.code 2001) on the song-search path only', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 0,
            request: { code: 2001, data: { body: { item_song: [] } } },
        })));
        vi.stubGlobal('fetch', fetchMock);

        await expect(searchQQSongs('test')).rejects.toBeInstanceOf(QQUpstreamRejectedError);
        // 歌词匹配路径维持吞错回空，后端抖动不能阻断自动匹配。
        await expect(searchQQLyrics('test')).resolves.toEqual([]);
    });
});
