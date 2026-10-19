import type { LineType } from '../../../../utils/lyrics/lineTypeDetector';

// src/components/app/lattice/lyrics/latticeLyricBoost.ts
// 高潮/重音的歌词提亮增益。Lattice 走 Pixi 颜色 uniform 而非 CSS filter，而主题正文字色大多
// 接近纯白（默认 #f4f4f5），颜色乘上去逐通道直接碰到 1.0 天花板——所以光靠“乘字色”看不见。
// 真正的亮度余量在三处：光晕从半透不透明顶到实心（不透明度）、光晕改用加性合成（累加发光）、
// 副歌行把未唱的墨色压一档（拉落差）。倍数只驱动这三件，颜色缩放只对彩色主题起作用。

export interface LatticeBoostPreset {
    /** 段类型基座倍数（与 audioPower 无关）。 */
    base: number;
    /** 音频能量叠加权重。 */
    weight: number;
    /** 封顶倍数，防过曝。 */
    cap: number;
}

export const LATTICE_BOOST_PRESETS: Record<LineType, LatticeBoostPreset> = {
    chorus: { base: 1.60, weight: 0.70, cap: 2.60 },
    rap: { base: 1.20, weight: 0.50, cap: 2.00 },
    normal: { base: 1.00, weight: 0.35, cap: 1.70 },
};

/** 副歌行未唱部分的压暗系数：白字提不动，落差才是“更亮”。 */
export const LATTICE_CHORUS_BASE_DIM = 0.78;
/** 非副歌行的光晕不透明度上限（保持旧观感），副歌行顶到 1。 */
export const LATTICE_PLAIN_HALO_ALPHA = 0.88;

/**
 * audioPower 实际范围 0..255 且上游经 process(v,3) 立方压缩（见 usePlaybackVisualizerBridge），
 * 先开立方反压回线性再按档位叠加，与 classic 的 writeGlowBoost 保持同一口径。
 * chorus 档由调用侧用 line.isChorus 覆盖 annotateLineTypes 的判定（Lattice 原本就吃这个标注）。
 */
export const resolveLatticeBoost = (power: number, type: LineType): number => {
    const preset = LATTICE_BOOST_PRESETS[type];
    const norm = Math.max(0, Math.min(255, Number.isFinite(power) ? power : 0)) / 255;
    return Math.min(preset.cap, preset.base + Math.cbrt(norm) * preset.weight);
};

/**
 * 按通道缩放到 0..1（uWord 与 glow tint 都是逐通道消费的，直接乘会爆通道）；alpha 原样保留。
 * 写入 out 复用同一数组，避免每帧分配。
 */
export const scaleColor01 = (data: ArrayLike<number>, factor: number, out: number[]): number[] => {
    for (let i = 0; i < 3; i++) {
        const v = data[i] * factor;
        out[i] = v > 1 ? 1 : v < 0 ? 0 : v;
    }
    out[3] = data[3];
    return out;
};
