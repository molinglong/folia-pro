import type { ProviderArtistSummary, ProviderCollection } from '../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../../core/contracts/collection';
import type { BravaisSeamBylineData } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisBylineProjection.ts
// @fork 本地魔改版：缝里标题下的「署名行」投影——专辑的艺人与发行信息。
// 数据与网格信息面板的专辑块同一份规则（grid/collection/GridView.tsx：L1434-1437 取值、L1720-1757 排版、
// L204-221 两个格式化函数）：资源的详情（CollectionResourceSnapshot.detail）盖在集合描述上、只有专辑集合有这一块、
// 年份 / 流派 / 时长只有 Navidrome 的集合带。这里只产出已排好的展示文字与回调，画不画由缝决定。
// 与网格各写一份格式化函数（不抽公共 util）：动 GridView.tsx 会让每次同步上游都冲突，而这两个函数各不到 10 行。

/** 发行日期：与网格一样交给本地化（不自己拼格式）。 */
const formatAlbumDate = (timestamp?: number) => {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

/** 专辑总时长：provider 给的单位不统一（秒或毫秒），沿用网格那条 >10000 就当毫秒的判断。 */
const formatAlbumDuration = (duration?: number) => {
    if (!duration || !Number.isFinite(duration)) return '';
    const totalSeconds = duration > 10000 ? Math.round(duration / 1000) : Math.round(duration);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export type BravaisSeamBylineInput = {
    collection: LibraryCollectionDescriptor;
    /** 在线集合的详情（封面、发行信息…），没有时为 null。 */
    detail: ProviderCollection | null;
    /** 只有专辑集合有这一块（与网格的 isAlbumCollection 同一条规则）。 */
    isAlbum: boolean;
    /** suite 声明了 open-artist：艺人才做成能点的按钮，否则只是文字。 */
    canOpenArtist: boolean;
    onOpenArtist: (artist: ProviderArtistSummary) => void;
};

/** 专辑的署名行；什么可显示的都没有时为 undefined（缝里不占位）。 */
export const projectBravaisSeamByline = (input: BravaisSeamBylineInput): BravaisSeamBylineData | undefined => {
    if (!input.isAlbum) return undefined;
    // 与网格同一条规则：详情盖在集合描述上——逐字段「详情里有这个键就以详情为准（哪怕是 undefined 的空值），
    // 键不在才回退描述」，与 resolveCollectionDescription 的 hasOwnProperty 判法同义（展开只覆盖详情里存在的键）。
    const info = { ...input.collection, ...(input.detail ?? {}) } as LibraryCollectionDescriptor & Partial<ProviderCollection>;

    const named = (Array.isArray(info.artists) ? info.artists : [])
        .filter((artist): artist is ProviderArtistSummary => Boolean(artist) && typeof artist.name === 'string' && artist.name.trim() !== '')
        .map(artist => ({
            name: artist.name.trim(),
            onOpen: input.canOpenArtist ? () => input.onOpenArtist(artist) : undefined,
        }));
    // 没有艺人列表时退到专辑歌手（网格 L1739-1741 同一条）：它没有 id，只画文字。
    const artists = named.length || !info.albumArtist
        ? named
        : [{ name: info.albumArtist.trim(), onOpen: undefined as (() => void) | undefined }];

    const isNavidrome = info.source === 'navidrome';
    const yearText = isNavidrome && info.albumYear ? String(info.albumYear) : '';
    // Navidrome 集合描述里的 publishedAt 是专辑年份拼出来的「1 月 1 日」（gridViewCollectionAdapters.ts:103）——
    // 网格把这一串和裸年份各画一行，等于「2020/1/1 … 2020 …」说两遍。缝里反过来：详情真给了发行日才用完整日期，
    // 只有描述上那个拼出来的日期时显示裸年份。在线集合的详情带 publishedAt，照旧走完整日期。
    const detailHasDate = Boolean(input.detail) && Object.prototype.hasOwnProperty.call(input.detail, 'publishedAt');
    const dateText = isNavidrome && !detailHasDate ? '' : formatAlbumDate(info.publishedAt);
    // 完整日期在场时去掉裸年份：「2020 · 2020/1/5」是同一件事说两遍。按本地化后的文字判断而不是自己拼 ISO——
    // toLocaleDateString 在各 locale 下分隔符不同（- / . 年月日），只有「日期串里含这个年份」是通用事实。
    const yearIsRedundant = Boolean(yearText) && dateText.includes(yearText);
    const facts = [
        dateText,
        (info.publisher ?? '').trim(),
        yearIsRedundant ? '' : yearText,
        isNavidrome ? (info.albumGenre ?? '').trim() : '',
        isNavidrome ? formatAlbumDuration(info.albumDuration) : '',
    ].filter(Boolean);
    const line = facts.join(' · ');
    if (artists.length === 0 && !line) return undefined;
    return { artists, facts: line ? [line] : [] };
};
