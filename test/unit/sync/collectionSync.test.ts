import { describe, expect, it } from 'vitest';
import type { ProviderCollection, ProviderUser } from '@/types/onlineMusic';
import { toCloudSnapshot } from '@/services/sync/collectionSync';
import { parseSyncCollectionRecord } from '@/services/sync/syncSchema';

// src/test/unit/sync/collectionSync.test.ts
// 白名单投影是安全硬约束（设计文档 §9）：混入 ProviderUser/ProviderCollection 的
// 认证相关字段（cookie/ptkey/token）绝不允许出现在云端快照里。

const taintedUser = {
    id: 'u1',
    nickname: 'Tester',
    avatarUrl: 'https://example.com/a.png',
    cookie: 'MUSIC_U=secret-cookie',
    ptkey: 'secret-ptkey',
    token: 'secret-token',
} as unknown as ProviderUser;

const taintedCollection = {
    providerId: 'netease',
    id: 123,
    name: 'My Playlist',
    type: 'playlist',
    trackCount: 3,
    isLiked: false,
    isOwned: true,
    playCount: 10,
    providerData: { someInternal: 'internal-value', cookie: 'leak-me' },
} as unknown as ProviderCollection;

describe('toCloudSnapshot whitelist projection', () => {
    it('projects only the whitelisted user fields', () => {
        const snapshot = toCloudSnapshot({ user: taintedUser, collections: [], likedSongIds: [] });
        expect(snapshot.user).toEqual({
            id: 'u1',
            nickname: 'Tester',
            avatarUrl: 'https://example.com/a.png',
        });
    });

    it('keeps credential-like fields out of the serialized snapshot', () => {
        const serialized = JSON.stringify(toCloudSnapshot({
            user: taintedUser,
            collections: [taintedCollection],
            likedSongIds: [],
        }));
        expect(serialized).not.toContain('secret-cookie');
        expect(serialized).not.toContain('secret-ptkey');
        expect(serialized).not.toContain('secret-token');
        expect(serialized).not.toContain('leak-me');
        expect(serialized).not.toContain('internal-value');
    });

    it('projects only the whitelisted collection fields and stringifies media ids', () => {
        const snapshot = toCloudSnapshot({
            user: taintedUser,
            collections: [taintedCollection],
            // 数字与字符串形式的同一 id 去重；空串丢弃。
            likedSongIds: [456, '456', ''],
        });
        expect(snapshot.collections).toEqual([{
            providerId: 'netease',
            id: '123',
            name: 'My Playlist',
            type: 'playlist',
            trackCount: 3,
            isLiked: false,
            isOwned: true,
            playCount: 10,
        }]);
        expect(snapshot.likedSongIds).toEqual(['456']);
    });
});

describe('parseSyncCollectionRecord', () => {
    const validRecord = {
        schemaVersion: 1,
        updatedAt: '2026-10-13T00:00:00.000Z',
        data: {
            user: { id: 'u1', nickname: 'Tester' },
            collections: [{ providerId: 'qq', id: '1', name: 'P', type: 'playlist' }],
            likedSongIds: ['a', 'b'],
        },
    };

    it('accepts a valid record', () => {
        const record = parseSyncCollectionRecord(validRecord);
        expect(record?.schemaVersion).toBe(1);
        expect(record?.updatedAt).toBe('2026-10-13T00:00:00.000Z');
        expect(record?.data.collections).toHaveLength(1);
        expect(record?.data.likedSongIds).toEqual(['a', 'b']);
    });

    it('rejects malformed records', () => {
        expect(parseSyncCollectionRecord(null)).toBeNull();
        expect(parseSyncCollectionRecord('nope')).toBeNull();
        // collections 的 schemaVersion 独立从 1 起计，2 不是合法输入。
        expect(parseSyncCollectionRecord({ ...validRecord, schemaVersion: 2 })).toBeNull();
        expect(parseSyncCollectionRecord({ ...validRecord, updatedAt: 'bad' })).toBeNull();
        expect(parseSyncCollectionRecord({ ...validRecord, data: null })).toBeNull();
        expect(parseSyncCollectionRecord({
            ...validRecord,
            data: { ...validRecord.data, likedSongIds: [1, 2] },
        })).toBeNull();
        expect(parseSyncCollectionRecord({
            ...validRecord,
            data: { ...validRecord.data, user: { id: 'u1' } },
        })).toBeNull();
        expect(parseSyncCollectionRecord({
            ...validRecord,
            data: { ...validRecord.data, collections: [{ providerId: 'qq' }] },
        })).toBeNull();
    });
});
