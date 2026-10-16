"use strict";

// dev/probes/mv-quality-probe.cjs
// 验证 /mv/url 的 r（清晰度）参数对匿名/免费档账号的行为：请求 1080 是否直接空 url，
// 降档 720/480 或多档请求能否拿到流。
// 用法：node dev/probes/mv-quality-probe.cjs

const { createNeteaseBackend } = require('../../electron/neteaseBackend.cjs');

const quietLogger = { log: () => {}, info: () => {}, warn: () => {}, debug: () => {}, error: (...a) => console.error('[backend]', ...a) };

const getJson = async (port, apiPath) => {
    const res = await fetch(`http://127.0.0.1:${port}${apiPath}`);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { status: res.status, body };
};

const tryR = async (port, mvId, r) => {
    const mv = await getJson(port, `/mv/url?id=${mvId}&r=${encodeURIComponent(r)}`);
    const data = mv?.body?.data;
    const rows = Array.isArray(data) ? data : [data];
    console.log(`[probe] mvId=${mvId} r=${r} ->`, JSON.stringify(rows.map(p => ({ r: p?.r, hasUrl: Boolean(p?.url), urlHead: typeof p?.url === 'string' ? p.url.slice(0, 55) : p?.url }))));
    return rows;
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

    // 找《陪你去流浪》的 mv id（用户实测唯一能显示的歌）
    const search = await getJson(port, `/cloudsearch?keywords=${encodeURIComponent('陪你去流浪 薛之谦')}&limit=3`);
    const hit = (search?.body?.result?.songs || []).find(s => Number(s?.mv) > 0);
    const mvIds = [];
    if (hit) {
        console.log('[probe] 陪你去流浪 ->', JSON.stringify({ id: hit.id, name: hit.name, mv: hit.mv }));
        mvIds.push({ label: '陪你去流浪(用户实测可放)', mvId: hit.mv });
    } else {
        console.log('[probe] 陪你去流浪: no mv in search results');
    }
    // 对照组：已知热门 MV
    mvIds.push({ label: '演员(用户实测不可放)', mvId: 420144 });
    mvIds.push({ label: '我不难过', mvId: 5293234 });

    for (const { label, mvId } of mvIds) {
        console.log(`[probe] ---- ${label} ----`);
        await tryR(port, mvId, 1080);
        await tryR(port, mvId, 720);
        await tryR(port, mvId, 480);
        await tryR(port, mvId, '1080,720,480');
    }
    process.exit(0);
};

main().catch((error) => { console.error('[probe] failed:', error); process.exit(1); });
