import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_AUTO_OUTPUT_LATENCY_MS,
    autoOutputLatencyMs,
    contextOutputLatencyMs,
    resetAudioOutputLatencyProber,
    sampleOutputLatencyMs,
    startAudioOutputLatencyProber,
} from '@/services/audioOutputLatencyProber';

// test/unit/services/audioOutputLatencyProber.test.ts
// 探测器的两条主张：一次不可信的读数绝不能变成补偿量；可信的读数要尽快生效但不能被
// 单次抖动带跑。数值本身来自 getOutputTimestamp 与交付位置之差，属于约定而非物理量，
// 所以这里用假元素把约定钉住。

type FakeElement = {
    paused: boolean;
    ended: boolean;
    currentTime: number;
    getOutputTimestamp?: () => { contextTime: number; presentationMs: number };
};

const makeElement = (overrides: Partial<FakeElement> = {}): FakeElement => ({
    paused: false,
    ended: false,
    currentTime: 10,
    getOutputTimestamp: () => ({ contextTime: 10, presentationMs: (10 - 0.187) * 1000 }),
    ...overrides,
});

describe('sampleOutputLatencyMs', () => {
    it('reads the gap between the delivered position and what actually reached the speaker', () => {
        expect(sampleOutputLatencyMs(makeElement() as never)).toBe(187);
    });

    it('returns null when the platform has no output timestamp at all', () => {
        const element = makeElement();
        delete element.getOutputTimestamp;
        expect(sampleOutputLatencyMs(element as never)).toBeNull();
    });

    it('returns null while nothing is sounding', () => {
        expect(sampleOutputLatencyMs(makeElement({ paused: true }) as never)).toBeNull();
        expect(sampleOutputLatencyMs(makeElement({ ended: true }) as never)).toBeNull();
    });

    it('returns null before any sample has been presented', () => {
        // presentationMs 为 0 是"还没有音频送到输出"，此时的差值等于整个播放位置。
        const element = makeElement({ getOutputTimestamp: () => ({ contextTime: 0, presentationMs: 0 }) });
        expect(sampleOutputLatencyMs(element as never)).toBeNull();
    });

    it('rejects readings that would delay the lyrics or run away past the cap', () => {
        const ahead = makeElement({ getOutputTimestamp: () => ({ contextTime: 10, presentationMs: 10_500 }) });
        expect(sampleOutputLatencyMs(ahead as never)).toBeNull();

        const absurd = makeElement({ getOutputTimestamp: () => ({ contextTime: 10, presentationMs: (10 - 3) * 1000 }) });
        expect(sampleOutputLatencyMs(absurd as never)).toBeNull();
        expect(sampleOutputLatencyMs(absurd as never, MAX_AUTO_OUTPUT_LATENCY_MS)).toBeNull();
        expect(sampleOutputLatencyMs(absurd as never, 4000)).toBe(3000);
    });

    it('survives a throwing getOutputTimestamp', () => {
        const element = makeElement({
            getOutputTimestamp: () => { throw new Error('not allowed'); },
        });
        expect(sampleOutputLatencyMs(element as never)).toBeNull();
    });
});

/** 每次采样依次吐出脚本里的延迟（秒），超出部分重复最后一项。 */
const scriptedElement = (latencySec: number[]) => {
    let call = 0;
    return () => makeElement({
        getOutputTimestamp: () => ({
            contextTime: 10,
            presentationMs: (10 - latencySec[Math.min(call++, latencySec.length - 1)]) * 1000,
        }),
    }) as never;
};

describe('contextOutputLatencyMs', () => {
    const context = (overrides: Record<string, unknown> = {}) => ({
        state: 'running',
        outputLatency: 0.026,
        ...overrides,
    } as unknown as AudioContext);

    it('reads the device latency the audio context reports', () => {
        expect(contextOutputLatencyMs(context())).toBe(26);
    });

    it('stays silent unless the context is actually running', () => {
        expect(contextOutputLatencyMs(context({ state: 'suspended' }))).toBeNull();
        expect(contextOutputLatencyMs(context({ outputLatency: 0 }))).toBeNull();
        expect(contextOutputLatencyMs(context({ outputLatency: undefined }))).toBeNull();
        expect(contextOutputLatencyMs(null)).toBeNull();
    });

    it('drops a latency past the trust cap', () => {
        expect(contextOutputLatencyMs(context({ outputLatency: 2.5 }))).toBeNull();
    });
});

describe('latency prober loop', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetAudioOutputLatencyProber();
    });

    afterEach(() => {
        resetAudioOutputLatencyProber();
        vi.useRealTimers();
    });

    it('adopts the first trustworthy reading without waiting for the window', () => {
        startAudioOutputLatencyProber(() => makeElement() as never);
        vi.advanceTimersByTime(500);
        expect(autoOutputLatencyMs.get()).toBe(187);
    });

    it('keeps the last good value when a reading is rejected', () => {
        let element: FakeElement = makeElement();
        startAudioOutputLatencyProber(() => element as never);
        vi.advanceTimersByTime(500);
        expect(autoOutputLatencyMs.get()).toBe(187);

        element = makeElement({ paused: true });
        vi.advanceTimersByTime(4000);
        expect(autoOutputLatencyMs.get()).toBe(187);
    });

    it('follows a sustained output-device switch without averaging it away', () => {
        // 前三个读数在 20ms 附近，之后跳到 240ms（换到蓝牙）。
        startAudioOutputLatencyProber(scriptedElement([0.02, 0.021, 0.019, 0.24, 0.24, 0.24]));

        vi.advanceTimersByTime(1500);
        expect(autoOutputLatencyMs.get()).toBe(20);

        // 单帧尖峰不算换设备（近窗里还有旧读数顶着），新水平上站稳两帧就采纳；
        // 否则要么被噪声带跑，要么得等整个长窗口排干。
        vi.advanceTimersByTime(500);
        expect(autoOutputLatencyMs.get()).toBe(21);
        vi.advanceTimersByTime(500);
        expect(autoOutputLatencyMs.get()).toBe(240);
    });

    it('falls back to the audio context only when the element cannot report at all', () => {
        const ctx = { state: 'running', outputLatency: 0.033 } as unknown as AudioContext;
        let element: FakeElement = makeElement();
        delete element.getOutputTimestamp;
        startAudioOutputLatencyProber(() => element as never, () => ctx);
        vi.advanceTimersByTime(500);
        expect(autoOutputLatencyMs.get()).toBe(33);

        // 主通道存在但读数不合格（一次暂停）：不能降级，否则暂停会把补偿量拉到另一个源头。
        element = makeElement({ paused: true });
        vi.advanceTimersByTime(2000);
        expect(autoOutputLatencyMs.get()).toBe(33);
    });

    it('ignores a lone spike', () => {
        startAudioOutputLatencyProber(scriptedElement([0.02, 0.02, 0.02, 0.4, 0.02, 0.02, 0.02, 0.02]));

        // 3 帧基线 + 1 帧 400ms 尖峰：尖峰那一帧必须仍停在 20ms。
        vi.advanceTimersByTime(2000);
        expect(autoOutputLatencyMs.get()).toBe(20);

        vi.advanceTimersByTime(4000);
        expect(autoOutputLatencyMs.get()).toBe(20);
    });
});
