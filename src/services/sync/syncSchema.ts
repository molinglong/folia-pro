import { sanitizeDualTheme } from '../themeSanitizer';
// 背景模式没有 mod 投稿通道，静态清单与活注册表在任何时刻都等价。
import { isBuiltinVisualizerBackgroundMode } from '../../types/visualizerModes';
import {
    SYNC_LEGACY_SCHEMA_VERSION,
    SYNC_SCHEMA_VERSION,
    type SyncLibraryExportBundle,
    type SyncRemoteState,
    type SyncThemeBucketSummary,
    type SyncThemeManifest,
    type SyncedCloudCollection,
    type SyncedCloudSnapshot,
    type SyncedCloudUser,
    type SyncedCollectionRecord,
    type SyncedPlatformSessionRecord,
    type SyncedSettingsRecord,
    type SyncedVisualSettings,
    type SyncedThemeRecord,
} from './syncTypes';

// src/services/sync/syncSchema.ts
// Defensive parsing for JSON returned by user-hosted sync servers.

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isIsoDateString = (value: unknown): value is string => (
    typeof value === 'string' && !Number.isNaN(Date.parse(value))
);

// schema 2 服务端对账号会话应答 2，兼容模式与旧服务端应答 1，两侧都接受。
const isSchemaCompatible = (value: unknown) => value === SYNC_SCHEMA_VERSION || value === SYNC_LEGACY_SCHEMA_VERSION;

const isFiniteNumber = (value: unknown): value is number => (
    typeof value === 'number' && Number.isFinite(value)
);

const isStringArray = (value: unknown): value is string[] => (
    Array.isArray(value) && value.every(item => typeof item === 'string')
);

const isFontStyle = (value: unknown): value is SyncedVisualSettings['lyricsFontStyle'] => (
    value === 'sans' || value === 'serif' || value === 'mono'
);

const isVisualizerBackgroundMode = (value: unknown): value is NonNullable<SyncedVisualSettings['visualizerBackgroundMode']> => (
    isBuiltinVisualizerBackgroundMode(value)
);

const parseSyncedVisualSettings = (value: Record<string, unknown>): SyncedVisualSettings => {
    const settings: SyncedVisualSettings = {};

    if (typeof value.followSystemTheme === 'boolean') settings.followSystemTheme = value.followSystemTheme;
    if (typeof value.visualizerMode === 'string' && value.visualizerMode.trim()) settings.visualizerMode = value.visualizerMode;
    if (value.visualizerBackgroundMode === null) settings.visualizerBackgroundMode = null;
    else if (isVisualizerBackgroundMode(value.visualizerBackgroundMode)) settings.visualizerBackgroundMode = value.visualizerBackgroundMode;
    if (isFiniteNumber(value.backgroundOpacity)) settings.backgroundOpacity = value.backgroundOpacity;
    if (isFiniteNumber(value.visualizerOpacity)) settings.visualizerOpacity = value.visualizerOpacity;
    if (typeof value.hidePlayerTranslationSubtitle === 'boolean') settings.hidePlayerTranslationSubtitle = value.hidePlayerTranslationSubtitle;
    if (typeof value.showSubtitleTranslation === 'boolean') settings.showSubtitleTranslation = value.showSubtitleTranslation;
    if (value.subtitleContentMode === 'translation' || value.subtitleContentMode === 'romanization' || value.subtitleContentMode === 'both' || value.subtitleContentMode === 'none') {
        settings.subtitleContentMode = value.subtitleContentMode;
    }
    if (typeof value.subtitleOverlayBackground === 'boolean') settings.subtitleOverlayBackground = value.subtitleOverlayBackground;
    if (typeof value.subtitleUpcomingLyricsBlur === 'boolean') settings.subtitleUpcomingLyricsBlur = value.subtitleUpcomingLyricsBlur;
    if (isFontStyle(value.lyricsFontStyle)) settings.lyricsFontStyle = value.lyricsFontStyle;
    if (isFiniteNumber(value.lyricsFontScale)) settings.lyricsFontScale = value.lyricsFontScale;
    if (value.lyricsFontWeight === null) settings.lyricsFontWeight = null;
    else if (isFiniteNumber(value.lyricsFontWeight) && value.lyricsFontWeight >= 100 && value.lyricsFontWeight <= 900) settings.lyricsFontWeight = value.lyricsFontWeight;
    if (isStringArray(value.lyricsFontFallbackFamilies)) settings.lyricsFontFallbackFamilies = value.lyricsFontFallbackFamilies;
    if (typeof value.subtitleFontInheritsLyrics === 'boolean') settings.subtitleFontInheritsLyrics = value.subtitleFontInheritsLyrics;
    if (isFontStyle(value.subtitleFontStyle)) settings.subtitleFontStyle = value.subtitleFontStyle;
    if (value.subtitleFontWeight === null) settings.subtitleFontWeight = null;
    else if (isFiniteNumber(value.subtitleFontWeight) && value.subtitleFontWeight >= 100 && value.subtitleFontWeight <= 900) settings.subtitleFontWeight = value.subtitleFontWeight;
    if (value.subtitleFontFamily === null) settings.subtitleFontFamily = null;
    else if (typeof value.subtitleFontFamily === 'string') settings.subtitleFontFamily = value.subtitleFontFamily;
    if (isStringArray(value.subtitleFontFallbackFamilies)) settings.subtitleFontFallbackFamilies = value.subtitleFontFallbackFamilies;
    if (isRecord(value.visualizerTunings)) settings.visualizerTunings = value.visualizerTunings;
    if (value.classicTuning !== undefined) settings.classicTuning = value.classicTuning;
    if (value.cadenzaTuning !== undefined) settings.cadenzaTuning = value.cadenzaTuning;
    if (value.partitaTuning !== undefined) settings.partitaTuning = value.partitaTuning;
    if (value.fumeTuning !== undefined) settings.fumeTuning = value.fumeTuning;
    if (value.claddaghTuning !== undefined) settings.claddaghTuning = value.claddaghTuning;
    if (value.cappellaTuning !== undefined) settings.cappellaTuning = value.cappellaTuning;
    if (value.tiltTuning !== undefined) settings.tiltTuning = value.tiltTuning;
    if (value.dioramaTuning !== undefined) settings.dioramaTuning = value.dioramaTuning;
    if (value.monetBackgroundTuning !== undefined) settings.monetBackgroundTuning = value.monetBackgroundTuning;
    if (value.nomandBackgroundTuning !== undefined) settings.nomandBackgroundTuning = value.nomandBackgroundTuning;
    if (value.latentBackgroundTuning !== undefined) settings.latentBackgroundTuning = value.latentBackgroundTuning;
    if (value.soraBackgroundTuning !== undefined) settings.soraBackgroundTuning = value.soraBackgroundTuning;
    if (value.monetTuning !== undefined) settings.monetTuning = value.monetTuning;
    if (value.pendoloTuning !== undefined) settings.pendoloTuning = value.pendoloTuning;
    if (value.sonnetTuning !== undefined) settings.sonnetTuning = value.sonnetTuning;
    if (value.temperaTuning !== undefined) settings.temperaTuning = value.temperaTuning;
    if (value.lumiereTuning !== undefined) settings.lumiereTuning = value.lumiereTuning;
    if (Array.isArray(value.urlBackgroundList)) settings.urlBackgroundList = value.urlBackgroundList;
    if (value.urlBackgroundSelectedId === null) settings.urlBackgroundSelectedId = null;
    else if (typeof value.urlBackgroundSelectedId === 'string') settings.urlBackgroundSelectedId = value.urlBackgroundSelectedId;
    if (value.homeLayoutStyle === 'carousel' || value.homeLayoutStyle === 'grid') settings.homeLayoutStyle = 'grid';
    if (value.grid3dCardStyle === 'image' || value.grid3dCardStyle === 'card') settings.grid3dCardStyle = value.grid3dCardStyle;

    return settings;
};

export const parseSyncedSettingsRecord = (value: unknown): SyncedSettingsRecord | null => {
    if (!isRecord(value) || !isSchemaCompatible(value.schemaVersion) || !isIsoDateString(value.updatedAt) || !isRecord(value.data)) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        updatedAt: value.updatedAt,
        data: parseSyncedVisualSettings(value.data),
    };
};

export const parseSyncedThemeRecord = (value: unknown): SyncedThemeRecord | null => {
    if (!isRecord(value)
        || typeof value.fingerprint !== 'string'
        || !value.fingerprint
        || !isIsoDateString(value.updatedAt)
        || !isRecord(value.theme)
    ) {
        return null;
    }

    return {
        fingerprint: value.fingerprint,
        theme: sanitizeDualTheme(value.theme),
        updatedAt: value.updatedAt,
        source: value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
            ? value.source
            : 'manual',
    };
};

export const parseSyncedThemeRecords = (value: unknown): SyncedThemeRecord[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(parseSyncedThemeRecord)
        .filter((record): record is SyncedThemeRecord => Boolean(record));
};

export const parseSyncLibraryExportBundle = (value: unknown): SyncLibraryExportBundle | null => {
    if (!isRecord(value)
        || value.kind !== 'folia-sync-export'
        || !isSchemaCompatible(value.schemaVersion)
        || !isIsoDateString(value.exportedAt)
        || !Array.isArray(value.themes)
    ) {
        return null;
    }

    const themes = value.themes.map(parseSyncedThemeRecord);
    if (themes.some(theme => !theme)) {
        return null;
    }

    const settings = value.settings === null
        ? null
        : parseSyncedSettingsRecord(value.settings);
    if (value.settings !== null && !settings) {
        return null;
    }

    return {
        kind: 'folia-sync-export',
        schemaVersion: SYNC_SCHEMA_VERSION,
        exportedAt: value.exportedAt,
        settings,
        themes: themes as SyncedThemeRecord[],
    };
};

export const parseSyncRemoteState = (value: unknown): SyncRemoteState | null => {
    if (!isRecord(value) || !isSchemaCompatible(value.schemaVersion)) {
        return null;
    }

    const settingsUpdatedAt = typeof value.settingsUpdatedAt === 'string' ? value.settingsUpdatedAt : null;
    const themesUpdatedAt = typeof value.themesUpdatedAt === 'string' ? value.themesUpdatedAt : null;
    if ((value.settingsUpdatedAt != null && !isIsoDateString(settingsUpdatedAt))
        || (value.themesUpdatedAt != null && !isIsoDateString(themesUpdatedAt))
        || typeof value.themeCount !== 'number'
        || !Number.isFinite(value.themeCount)
    ) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        scoped: value.scoped === true,
        settingsUpdatedAt,
        themesUpdatedAt,
        themeCount: Math.max(0, Math.trunc(value.themeCount)),
    };
};

const parseThemeBucketSummary = (value: unknown): SyncThemeBucketSummary | null => {
    if (!isRecord(value)
        || typeof value.bucketId !== 'number'
        || !Number.isInteger(value.bucketId)
        || value.bucketId < 0
        || typeof value.count !== 'number'
        || !Number.isFinite(value.count)
        || typeof value.hash !== 'string'
    ) {
        return null;
    }

    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
    if (value.updatedAt != null && !isIsoDateString(updatedAt)) {
        return null;
    }

    return {
        bucketId: value.bucketId,
        count: Math.max(0, Math.trunc(value.count)),
        hash: value.hash,
        updatedAt,
    };
};

// --- 收藏/歌单快照（/collections/*，schemaVersion 独立从 1 起计）---

const parseSyncedCloudUser = (value: unknown): SyncedCloudUser | null => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.nickname !== 'string') {
        return null;
    }

    const user: SyncedCloudUser = { id: value.id, nickname: value.nickname };
    if (typeof value.avatarUrl === 'string' && value.avatarUrl) {
        user.avatarUrl = value.avatarUrl;
    }
    return user;
};

const parseSyncedCloudCollection = (value: unknown): SyncedCloudCollection | null => {
    if (!isRecord(value)
        || typeof value.providerId !== 'string'
        || !value.providerId
        || typeof value.id !== 'string'
        || !value.id
        || typeof value.name !== 'string'
        || typeof value.type !== 'string'
    ) {
        return null;
    }

    const collection: SyncedCloudCollection = {
        providerId: value.providerId,
        id: value.id,
        name: value.name,
        type: value.type,
    };
    if (typeof value.coverUrl === 'string' && value.coverUrl) collection.coverUrl = value.coverUrl;
    if (typeof value.description === 'string' && value.description) collection.description = value.description;
    if (isFiniteNumber(value.trackCount)) collection.trackCount = Math.trunc(value.trackCount);
    if (typeof value.isLiked === 'boolean') collection.isLiked = value.isLiked;
    if (typeof value.isOwned === 'boolean') collection.isOwned = value.isOwned;
    if (isFiniteNumber(value.playCount)) collection.playCount = Math.trunc(value.playCount);
    return collection;
};

export const parseSyncedCloudSnapshot = (value: unknown): SyncedCloudSnapshot | null => {
    if (!isRecord(value)) {
        return null;
    }

    const user = parseSyncedCloudUser(value.user);
    if (!user || !Array.isArray(value.collections) || !Array.isArray(value.likedSongIds)) {
        return null;
    }

    const collections = value.collections.map(parseSyncedCloudCollection);
    if (collections.some(collection => !collection)) {
        return null;
    }
    if (!value.likedSongIds.every(id => typeof id === 'string')) {
        return null;
    }

    return {
        user,
        collections: collections as SyncedCloudCollection[],
        likedSongIds: value.likedSongIds,
    };
};

export const parseSyncCollectionRecord = (value: unknown): SyncedCollectionRecord | null => {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isIsoDateString(value.updatedAt) || !isRecord(value.data)) {
        return null;
    }

    const data = parseSyncedCloudSnapshot(value.data);
    return data ? { schemaVersion: 1, updatedAt: value.updatedAt, data } : null;
};

/** 严格三键校验：token 域是唯一允许含凭证引用的同步域，
 *  解析时拒绝任何夹带字段，防止它变成第二个凭证存放处。 */
export const parseSyncPlatformSessionRecord = (value: unknown): SyncedPlatformSessionRecord | null => {
    if (!isRecord(value)
        || value.schemaVersion !== 1
        || !isIsoDateString(value.updatedAt)
        || typeof value.token !== 'string'
        || value.token.length === 0
        || Object.keys(value).some((key) => key !== 'schemaVersion' && key !== 'updatedAt' && key !== 'token')) {
        return null;
    }
    return { schemaVersion: 1, updatedAt: value.updatedAt, token: value.token };
};

export const parseSyncThemeManifest = (value: unknown): SyncThemeManifest | null => {
    if (!isRecord(value)
        || !isSchemaCompatible(value.schemaVersion)
        || typeof value.bucketCount !== 'number'
        || !Number.isInteger(value.bucketCount)
        || !Array.isArray(value.buckets)
    ) {
        return null;
    }

    const buckets = value.buckets.map(parseThemeBucketSummary);
    if (buckets.some(bucket => !bucket)) {
        return null;
    }

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        bucketCount: value.bucketCount,
        buckets: buckets as SyncThemeBucketSummary[],
    };
};
