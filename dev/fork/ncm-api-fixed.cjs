// dev/fork/ncm-api-fixed.cjs
// @fork 本地魔改版专用：把内嵌网易后端拉在**固定端口**上，给「网页版 prod 预览」当在线平台后端用。
// 为什么要固定：ncm-api-standalone.cjs 的端口来自上游 findFreePort()，每次启动都换，而 VITE_NETEASE_API_BASE
// 是**构建期**烘进 bundle 的（src/services/netease.ts 读 import.meta.env.VITE_NETEASE_API_BASE）。
// 随机端口 = 后端一重启，整个网页版就要重打包。这条路要能天天用，端口必须钉死。
// 做法：临时把 backendLifecycle 的 findFreePort 换成固定端口版，再 require 后端；require.cache 命中，
// 桌面壳走的是同一份进程内替换，本脚本自己起的进程互不影响。
// 用法：node dev/fork/ncm-api-fixed.cjs [port]   （缺省 65411，与既有 dev 服务的 VITE_NETEASE_API_BASE 对齐）
const path = require('path');

const PORT = Number(process.argv[2] || 65411);
const lifecyclePath = path.resolve(__dirname, '../../electron/backendLifecycle.cjs');
const lifecycle = require(lifecyclePath);

const originalFindFreePort = lifecycle.findFreePort;
lifecycle.findFreePort = async () => {
    const net = await import('node:net');
    await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.once('listening', () => probe.close(resolve));
        probe.listen(PORT, '127.0.0.1');
    });
    return PORT;
};

const { createNeteaseBackend } = require('../../electron/neteaseBackend.cjs');
const backend = createNeteaseBackend({ broadcast: () => { } });

backend.start()
    .then(() => {
        const port = backend.getPort();
        if (port !== PORT) {
            console.error(`NCM_PORT_MISMATCH 期望 ${PORT}，实际 ${port}`);
            process.exit(1);
        }
        console.log(`NCM_PORT=${port}`);
        console.log(`NCM_BASE=http://127.0.0.1:${port}`);
    })
    .catch(error => {
        // 端口被占：说明上一轮的后端还活着，直接用现成的，不换端口重启（固定端口的意义就在于此）。
        const code = error && error.code;
        if (code === 'EADDRINUSE') {
            console.log(`NCM_PORT_IN_USE=${PORT}（已有后端在听，复用即可，无需重启）`);
            process.exit(0);
        }
        console.error('NCM_START_FAIL ' + ((error && error.stack) || error));
        lifecycle.findFreePort = originalFindFreePort;
        process.exit(1);
    });
