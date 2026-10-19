import React from 'react';
import { AudioWaveform, Command, Database, Disc3, Download, FolderOpen, HardDrive, Layers, Loader2, Pencil, PlayCircle, Trash2, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { CustomSelect } from '../../shared/CustomSelect';
import LocalLibraryWatchSection from './LocalLibraryWatchSection';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { openCommandPaletteCommand } from '../../../stores/useAppViewStore';
import { closeSettings } from '../../../stores/useSettingsModalStore';
import AccountAuthForm from './AccountAuthForm';
import { LYRIC_EXPORT_COMMAND_ID } from '../../command-palette/commands/lyricExportCommands';

// src/components/modal/settings/StorageSettingsSection.tsx
// Shared storage and media cache settings used by the main options page and storage subview.

type CacheCategory = 'playlist' | 'lyrics' | 'cover' | 'media' | 'analysis';

type CacheSizes = Record<CacheCategory, string>;

type StorageSettingsSectionProps = {
    cacheDirectory: string;
    cacheDirectoryIsDefault: boolean;
    cacheDirectoryStatus: 'idle' | 'choosing';
    cacheSizes: CacheSizes;
    enableMediaCache: boolean;
    errorTextColor: string;
    isCleaning: string | null;
    isDaylight?: boolean;
    isElectron: boolean;
    mediaCacheLimitGb: number;
    mediaCount: number;
    onChooseCacheDirectory: () => void;
    onClear: (category: CacheCategory) => void;
    onClearAll: () => void;
    onSetMediaCacheLimitGb: (gigabytes: number) => void;
    onToggleMediaCache: (enabled: boolean) => void;
    settingsCardClass: string;
    settingsIconClass?: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
    useInsetCacheRows?: boolean;
};

const StorageSettingsSection: React.FC<StorageSettingsSectionProps> = ({
    cacheDirectory,
    cacheDirectoryIsDefault,
    cacheDirectoryStatus,
    cacheSizes,
    enableMediaCache,
    errorTextColor,
    isCleaning,
    isDaylight = false,
    isElectron,
    mediaCacheLimitGb,
    mediaCount,
    onChooseCacheDirectory,
    onClear,
    onClearAll,
    onSetMediaCacheLimitGb,
    onToggleMediaCache,
    settingsCardClass,
    settingsIconClass,
    theme,
    toggleOffBackgroundClass,
    useInsetCacheRows = false,
}) => {
    const { t } = useTranslation();
    // shrink-0 给手机那条横滑行（不被压扁），min-w-0 给 PC 网格（列窄时让标题省略而不是撑破栏）。
    const cacheRowClass = useInsetCacheRows
        ? `flex min-w-0 items-center justify-between gap-2 shrink-0 px-3 py-2 rounded-xl border ${settingsCardClass}`
        : 'flex min-w-0 items-center justify-between gap-2 shrink-0 px-3 py-2 rounded-xl border bg-white/5 border-white/5';
    const iconClass = useInsetCacheRows && settingsIconClass
        ? `p-2 rounded-lg opacity-60 ${settingsIconClass}`
        : 'p-2 bg-white/5 rounded-lg opacity-60';
    // Zero is "no ceiling", which is a real answer rather than a missing one, so it gets a label
    // instead of an empty field.
    const cacheLimitOptions = [1, 2, 5, 10, 20, 50, 0].map((gigabytes) => ({
        value: String(gigabytes),
        label: gigabytes === 0 ? (t('options.mediaCacheLimitNone') || 'No limit') : `${gigabytes} GB`,
    }));
    const cacheItems = [
        { id: 'playlist' as const, label: t('options.playlistData') || 'Playlist Data', size: cacheSizes.playlist, icon: Layers },
        { id: 'lyrics' as const, label: t('options.lyrics') || 'Lyrics', size: cacheSizes.lyrics, icon: Command },
        { id: 'cover' as const, label: t('options.covers') || 'Covers', size: cacheSizes.cover, icon: Disc3 },
        { id: 'media' as const, label: t('options.mediaFiles') || 'Media Files', size: cacheSizes.media, icon: PlayCircle },
        { id: 'analysis' as const, label: t('options.analysisData') || 'Analysis Data', size: cacheSizes.analysis, icon: AudioWaveform },
    ];

    return (
        <>
            {/* Folia 账号：登录后收藏/歌单/喜欢走账号数据域；同步服务器地址有内置默认值，登录即自动同步，
                不再需要手动填地址 / 开关 / 兼容 token。登录 / 注册在 AccountAuthDialog 弹窗里，这里只留入口。 */}
            <SettingsAnchor anchorId="foliaAccount" label={t('ui.storage.accountTitle') || 'Folia Account'}>
                <SettingsSectionHeading icon={UserRound} label={t('ui.storage.accountTitle') || 'Folia Account'} />
                <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                    <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('ui.storage.accountDesc') || 'Sign in to sync playlists and likes across devices through your own sync server. Platform credentials never leave this device.'}
                    </div>
                    {/* 已登录显示邮箱与登出（与侧栏账号页、首页平台列表共用同一份 AccountAuthForm）。 */}
                    <AccountAuthForm errorTextColor={errorTextColor} />
                </div>
            </SettingsAnchor>

            <SettingsAnchor anchorId="cacheDetails" label={t('options.cacheDetails') || 'Cache Details'}>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Database size={14} /> {t('options.cacheDetails') || 'Cache Storage'}
                    <button
                        onClick={onClearAll}
                        disabled={isCleaning === 'all'}
                        className={`ml-auto text-xs font-normal normal-case tracking-normal px-2 py-1 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20 flex items-center gap-1`}
                    >
                        {isCleaning === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {t('options.clearAll')}
                    </button>
                </h3>

                {/* @fork 本地魔改版：手机仍是那条横向滑动行（宽度不够，竖排会把「清除」按钮挤到看不见）；
                    md 起换成按容器实际宽度自动分栏的网格——五类缓存一屏看全，不必左右拖。 */}
                <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1 mobile-hide-scrollbar md:grid md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] md:overflow-x-visible md:pb-0">
                    {cacheItems.map((item) => (
                        <div key={item.id} className={cacheRowClass}>
                            <div className="flex min-w-0 items-center gap-2">
                                <div className={`${iconClass} shrink-0`}>
                                    <item.icon size={16} />
                                </div>
                                <div className="flex min-w-0 items-baseline gap-1.5">
                                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                                    <div className="text-xs opacity-50 shrink-0 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{item.size}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {item.id === 'lyrics' && (
                                    <button
                                        type="button"
                                        data-ponder-lyric-export-settings-entry
                                        onClick={() => {
                                            openCommandPaletteCommand(LYRIC_EXPORT_COMMAND_ID);
                                            closeSettings();
                                        }}
                                        className="p-2 hover:bg-white/10 rounded-lg opacity-60 hover:opacity-100 transition-all"
                                        title={t('lyricExport.settingsEntry')}
                                        aria-label={t('lyricExport.settingsEntry')}
                                    >
                                        <Download size={16} />
                                    </button>
                                )}
                                <button
                                    onClick={() => onClear(item.id)}
                                    disabled={isCleaning === item.id}
                                    className={`p-2 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20`}
                                    title={t('ui.clear')}
                                >
                                    {isCleaning === item.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </SettingsAnchor>

            <LocalLibraryWatchSection
                errorTextColor={errorTextColor}
                settingsCardClass={settingsCardClass}
                theme={theme}
                toggleOffBackgroundClass={toggleOffBackgroundClass}
            />

            <SettingsAnchor anchorId="mediaCache" label={t('options.mediaCache') || 'Media Cache'}>
                <SettingsSectionHeading icon={Database} label={t('options.mediaCache') || 'Media Cache'} />
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.enableMediaCache') || 'Cache Songs'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.enableMediaCacheDesc') || 'Cache audio after playback for offline listening.'}
                            </div>
                        </div>
                        <button
                            onClick={() => onToggleMediaCache(!enableMediaCache)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!enableMediaCache ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: enableMediaCache ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableMediaCache ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {isElectron && (
                        <div className="pt-3 border-t border-white/10 space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <FolderOpen size={14} />
                                    {t('options.cacheDirectory') || 'Cache Directory'}
                                </div>
                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.cacheDirectoryDesc') || 'Choose where large desktop cache files should be stored.'}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <div className="flex-1 bg-black/10 rounded-lg border border-white/5 px-3 py-2 min-w-0">
                                    <div className="text-[11px] break-all font-mono" style={{ color: 'var(--text-primary)' }}>
                                        {cacheDirectory || '...'}
                                    </div>
                                    <div className="text-[10px] opacity-45 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {cacheDirectoryIsDefault
                                            ? (t('options.cacheDirectoryDefaultHint') || 'Using the default desktop cache location.')
                                            : (t('options.cacheDirectoryCustomHint') || 'Using a custom cache location.')}
                                    </div>
                                </div>
                                <button
                                    onClick={onChooseCacheDirectory}
                                    disabled={cacheDirectoryStatus !== 'idle'}
                                    className="shrink-0 w-12 rounded-lg text-sm font-medium transition-colors flex items-center justify-center bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                    title={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                    aria-label={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                >
                                    {cacheDirectoryStatus === 'choosing' ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {isElectron && (
                        <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <HardDrive size={14} />
                                    {t('options.mediaCacheLimit') || 'Cache Limit'}
                                </div>
                                <div className="text-xs opacity-50 max-w-[240px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.mediaCacheLimitDesc') || 'Once past this, the songs you have not played in longest are dropped first.'}
                                </div>
                            </div>
                            <div className="w-32 shrink-0">
                                <CustomSelect
                                    value={String(mediaCacheLimitGb)}
                                    onChange={(value) => onSetMediaCacheLimitGb(Number(value))}
                                    options={cacheLimitOptions}
                                    ariaLabel={t('options.mediaCacheLimit') || 'Cache Limit'}
                                    isDaylight={isDaylight}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}

                    <div className="pt-3 border-t border-white/10 flex justify-between items-center text-xs opacity-50">
                        <span>{t('options.cachedSongsCount') || 'Cached Songs'}:</span>
                        <span className="font-mono">{mediaCount} · {cacheSizes.media}</span>
                    </div>
                </div>
            </SettingsAnchor>
        </>
    );
};

export default StorageSettingsSection;