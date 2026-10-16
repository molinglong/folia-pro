// src/components/visualizer/glowWordFrost.ts
// MV 背景变体的词级毛玻璃贴片：字形 mask 生成与激活判定。
//
// 来源是 preview-lyric-frosted 原型的「逐字毛玻璃」形态：磨砂贴片垫在 glow/body 层之下，
// 被 mask 成词的字形（离屏 canvas 白填充 + 白描边膨胀），未唱的雾字透出磨砂亮块，
// 唱到后 body 层的实色盖在磨砂上 —— 可读性由磨砂负责，不靠投影硬压。
// 贴片单位是词而不是字：body 层本来就是词粒度变色，且每词一片把合成层数量压到行内词数
// 级别（原型注明 blur 半径开大时逐字贴片的合成开销明显上升，落地要设上限）。

/** 毛玻璃参数（原型默认 blur 18 / brightness 1.4 / alpha 0.92，落地略收敛控合成开销）。 */
export const FROST_BLUR_PX = 16;
export const FROST_BRIGHTNESS = 1.35;
export const FROST_OPACITY = 0.9;

/** classic 的 MV 变体只在背景类型真的是 mv 且当前歌解析出了 MV 流时激活。 */
export const resolveClassicMvFrostActive = (
    backgroundMode: string | null | undefined,
    mvUrl: string | null,
): boolean => backgroundMode === 'mv' && !!mvUrl;

const FROST_MASK_CACHE_LIMIT = 256;
const frostMaskCache = new Map<string, string | null>();

let frostMeasureContext: CanvasRenderingContext2D | null | undefined;
const measureFrostWidth = (text: string, pxSize: number, fontStack: string, fontWeight: number): number => {
    if (frostMeasureContext === undefined) {
        const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
        frostMeasureContext = canvas ? canvas.getContext('2d') : null;
    }
    if (!frostMeasureContext) return text.length * pxSize * 0.65;
    frostMeasureContext.font = `${fontWeight} ${pxSize}px ${fontStack}`;
    return frostMeasureContext.measureText(text).width;
};

/**
 * 画出词的字形 mask（白填充 + 4px 白描边膨胀）转 dataURL。mask 以 mask-size: 100% 100%
 * 拉伸贴合词盒，字号 / 字体栈 / 字重必须与 GlowWord 同源才能贴住笔画；pad 余量过大时
 * 拉伸形变明显，保持原型的 3px。无 canvas 环境（jsdom / SSR）返回 null，调用方跳过贴片。
 */
export const buildWordFrostMaskUrl = (
    text: string,
    pxSize: number,
    fontStack: string,
    fontWeight: number,
): string | null => {
    const key = `${text}|${pxSize}|${fontWeight}|${fontStack}`;
    const cached = frostMaskCache.get(key);
    if (cached !== undefined) return cached;

    let url: string | null = null;
    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
            const pad = 3;
            canvas.width = Math.ceil(measureFrostWidth(text, pxSize, fontStack, fontWeight)) + pad * 2;
            canvas.height = Math.ceil(pxSize * 1.5) + pad * 2;
            // 赋值 width/height 会重置 context 状态，font 必须在尺寸之后设置。
            context.font = `${fontWeight} ${pxSize}px ${fontStack}`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.lineWidth = 4;
            context.strokeStyle = '#fff';
            context.fillStyle = '#fff';
            context.strokeText(text, canvas.width / 2, canvas.height / 2);
            context.fillText(text, canvas.width / 2, canvas.height / 2);
            url = canvas.toDataURL();
        }
    }

    if (frostMaskCache.size >= FROST_MASK_CACHE_LIMIT) frostMaskCache.clear();
    frostMaskCache.set(key, url);
    return url;
};
