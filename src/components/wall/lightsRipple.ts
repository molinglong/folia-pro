// src/components/wall/lightsRipple.ts — 涟漪熄灯（关灯/开灯切换）的共用延迟公式。
// Lattice 与 bravais 共用同一份灯光设置（useLatticeSettingsStore），也让它们共用同一份涟漪节奏：
// 以正在播放那张卡的世界坐标中心为原点，每张卡的熄灯层按与中心的欧氏距离延后启动。
// 相邻卡（CELL_SIZE + GAP = 136 世界单位）约 75ms，跨 5–6 列总时长约 450ms；上限 900ms 防极端布局拖尾。
export const LIGHTS_RIPPLE_MS_PER_UNIT = 0.55;
export const LIGHTS_RIPPLE_MAX_MS = 900;

export type LightsRippleRect = { x: number; y: number; width: number; height: number };
export type LightsRippleOrigin = { x: number; y: number } | null;

/** 卡片中心与涟漪中心的欧氏距离 → 熄灯层的 transitionDelay（ms）。origin 为 null 时返回 0（沿用旧行为）。 */
export const computeLightsRippleDelay = (
    rect: LightsRippleRect,
    origin: LightsRippleOrigin,
): number => {
    if (!origin) return 0;
    const dx = rect.x + rect.width / 2 - origin.x;
    const dy = rect.y + rect.height / 2 - origin.y;
    return Math.min(LIGHTS_RIPPLE_MAX_MS, Math.round(Math.sqrt(dx * dx + dy * dy) * LIGHTS_RIPPLE_MS_PER_UNIT));
};
