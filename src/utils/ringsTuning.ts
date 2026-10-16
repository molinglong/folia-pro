import { DEFAULT_RINGS_TUNING, type RingsTuning } from '../types';

// src/utils/ringsTuning.ts
// 年轮 tuning 的归一化：localStorage、同步、外观短码 / JSON 导入和 store setter 共用同一套钳制规则。

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

/**
 * 把任意输入收敛成合法的 RingsTuning：数值钳到各自区间，缺失或类型不对的字段回落到默认值。
 * 输入不是对象时直接返回默认值。
 */
export const normalizeRingsTuning = (value: unknown): RingsTuning => {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const d = DEFAULT_RINGS_TUNING;
    return {
        reach: clampNumber(raw.reach, d.reach, 0.4, 2),
        beatSensitivity: clampNumber(raw.beatSensitivity, d.beatSensitivity, 0.4, 2.5),
        sensitivity: clampNumber(raw.sensitivity, d.sensitivity, 0.2, 3),
        opacity: clampNumber(raw.opacity, d.opacity, 0.1, 1),
    };
};
