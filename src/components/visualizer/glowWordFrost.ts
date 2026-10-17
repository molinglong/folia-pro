// src/components/visualizer/glowWordFrost.ts
// 词粒度「字形磨砂」贴片：把每个词的字形挖成一张离屏 mask（白填充 + 白描边膨胀），交给 GlowWord
// 垫在 glow/body 层之下的一块 backdrop-filter 磨砂贴片使用——磨砂被剪成字的轮廓，透出被模糊的背景，
// 于是字本身就呈现磨砂玻璃观感。body 层再按各模式的字色叠在上面（流光-2 把字色压了 alpha）。
//
// mask 用 mask-size: 100% 100% 拉伸贴合词盒，所以字号 / 字体栈 / 字重必须与 GlowWord 同源才贴得住；
// pad 余量过大会被拉伸变形，保持 3px。无 canvas 环境（jsdom / SSR）返回 null，调用方跳过贴片。

/** 磨砂贴片参数（原型默认 blur 18 / brightness 1.4 / opacity 0.92）：流光-2 走「更清透」档，
 *  压暗提亮、降贴片浓度，让背景更看得透。要更奶白就把 OPACITY / BRIGHTNESS 往上调。 */
export const FROST_BLUR_PX = 16;
export const FROST_BRIGHTNESS = 1.12;
export const FROST_OPACITY = 0.3;

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

/** 画出词的字形 mask（白填充 + 4px 白描边膨胀）转 dataURL。 */
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
