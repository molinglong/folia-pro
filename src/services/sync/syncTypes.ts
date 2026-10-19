import type { DualTheme, SubtitleContentMode, Theme, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import type { VisualizerTuningBundle } from '../../components/visualizer/tuningRegistry';
import type { ListeningPlayRecord } from '../../types/listeningStats';

// src/services/sync/syncTypes.ts
// Shared contracts for Folia's user-hosted sync server API.

export const SYNC_SCHEMA_VERSION = 2;
// 兼容模式（全局 SYNC_TOKEN）与旧服务端永远应答 schema 1，客户端两侧都要接受。
export const SYNC_LEGACY_SCHEMA_VERSION = 1;
export const SYNC_PROVIDER = 'sync-server' as const;

export type SyncProvider = typeof SYNC_PROVIDER;
export type SyncStatusState = 'idle' | 'syncing' | 'success' | 'error';
export type SyncedThemeSource = 'manual' | 'auto' | 'fallback' | 'edited';

export type SyncProviderConfig = {
    provider: SyncProvider;
    enabled: boolean;
    workerBaseUrl: string;
    /** 兼容模式的全局 SYNC_TOKEN；登录账号后非必填。 */
    authToken: string;
    /** 已登录账号的非敏感信息（token 本体在 IndexedDB，见 syncConfig）。 */
    account?: SyncAccountMeta;
};

export type SyncAccountMeta = {
    userId: string;
    email: string;
};

export type SyncAccountSession = SyncAccountMeta & {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
};

export type SyncRuntimeStatus = {
    state: SyncStatusState;
    lastSyncAt: string | null;
    lastError: string | null;
};

export type SyncedVisualSettings = {
    followSystemTheme?: boolean;
    visualizerMode?: VisualizerMode;
    randomVisualizerModePerSong?: boolean;
    visualizerBackgroundMode?: VisualizerBackgroundMode | null;
    backgroundOpacity?: number;
    visualizerOpacity?: number;
    hidePlayerTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    lyricsFontStyle?: Theme['fontStyle'];
    lyricsFontScale?: number;
    lyricsFontWeight?: number | null;
    lyricsFontFallbackFamilies?: string[];
    subtitleFontInheritsLyrics?: boolean;
    subtitleFontStyle?: Theme['fontStyle'];
    subtitleFontWeight?: number | null;
    subtitleFontFamily?: string | null;
    subtitleFontFallbackFamilies?: string[];
    visualizerTunings?: VisualizerTuningBundle;
    classicTuning?: unknown;
    cadenzaTuning?: unknown;
    partitaTuning?: unknown;
    fumeTuning?: unknown;
    claddaghTuning?: unknown;
    cappellaTuning?: unknown;
    tiltTuning?: unknown;
    dioramaTuning?: unknown;
    monetBackgroundTuning?: unknown;
    nomandBackgroundTuning?: unknown;
    latentBackgroundTuning?: unknown;
    soraBackgroundTuning?: unknown;
    monetTuning?: unknown;
    pendoloTuning?: unknown;
    sonnetTuning?: unknown;
    temperaTuning?: unknown;
    lumiereTuning?: unknown;
    urlBackgroundList?: unknown[];
    urlBackgroundSelectedId?: string | null;
    homeLayoutStyle?: 'carousel' | 'grid';
    grid3dCardStyle?: 'image' | 'card';
};

export type SyncedSettingsRecord = {
    schemaVersion: number;
    updatedAt: string;
    data: SyncedVisualSettings;
};

export type SyncedThemeRecord = {
    fingerprint: string;
    theme: DualTheme;
    updatedAt: string;
    source: SyncedThemeSource;
};

export type SyncThemeBucketSummary = {
    bucketId: number;
    count: number;
    hash: string;
    updatedAt: string | null;
};

export type SyncThemeManifest = {
    schemaVersion: number;
    bucketCount: number;
    buckets: SyncThemeBucketSummary[];
};

export type SyncRemoteState = {
    schemaVersion: number;
    /** true = 请求落在登录账号的数据域（schema 2 服务端）。 */
    scoped?: boolean;
    settingsUpdatedAt: string | null;
    themesUpdatedAt: string | null;
    themeCount: number;
};

export type WorkerHealthResponse = {
    ok: boolean;
    schemaVersion?: number;
    supportedSchemaVersions?: number[];
    backend?: string;
};

// --- 收藏/歌单云同步（/collections/*，schemaVersion 独立从 1 起计）---

export type SyncedCloudUser = {
    id: string;
    nickname: string;
    avatarUrl?: string;
};

export type SyncedCloudCollection = {
    providerId: string;
    id: string;
    name: string;
    type: string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    isLiked?: boolean;
    isOwned?: boolean;
    playCount?: number;
};

/** 白名单投影：绝不允许把 provider 凭证/内部字段整体上云（见 collectionSync.toCloudSnapshot）。 */
export type SyncedCloudSnapshot = {
    user: SyncedCloudUser;
    collections: SyncedCloudCollection[];
    likedSongIds: string[];
};

export type SyncedCollectionRecord = {
    schemaVersion: 1;
    updatedAt: string;
    data: SyncedCloudSnapshot;
};

/** 平台会话键（docs/qq-shared-session-design.md）：唯一允许含 token 的云同步域，
 *  token 是 qq-api 后端签发的不透明会话查找键，凭证本体不上云的承诺不变。 */
export type SyncedPlatformSessionRecord = {
    schemaVersion: 1;
    updatedAt: string;
    token: string;
};

export type SyncLibraryExportBundle = {
    kind: 'folia-sync-export';
    schemaVersion: number;
    exportedAt: string;
    settings: SyncedSettingsRecord | null;
    themes: SyncedThemeRecord[];
};

// --- 听歌记录云同步（/listening-plays，schemaVersion 独立从 1 起计）---
// 记录是只追加事件：跨设备按 sessionId 取并集，没有 LWW。删除用墓碑传播，
// 清空用每用户 clearedAt 水位线传播，revision 是服务端分配的增量游标。

export const LISTENING_SYNC_SCHEMA_VERSION = 1;

/** 服务端接受的来源白名单，与 sync-server/src/listening.ts 保持一致。 */
export const LISTENING_SYNC_SOURCES: ReadonlySet<string> = new Set([
    'netease', 'qq', 'kugou', 'local', 'navidrome', 'stage',
]);

export type SyncedListeningPull = {
    schemaVersion: 1;
    plays: ListeningPlayRecord[];
    deletes: string[];
    /** 清空水位线（毫秒）；早于它的记录在两端都不再存在。 */
    clearedAt: number;
    /** 下次拉取游标；hasMore 时为本页最后一条 revision。 */
    since: number;
    latestRevision: number;
    hasMore: boolean;
    /** 本地游标超前（服务端换库/回滚），调用方应从 0 重拉。 */
    reset: boolean;
};

export type SyncedListeningPushResult = {
    schemaVersion: 1;
    revision: number;
    clearedAt: number;
    savedPlays: number;
    savedDeletes: number;
};
