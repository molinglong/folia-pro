import { describe, expect, it, vi } from 'vitest';
import type { ProviderCollection } from '@/types/onlineMusic';
import type { LibraryCollectionDescriptor } from '@/library/core/contracts/collection';
import { projectBravaisSeamByline } from '@/library/suites/bravais/bravaisBylineProjection';

// test/unit/library/bravais/bravaisBylineProjection.test.ts
// @fork 本地魔改版：缝里署名行的投影。判的是「与网格信息面板的专辑块同一条规则」：只有专辑有这一块、
// 详情盖在集合描述上、年份 / 流派 / 时长只有 Navidrome 带、艺人能不能点是 suite 的声明决定的、裸年份不重复说。

const localAlbum = (extra: Partial<LibraryCollectionDescriptor> = {}): LibraryCollectionDescriptor => ({
    source: 'local',
    type: 'album',
    id: 'album-1',
    name: '原神',
    songIds: [],
    ...extra,
} as LibraryCollectionDescriptor);

const navidromeAlbum = (extra: Partial<LibraryCollectionDescriptor> = {}): LibraryCollectionDescriptor => ({
    source: 'navidrome',
    type: 'album',
    id: 'nd-1',
    name: '大荒',
    ...extra,
} as LibraryCollectionDescriptor);

const detail = (extra: Partial<ProviderCollection> = {}): ProviderCollection => ({
    providerId: 'netease',
    id: 'remote-1',
    name: '原神',
    type: 'album',
    ...extra,
});

const dateText = (timestamp: number) => new Date(timestamp).toLocaleDateString();

describe('bravais seam byline', () => {
    it('只给专辑投影，其它集合与没有任何可显示信息的专辑都不占位', () => {
        const open = vi.fn();
        const base = { canOpenArtist: false, onOpenArtist: open };
        expect(projectBravaisSeamByline({ ...base, collection: localAlbum({ type: 'playlist' }), detail: detail({ artists: [{ id: 1, name: '陈致逸' }] }), isAlbum: false })).toBeUndefined();
        // 不是专辑（歌单 / 文件夹）：即便详情带了艺人也不画——与网格的 isAlbumCollection 同一条门。
        expect(projectBravaisSeamByline({ ...base, collection: localAlbum(), detail: null, isAlbum: false })).toBeUndefined();
        // 专辑但什么元数据都没有：undefined，缝里整块不出现。
        expect(projectBravaisSeamByline({ ...base, collection: localAlbum(), detail: null, isAlbum: true })).toBeUndefined();
        // 只有空白字段的当作没有。
        expect(projectBravaisSeamByline({
            ...base, isAlbum: true, detail: detail({ artists: [{ id: 1, name: '  ' }] }), collection: localAlbum({ publisher: '  ' }),
        })).toBeUndefined();
    });

    it('详情盖在集合描述上，艺人按声明决定能不能点', () => {
        const onOpenArtist = vi.fn();
        const artist = { id: 42, name: '陈致逸' };
        const byline = projectBravaisSeamByline({
            collection: localAlbum({ artists: [{ id: 1, name: '集合上的旧艺人' }], publisher: '集合上的出版方', publishedAt: 1500000000000 }),
            detail: detail({ artists: [artist], publisher: 'HOYO-MiX', publishedAt: 1595548800000 }),
            isAlbum: true,
            canOpenArtist: true,
            onOpenArtist,
        });
        expect(byline?.artists).toHaveLength(1);
        expect(byline?.artists[0].name).toBe('陈致逸');
        // 日期与出版方都以详情为准（与网格的 { ...descriptor, ...detail } 同一条）。
        expect(byline?.facts).toEqual([`${dateText(1595548800000)} · HOYO-MiX`]);
        expect(byline?.artists[0].onOpen).toBeTypeOf('function');
        byline?.artists[0].onOpen?.();
        expect(onOpenArtist).toHaveBeenCalledWith(artist);

        // suite 没声明 open-artist：同一份数据只画纯文本，onOpen 不给（组件那边就不渲染按钮）。
        const plain = projectBravaisSeamByline({
            collection: localAlbum(), detail: detail({ artists: [artist] }), isAlbum: true, canOpenArtist: false, onOpenArtist,
        });
        expect(plain?.artists).toEqual([{ name: '陈致逸', onOpen: undefined }]);
    });

    it('详情里有这个字段才算盖（显式 undefined 也算），没有这个字段才回退描述', () => {
        const collection = localAlbum({ artists: [{ id: 1, name: '集合上的艺人' }], publisher: '集合上的出版方' });
        // 详情带了 artists 这个键、值是 undefined：以详情为准 → 艺人这行没了，但描述上的发行方仍在。
        // 挡的是「把 undefined 当作没有、再回退描述」那一版写法（raw ?? descriptor 之类）。
        const blanked = projectBravaisSeamByline({
            collection, detail: { ...detail(), artists: undefined }, isAlbum: true, canOpenArtist: true, onOpenArtist: () => { },
        });
        expect(blanked?.artists).toEqual([]);
        expect(blanked?.facts).toEqual(['集合上的出版方']);
        // 详情压根没有 artists / publisher 这两个键：这两个字段回退集合描述。
        const untouched = projectBravaisSeamByline({
            collection, detail: detail(), isAlbum: true, canOpenArtist: true, onOpenArtist: () => { },
        });
        expect(untouched?.artists).toEqual([{ name: '集合上的艺人', onOpen: expect.any(Function) }]);
        expect(untouched?.facts).toEqual(['集合上的出版方']);
    });

    it('没有艺人列表时退到专辑歌手，且不可点', () => {
        const onOpenArtist = vi.fn();
        const byline = projectBravaisSeamByline({
            collection: localAlbum({ albumArtist: 'HOYO-MiX' }), detail: null, isAlbum: true, canOpenArtist: true, onOpenArtist,
        });
        expect(byline?.artists).toEqual([{ name: 'HOYO-MiX', onOpen: undefined }]);
        expect(onOpenArtist).not.toHaveBeenCalled();
    });

    it('年份 / 流派 / 时长只有 Navidrome 带，且与完整日期不重复说', () => {
        const publishedAt = 1577836800000; // 2020-01-01（本地时区），裸年份与它同一年
        const withExtras = projectBravaisSeamByline({
            collection: navidromeAlbum({ albumYear: 2020, albumGenre: '原声', albumDuration: 4353 }),
            detail: detail({ publishedAt, publisher: 'HOYO-MiX' }),
            isAlbum: true, canOpenArtist: false, onOpenArtist: () => { },
        });
        // 2020 这个裸年份被去掉（完整日期已经在场），时长按秒格式化。
        expect(withExtras?.facts).toEqual([`${dateText(publishedAt)} · HOYO-MiX · 原声 · 1:12:33`]);

        // 只有裸年份（没有完整日期）时它留下来。
        const yearOnly = projectBravaisSeamByline({
            collection: navidromeAlbum({ albumYear: 1999 }), detail: null, isAlbum: true, canOpenArtist: false, onOpenArtist: () => { },
        });
        expect(yearOnly?.facts).toEqual(['1999']);

        // Navidrome 描述上那个 publishedAt 是年份拼出来的 1 月 1 日（适配器 :103）：详情没给日期就显示裸年份，
        // 不显示「1999/1/1 · 1999」这种既假精确又说两遍的样子（网格那一版就是）。
        const fabricated = projectBravaisSeamByline({
            collection: navidromeAlbum({ albumYear: 2020, publishedAt: new Date(2020, 0, 1).getTime(), albumGenre: '原声' }),
            detail: null, isAlbum: true, canOpenArtist: false, onOpenArtist: () => { },
        });
        expect(fabricated?.facts).toEqual(['2020 · 原声']);

        // 本地集合：即便字段在，也不显示年份 / 流派 / 时长（与网格的 isNavidromeCollection 同一条门）——
        // 一门全挡就没有任何可显示的内容，整块 undefined（缝里不占位），而不是留一个空署名行。
        const local = projectBravaisSeamByline({
            collection: localAlbum({ albumYear: 2020, albumGenre: '原声', albumDuration: 4353 }), detail: null,
            isAlbum: true, canOpenArtist: false, onOpenArtist: () => { },
        });
        expect(local).toBeUndefined();
    });

    it('时长按 provider 给的单位走（秒或毫秒），坏值当作没有', () => {
        // 带一个流派做参照：断言的是「时长在/不在」，而不是整块消失（坏值只剩流派时仍要有那一行）。
        const factsOf = (albumDuration: number) => projectBravaisSeamByline({
            collection: navidromeAlbum({ albumGenre: '原声', albumDuration }), detail: null, isAlbum: true, canOpenArtist: false, onOpenArtist: () => { },
        })?.facts;
        expect(factsOf(4353)).toEqual(['原声 · 1:12:33']);
        expect(factsOf(4353000)).toEqual(['原声 · 1:12:33']);
        expect(factsOf(45)).toEqual(['原声 · 0:45']);
        expect(factsOf(0)).toEqual(['原声']);
        expect(factsOf(Number.NaN)).toEqual(['原声']);
    });
});
