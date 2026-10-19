import Dexie, { type Table } from 'dexie';
import type { LocalSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import type { LocalCoverAsset } from '../types/localCover';
import type { ListeningPlayRecord, ListeningSyncOutboxRecord } from '../types/listeningStats';
import { migrateLegacyLocalSongRecords } from './localLibraryV8Migration';

// src/services/appDatabase.ts
// Owns the complete typed Dexie schema for local songs, entities, and content-addressed cover assets.

export const APP_DATABASE_NAME = 'KineticPlayerDB';
export const APP_DATABASE_VERSION_CHANGE_EVENT = 'folia-database-version-change';
export const LOCAL_LIBRARY_BOOTSTRAP_MARKER_KEY = 'local_library_entities_bootstrap_v1';
export const LOCAL_LIBRARY_ARTIST_SPLIT_MARKER_KEY = 'local_library_artist_delimiter_split_v1';

export interface StoredCacheEntry<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
}

export interface ThemeRegistryRecord {
  fingerprint: string;
  [key: string]: unknown;
}

export class AppDatabase extends Dexie {
  session!: Table<unknown, string>;
  api_cache!: Table<StoredCacheEntry, string>;
  user_cache!: Table<StoredCacheEntry, string>;
  media_cache!: Table<StoredCacheEntry, string>;
  metadata_cache!: Table<StoredCacheEntry, string>;
  local_music!: Table<LocalSong, string>;
  theme_registry!: Table<ThemeRegistryRecord, string>;
  local_library_entities!: Table<LocalLibraryEntity, string>;
  local_library_assignments!: Table<LocalLibraryAssignment, string>;
  local_cover_assets!: Table<LocalCoverAsset, string>;
  listening_plays!: Table<ListeningPlayRecord, string>;
  listening_sync_outbox!: Table<ListeningSyncOutboxRecord, number>;

  constructor(name = APP_DATABASE_NAME) {
    super(name);

    this.version(0.6).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id',
      theme_registry: 'fingerprint',
    });

    this.version(0.7).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id',
      theme_registry: 'fingerprint',
      local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
      local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
    });

    this.version(0.8).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id',
      theme_registry: 'fingerprint',
      local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
      local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
    }).upgrade(async transaction => {
      const legacySongs = await transaction.table<LocalSong, string>('local_music').toArray();
      const migrated = migrateLegacyLocalSongRecords(legacySongs as Array<LocalSong & Record<string, unknown>>);
      await Promise.all([
        transaction.table('local_music').bulkPut(migrated.songs),
        transaction.table('local_library_entities').clear().then(() => (
          transaction.table('local_library_entities').bulkPut(migrated.entities)
        )),
        transaction.table('local_library_assignments').clear().then(() => (
          transaction.table('local_library_assignments').bulkPut(migrated.assignments)
        )),
      ]);
    });

    this.version(0.9).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id, localCoverAssetId',
      theme_registry: 'fingerprint',
      local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
      local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
      local_cover_assets: 'id',
    });

    // One row per qualifying listen, keyed by session so a repeated settle cannot double-count.
    // `playedAt` is the range index; `songKey` / `source` serve the top lists and the source split.
    // Dexie version numbers carry a single decimal, so this rolls over from 0.9 to 1 rather than
    // 0.10 (which JavaScript reads as 0.1 and Dexie would ignore as an older schema).
    this.version(1).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id, localCoverAssetId',
      theme_registry: 'fingerprint',
      local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
      local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
      local_cover_assets: 'id',
      listening_plays: 'sessionId, playedAt, songKey, source',
    });

    // 云同步发件箱：本地每次播放/删除/清空都记一条待推送操作。账号标签存在行上（见类型注释），
    // 推送成功才删除，所以断网/关应用都不会丢待同步的变更。
    this.version(1.1).stores({
      session: '',
      api_cache: 'key',
      user_cache: 'key',
      media_cache: 'key',
      metadata_cache: 'key',
      local_music: 'id, localCoverAssetId',
      theme_registry: 'fingerprint',
      local_library_entities: 'id, kind, *normalizedAliases, mergedInto, needsReview, createdAt',
      local_library_assignments: 'songId, *artistEntityIds, albumEntityId, artistOrigin, albumOrigin',
      local_cover_assets: 'id',
      listening_plays: 'sessionId, playedAt, songKey, source',
      listening_sync_outbox: '++id, kind, accountId, sessionId, playedAt, createdAt',
    });

    this.on('versionchange', event => {
      this.close();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(APP_DATABASE_VERSION_CHANGE_EVENT, {
          detail: { oldVersion: event.oldVersion, newVersion: event.newVersion },
        }));
        window.setTimeout(() => window.location.reload(), 0);
      }
    });
  }
}

export const appDatabase = new AppDatabase();
