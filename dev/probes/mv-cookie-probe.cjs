"use strict";

// dev/probes/mv-cookie-probe.cjs
// 对照实验：同一后端、同一首歌，带不带 cookie 参数各请求一次，对比歌曲对象里 mv 字段的存活。
// 用法：node dev/probes/mv-cookie-probe.cjs

const { createNeteaseBackend } = require('../../electron/neteaseBackend.cjs');

const quietLogger = { log: () => {}, info: () => {}, warn: () => {}, debug: () => {}, error: (...a) => console.error('[backend]', ...a) };

const getJson = async (port, apiPath) => {
    const res = await fetch(`http://127.0.0.1:${port}${apiPath}`);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { status: res.status, body };
};

const showSong = (label, song) => {
    console.log(`[probe] ${label} ->`, JSON.stringify({
        id: song?.id,
        name: song?.name,
        mv: song?.mv,
        hasMvField: 'mv' in (song || {}),
        keys: song ? Object.keys(song).slice(0, 30) : [],
    }));
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

    // 复刻 fetchWithCreds 的匿名 cookie 流程
    const anon = await getJson(port, `/register/anonimous?timestamp=${Date.now()}`);
    const cookie = typeof anon?.body?.cookie === 'string' ? anon.body.cookie : '';
    console.log('[probe] anonymous cookie:', cookie ? `${cookie.slice(0, 60)}...` : '(none)');

    // 对照组：无 cookie
    const plain = await getJson(port, `/song/detail?ids=287398`);
    showSong('A plain  /song/detail', plain?.body?.songs?.[0]);

    // 实验组：带匿名 cookie（与渲染进程 fetchWithCreds 一致）
    const withCookie = await getJson(port, `/song/detail?ids=287398&cookie=${encodeURIComponent(cookie)}`);
    showSong('B cookie /song/detail', withCookie?.body?.songs?.[0]);

    // 对照组 2：无 cookie 的 cloudsearch
    const csPlain = await getJson(port, `/cloudsearch?keywords=${encodeURIComponent('演员')}&limit=3`);
    const csPlainRows = (csPlain?.body?.result?.songs || []).slice(0, 3);
    console.log('[probe] C plain  /cloudsearch ->', JSON.stringify(csPlainRows.map(s => ({ id: s?.id, name: s?.name, mv: s?.mv, has: 'mv' in (s || {}) }))));

    // 实验组 2：带匿名 cookie 的 cloudsearch
    const csCookie = await getJson(port, `/cloudsearch?keywords=${encodeURIComponent('演员')}&limit=3&cookie=${encodeURIComponent(cookie)}`);
    const csCookieRows = (csCookie?.body?.result?.songs || []).slice(0, 3);
    console.log('[probe] D cookie /cloudsearch ->', JSON.stringify(csCookieRows.map(s => ({ id: s?.id, name: s?.name, mv: s?.mv, has: 'mv' in (s || {}) }))));
    process.exit(0);
};

main().catch((error) => { console.error('[probe] failed:', error); process.exit(1); });
