import type { Line, Word } from '../../../../types';
import { buildMonetDisplayTokens } from '../../../visualizer/monet/monetLyricsModel';
import type { GraphemeTiming } from '../../../../utils/lyrics/graphemeTiming';
import { splitLyricGraphemes } from '../../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import type { MeasureText } from './latticeLyricLayout';

// src/components/app/lattice/lyrics/latticeLyricRowSplit.ts
// Lattice 的歌词一句只占一行。源句长到一行装不下时不折行，而是就地切成几段：
// 装不下的那截不再是"第二行"，而是"下一句"——它在自己那几个字真正开唱的时刻才上场。
// 切出来的段仍是普通 Line（words 带着各自的原时间），所以下游的时间线、扫色、辉光一行都不用改。

/** 切段的最小单位：一个有时间轴的词，或一段没有时间的标点/空格。 */
interface Atomic {
    text: string;
    start: number;
    end: number;
    timing: { start: number; end: number } | null;
    /** 自身宽度。行宽走累加而不是整串重量：排版那边本来就是一个词一段宽度地累加，两边算法一致才不会切完又折行。 */
    w: number;
}

const timed = (atom: Atomic) => atom.timing !== null;
const lastTimed = (atoms: Atomic[]) => {
    for (let i = atoms.length - 1; i >= 0; i--) if (timed(atoms[i])) return atoms[i].timing!;
    return null;
};
const firstTimed = (atoms: Atomic[]) => atoms.find(timed)?.timing ?? null;

/** 单个词比一行还宽（整句一词的 LRC、超长英文单词）时按字素切开，切口时间取字素时间表，没有就按时长比例。 */
function splitOversized(atom: Atomic, glyphs: GraphemeTiming[], maxWidth: number, width: (text: string) => number): Atomic[] {
    const graphemes = splitLyricGraphemes(atom.text);
    if (graphemes.length < 2) return [atom];
    const exact = glyphs.length === graphemes.length ? glyphs : null;
    const span = atom.timing ? atom.timing.end - atom.timing.start : 0;
    // 切点 i 既是前一块的结束也是后一块的开始：有逐字时间表就取该字素的起唱时刻，
    // 末尾越界时回退到最后一个字素的结束（它就是原子的结束）；没有就按时长等分。
    const edge = (index: number, fallback: number) => {
        if (exact) return index < graphemes.length ? exact[index].startTime : exact[graphemes.length - 1].endTime;
        return atom.timing ? atom.timing.start + span * (index / graphemes.length) : fallback;
    };
    const parts: Atomic[] = [];
    let buffer = '', bufferStart = 0, bufferWidth = 0;
    const flush = (cut: number, timed = true) => {
        if (!buffer) return;
        const start = edge(bufferStart, atom.start);
        const end = Math.max(start, edge(cut, atom.end));
        parts.push({
            text: buffer, start: atom.start + bufferStart, end: atom.start + cut,
            // 换行符本身不唱，它跟着前一句的尾巴走；当词用会让下一段凭空多出一个占位字。
            timing: atom.timing && timed ? { start, end } : null,
            w: bufferWidth,
        });
        buffer = ''; bufferStart = cut; bufferWidth = 0;
    };
    for (let i = 0; i < graphemes.length; i++) {
        // 换行符不论宽不宽都硬断一段：源词表里的显式断行不能被并回一行。
        if (graphemes[i] === '\n') {
            flush(i);
            buffer = graphemes[i]; bufferStart = i;
            flush(i + 1, false);
            continue;
        }
        // 同一个词内部按前缀量宽，与 wrapLatticeTokens 在同一词内的取数方式一致。
        const next = buffer + graphemes[i];
        const nextWidth = width(next);
        if (buffer && nextWidth > maxWidth) { flush(i); buffer = graphemes[i]; bufferWidth = width(graphemes[i]); continue; }
        buffer = next; bufferWidth = nextWidth;
    }
    flush(graphemes.length);
    return parts.length > 0 ? parts : [atom];
}

function buildAtoms(line: Line, maxWidth: number, width: (text: string) => number): Atomic[] {
    const atoms: Atomic[] = [];
    for (const token of buildMonetDisplayTokens(line)) {
        if (!token.text) continue;
        const timing = token.timed && token.startTime !== null && token.endTime !== null
            ? { start: token.startTime, end: token.endTime } : null;
        const atom: Atomic = { text: token.text, start: token.startOffset, end: token.endOffset, timing, w: width(token.text) };
        // 只有塞不满一行的词才需要拆开；普通词整块进贪心打包。
        if (atom.w > maxWidth || token.text.includes('\n')) {
            atoms.push(...splitOversized(atom, token.graphemeTimings, maxWidth, width));
        } else atoms.push(atom);
    }
    return atoms;
}

/** 贪心打包：能塞进一行的原子就塞，装满就断段。 */
function packRows(atoms: Atomic[], maxWidth: number): Atomic[][] {
    const rows: Atomic[][] = [];
    let start = 0;
    while (start < atoms.length) {
        let keep = start, used = 0, hardBreak = false;
        while (keep < atoms.length) {
            const atom = atoms[keep];
            // 首原子无条件收下：拆到字素还超宽的是单个巨型字，吐回去就死循环了。
            if (keep > start && used + atom.w > maxWidth) break;
            used += atom.w; keep++;
            if (atom.text.endsWith('\n')) { hardBreak = true; break; }
        }
        // 走到这里说下一原子肯定塞不下了（装满判断用的就是同一个累加宽度）。
        // 它要是没时间的标点/空格，就把行尾连词带标点一并挤到下一句去：
        // 宁可这一行少唱一个词，也不让逗号开下一句的头——那读起来像句子被腰斩。
        if (!hardBreak && keep < atoms.length && !timed(atoms[keep])) {
            let prev = keep - 1;
            while (prev > start && !timed(atoms[prev])) prev--;
            if (prev > start) keep = prev;
        }
        if (keep <= start) keep = start + 1;
        rows.push(atoms.slice(start, keep));
        start = keep;
    }
    return rows;
}

/** 取第 index 段应得的副文本：没有原文就没有，切出来是空串也当作没有。 */
function sliceAux(text: string | undefined, cuts: number[], index: number): string | undefined {
    if (!text || cuts.length < 2) return undefined;
    return text.slice(cuts[index], cuts[index + 1]) || undefined;
}

/** 副文本按各段的字数占比切；最后一段永远拿走剩下的全部，避免四舍五入丢字。 */
function auxCuts(timedChars: number[], text?: string): number[] {
    if (!text) return timedChars.map(() => 0);
    const total = timedChars.reduce((sum, count) => sum + count, 0) || 1;
    const cuts: number[] = [0];
    let run = 0;
    for (let i = 0; i < timedChars.length - 1; i++) {
        run += timedChars[i];
        cuts.push(Math.min(text.length, Math.max(cuts[i], Math.round(run / total * text.length))));
    }
    cuts.push(text.length);
    return cuts;
}

function buildRowLine(line: Line, atoms: Atomic[], index: number, rows: Atomic[][],
    startTime: number, endTime: number, translationCuts: number[], romanizationCuts: number[]): Line {
    const words: Word[] = atoms.filter(timed)
        .map(atom => ({ text: atom.text, startTime: atom.timing!.start, endTime: atom.timing!.end }));
    // 停留提示属于整句的收尾，只有最后一段能继承，否则前面几段会一起赖在屏幕上。
    const row: Line = {
        ...line,
        words,
        fullText: line.fullText.slice(atoms[0].start, atoms[atoms.length - 1].end),
        startTime, endTime,
        translation: sliceAux(line.translation, translationCuts, index),
        romanization: sliceAux(line.romanization, romanizationCuts, index),
        renderHints: index === rows.length - 1 ? line.renderHints : undefined,
        // id 唯一标识源句；重复挂到多段上会让按 key 复用的地方串台。
        ...(index === 0 ? {} : { id: undefined }),
    };
    // 源句有逐字时间却一段字都没落到（整段是标点）时铺一个占位词，免得下游按空 words 折回全行时间。
    if (words.length === 0 && line.words.length > 0) row.words = [{ text: row.fullText, startTime, endTime }];
    return row;
}

/**
 * 留一点余量：切段量的是每个词自己的宽度，排版再把这些宽度累加到行上，两边取数总有零点几像素的差。
 * 不留就会出现差一两个字又折一行的情况，正好破掉“一句只占一行”的承诺。
 */
const LATTICE_ROW_SLACK_PX = 2;

/** 一句 → 若干"每句一行"的显示句。装得下就原样返回（保持引用，视图与时间线都不必重建）。 */
export function splitLatticeLineToRows(line: Line, maxWidth: number, font: string, measure: MeasureText): Line[] {
    if (!line.fullText) return [line];
    const capacity = Math.max(1, maxWidth - LATTICE_ROW_SLACK_PX);
    const width = (text: string) => measure(text, font).width;
    const rows = packRows(buildAtoms(line, capacity, width), capacity);
    // 不拿整串重量抄近路：英文里整串重量比逐词累加窄（kerning），照它判会漏掉一个真的装不下的句子。
    if (rows.length <= 1 && !line.fullText.includes('\n')) return [line];
    const boundaries: number[] = [];
    let previousEnd = line.startTime;
    for (let i = 0; i < rows.length; i++) {
        // 上一段的结束就是下一段的开始：交接不留空档，否则切到中间时会出现"当前句消失"的一瞬。
        const start = i === 0 ? line.startTime : (firstTimed(rows[i])?.start ?? previousEnd);
        const nextStart = i === rows.length - 1 ? null : firstTimed(rows[i + 1])?.start ?? null;
        const end = nextStart ?? lastTimed(rows[i])?.end ?? line.endTime;
        boundaries.push(start);
        // 收尾那段继承整句的停留时长，否则切段后句子唱完就立刻消失，长句比短句少一截余韵。
        const hold = i === rows.length - 1 ? getLineRenderEndTime(line) : 0;
        const resolved = Math.max(end, hold);
        boundaries.push(resolved);
        previousEnd = Math.max(start + 0.001, resolved);
    }
    // boundaries 是 [start0, end0, start1, end1, ...]；end_i 与 start_{i+1} 已强制相等。
    const timedChars = rows.map(row => row.filter(timed).reduce((sum, atom) => sum + atom.text.length, 0));
    const translation = auxCuts(timedChars, line.translation);
    const romanization = auxCuts(timedChars, line.romanization);
    return rows.map((row, index) => buildRowLine(line, row, index, rows,
        boundaries[index * 2], boundaries[index * 2 + 1], translation, romanization));
}

/** 整份词表按同一容量切段；一行装得下的句子原样透传。 */
export function splitLatticeLinesToRows(lines: Line[], maxWidth: number, font: string, measure: MeasureText): Line[] {
    const out: Line[] = [];
    for (const line of lines) out.push(...splitLatticeLineToRows(line, maxWidth, font, measure));
    return out;
}
