import { describe, expect, it } from 'vitest';
import type { Line, Word } from '@/types';
import { annotateLineTypes, classifyLineType, type LineType } from '@/utils/lyrics/lineTypeDetector';

// test/unit/lyrics/lineTypeDetector.test.ts
// 覆盖三档判定的主干与边界：chorus 优先、连续密集升 rap、孤立密集防抖回 normal、
// 间奏/空行/时长异常/words 缺失兜底。

const mkWord = (text: string, s: number, e: number): Word => ({ text, startTime: s, endTime: e });

const mkLine = (opts: {
    fullText: string;
    startTime: number;
    endTime: number;
    /** 快速构造 N 个 word 单元；不传则用 words 显式给出。 */
    wordCount?: number;
    words?: Word[];
    isChorus?: boolean;
}): Line => {
    const words: Word[] = opts.words
        ?? Array.from({ length: opts.wordCount ?? 0 }, () => mkWord('字', opts.startTime, opts.endTime));
    return {
        words,
        startTime: opts.startTime,
        endTime: opts.endTime,
        fullText: opts.fullText,
        isChorus: opts.isChorus,
    } as Line;
};

describe('classifyLineType', () => {
    it('chorus 优先，即便密度爆表也不改判 rap', () => {
        const line = mkLine({ fullText: '副歌歌词', startTime: 10, endTime: 11, wordCount: 20, isChorus: true });
        expect(classifyLineType(line, null, null)).toBe('chorus');
    });

    it('连续两行 CJK 密集 → 判 rap', () => {
        // 10 字 / 2 秒 = 5 字/秒；再加相邻一行也过阈值
        const a = mkLine({ fullText: '一样密集的一句歌词', startTime: 0, endTime: 1.5, wordCount: 9 });
        const b = mkLine({ fullText: '找一支笔蘸墨写首诗', startTime: 1.5, endTime: 3, wordCount: 10 });
        expect(classifyLineType(b, a, null)).toBe('rap');
    });

    it('孤立密集行（前后疏）→ 防抖回 normal', () => {
        const prev = mkLine({ fullText: '安静', startTime: 0, endTime: 4, wordCount: 2 });
        const dense = mkLine({ fullText: '突然一句密集的说唱', startTime: 4, endTime: 6, wordCount: 10 });
        const next = mkLine({ fullText: '再归平静', startTime: 6, endTime: 10, wordCount: 3 });
        expect(classifyLineType(dense, prev, next)).toBe('normal');
    });

    it('英文密集段：10 词 / 2 秒 → rap', () => {
        const line = mkLine({ fullText: 'spread the words in a rapid flow', startTime: 0, endTime: 2, wordCount: 10 });
        const prev = mkLine({ fullText: 'another bar packed with lots of syllables here', startTime: -2, endTime: 0, wordCount: 12 });
        expect(classifyLineType(line, prev, null)).toBe('rap');
    });

    it('英文慢唱：5 词 / 4 秒 → normal', () => {
        const line = mkLine({ fullText: 'five slow words right here', startTime: 0, endTime: 4, wordCount: 5 });
        const prev = mkLine({ fullText: 'another lazy phrase too', startTime: -4, endTime: 0, wordCount: 5 });
        expect(classifyLineType(line, prev, null)).toBe('normal');
    });

    it('间奏 "......" → normal 且不炸', () => {
        const line = mkLine({ fullText: '......', startTime: 5, endTime: 8 });
        expect(classifyLineType(line, null, null)).toBe('normal');
    });

    it('words 缺失时按字数兼底（CJK）：10 字 / 1.5 秒 → rap', () => {
        // 中文句无 words 单元时，density 用字符数估算（一字一音）
        const line = mkLine({ fullText: '这一句里刚好十四字呀', startTime: 0, endTime: 1.5 });
        const prev = mkLine({ fullText: '前面也来十四字差不多', startTime: -1.5, endTime: 0 });
        expect(classifyLineType(line, prev, null)).toBe('rap');
    });
    
    it('words 缺失时按词数兼底（非 CJK）：12 字符但只 2 词 / 1 秒 → normal 不虚报', () => {
        // "hello world" 长度 11 但只有 2 词，1 秒 2 词 < 3.5 阈值 → normal
        const line = mkLine({ fullText: 'hello world', startTime: 0, endTime: 1 });
        const prev = mkLine({ fullText: 'good night', startTime: -1, endTime: 0 });
        expect(classifyLineType(line, prev, null)).toBe('normal');
    });

    it('时长为 0 → normal 不炸除法', () => {
        const l0 = mkLine({ fullText: '时间倒挂', startTime: 5, endTime: 5, wordCount: 8 });
        const neighbor = mkLine({ fullText: '正常密集的一行', startTime: 0, endTime: 1, wordCount: 8 });
        expect(classifyLineType(l0, neighbor, neighbor)).toBe('normal');
    });

    it('单词数不足 minUnits（如副歌前 hook 短句）→ normal', () => {
        // 4 字/0.5 秒 = 8 字/秒 密度爆表但 minUnits=6 拦住
        const dense = mkLine({ fullText: '啊啊啊啊', startTime: 0, endTime: 0.5, wordCount: 4 });
        const neighbor = mkLine({ fullText: '哎哎哎', startTime: -1, endTime: -0.4, wordCount: 3 });
        expect(classifyLineType(dense, neighbor, null)).toBe('normal');
    });
});

describe('annotateLineTypes', () => {
    it('四行整曲：慢-密-密-副歌 → normal / rap / rap / chorus', () => {
        const l1 = mkLine({ fullText: '慢一点', startTime: 0, endTime: 4, wordCount: 3 });
        const l2 = mkLine({ fullText: 'rap 段第一句密集一点', startTime: 4, endTime: 6, wordCount: 12 });
        const l3 = mkLine({ fullText: 'rap 段第二句同样很密', startTime: 6, endTime: 8, wordCount: 12 });
        const l4 = mkLine({ fullText: '副歌', startTime: 8, endTime: 12, wordCount: 4, isChorus: true });
        const types = annotateLineTypes([l1, l2, l3, l4]);
        expect(types).toEqual<LineType[]>(['normal', 'rap', 'rap', 'chorus']);
    });

    it('空/null/undefined → 空数组不抛', () => {
        expect(annotateLineTypes(null)).toEqual([]);
        expect(annotateLineTypes(undefined)).toEqual([]);
        expect(annotateLineTypes([])).toEqual([]);
    });

    it('单行密集无邻居 → 防抖判 normal（跟 classifyLineType 一致）', () => {
        const only = mkLine({ fullText: '孤零零一句特别密集', startTime: 0, endTime: 1, wordCount: 10 });
        expect(annotateLineTypes([only])).toEqual<LineType[]>(['normal']);
    });
});
