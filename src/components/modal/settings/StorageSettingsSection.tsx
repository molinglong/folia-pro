import React from 'react';
import { AudioWaveform, Check, Cloud, Command, Database, Disc3, Download, FolderOpen, HardDrive, Layers, Loader2, LogIn, LogOut, Pencil, PlayCircle, RefreshCw, Trash2, Upload, UserRound, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { getSyncConfig, getSyncStatus, saveSyncConfig, setSyncStatus, subscribeSyncConfig, subscribeSyncStatus } from '../../../services/sync/syncConfig';
import { exportSyncLibraryBundle, importSyncLibraryBundle, isSyncLibraryExportBundle, syncNow, testSyncProviderConnection } from '../../../services/sync/syncCoordinator';
import { createSyncLibraryZipBlob, readSyncLibraryZipFile } from '../../../services/sync/syncArchive';
import { SYNC_PROVIDER, type SyncProviderConfig, type SyncRuntimeStatus } from '../../../services/sync/syncTypes';
import { createSafeObjectUrl } from '../../../utils/blobGuards';
import { getQqApiBaseUrlOverride, setQqApiBaseUrlOverride } from '../../../services/onlineMusic/qqApiConfig';
import { formatLocalDateTimeStamp } from '../../../utils/downloadFileName';
import { CustomSelect } from '../../shared/CustomSelect';
import LocalLibraryWatchSection from './LocalLibraryWatchSection';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { openCommandPaletteCommand } from '../../../stores/useAppViewStore';
import { closeSettings } from '../../../stores/useSettingsModalStore';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';
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
    const accountSession = useAccountSessionStore();
    const [authMode, setAuthMode] = React.useState<'sign-in' | 'sign-up'>('sign-in');
    const [authEmail, setAuthEmail] = React.useState('');
    const [authPassword, setAuthPassword] = React.useState('');
    const [syncConfig, setSyncConfig] = React.useState<SyncProviderConfig>(() => getSyncConfig());
    const [draftSyncConfig, setDraftSyncConfig] = React.useState<SyncProviderConfig>(() => getSyncConfig());
    const [syncStatus, setSyncStatusState] = React.useState<SyncRuntimeStatus>(() => getSyncStatus());
    const [syncAction, setSyncAction] = React.useState<'idle' | 'testing' | 'syncing' | 'syncingSettings' | 'exporting' | 'importing'>('idle');
    const [testResult, setTestResult] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [syncSummaryMsg, setSyncSummaryMsg] = React.useState<string | null>(null);
    // QQ 音乐 API 地址：多设备共享 QQ 登录态的前提，Electron 由此指向远程后端（默认留空 = 内嵌/构建期变量）。
    const [qqApiUrlDraft, setQqApiUrlDraft] = React.useState<string>(() => getQqApiBaseUrlOverride());
    const syncImportInputRef = React.useRef<HTMLInputElement | null>(null);
    const cacheRowClass = useInsetCacheRows
        ? `flex items-center justify-between p-3 rounded-xl border ${settingsCardClass}`
        : 'flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5';
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
    const syncConfigDirty = JSON.stringify(syncConfig) !== JSON.stringify(draftSyncConfig);
    // 登录 Folia 账号后兼容模式 token 非必填（鉴权走会话，见 syncClient.resolveBearerToken）。
    const syncConfigured = Boolean(draftSyncConfig.workerBaseUrl.trim())
        && (Boolean(draftSyncConfig.authToken.trim()) || accountSession.status === 'signed-in');
    const syncStatusLabel = syncStatus.state === 'error'
        ? (syncStatus.lastError || t('options.r2SyncStatusError') || 'Sync failed')
        : syncStatus.lastSyncAt
            ? `${t('options.r2SyncLastSync') || 'Last sync'}: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
            : (t('options.r2SyncStatusIdle') || 'Not synced yet');

    React.useEffect(() => {
        void useAccountSessionStore.getState().initialize();
        const unsubscribeConfig = subscribeSyncConfig(() => {
            const nextConfig = getSyncConfig();
            setSyncConfig(nextConfig);
            setDraftSyncConfig(nextConfig);
        });
        const unsubscribeStatus = subscribeSyncStatus(() => setSyncStatusState(getSyncStatus()));
        return () => {
            unsubscribeConfig();
            unsubscribeStatus();
        };
    }, []);

    const updateDraftSyncConfig = (patch: Partial<SyncProviderConfig>) => {
        setDraftSyncConfig(prev => ({
            ...prev,
            ...patch,
            provider: SYNC_PROVIDER,
        }));
    };

    const handleSaveSyncConfig = () => {
        saveSyncConfig(draftSyncConfig);
        setSyncConfig(getSyncConfig());
    };

    const handleTestSync = async () => {
        setSyncAction('testing');
        setTestResult('idle');
        setSyncSummaryMsg(null);
        const nextConfig = {
            ...draftSyncConfig,
            workerBaseUrl: draftSyncConfig.workerBaseUrl.trim().replace(/\/+$/, ''),
            authToken: draftSyncConfig.authToken.trim(),
        };
        try {
            const ok = await testSyncProviderConnection(nextConfig);
            if (ok) {
                saveSyncConfig(nextConfig);
                setSyncConfig(getSyncConfig());
                setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
                setTestResult('success');
                setSyncSummaryMsg(t('ui.storage.syncTestSuccess'));
            } else {
                setTestResult('error');
                setSyncSummaryMsg(t('ui.storage.syncTestFailed'));
            }
        } catch (error) {
            setTestResult('error');
            setSyncSummaryMsg(error instanceof Error ? error.message : String(error));
            setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        } finally {
            setSyncAction('idle');
            setTimeout(() => setTestResult('idle'), 3000);
        }
    };

    const handleSyncNow = async () => {
        if (syncConfigDirty) {
            handleSaveSyncConfig();
        }
        setSyncAction('syncing');
        setSyncSummaryMsg(null);
        try {
            const summary = await syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
            if (summary) {
                setSyncSummaryMsg(t('ui.storage.syncThemesComplete', { uploaded: summary.uploadedThemeCount, downloaded: summary.downloadedThemeCount, local: summary.checkedLocalThemeCount, diff: summary.diffBucketCount }));
            }
        } finally {
            setSyncAction('idle');
        }
    };

    const handleSyncSettings = async () => {
        if (syncConfigDirty) {
            handleSaveSyncConfig();
        }
        setSyncAction('syncingSettings');
        setSyncSummaryMsg(null);
        try {
            const summary = await syncNow({ syncThemes: false, applyRemoteSettings: true, pushSettings: true });
            if (summary) {
                const parts = [];
                if (summary.appliedRemoteSettings) parts.push(t('ui.storage.syncAppliedRemote'));
                if (summary.pushedLocalSettings) parts.push(t('ui.storage.syncPushedLocal'));
                setSyncSummaryMsg(parts.length > 0 ? t('ui.storage.syncSettingsComplete', { details: parts.join(', ') }) : t('ui.storage.syncSettingsNoChange'));
            }
        } finally {
            setSyncAction('idle');
        }
    };

    const authErrorCodeText = (code: string): string => {
        switch (code) {
            case 'invalid_credentials':
                return t('ui.storage.accountErrorInvalidCredentials') || 'Email or password is incorrect';
            case 'email_taken':
                return t('ui.storage.accountErrorEmailTaken') || 'This email is already registered';
            case 'rate_limited':
                return t('ui.storage.accountErrorRateLimited') || 'Too many attempts, try again later';
            case 'registration_disabled':
                return t('ui.storage.accountErrorRegistrationDisabled') || 'Registration is disabled on this server';
            case 'network_error':
                return t('ui.storage.accountErrorNetwork') || 'Cannot reach the sync server';
            default:
                return t('ui.storage.accountErrorGeneric') || 'Sign in failed';
        }
    };

    const handleAuthSubmit = async () => {
        if (accountSession.busy || !authEmail.trim() || !authPassword) return;
        const succeeded = authMode === 'sign-in'
            ? await accountSession.signIn(authEmail, authPassword)
            : await accountSession.signUp(authEmail, authPassword);
        if (succeeded) {
            setAuthPassword('');
        }
    };

    const handleSwitchAuthMode = () => {
        setAuthMode(prev => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
        accountSession.clearError();
    };

    const handleSignOut = () => {
        void accountSession.signOut();
    };

    const handleExportSyncLibrary = async () => {
        setSyncAction('exporting');
        try {
            const bundle = await exportSyncLibraryBundle();
            const blob = createSyncLibraryZipBlob(bundle);
            const url = createSafeObjectUrl(blob);
            if (!url) throw new TypeError('Sync export must produce a Blob');
            const link = document.createElement('a');
            link.href = url;
            link.download = `folia-sync-${formatLocalDateTimeStamp()}.zip`;
            link.click();
            URL.revokeObjectURL(url);
        } finally {
            setSyncAction('idle');
        }
    };

    const handleImportSyncLibrary = async (file: File | null) => {
        if (!file) {
            return;
        }

        setSyncAction('importing');
        try {
            const parsed = file.name.toLowerCase().endsWith('.zip')
                ? await readSyncLibraryZipFile(file)
                : JSON.parse(await file.text()) as unknown;
            if (!isSyncLibraryExportBundle(parsed)) {
                throw new Error('Invalid Folia sync export');
            }
            const shouldImport = window.confirm(t('options.r2SyncImportConfirm') || 'Import this sync library and overwrite local sync cache?');
            if (!shouldImport) {
                return;
            }
            await importSyncLibraryBundle(parsed, {
                pushRemote: draftSyncConfig.enabled && syncConfigured,
            });
        } catch (error) {
            setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        } finally {
            setSyncAction('idle');
            if (syncImportInputRef.current) {
                syncImportInputRef.current.value = '';
            }
        }
    };

    return (
        <>
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

                <div className="grid grid-cols-2 gap-3">
                    {cacheItems.map((item) => (
                        <div key={item.id} className={cacheRowClass}>
                            <div className="flex items-center gap-3">
                                <div className={iconClass}>
                                    <item.icon size={16} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                                    <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{item.size}</div>
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

            <SettingsAnchor anchorId="r2Sync" label={t('options.r2Sync') || 'Sync Server'}>
                <SettingsSectionHeading icon={Cloud} label={t('options.r2Sync') || 'Sync Server'} />
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.r2SyncEnable') || 'Enable sync server'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.r2SyncEnableDesc') || 'Sync appearance settings and AI themes through your own Cloudflare D1 Worker or self-hosted sync service.'}{' '}
                                <a
                                    href="https://folia-site.cielaniska.top/guide/deploy-sync"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    {t('options.r2SyncDeployDocs') || 'Deployment guide'}
                                </a>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateDraftSyncConfig({ enabled: !draftSyncConfig.enabled })}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!draftSyncConfig.enabled ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: draftSyncConfig.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${draftSyncConfig.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <label className="block space-y-1">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.r2SyncWorkerUrl') || 'Sync Server URL'}
                            </span>
                            <input
                                type="url"
                                value={draftSyncConfig.workerBaseUrl}
                                onChange={(event) => updateDraftSyncConfig({ workerBaseUrl: event.target.value })}
                                placeholder="https://folia-sync.example.workers.dev"
                                className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        {/* QQ 音乐 API 地址：指向你自己部署的 qq-api，多设备共享同一登录态（docs/qq-shared-session-design.md §5.2） */}
                        <label className="block space-y-1">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.qqApiUrl') || 'QQ Music API URL'}
                            </span>
                            <input
                                type="url"
                                value={qqApiUrlDraft}
                                onChange={(event) => setQqApiUrlDraft(event.target.value)}
                                onBlur={() => setQqApiBaseUrlOverride(qqApiUrlDraft)}
                                placeholder="https://qq-api.example.com"
                                className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <span className="block text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.qqApiUrlHint') || 'Point every device at the same self-hosted qq-api to share the QQ login. Leave empty for the default. Restart the app to apply.'}
                            </span>
                        </label>
                        {/* Folia 账号：登录后收藏/歌单/喜欢走账号数据域，兼容模式 token 可留空 */}
                        <div className="pt-3 border-t border-white/10 space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <UserRound size={14} />
                                    {t('ui.storage.accountTitle') || 'Folia Account'}
                                </div>
                                <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('ui.storage.accountDesc') || 'Sign in to sync playlists and likes across devices through your own sync server. Platform credentials never leave this device.'}
                                </div>
                            </div>

                            {accountSession.status === 'hydrating' ? (
                                <div className="flex items-center gap-2 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    <Loader2 size={14} className="animate-spin" />
                                    {t('ui.storage.accountHydrating') || 'Checking session...'}
                                </div>
                            ) : accountSession.status === 'signed-in' ? (
                                <div className="flex items-center justify-between gap-3 bg-black/10 rounded-lg border border-white/5 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{accountSession.email}</div>
                                        <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {t('ui.storage.accountSignedIn') || 'Signed in — playlists and likes sync to this account.'}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleSignOut}
                                        disabled={accountSession.busy}
                                        className={`shrink-0 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-1.5 disabled:opacity-40 ${errorTextColor}`}
                                    >
                                        {accountSession.busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                                        {t('ui.storage.accountSignOut') || 'Sign out'}
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <input
                                            type="email"
                                            autoComplete="email"
                                            value={authEmail}
                                            onChange={(event) => setAuthEmail(event.target.value)}
                                            placeholder={t('ui.storage.accountEmail') || 'Email'}
                                            className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                            style={{ color: 'var(--text-primary)' }}
                                        />
                                        <input
                                            type="password"
                                            autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                                            value={authPassword}
                                            onChange={(event) => setAuthPassword(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') void handleAuthSubmit();
                                            }}
                                            placeholder={t('ui.storage.accountPassword') || 'Password'}
                                            className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                            style={{ color: 'var(--text-primary)' }}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void handleAuthSubmit()}
                                            disabled={accountSession.busy || !authEmail.trim() || !authPassword || !draftSyncConfig.workerBaseUrl.trim()}
                                            className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {accountSession.busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                                            {authMode === 'sign-in'
                                                ? (t('ui.storage.accountSignIn') || 'Sign in')
                                                : (t('ui.storage.accountSignUp') || 'Sign up')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSwitchAuthMode}
                                            className="text-xs opacity-60 hover:opacity-90 underline underline-offset-2 transition-opacity"
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            {authMode === 'sign-in'
                                                ? (t('ui.storage.accountSwitchToSignUp') || 'No account? Sign up')
                                                : (t('ui.storage.accountSwitchToSignIn') || 'Have an account? Sign in')}
                                        </button>
                                    </div>
                                    {!draftSyncConfig.workerBaseUrl.trim() && (
                                        <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {t('ui.storage.accountNeedsServerUrl') || 'Set the sync server URL above first.'}
                                        </div>
                                    )}
                                    {accountSession.errorCode && (
                                        <div className="text-xs rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                                            <span className={errorTextColor}>{authErrorCodeText(accountSession.errorCode)}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <details>
                            <summary
                                className="text-xs opacity-60 cursor-pointer select-none hover:opacity-90 transition-opacity"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                {t('options.r2SyncAdvanced') || 'Advanced / compatibility mode'}
                            </summary>
                            <label className="block space-y-1 mt-3">
                                <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.r2SyncToken') || 'Bearer Token'}
                                </span>
                                <input
                                    type="password"
                                    value={draftSyncConfig.authToken}
                                    onChange={(event) => updateDraftSyncConfig({ authToken: event.target.value })}
                                    placeholder={t('options.r2SyncTokenPlaceholder') || 'Worker SYNC_TOKEN'}
                                    className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                                <span className="block text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.r2SyncTokenAccountHint') || 'Leave empty after signing in; only needed for legacy single-user deployments.'}
                                </span>
                            </label>
                        </details>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* 基础配置与备份功能 */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleSaveSyncConfig}
                                    disabled={!syncConfigDirty}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <Check size={14} />
                                    {t('options.r2SyncSave') || 'Save'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleTestSync()}
                                    disabled={!syncConfigured || syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'testing' ? <Loader2 size={14} className="animate-spin" /> : 
                                     testResult === 'success' ? <Check size={14} className="text-green-500" /> :
                                     testResult === 'error' ? <X size={14} className="text-red-500" /> :
                                     <Cloud size={14} />}
                                    {t('options.r2SyncTest') || 'Test'}
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void handleExportSyncLibrary()}
                                    disabled={syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'exporting' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    {t('options.r2SyncExportLibrary') || 'Export library'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => syncImportInputRef.current?.click()}
                                    disabled={syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'importing' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                    {t('options.r2SyncImportLibrary') || 'Import library'}
                                </button>
                            </div>
                        </div>

                        {/* 核心同步功能 */}
                        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => void handleSyncNow()}
                                disabled={!draftSyncConfig.enabled || !syncConfigured || syncAction !== 'idle'}
                                className="flex-1 px-3 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg text-xs font-medium transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-blue-400"
                            >
                                {syncAction === 'syncing' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                {t('options.r2SyncNow') || 'Sync AI Themes'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSyncSettings()}
                                disabled={!draftSyncConfig.enabled || !syncConfigured || syncAction !== 'idle'}
                                className="flex-1 px-3 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg text-xs font-medium transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-purple-400"
                            >
                                {syncAction === 'syncingSettings' ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                                {t('options.syncVisualSettings')}
                            </button>
                        </div>

                        <input
                            ref={syncImportInputRef}
                            type="file"
                            accept="application/zip,.zip,application/json,.json"
                            className="hidden"
                            onChange={(event) => void handleImportSyncLibrary(event.target.files?.[0] ?? null)}
                        />
                    </div>

                    <div className={`rounded-lg border px-3 py-2 text-xs ${(syncStatus.state === 'error' || testResult === 'error') && !syncSummaryMsg ? errorTextColor : testResult === 'success' ? 'text-green-500 border-green-500/20 bg-green-500/5' : ''}`} style={{ color: testResult === 'success' || testResult === 'error' ? undefined : 'var(--text-secondary)' }}>
                        {syncSummaryMsg || syncStatusLabel}
                    </div>
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
