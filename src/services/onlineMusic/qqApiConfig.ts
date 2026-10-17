// src/services/onlineMusic/qqApiConfig.ts
// QQ 音乐 API 后端地址的用户覆盖（docs/qq-shared-session-design.md §5.2）。
// 独立于 qqTransport 的纯配置存储：设置 UI、sync 层与歌词 provider 的上游出口都要读它，
// 但不该拉进 transport 实现（架构边界测试禁止 UI 层 import qqTransport）。

const QQ_API_BASE_OVERRIDE_KEY = 'folia_qq_api_base_url_v1';

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const getQqApiBaseUrlOverride = (): string => {
    if (typeof localStorage === 'undefined') return '';
    return normalizeBaseUrl(localStorage.getItem(QQ_API_BASE_OVERRIDE_KEY) || '');
};

export const setQqApiBaseUrlOverride = (value: string): void => {
    if (typeof localStorage === 'undefined') return;
    const trimmed = normalizeBaseUrl(value);
    if (trimmed) localStorage.setItem(QQ_API_BASE_OVERRIDE_KEY, trimmed);
    else localStorage.removeItem(QQ_API_BASE_OVERRIDE_KEY);
};

/**
 * QQ 上游匿名请求的远端出口：把 `u.y.qq.com` 从「本机直连」换成「已部署后端的同源
 * `/api/lyric-proxy`」，出口 IP 随之换到服务器。QQ 对匿名搜索按 IP 频控（回 HTTP 200 +
 * `request.code 2001` 的空结果），换出口是不动用登录态就能绕开它的那一档。
 *
 * 只能取 origin 再拼路径，不能直接把后端地址当代理地址：VPS 网关上 `/qq`（qq-music-api）与
 * `/api/lyric-proxy`（上游转发）同源不同路径，前者没有后者那条路由。
 * 相对地址按页面基准解析（dev 服务器自带同名的 `/api/lyric-proxy` 中间件，正好能用）；
 * 解不出可用的 http(s) 地址时返回 null，调用方继续直连。
 */
export const getQqUpstreamProxyUrl = (): string | null => {
    const override = getQqApiBaseUrlOverride();
    if (!override) return null;
    try {
        const base = typeof window !== 'undefined' ? window.location?.href : undefined;
        const url = new URL(override, base);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return `${url.origin}/api/lyric-proxy`;
    } catch {
        return null;
    }
};
