"use strict";

// dev/probes/mv-url-probe.cjs
// 拉起与桌面版完全一致的网易云本地 API 后端（neteaseBackend.cjs），对比多个歌曲来源接口里
// mv 字段的存活情况，并验证 /mv/url 路由本身是否工作。
// 用法：node dev/probes/mv-url-probe.cjs

const { createNeteaseBackend } = require('../../electron/neteaseBackend.cjs');

const quietLogger = { log: () => {}, info: () => {}, warn: () => {}, debug: () => {}, error: (...a) => console.error('[backend]', ...a) };

const getJson = async (port, apiPath) => {
    const res = await fetch(`http://127.0.0.1:${port}${apiPath}`);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { status: res.status, body };
};

const pickSongRows = (label, rows) => {
    const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
    console.log(`[probe] ${label} ->`, JSON.stringify(list.map(s => ({
        id: s?.id, name: s?.name, mv: s?.mv, hasMvField: 'mv' in (s || {}),
    }))));
    return list;
};

const main = async () => {
    const backend = createNeteaseBackend({ broadcast: () => {}, logger: quietLogger });
    const status = await backend.start();
    if (status.status !== 'running') {
        console.error('[probe] backend failed to start:', JSON.stringify(status));
        process.exit(1);
    }
    const port = backend.getPort();
    console.log('[probe] backend running on port', port);

    // A. 老搜索接口
    const search = await getJson(port, `/search?keywords=${encodeURIComponent('晴天 林俊杰')}&limit=3`);
    const searchRows = pickSongRows('A /search songs', search?.body?.result?.songs);

    // B. 新搜索接口
    const cloud = await getJson(port, `/cloudsearch?keywords=${encodeURIComponent('晴天 林俊杰')}&limit=3`);
    const cloudRows = pickSongRows('B /cloudsearch songs', cloud?.body?.result?.songs);

    // C. 歌单详情（云音乐热歌榜）
    const playlist = await getJson(port, `/playlist/detail?id=3778678&n=3`);
    const playlistRows = pickSongRows('C /playlist/detail tracks', playlist?.body?.playlist?.tracks);

    // D. /song/detail（provider 播放详情路径）
    const firstId = searchRows?.[0]?.id ?? cloudRows?.[0]?.id;
    if (firstId) {
        const detail = await getJson(port, `/song/detail?ids=${firstId}`);
        const song = detail?.body?.songs?.[0];
        console.log('[probe] D /song/detail ->', JSON.stringify({ id: song?.id, name: song?.name, mv: song?.mv, hasMvField: 'mv' in (song || {}) }));
    }

    // F. 关键验证：有 MV 的歌（我不难过 287398，mv=5293234）过 /song/detail 后 mv 字段还在不在
    // Folia 播放时会用 /song/detail 重建队列里的歌——这个接口丢字段的话，无论从哪播都会静默失败。
    const detailMv = await getJson(port, `/song/detail?ids=287398`);
    const detailSong = detailMv?.body?.songs?.[0];
    console.log('[probe] F /song/detail 287398 ->', JSON.stringify({ id: detailSong?.id, name: detailSong?.name, mv: detailSong?.mv, hasMvField: 'mv' in (detailSong || {}) }));

    // G. 每日推荐（常用播放入口）
    const rec = await getJson(port, `/recommend/songs`);
    pickSongRows('G /recommend/songs', rec?.body?.data?.dailySongs);

    // H. 私人 FM
    const fm = await getJson(port, `/personal_fm`);
    pickSongRows('H /personal_fm', fm?.body?.data);

    // E. /mv/url 路由本身（拿搜索结果里第一个非 0 的 mv id；没有就用经典 id 硬测路由）
    const mvCandidate = [...searchRows, ...cloudRows, ...playlistRows].map(s => Number(s?.mv) || 0).find(v => v > 0);
    const mvId = mvCandidate || 5436716;
    console.log('[probe] E /mv/url trying mvId =', mvId, mvCandidate ? '(from search)' : '(hardcoded route check)');
    const mv = await getJson(port, `/mv/url?id=${mvId}&r=1080`);
    const payload = Array.isArray(mv?.body?.data) ? mv.body.data[0] : mv?.body?.data;
    console.log('[probe] E /mv/url ->', JSON.stringify({
        httpStatus: mv.status,
        code: mv?.body?.code,
        id: payload?.id,
        r: payload?.r,
        url: typeof payload?.url === 'string' ? payload.url.slice(0, 90) : payload?.url,
    }, null, 2));
    process.exit(0);
};

main().catch((error) => { console.error('[probe] failed:', error); process.exit(1); });
