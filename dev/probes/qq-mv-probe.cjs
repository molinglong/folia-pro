"use strict";

// dev/probes/qq-mv-probe.cjs
// Read-only feasibility probe for QQ Music MV support (M2 candidate).
// Boots the local QQ API package (no auth session), then checks:
//   1. whether search results carry a song->MV vid field, and where;
//   2. whether /getMvPlay turns a vid into streamable mp4 URLs, and at which quality tiers.
// Usage: node "C:\项目\folia\repo\dev\probes\qq-mv-probe.cjs" [search keyword]

const { startQqApi } = require('../../electron/qqApiStartup.cjs');
const { findFreePort } = require('../../electron/backendLifecycle.cjs');

const KEYWORD = process.argv[2] || 'GEM'; // ASCII only: the package's own route decoding mangles non-ASCII in path params.

const get = async (port, pathWithQuery) => {
    const res = await fetch(`http://127.0.0.1:${port}${pathWithQuery}`);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return { parseError: text.slice(0, 200) };
    }
};

const run = async () => {
    // Attach mode: set QQ_MV_PROBE_PORT to probe the RUNNING client's QQ backend (logged-in
    // session, so search/risk-control behave like the real app) instead of booting a bare one.
    const attachPort = Number(process.env.QQ_MV_PROBE_PORT) || 0;
    const port = attachPort || await findFreePort();
    const handle = attachPort ? { close: async () => console.log('[probe] detached (client backend untouched)') } : await startQqApi({ port });
    try {
        // 1) search: where does the MV vid live in a song payload?
        // NOTE: the package's controllers read ctx.query, NOT the route params -- the /:key? in
        // the router is decorative. Real args must go in the query string.
        const search = await get(port, `/getSearchByKey?key=${encodeURIComponent(KEYWORD)}&limit=5&page=1`);
        console.log('[search] top keys:', Object.keys(search ?? {}), '| code:', search?.code);
        const resp = search?.response ?? {};
        console.log('[search] response keys:', Object.keys(resp), '| resp.code:', resp?.code, '| resp.data keys:', Object.keys(resp?.data ?? {}));
        const songNode = resp?.data?.song ?? {};
        console.log('[search] song node keys:', Object.keys(songNode), '| curnum:', songNode?.curnum, '| list len:', songNode?.list?.length ?? 'n/a');
        const songList = songNode?.list ?? [];
        console.log('[search] code:', search?.code, 'songs:', songList.length);
        for (const song of songList.slice(0, 3)) {
            console.log(JSON.stringify({
                mid: song.mid,
                name: song.name,
                singer: song.singer?.[0]?.name,
                mv: song.mv ?? null,
                mvIdTitle: song.mv?.title ?? null,
                file: song.file ? Object.keys(song.file) : null,
            }, null, 2));
        }

        // 2) mv play: turn the first vid into stream URLs.
        // Anonymous search may come back empty (upstream risk control); fall back to the MV chart
        // list, which returns vids directly.
        const firstVid = songList.find(song => song.mv?.vid || song.mv?.id)?.mv?.vid
            ?? songList.find(song => song.mv?.vid || song.mv?.id)?.mv?.id;
        let vid = firstVid;
        if (!vid) {
            console.log('[mv-play] no vid in search results; trying the MV chart list');
            const chart = await get(port, '/getMv?limit=5&page=1');
            const resp = chart?.response ?? {};
            console.log('[mv-chart] response keys:', Object.keys(resp), '| mv_list keys:', Object.keys(resp?.mv_list ?? {}), '| mv_list.data keys:', Object.keys(resp?.mv_list?.data ?? {}));
            const chartNode = resp?.mv_list?.data ?? resp?.data ?? {};
            const list = chartNode?.list ?? [];
            console.log('[mv-chart] entries:', list.length);
            for (const entry of list.slice(0, 3)) {
                console.log(JSON.stringify({ vid: entry.vid, name: entry.name ?? entry.title, singer: entry.singers?.[0]?.name ?? null }));
            }
            vid = list.find(entry => entry.vid)?.vid;
        }
        if (!vid) {
            console.log('[mv-play] no vid found anywhere; skipping');
            return;
        }
        console.log('[mv-play] vid:', vid);
        const play = await get(port, `/getMvPlay?vid=${encodeURIComponent(String(vid))}`);
        const mvUrlData = play?.response?.getMVUrl?.data ?? {};
        const key = Object.keys(mvUrlData)[0];
        const mp4 = mvUrlData[key]?.mp4 ?? [];
        console.log('[mv-play] mp4 entries:', mp4.length);
        for (const entry of mp4) {
            const url = entry.freeflow_url?.[0] ?? null;
            if (!url) continue;
            console.log(JSON.stringify({
                filename: entry.filename ?? null,
                filesize: entry.filesize ?? null,
                durationSec: entry.duration ?? null,
                matchedTier: /\.f10\.mp4/.test(url) ? 'f10' : /\.f20\.mp4/.test(url) ? 'f20' : /\.f30\.mp4/.test(url) ? 'f30' : /\.f40\.mp4/.test(url) ? 'f40' : 'other',
                host: new URL(url).host,
                head: await fetch(url, { method: 'HEAD' }).then(r => ({
                    status: r.status,
                    contentType: r.headers.get('content-type'),
                    contentLength: r.headers.get('content-length'),
                })).catch(error => ({ error: String(error).slice(0, 80) })),
            }, null, 2));
        }
        const mvinfo = play?.response?.mvinfo?.data ?? {};
        const infoKey = Object.keys(mvinfo)[0];
        const info = mvinfo[infoKey]?.[0];
        console.log('[mv-info]', JSON.stringify({
            name: info?.name ?? null,
            durationSec: info?.duration ?? null,
            cover: (info?.cover_pic ?? null),
            videoSwitch: info?.video_switch ?? null,
        }, null, 2));
    } finally {
        await handle.close();
        console.log('[probe] server closed');
    }
};

run().catch((error) => {
    console.error('[probe] failed:', error);
    process.exitCode = 1;
});
