import type { Line } from '../../types';

// src/utils/lyrics/lineTypeDetector.ts
// 段落类型判定：把每一行分成 chorus / rap / normal 三档，供视觉层选型。
// 只读判定，不改数据。与 chorusResolver 是不同层：chorus 来自外部标注（时间范围/文本重复），
// rap 走"每秒字数密度 + 前后防抖"启发式。判不准时宁可留 normal 也不硬升 rap，避免误伤半唱半念段。

export type LineType = 'chorus' | 'rap' | 'normal';

export interface RapThresholds {
    /** CJK 行的最低字数/秒。5.5 覆盖双截棍/浮夸类，慢歌过渡段（3~4 字/秒）不吃进。 */
    cjkMinDensity: number;
    /** 非 CJK 行的最低词数/秒。英文 3.5 词/秒 ≈ Eminem 中速段，Ed Sheeran 慢唱约 1.5。 */
    latinMinDensity: number;
    /** 本行最少几个发音单元，防止"哦/啊"这类 hook 短句被密度公式误判。 */
    minUnits: number;
    /** 本行最少秒数，防止 0/负时长或时间戳错乱的歌词炸除法。 */
    minDurationSeconds: number;
}

const DEFAULT_THRESHOLDS: RapThresholds = {
    cjkMinDensity: 5.5,
    latinMinDensity: 3.5,
    minUnits: 6,
    minDurationSeconds: 0.3,
};

const CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
const INTERLUDE_RE = /^[.\s·…~]+$/;

const hasCJK = (text: string): boolean => CJK_RE.test(text);

/**
 * 发音单元计数：words 是分词后的单元（中文一字一 word、英文一单词一 word），最贴近“咬字密度”。
 * 有的 lyric 只有整句 fullText 没 words：CJK 按字符数（一字一音），非 CJK 按空白切分（避免字符数把“hello world”当 11 单元虚报为 11 单元而非 2 词）。
 */
const countUnits = (line: Line): number => {
    if (line.words && line.words.length > 0) return line.words.length;
    const text = (line.fullText ?? '').trim();
    if (!text) return 0;
    if (hasCJK(text)) return text.length;
    return text.split(/\s+/).filter(Boolean).length;
};

const durationOf = (line: Line): number => {
    const start = line.startTime;
    const end = line.endTime;
    if (typeof start !== 'number' || typeof end !== 'number') return 0;
    return Math.max(0, end - start);
};

/** 单行"字/秒密集"判定。副歌不重复计 dense（外层已按 chorus 短路）。 */
const isDenseLine = (line: Line, t: RapThresholds): boolean => {
    if (!line) return false;
    if (line.isChorus === true) return false;
    const text = (line.fullText ?? '').trim();
    if (!text || INTERLUDE_RE.test(text)) return false;
    const dur = durationOf(line);
    if (dur < t.minDurationSeconds) return false;
    const units = countUnits(line);
    if (units < t.minUnits) return false;
    const density = units / dur;
    const threshold = hasCJK(text) ? t.cjkMinDensity : t.latinMinDensity;
    return density >= threshold;
};

/**
 * 单行判定：本行 dense 且（prev 或 next 也 dense）才升 rap。孤立密集行留 normal，
 * 避免"副歌前一句渐强"被误伤成 rap。chorus 优先级最高。
 */
export const classifyLineType = (
    line: Line,
    prev: Line | null,
    next: Line | null,
    thresholds: RapThresholds = DEFAULT_THRESHOLDS,
): LineType => {
    if (line?.isChorus === true) return 'chorus';
    if (!isDenseLine(line, thresholds)) return 'normal';
    const prevDense = prev ? isDenseLine(prev, thresholds) : false;
    const nextDense = next ? isDenseLine(next, thresholds) : false;
    return (prevDense || nextDense) ? 'rap' : 'normal';
};

/**
 * 批量版：给整首歌打标签，返回与 lines 同长的数组。内部缓存 dense 判定避免相邻重复计算。
 * 空/null/undefined 返回 []。
 */
export const annotateLineTypes = (
    lines: readonly Line[] | null | undefined,
    thresholds: RapThresholds = DEFAULT_THRESHOLDS,
): LineType[] => {
    if (!lines || lines.length === 0) return [];
    const denseCache = lines.map(l => isDenseLine(l, thresholds));
    const result: LineType[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line?.isChorus === true) {
            result[i] = 'chorus';
            continue;
        }
        if (!denseCache[i]) {
            result[i] = 'normal';
            continue;
        }
        const prevDense = i > 0 ? denseCache[i - 1] : false;
        const nextDense = i < lines.length - 1 ? denseCache[i + 1] : false;
        result[i] = (prevDense || nextDense) ? 'rap' : 'normal';
    }
    return result;
};
