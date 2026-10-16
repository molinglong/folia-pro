// dev/probes/qq-mv-url-shape-probe.cjs
// Pure-node probe for the GetMvUrls single-request envelope shape (same transport as
// requestQQ in src/utils/lyrics/providers/qqLyricProvider.ts). Probe scripts stay out of CI.
// Usage: node dev/probes/qq-mv-url-shape-probe.cjs [vid]
const VID = process.argv[2] || 'g0022q7z0um';

const payload = {
    comm: {
        ct: 11,
        cv: '1003006',
        v: '1003006',
        os_ver: '15',
        phonetype: '24122RKC7C',
        rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys',
        tmeAppID: 'qqmusiclight',
        nettype: 'NETWORK_WIFI',
        udid: '0',
        uid: '0',
    },
    request: {
        method: 'GetMvUrls',
        module: 'gosrf.Stream.MvUrlProxy',
        param: { vids: [VID], request_typet: 10001 },
    },
};

fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Cookie: 'tmeLoginType=-1;',
        'User-Agent': 'okhttp/3.14.9',
    },
    body: JSON.stringify(payload),
})
    .then(r => r.json())
    .then(j => {
        console.log('top code:', j.code, '| request.code:', j.request?.code);
        const d = j.request?.data;
        if (d && typeof d === 'object') {
            console.log('request.data keys:', Object.keys(d).slice(0, 10));
            const vidEntry = d.getMVUrl?.data?.[VID] ?? d.data?.[VID] ?? d[VID];
            console.log('vid entry found via getMVUrl.data?', Boolean(d.getMVUrl?.data?.[VID]));
            console.log('vid entry found via data.data?', Boolean(d.data?.[VID]));
            console.log('vid entry found via top-level?', Boolean(d[VID]));
            console.log('entry preview:', vidEntry ? JSON.stringify(vidEntry).slice(0, 400) : '(missing)');
            if (d.getMVUrl?.data?.[VID]) {
                const mp4 = d.getMVUrl.data[VID].mp4 || [];
                console.log('mp4 entries:', mp4.length, 'sample url:', mp4[0]?.freeflow_url?.[0]?.slice(0, 120));
            }
            if (d.data?.[VID]) {
                const mp4 = d.data[VID].mp4 || [];
                console.log('mp4 entries:', mp4.length, 'sample url:', mp4[0]?.freeflow_url?.[0]?.slice(0, 120));
            }
        } else {
            console.log('request.data preview:', JSON.stringify(d)?.slice(0, 300));
        }
    })
    .catch(e => console.error('ERR', e.message));
