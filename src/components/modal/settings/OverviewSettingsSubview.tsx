import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ChevronRight,
    Database,
    Palette,
    PlayCircle,
    Server,
    Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { ListeningStatsResult } from '../../../types/listeningStats';
import type { LyricApiStatus } from '../../../types/lyricApi';
import type { ObsBrowserSourceStatus } from '../../../types/obsBrowserSource';
import type { ThemeGenerationSource } from '../../../services/themePreferences';
import type { SettingsSectionId } from './navigation/settingsNavModel';
import { getListeningStats } from '../../../services/listeningStats/listeningStatsService';
import { LISTENING_STATS_CHANGED_EVENT } from '../../../services/listeningStats/listeningStatsRepository';
import { getCacheUsage } from '../../../services/db';
import { getVisualizerModeLabel } from '../../visualizer/registry';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { settingsCardClassFor } from './settingsCardClasses';

// src/components/modal/settings/OverviewSettingsSubview.tsx
// The options tab's landing page when no section has been remembered yet: account state, this
// week's listening, and the three main section groups. Rows carry live values and only navigate —
// nothing here writes a setting, so every section keeps exactly one editor (its own page).
//
// Deliberately plain divs rather than section elements with anchors: the overview has no setting to
// anchor to, and the anchor coverage test only inspects those elements. Every row is a jump, not an
// editor, so there is nothing here to bookmark.

type OverviewSettingsSubviewProps = {
    isDaylight: boolean;
    isElectron: boolean;
    themeGenerationSource: ThemeGenerationSource;
    /** Sidebar sections are pages; switching here is the same move the sidebar makes. */
    onOpenSection: (section: SettingsSectionId) => void;
    discordPresenceStatus?: ElectronDiscordPresenceStatus | null;
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    lyricApiStatus?: LyricApiStatus | null;
};

type OverviewRowData = {
    id: string;
    icon: LucideIcon;
    name: string;
    /** 一行摘要，用 · 连接两三个值。比两行标签更像总览，而不是又一张设置表单。 */
    summary: string;
    onClick: () => void;
};

type OverviewGroup = {
    id: string;
    label: string;
    items: OverviewRowData[];
};

const QUALITY_LABEL_KEYS: Record<string, string> = {
    standard: 'account.qualityStandard',
    high: 'account.qualityExhigh',
    lossless: 'account.qualityLossless',
    hires: 'account.qualityHires',
};

const formatBytes = (bytes: number | null): string => {
    if (bytes === null || !Number.isFinite(bytes)) return '—';
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
};

/** Hours with one decimal below 10, so a glance reads "2.4 小时" rather than a wall of minutes. */
const formatHours = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0';
    const hours = seconds / 3600;
    return hours >= 10 ? String(Math.round(hours)) : hours.toFixed(1);
};

const OverviewRow: React.FC<{ row: OverviewRowData; hoverClass: string; }> = ({ row, hoverClass }) => {
    const Icon = row.icon;
    return (
        // 无边框行：一排描边小卡会拼成一张表单网格；这里只在 hover 时浮出浅底和箭头。
        <button
            type="button"
            onClick={row.onClick}
            className={`group flex h-[38px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${hoverClass}`}
        >
            <Icon size={16} strokeWidth={1.7} className="shrink-0 opacity-40" />
            <span className="shrink-0 text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>{row.name}</span>
            <span className="ml-auto min-w-0 truncate text-right text-[11px] tabular-nums opacity-55" style={{ color: 'var(--text-secondary)' }}>
                {row.summary}
            </span>
            <ChevronRight size={13} strokeWidth={1.7} className="shrink-0 opacity-45 transition-opacity group-hover:opacity-90" />
        </button>
    );
};

const OverviewSettingsSubview: React.FC<OverviewSettingsSubviewProps> = ({
    isDaylight,
    isElectron,
    themeGenerationSource,
    onOpenSection,
    discordPresenceStatus,
    obsBrowserSourceStatus,
    lyricApiStatus,
}) => {
    const { t, i18n } = useTranslation();
    const cardClass = settingsCardClassFor(isDaylight);
    const rowHoverClass = isDaylight ? 'hover:bg-black/[0.04]' : 'hover:bg-white/[0.06]';

    const folia = useAccountSessionStore(useShallow(state => ({
        status: state.status,
        email: state.email,
        avatar: state.avatar,
    })));
    const providerAccounts = useOnlineProviderAccountStore(state => state.accounts);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const {
        audioQuality,
        listeningStatsEnabled,
        enableMediaCache,
    } = useAudioSettingsStore(useShallow(state => ({
        audioQuality: state.audioQuality,
        listeningStatsEnabled: state.listeningStatsEnabled,
        enableMediaCache: state.enableMediaCache,
    })));

    const [weekStats, setWeekStats] = useState<ListeningStatsResult | null>(null);
    const [cacheBytes, setCacheBytes] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!listeningStatsEnabled) {
            setWeekStats(null);
            return () => { cancelled = true; };
        }
        const load = () => {
            void getListeningStats('week')
                .then(result => { if (!cancelled) setWeekStats(result); })
                .catch(() => { /* an unreadable local table reads as no data, same as the stats page */ });
        };
        load();
        window.addEventListener(LISTENING_STATS_CHANGED_EVENT, load);
        return () => {
            cancelled = true;
            window.removeEventListener(LISTENING_STATS_CHANGED_EVENT, load);
        };
    }, [listeningStatsEnabled]);

    useEffect(() => {
        let cancelled = false;
        void getCacheUsage()
            .then(bytes => { if (!cancelled) setCacheBytes(bytes); })
            .catch(() => { if (!cancelled) setCacheBytes(null); });
        return () => { cancelled = true; };
    }, []);

    const onOff = (value: boolean) => (value ? t('options.overviewOn') : t('options.overviewOff'));

    const providerState = (providerId: string): { tone: 'on' | 'off' | 'muted'; label: string; } => {
        const account = providerAccounts[providerId];
        if (!account || account.hydration === 'loading' || account.status === 'unknown') {
            return { tone: 'muted', label: t('options.overviewChecking') };
        }
        if (account.cloudOrigin) {
            return { tone: 'muted', label: t('options.overviewCloudProjection') };
        }
        if (account.status === 'authenticated') {
            return { tone: 'on', label: t('options.overviewSignedIn') };
        }
        if (account.status === 'error') {
            return { tone: 'off', label: t('options.overviewError') };
        }
        return { tone: 'off', label: t('options.overviewSignedOut') };
    };

    const discordLabel = !isElectron
        ? t('options.overviewDesktopOnly')
        : !discordPresenceStatus
            ? t('options.overviewChecking')
            : !discordPresenceStatus.enabled
                ? t('options.overviewDisabled')
                : discordPresenceStatus.connected
                    ? t('options.overviewConnected')
                    : t('options.overviewEnabled');

    const lyricApiLabel = !lyricApiStatus
        ? t('options.overviewChecking')
        : !lyricApiStatus.enabled
            ? t('options.overviewDisabled')
            : lyricApiStatus.running
                ? t('options.overviewRunning')
                : t('options.overviewEnabled');

    // 一行摘要只放得下一条状态：OBS 真有人连时优先报连接数，其余时候报各自的开关。
    const integrationSummary = (obsBrowserSourceStatus?.clientCount ?? 0) > 0
        ? `OBS ${t('options.overviewConnected')} · ${obsBrowserSourceStatus?.clientCount}`
        : isElectron
            ? `Discord ${discordLabel}`
            : `${t('options.overviewLyricApi')} ${lyricApiLabel}`;

    // 总览只保留每个主分组最常用的两条；其余入口留在左侧栏，不在这里再铺一遍。
    const groups: OverviewGroup[] = [
        {
            id: 'appearance',
            label: t('options.settingsGroupAppearance'),
            items: [
                {
                    id: 'appearance',
                    icon: Sparkles,
                    name: t('options.playerLookSettings'),
                    onClick: () => onOpenSection('appearance'),
                    summary: getVisualizerModeLabel(visualizerMode, t),
                },
                {
                    id: 'theme',
                    icon: Palette,
                    name: t('options.themeGroupSettings'),
                    onClick: () => onOpenSection('theme'),
                    summary: themeGenerationSource === 'ai' ? t('options.overviewAiTheme') : t('options.overviewFollowCover'),
                },
            ],
        },
        {
            id: 'controls',
            label: t('options.settingsGroupControls'),
            items: [
                {
                    id: 'playback',
                    icon: PlayCircle,
                    name: t('options.playbackSettings'),
                    onClick: () => onOpenSection('playback'),
                    summary: t(QUALITY_LABEL_KEYS[audioQuality] ?? 'account.qualityStandard'),
                },
                {
                    id: 'listeningStats',
                    icon: Activity,
                    name: t('options.listeningStatsSettings'),
                    onClick: () => onOpenSection('listeningStats'),
                    summary: weekStats
                        ? `${formatHours(weekStats.summary.totalSeconds)} ${t('options.overviewHours')}`
                        : onOff(listeningStatsEnabled),
                },
            ],
        },
        {
            id: 'connections',
            label: t('options.settingsGroupConnections'),
            items: [
                {
                    id: 'integration',
                    icon: Server,
                    name: t('options.integrationSettings'),
                    onClick: () => onOpenSection('integration'),
                    summary: integrationSummary,
                },
                {
                    id: 'storage',
                    icon: Database,
                    name: t('options.storageSettings'),
                    onClick: () => onOpenSection('storage'),
                    summary: `${enableMediaCache ? t('options.overviewEnabled') : t('options.overviewDisabled')} · ${formatBytes(cacheBytes)}`,
                },
            ],
        },
    ];

    const platforms: Array<{ id: string; name: string; }> = [
        { id: 'netease', name: t('options.overviewPlatformNetease') },
        { id: 'qq', name: t('options.overviewPlatformQq') },
        { id: 'kugou', name: t('options.overviewPlatformKugou') },
    ];

    const foliaInitial = (folia.email ?? 'F').trim().charAt(0).toUpperCase() || 'F';
    const foliaStateLabel = folia.status === 'signed-in'
        ? t('options.overviewSynced')
        : folia.status === 'hydrating'
            ? t('options.overviewHydrating')
            : t('options.overviewSignedOut');

    // 柱状图是本周的七日分布：byWeekday 从周一开始，今天那根加深。
    // 中文的短标签是「周一」，比「一」多一个字但在 236px 里仍放得下；拉丁文则用 Mon。
    const weekdayLabels = useMemo(() => {
        const formatter = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
        return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 1 + index)));
    }, [i18n.language]);
    const todayWeekdayIndex = (new Date().getDay() + 6) % 7;
    const weekdayBars = weekdayLabels.map((label, index) => ({
        label,
        seconds: weekStats?.summary.byWeekday[index] ?? 0,
        isToday: index === todayWeekdayIndex,
    }));
    const weekdayMax = Math.max(1, ...weekdayBars.map(bar => bar.seconds));
    const barColor = isDaylight ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.20)';
    const todayBarColor = isDaylight ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.55)';
    const dotOffColor = isDaylight ? '#B6B6BA' : '#5A5A61';

    const formatDuration = (seconds: number): string => {
        const rounded = Math.max(0, Math.round(seconds));
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        if (hours > 0) return t('listeningStats.durationHoursMinutes', { hours, minutes });
        if (minutes > 0) return t('listeningStats.durationMinutes', { minutes });
        return t('listeningStats.durationSeconds', { seconds: rounded % 60 });
    };

    const weekSummary = weekStats
        ? t('options.overviewWeekSummary', {
            plays: weekStats.summary.totalPlays,
            songs: weekStats.summary.uniqueSongs,
            artists: weekStats.summary.uniqueArtists,
        })
        : '—';
    const streakLabel = weekStats
        ? `${t('options.overviewStreak')} ${weekStats.streak.current} ${t('options.overviewDays')} · ${t('options.overviewLongestStreak')} ${weekStats.streak.longest} ${t('options.overviewDays')}`
        : '';

    return (
        <div>
            {/* 账户卡：身份、平台登录态和「管理」入口，只占一行高。 */}
            <div className={`rounded-xl border px-3.5 py-3 ${cardClass}`}>
                <div className="flex min-w-0 items-center gap-2.5">
                    <div
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-full text-[12px] font-semibold"
                        style={{ backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)', color: 'var(--text-secondary)' }}
                    >
                        {folia.avatar
                            ? <img src={folia.avatar} alt="" className="h-full w-full object-cover" />
                            : foliaInitial}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-baseline gap-[7px]">
                            <span className="truncate text-[13.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
                                {folia.email ?? t('options.overviewFoliaAccount')}
                            </span>
                            <span className="shrink-0 text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                · {foliaStateLabel}
                            </span>
                        </div>
                        {/* 平台各占一段：登录后只留名字，未登录才在名字后面补状态。 */}
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 sm:flex-nowrap">
                            {platforms.map((platform) => {
                                const state = providerState(platform.id);
                                return (
                                    <span key={platform.id} className="flex min-w-0 items-center gap-1.5 text-[10.5px]">
                                        <span
                                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{
                                                backgroundColor: state.tone === 'on' ? 'var(--text-primary)' : 'transparent',
                                                border: state.tone === 'on' ? 'none' : `1px solid ${dotOffColor}`,
                                                opacity: state.tone === 'muted' ? 0.4 : 1,
                                            }}
                                        />
                                        <span
                                            className="truncate"
                                            style={{ color: state.tone === 'on' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                                        >
                                            {platform.name}
                                        </span>
                                        {state.tone !== 'on' && (
                                            <span className="shrink-0 text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                                {state.label}
                                            </span>
                                        )}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenSection('storage')}
                        className="flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] opacity-50 transition-opacity hover:opacity-100"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {t('options.overviewManage')}
                        <ChevronRight size={12} />
                    </button>
                </div>
            </div>

            {/* 本周听歌独立成卡：左数字、右七日柱，数据直接来自 byWeekday。 */}
            <div className={`mt-2.5 rounded-xl border px-3.5 pb-3 pt-[13px] ${cardClass}`}>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2.5">
                        <span className="shrink-0 text-[10px] font-medium tracking-[0.08em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.overviewWeekListening')}
                        </span>
                        {listeningStatsEnabled && weekStats && weekStats.streak.longest > 0 && (
                            <span className="truncate text-[10px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                                {streakLabel}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenSection('listeningStats')}
                        className="flex shrink-0 items-center gap-0.5 text-[11px] opacity-50 transition-opacity hover:opacity-100"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {t('options.listeningStatsSettings')}
                        <ChevronRight size={12} />
                    </button>
                </div>

                {!listeningStatsEnabled ? (
                    <div className="mt-2 text-[11px] leading-relaxed opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.overviewStatsOff')}
                    </div>
                ) : (
                    <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-[3px]">
                                <b className="text-[20px] font-semibold leading-[1.05] tabular-nums" style={{ color: 'var(--text-primary)' }}>
                                    {weekStats ? formatHours(weekStats.summary.totalSeconds) : '—'}
                                </b>
                                <span className="text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.overviewHours')}
                                </span>
                            </div>
                            <div className="mt-[5px] truncate text-[10.5px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                {weekSummary}
                            </div>
                        </div>
                        <div className="w-full shrink-0 sm:w-[236px]" role="img" aria-label={t('options.overviewWeekListening')}>
                            <div className="flex h-10 items-end gap-1.5">
                                {weekdayBars.map((bar, index) => (
                                    <div
                                        key={index}
                                        className="min-w-0 flex-1 rounded-[2px]"
                                        style={{
                                            height: `${bar.seconds > 0 ? Math.max(4, (bar.seconds / weekdayMax) * 100) : 0}%`,
                                            minHeight: 2,
                                            backgroundColor: bar.isToday ? todayBarColor : barColor,
                                        }}
                                        title={`${bar.label} · ${formatDuration(bar.seconds)}`}
                                    />
                                ))}
                            </div>
                            <div className="mt-[5px] flex gap-1.5 text-[9.5px]">
                                {weekdayBars.map((bar, index) => (
                                    <span
                                        key={index}
                                        className={`min-w-0 flex-1 text-center ${bar.isToday ? 'font-semibold' : ''}`}
                                        style={{
                                            color: 'var(--text-secondary)',
                                            opacity: bar.isToday ? 0.9 : 0.4,
                                        }}
                                    >
                                        {bar.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-4 space-y-4">
                {groups.map((group) => (
                    <div key={group.id}>
                        <div className="mb-1 px-2.5 text-[10px] font-medium tracking-[0.08em] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                            {group.label}
                        </div>
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            {group.items.map((row) => (
                                <OverviewRow key={row.id} row={row} hoverClass={rowHoverClass} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OverviewSettingsSubview;
