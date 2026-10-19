import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import type { Line } from '../../../src/types';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { layoutLatticeLine, resolveLatticeTypography, type MeasureText }
    from '../../../src/components/app/lattice/lyrics/latticeLyricLayout';
import { splitLatticeLineToRows, splitLatticeLinesToRows }
    from '../../../src/components/app/lattice/lyrics/latticeLyricRowSplit';
import { buildLineRenderHints } from '../../../src/utils/lyrics/renderHints';

// test/unit/lattice/latticeLyricRowSplit.test.ts
// 一个字符 10px：maxWidth 37 时容量是 35，一行恰好塞 3 个字符。
const measure: MeasureText = (text) => ({ width: [...text].length * 10, height: 20 });
const font = '600 20px sans-serif';
const MAX_WIDTH = 37;

const worded = (text: string, words: [string, number, number][], patch: Partial<Line> = {}): Line => ({
    fullText: text, startTime: words[0]?.[1] ?? 0, endTime: words[words.length - 1]?.[2] ?? 1,
    words: words.map(([word, start, end]) => ({ text: word, startTime: start, endTime: end })),
    ...patch,
});

const split = (line: Line) => splitLatticeLineToRows(line, MAX_WIDTH, font, measure);

describe('Lattice 一句一行切段', () => {
    it('一行装得下的句子原样透传，引用都不变', () => {
        const short = worded('一二三', [['一二', 0, 1], ['三', 2, 3]]);
        expect(split(short)).toEqual([short]);
        expect(split(short)[0]).toBe(short);
        const empty: Line = { fullText: '', words: [], startTime: 0, endTime: 1 };
        expect(split(empty)[0]).toBe(empty);
    });

    it('超长的源句切成多段，字一个字都不丢也不重复', () => {
        const line = worded('一二三四五六七八九十',
            [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7], ['九十', 8, 9]]);
        const rows = split(line);
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.map(row => row.fullText).join('')).toBe(line.fullText);
        expect(rows.flatMap(row => row.words.map(word => word.text))).toEqual(line.words.map(word => word.text));
        // 每段都还在自己那几个字的原时间轴上，没有因为切段被挪后或提前。
        for (const row of rows) for (const word of row.words) {
            const source = line.words.find(item => item.text === word.text);
            expect(word.startTime).toBe(source!.startTime);
            expect(word.endTime).toBe(source!.endTime);
        }
    });

    it('段与段首尾无缝且单调，交接时不会有一句空档', () => {
        const line = worded('一二三四五六七八九十',
            [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7], ['九十', 8, 9]]);
        const rows = split(line);
        expect(rows[0].startTime).toBe(line.startTime);
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].startTime).toBe(rows[i - 1].endTime);
            expect(rows[i].endTime).toBeGreaterThan(rows[i].startTime);
        }
        // 末段继承整句的停留时长，唱完不该立刻消失。
        expect(rows[rows.length - 1].endTime).toBeGreaterThanOrEqual(line.endTime);
    });

    it('每段都只占一行：切完再排版，行数恒为一', () => {
        // 切段用的容量必须和排版用的是同一个宽度，否则切完照样折行，这个测试就是专门钉住这一点的。
        const box = 160;
        const type = resolveLatticeTypography({
            songKey: 'a', lines: [], currentLineIndex: -1, currentTime: motionValue(0),
            audioPower: motionValue(0), theme: DEFAULT_THEME, keywordColoringEnabled: true,
            reducedMotion: false, fontsEpoch: 0,
        }, box, 500, measure);
        const capacity = Math.max(1, box - type.padding * 2);
        const text = '一二三四五六七八九十'.repeat(2);
        const line = worded(text, [...text.match(/.{2}/g)!].flatMap((pair, i) => [[pair, i * 2, i * 2 + 1] as [string, number, number]]));
        const rows = splitLatticeLineToRows(line, capacity, type.font, measure);
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.map(row => row.fullText).join('')).toBe(text);
        for (const row of rows) {
            expect(layoutLatticeLine(row, type, capacity, measure, false).rows).toBe(1);
        }
    });

    it('标点不会开下一段的头', () => {
        const line = worded('一二三，四五六七八', [
            ['一', 0, 0.5], ['二', 0.5, 1], ['三', 1, 1.5], ['四', 1.5, 2],
            ['五', 2, 2.5], ['六', 2.5, 3], ['七', 3, 3.5], ['八', 3.5, 4]]);
        const rows = split(line);
        expect(rows.length).toBeGreaterThan(1);
        for (const row of rows) expect(/^[，。！？、\s]/.test(row.fullText)).toBe(false);
        expect(rows.map(row => row.fullText).join('')).toBe(line.fullText);
    });

    it('标点塞得下就跟着这一句，不被断段策略挤走', () => {
        // 一个逗只占 5px：容量 35 刚好装下“三个字 + 一个逗”。
        const narrow: MeasureText = (text) => ({ width: [...text].reduce((sum, char) => sum + (char === '，' ? 5 : 10), 0), height: 20 });
        const line = worded('一二三，四五六', [['一', 0, 1], ['二', 1, 2], ['三', 2, 3], ['四', 3, 4], ['五', 4, 5], ['六', 5, 6]]);
        const rows = splitLatticeLineToRows(line, MAX_WIDTH, font, narrow);
        expect(rows.map(row => row.fullText)).toEqual(['一二三，', '四五六']);
    });

    it('源词表里的显式换行强制断段，即使两个半句都合得下', () => {
        const line = worded('一二\n三四五六', [['一二\n三四', 0, 1], ['五六', 2, 3]]);
        const rows = split(line);
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.map(row => row.fullText).join('')).toBe(line.fullText);
        expect(rows.some(row => row.fullText.includes('\n'))).toBe(true);
    });

    it('整句一词的 LRC：超宽的词按字素切开，切口时间落在字素起唱时刻', () => {
        const line: Line = { fullText: '一二三四五六', startTime: 0, endTime: 6,
            words: [{ text: '一二三四五六', startTime: 0, endTime: 6 }] };
        const rows = split(line);
        expect(rows.length).toBe(2);
        expect(rows.map(row => row.fullText)).toEqual(['一二三', '四五六']);
        expect(rows[0].startTime).toBe(0);
        expect(rows[1].startTime).toBeCloseTo(rows[0].endTime, 6);
        expect(rows[1].endTime).toBeGreaterThanOrEqual(6);
    });

    it('没有逐字时间的整句 token 也能切开，时间按时长等分', () => {
        const line: Line = { fullText: '一二三四五六七八', startTime: 10, endTime: 14, words: [] };
        const rows = split(line);
        expect(rows.map(row => row.fullText).join('')).toBe(line.fullText);
        for (const row of rows) expect(row.words.length).toBeGreaterThan(0);
        expect(rows[0].startTime).toBe(10);
        expect(rows[0].endTime).toBeLessThan(14);
    });

    it('译文与音译按字数占比分给各段，最后一段拿走余下的字', () => {
        const line = worded('一二三四五六七八九十',
            [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7], ['九十', 8, 9]],
            { translation: 'ABCDEFGHIJ', romanization: 'yi-san-jiu' });
        const rows = split(line);
        expect(rows.map(row => row.translation ?? '').join('')).toBe('ABCDEFGHIJ');
        expect(rows.map(row => row.romanization ?? '').join('')).toBe('yi-san-jiu');
        expect(rows.slice(0, -1).every(row => row.translation)).toBe(true);
    });

    it('停留提示只归最后一段，源句 id 只归第一段', () => {
        const line = worded('一二三四五六七八九十',
            [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7], ['九十', 8, 9]],
            { id: 'line-1', renderHints: buildLineRenderHints({ startTime: 0, endTime: 9, words: [] }) });
        const rows = split(line);
        expect(rows[0].id).toBe('line-1');
        expect(rows.slice(1).every(row => row.id === undefined)).toBe(true);
        expect(rows.slice(0, -1).every(row => row.renderHints === undefined)).toBe(true);
        expect(rows[rows.length - 1].renderHints).toBe(line.renderHints);
    });

    it('isChorus 一类的段标记随每一段继承，提亮档位不会因为切段丢失', () => {
        const line = worded('一二三四五六七八九十',
            [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7], ['九十', 8, 9]],
            { isChorus: true });
        expect(split(line).every(row => row.isChorus === true)).toBe(true);
    });

    it('整份词表里装得下的句子保持引用，只有超长句才被改写', () => {
        const short = worded('一二', [['一二', 0, 1]]);
        const long = worded('一二三四五六七八', [['一二', 0, 1], ['三四', 2, 3], ['五六', 4, 5], ['七八', 6, 7]]);
        const rows = splitLatticeLinesToRows([short, long], MAX_WIDTH, font, measure);
        expect(rows[0]).toBe(short);
        expect(rows.length).toBeGreaterThan(2);
        expect(rows[1]).not.toBe(long);
        expect(rows.slice(1).map(row => row.fullText).join('')).toBe(long.fullText);
    });
});
