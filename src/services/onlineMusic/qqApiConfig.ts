// src/services/onlineMusic/qqApiConfig.ts
// QQ 音乐 API 后端地址的用户覆盖（docs/qq-shared-session-design.md §5.2）。
// 独立于 qqTransport 的纯配置存储：设置 UI 与 sync 层都要读它，但不该拉进 transport 实现
// （架构边界测试禁止 UI 层 import qqTransport）。

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
