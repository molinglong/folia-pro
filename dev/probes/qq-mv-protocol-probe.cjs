"use strict";

// dev/probes/qq-mv-protocol-probe.cjs
// Read-only feasibility probe at the protocol level (musicu.fcg, anonymous), the same transport
// the client's QQ lyric/song search already uses. Checks:
//   1. does a search response's item_song carry the MV vid (song -> MV join key)?
//   2. does gosrf.Stream.MvUrlProxy.GetMvUrls turn a vid into playable mp4 URLs (tiers f10-f40)?
// No auth, no local backend: pure node fetch, same headers as qqLyricProvider.

const KEYWORD = process.argv[2] || '光年之外';

const requestQQ = async (method, module, param) => {
    const payload = {
        comm: {
            ct: 11, cv: '1003006', v: '1003006', os_ver: '15',
            phonetype: '24122RKC7C',
            rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys',
            tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI', udid: '0', uid: '0',
        },
        request: { method, module, param },
    };
    const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': 'tmeLoginType=-1;',
            'User-Agent': 'okhttp/3.14.9',
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`musicu.fcg ${res.status}`);
    return res.json();
};

const run = async () => {
    // 1) song search: where is the MV vid?
    const search = await requestQQ('DoSearchForQQMusicLite', 'music.search.SearchCgiService', {
        search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
        remoteplace: 'search.android.keyboard',
        query: KEYWORD,
        search_type: 0,
        num_per_page: 5,
        page_num: 1,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
    });
    console.log('[search] raw code:', search?.code, '| top keys:', Object.keys(search ?? {}), '| request keys:', Object.keys(search?.request ?? {}));
    const songs = search?.request?.data?.body?.item_song ?? search?.data?.body?.item_song ?? [];
    console.log('[search] songs:', songs.length);
    for (const song of songs.slice(0, 3)) {
        console.log(JSON.stringify({
            mid: song.mid,
            name: song.title,
            singer: song.singer?.[0]?.name,
            songKeysMvLike: Object.keys(song).filter(key => /mv|vid|video/i.test(key)),
            mv: song.mv ?? null,
        }, null, 2));
    }

    // 2) MV urls by vid (gosrf.Stream.MvUrlProxy.GetMvUrls), same module the local package calls.
    const vid = songs.map(song => song.mv?.vid ?? song.mv?.id ?? song.vid).find(Boolean);
    if (!vid) {
        console.log('[mv-url] no vid in item_song; cannot test the stream step');
        return;
    }
    console.log('[mv-url] vid:', vid);
    const mvUrls = await requestQQ('GetMvUrls', 'gosrf.Stream.MvUrlProxy', {
        vids: [vid],
        request_typet: 10001,
    });
    console.log('[mv-url] raw top keys:', Object.keys(mvUrls ?? {}), '| request keys:', Object.keys(mvUrls?.request ?? {}));
    const mvData = mvUrls?.request?.data?.getMVUrl?.data
        ?? mvUrls?.data?.getMVUrl?.data
        ?? mvUrls?.request?.getMVUrl?.data
        ?? mvUrls?.getMVUrl?.data
        ?? {};
    const firstKey = Object.keys(mvData)[0];
    const mp4 = mvData[firstKey]?.mp4 ?? [];
    console.log('[mv-url] mp4 entries:', mp4.length);
    for (const entry of mp4) {
        const url = entry.freeflow_url?.[0];
        if (!url) continue;
        const tier = /\.f10\.mp4/.test(url) ? 'f10(480P)' : /\.f20\.mp4/.test(url) ? 'f20(720P)' : /\.f30\.mp4/.test(url) ? 'f30(1080P)' : /\.f40\.mp4/.test(url) ? 'f40(4K)' : 'other';
        const head = await fetch(url, { method: 'HEAD' }).then(r => ({
            status: r.status,
            contentType: r.headers.get('content-type'),
            contentLength: r.headers.get('content-length'),
        })).catch(error => ({ error: String(error).slice(0, 80) }));
        console.log(JSON.stringify({ tier, filename: entry.filename ?? null, fileSizeMb: entry.filesize ? Math.round(entry.filesize / 1048576) : null, head }, null, 2));
    }
};

run().catch((error) => {
    console.error('[probe] failed:', error);
    process.exitCode = 1;
});
