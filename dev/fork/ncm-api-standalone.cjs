// dev/fork/ncm-api-standalone.cjs
// @fork 本地魔改版专用：把桌面壳内嵌的网易云后端（electron/neteaseBackend.cjs，同一份代码、同一批上游补丁）
// 单独拉起来，给"在普通浏览器里跑网页版"这条路的在线功能用。
// 只监听 127.0.0.1（LISTEN_HOST 写死在 neteaseBackend.cjs 里），端口由 findFreePort 随机取，打印成 NCM_PORT=<port>。
// 用法：node dev/fork/ncm-api-standalone.cjs  →  把打印出来的端口填进 vite 的 VITE_NETEASE_API_BASE。
const { createNeteaseBackend } = require('../../electron/neteaseBackend.cjs');

const backend = createNeteaseBackend({ broadcast: () => {} });

backend.start()
    .then(() => {
        const port = backend.getPort();
        if (!port) {
            console.error('NCM_START_FAIL 没有拿到端口，状态：' + JSON.stringify(backend.getStatus()));
            process.exit(1);
        }
        console.log('NCM_PORT=' + port);
        console.log('NCM_BASE=http://127.0.0.1:' + port);
    })
    .catch(error => {
        console.error('NCM_START_FAIL ' + (error && error.stack || error));
        process.exit(1);
    });
