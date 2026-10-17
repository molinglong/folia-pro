import { motionValue, type MotionValue } from 'framer-motion';

// src/services/audioOutputLatencyProber.ts
// 自动探测当前音频输出路径的真实延迟（毫秒），给歌词时钟做设备级补偿。
//
// 原理：音频元素的 currentTime 是"已经交付给输出管线的进度"，而 getOutputTimestamp 报告
// "此刻真正送到扬声器的采样"位于哪里。两者之差就是声音还要在系统/蓝牙缓冲里走多久。
// 我们的音链挂在 MediaElementAudioSourceNode 上，Chromium 对这条链同样做该补偿，因此
// 差值涵盖了 Web Audio 图形与输出设备（蓝牙耳机是重灾区）的合计延迟。
//
// 只在播放中采样，长期值取窗口中位数防抖动；连续几个读数都停在另一个水平上（换了
// 输出设备）则采纳近窗中位数，不等整个长窗口排干。探测不到（方法缺失、暂停、数值离谱）
// 时保持上一个有效值：歌词不该因为一次采样失败而跳拍。

/** 与 DOM 规范对齐的最小形状；当前 TS lib 尚未带上这两个类型，故本地声明。 */
type AudioOutputTimestampLike = {
    contextTime: number;
    presentationMs: number;
};

type AudioElementWithOutputTimestamp = HTMLMediaElement & {
    getOutputTimestamp?: () => AudioOutputTimestampLike;
};

/** 补偿上限：再大的读数按"不可信"丢弃（离谱的蓝牙栈交给手动偏移去兜）。 */
export const MAX_AUTO_OUTPUT_LATENCY_MS = 1000;

/** 最近一次估计出的输出延迟（毫秒）；由探测循环写入，UI 订阅展示。 */
export const autoOutputLatencyMs: MotionValue<number> = motionValue(0);

/** 纯函数：从一次读数算出延迟。任何一项不合格返回 null，调用方保持旧值。 */
export const sampleOutputLatencyMs = (
    element: AudioElementWithOutputTimestamp | null | undefined,
    maxMs: number = MAX_AUTO_OUTPUT_LATENCY_MS,
): number | null => {
    if (!element || typeof element.getOutputTimestamp !== 'function') return null;
    if (element.paused || element.ended) return null;
    let timestamp: AudioOutputTimestampLike;
    try {
        timestamp = element.getOutputTimestamp();
    } catch {
        return null;
    }
    // presentationMs 为 0 表示尚未有采样送达输出（比如刚起播），没有可解释的差值。
    if (!timestamp || !Number.isFinite(timestamp.presentationMs) || timestamp.presentationMs <= 0) return null;
    if (!Number.isFinite(element.currentTime) || element.currentTime <= 0) return null;
    const presentedSec = timestamp.presentationMs / 1000;
    const latencyMs = Math.round((element.currentTime - presentedSec) * 1000);
    if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > maxMs) return null;
    return latencyMs;
};

/**
 * 兼容通道：某些版本/路由下媒体元素不报输出时间戳，此时用音频上下文自己报的设备输出延迟。
 * 只在主通道整个功能缺席时使用，不在“读数不合格”时降级，否则两个源头会轮流占上风、补偿量会来回跳。
 */
export const contextOutputLatencyMs = (context: AudioContext | null | undefined): number | null => {
    if (!context || context.state !== 'running') return null;
    const latencySec = context.outputLatency;
    if (!Number.isFinite(latencySec) || latencySec <= 0) return null;
    const latencyMs = Math.round(latencySec * 1000);
    return latencyMs > MAX_AUTO_OUTPUT_LATENCY_MS ? null : latencyMs;
};

const medianOf = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
};

const SAMPLE_INTERVAL_MS = 500;
const WINDOW_SIZE = 8;
/** 只看最近这么几个读数来判断“是不是换设备”，所以单次尖峰永远够不到阈值。 */
const RECENT_SIZE = 3;
/** 近窗中位数与当前值相差超过此数视为换了输出路径，立即采纳近窗值。 */
const JUMP_IMMEDIATE_MS = 50;

let timer: ReturnType<typeof setInterval> | null = null;
// 命名避开全局 window：模块内还要做环境判断时不该被它遮蔽。
let sampleWindow: number[] = [];

const tick = (getElement: () => HTMLMediaElement | null, getContext?: () => AudioContext | null) => {
    const element = getElement() as AudioElementWithOutputTimestamp | null;
    let sample = sampleOutputLatencyMs(element);
    if (sample === null && element && typeof element.getOutputTimestamp !== 'function') {
        // 主通道不存在才走兼容通道。
        sample = contextOutputLatencyMs(getContext?.());
    }
    if (sample === null) return;
    sampleWindow.push(sample);
    if (sampleWindow.length > WINDOW_SIZE) sampleWindow.shift();

    // 判据必须是“最近几个读数”而不是“新读数的长期中位数”：后者会被同一个窗口洗掉，
    // 换设备这种一次性阶跃恰恰在头几个样本里完全看不出来。
    const recent = medianOf(sampleWindow.slice(-RECENT_SIZE));
    const current = autoOutputLatencyMs.get();
    const next = Math.abs(recent - current) > JUMP_IMMEDIATE_MS
        ? recent
        : medianOf(sampleWindow);
    if (next !== current) autoOutputLatencyMs.set(next);
};

/** 由 App 挂载一次；重复调用无副作用。 */
export const startAudioOutputLatencyProber = (
    getElement: () => HTMLMediaElement | null,
    getContext?: () => AudioContext | null,
) => {
    if (timer !== null) return;
    timer = setInterval(() => tick(getElement, getContext), SAMPLE_INTERVAL_MS);
};

export const stopAudioOutputLatencyProber = () => {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
};

/** 关闭开关时调用：补偿清零并丢弃窗口，重新开启后重新探测。 */
export const resetAudioOutputLatencyProber = () => {
    stopAudioOutputLatencyProber();
    sampleWindow = [];
    autoOutputLatencyMs.set(0);
};
