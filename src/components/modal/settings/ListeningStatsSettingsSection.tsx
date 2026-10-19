import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Cloud, Download, ShieldCheck, Trash2 } from 'lucide-react';
import type { Theme } from '../../../types';
import type {
    ListeningStatsBucket,
    ListeningStatsRange,
    ListeningStatsResult,
} from '../../../types/listeningStats';
import {
    exportListeningStatsJson,
    getListeningStats,
} from '../../../services/listeningStats/listeningStatsService';
import {
    clearListeningPlays,
    deleteListeningPlay,
    LISTENING_STATS_CHANGED_EVENT,
} from '../../../services/listeningStats/listeningStatsRepository';
import { settingsDividerClassFor } from './settingsCardClasses';
import {
    buildListeningHeatmap,
    buildListeningHeatmapMonths,
    countListeningWindowDays,
} from './listeningStatsView';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';
import { syncListeningStats } from '../../../services/sync/listeningStatsSync';
import BravaisSettingsToggleRow from './BravaisSettingsToggleRow';

// src/components/modal/settings/ListeningStatsSettingsSection.tsx
// The listening readout: totals, a trailing-year heatmap, top lists, hour/source splits and the
// last few plays. Signed-in accounts sync automatically; the page pulls one incremental page on
// open and listens for local/remote changes, so another device's plays show up without a reopen.

type ListeningStatsSettingsSectionProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
};

const RANGES: { id: ListeningStatsRange; labelKey: string }[] = [
    { id: 'week', labelKey: 'listeningStats.rangeWeek' },
    { id: 'month', labelKey: 'listeningStats.rangeMonth' },
    { id: 'year', labelKey: 'listeningStats.rangeYear' },
    { id: 'all', labelKey: 'listeningStats.rangeAll' },
];

// The grid uses 10px cells with 3px gaps; month labels share the same column rhythm.
const HEATMAP_COLUMN_WIDTH = 13;
const HEATMAP_WEEKDAY_WIDTH = 15;

const SOURCE_LABEL_KEYS: Record<string, string> = {
    netease: 'listeningStats.sourceNetease',
    qq: 'listeningStats.sourceQq',
    kugou: 'listeningStats.sourceKugou',
    local: 'listeningStats.sourceLocal',
    navidrome: 'listeningStats.sourceNavidrome',
};

const StatTile: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const calm = useReducedMotionFor('uiMicroMotion');

    return (
        <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                {label}
            </div>
            <div className="mt-1 text-xl font-semibold leading-tight tabular-nums" style={{ color: 'var(--text-primary)', perspective: 600 }}>
                {calm ? (
                    <span className="inline-block">{value}</span>
                ) : (
                    <motion.span
                        key={value}
                        initial={{ rotateX: -90, opacity: 0 }}
                        animate={{ rotateX: 0, opacity: 1 }}
                        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                        className="inline-block origin-top"
                    >
                        {value}
                    </motion.span>
                )}
            </div>
        </div>
    );
};

const CoverThumb: React.FC<{ coverUrl?: string; isDaylight: boolean }> = ({ coverUrl, isDaylight }) => (
    <div
        className="h-9 w-9 shrink-0 overflow-hidden rounded-md"
        style={{ backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}
    >
        {coverUrl ? <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
    </div>
);

const BucketList: React.FC<{
    title: string;
    items: ListeningStatsBucket[];
    emptyLabel: string;
    settingsCardClass: string;
    dividerClass: string;
    formatDuration: (seconds: number) => string;
    formatPlays: (count: number) => string;
    isDaylight: boolean;
    showCover?: boolean;
}> = ({ title, items, emptyLabel, settingsCardClass, dividerClass, formatDuration, formatPlays, isDaylight, showCover }) => (
    <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</div>
        {items.length === 0 ? (
            <div className="mt-3 text-xs opacity-40" style={{ color: 'var(--text-secondary)' }}>{emptyLabel}</div>
        ) : (
            <div className={`mt-2 divide-y ${dividerClass}`}>
                {items.map((item, index) => (
                    <div key={item.key} className="flex items-center gap-3 py-2">
                        <span className="w-3 shrink-0 text-[11px] tabular-nums opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            {index + 1}
                        </span>
                        {showCover && <CoverThumb coverUrl={item.coverUrl} isDaylight={isDaylight} />}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px]" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                            {item.sublabel && (
                                <div className="truncate text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                    {item.sublabel}
                                </div>
                            )}
                        </div>
                        <div className="shrink-0 text-right">
                            <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                                {formatDuration(item.seconds)}
                            </div>
                            <div className="text-[10px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                                {formatPlays(item.plays)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
);

const ListeningStatsSettingsSection: React.FC<ListeningStatsSettingsSectionProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t, i18n } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const listeningStatsEnabled = useAudioSettingsStore(state => state.listeningStatsEnabled);
    const handleToggleListeningStats = useAudioSettingsStore(state => state.handleToggleListeningStats);
    const accountStatus = useAccountSessionStore(state => state.status);
    const accountEmail = useAccountSessionStore(state => state.email);
    const signedIn = accountStatus === 'signed-in';
    const [range, setRange] = useState<ListeningStatsRange>('week');
    const [stats, setStats] = useState<ListeningStatsResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [hoveredDay, setHoveredDay] = useState<string | null>(null);
    const [clearArmed, setClearArmed] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const accent = theme?.accentColor || (isDaylight ? '#3f3f46' : '#d4d4d8');
    const neutralCell = isDaylight ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.07)';
    const dividerClass = settingsDividerClassFor(isDaylight);
    const numberFormatter = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
    const recentDateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }), [i18n.language]);
    const monthFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
    }), [i18n.language]);
    const firstPlayedFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }), [i18n.language]);
    const weekdayFormatters = useMemo(() => ({
        short: new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }),
        narrow: new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }),
    }), [i18n.language]);
    // 1 January 2024 was a Monday, the first row of both the strip and the heatmap.
    const weekdayLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => weekdayFormatters.short.format(new Date(2024, 0, 1 + index)))
    ), [weekdayFormatters]);
    const weekdayNarrowLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => weekdayFormatters.narrow.format(new Date(2024, 0, 1 + index)))
    ), [weekdayFormatters]);

    const formatDuration = useCallback((seconds: number): string => {
        const rounded = Math.max(0, Math.round(seconds));
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        if (hours > 0) return t('listeningStats.durationHoursMinutes', { hours, minutes });
        if (minutes > 0) return t('listeningStats.durationMinutes', { minutes });
        return t('listeningStats.durationSeconds', { seconds: rounded % 60 });
    }, [t]);

    const formatPlays = useCallback((count: number): string => (
        t('listeningStats.playsCount', { value: numberFormatter.format(count) })
    ), [numberFormatter, t]);

    const sourceLabel = useCallback((source: string): string => (
        t(SOURCE_LABEL_KEYS[source] || 'listeningStats.sourceOther')
    ), [t]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        // 本地读数先出来：网络慢或服务端没部署时，页面不能被云端同步拖成一直 0。
        const readLocal = async () => {
            const result = await getListeningStats(range);
            if (cancelled) return;
            setStats(result);
            setLoading(false);
        };
        void readLocal();
        // 登录后在后台拉一次云端增量，回来后刷新读数；失败只影响云端那部分。
        if (signedIn) {
            void syncListeningStats()
                .then(() => readLocal())
                .catch(error => console.warn('[ListeningStats] Background sync failed', error));
        }
        return () => {
            cancelled = true;
        };
    }, [range, signedIn]);

    // A play that settles while the page is open lands here; no polling, no reopen.
    useEffect(() => {
        const reload = () => {
            void getListeningStats(range).then(setStats);
        };
        window.addEventListener(LISTENING_STATS_CHANGED_EVENT, reload);
        return () => window.removeEventListener(LISTENING_STATS_CHANGED_EVENT, reload);
    }, [range]);

    useEffect(() => {
        if (!clearArmed) return;
        const timeout = window.setTimeout(() => setClearArmed(false), 4000);
        return () => window.clearTimeout(timeout);
    }, [clearArmed]);

    useEffect(() => {
        if (!actionMessage) return;
        const timeout = window.setTimeout(() => setActionMessage(null), 2400);
        return () => window.clearTimeout(timeout);
    }, [actionMessage]);

    const heatmap = useMemo(() => buildListeningHeatmap(
        stats?.heatmapDailySeconds || {},
        stats?.heatmapWindow.to || Date.now(),
    ), [stats]);
    const heatmapMonths = useMemo(() => buildListeningHeatmapMonths(heatmap.cells), [heatmap]);
    const heatmapActiveDays = useMemo(
        () => heatmap.cells.filter(cell => cell.seconds > 0).length,
        [heatmap],
    );
    const hoveredCell = hoveredDay ? heatmap.cells.find(cell => cell.key === hoveredDay) : null;

    const summary = stats?.summary;
    const hasHistory = Boolean(stats && stats.recent.length > 0);
    const averageDays = useMemo(() => {
        if (!stats) return 0;
        // 'all' has no bounded window, so the average runs from the first record to today.
        return stats.range === 'all'
            ? countListeningWindowDays(stats.firstPlayedAt ?? stats.window.to, stats.window.to)
            : countListeningWindowDays(stats.window.from, stats.window.to);
    }, [stats]);
    const averageSeconds = summary && averageDays > 0 ? summary.totalSeconds / averageDays : 0;
    const hourMax = summary ? Math.max(1, ...summary.byHour) : 1;
    const weekdayMax = summary ? Math.max(1, ...summary.byWeekday) : 1;
    const sourceTotal = summary ? summary.bySource.reduce((total, bucket) => total + bucket.seconds, 0) : 0;
    const sourceColors = [accent, '#71717a', '#a1a1aa', '#52525b', '#d4d4d8', '#3f3f46'];

    const handleExport = async () => {
        try {
            const json = await exportListeningStatsJson();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `folia-listening-stats-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setActionMessage(t('listeningStats.exportDone'));
        } catch (error) {
            console.warn('[ListeningStats] Export failed', error);
        }
    };

    const handleClear = async () => {
        if (!clearArmed) {
            setClearArmed(true);
            return;
        }
        setClearArmed(false);
        try {
            await clearListeningPlays();
            setActionMessage(t('listeningStats.clearDone'));
        } catch (error) {
            console.warn('[ListeningStats] Clear failed', error);
        }
    };

    const handleDeletePlay = async (sessionId: string) => {
        try {
            await deleteListeningPlay(sessionId);
            setActionMessage(t('listeningStats.deleteDone'));
        } catch (error) {
            console.warn('[ListeningStats] Delete failed', error);
        }
    };

    if (loading && !stats) {
        return (
            <div className={`p-4 rounded-xl border text-sm opacity-50 ${settingsCardClass}`} style={{ color: 'var(--text-secondary)' }}>
                {t('listeningStats.loading')}
            </div>
        );
    }

    const ghostButtonClass = `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isDaylight ? 'border-black/10 hover:bg-black/5' : 'border-white/10 hover:bg-white/10'
    }`;

    return (
        <div className="space-y-4">
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <BravaisSettingsToggleRow
                    label={t('listeningStats.recordToggle')}
                    description={t('listeningStats.recordToggleDesc')}
                    checked={listeningStatsEnabled}
                    onChange={handleToggleListeningStats}
                    isDaylight={isDaylight}
                    onColor={accent}
                    divider={false}
                />
                {!listeningStatsEnabled && (
                    <div className="mt-2 text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                        {t('listeningStats.recordPausedHint')}
                    </div>
                )}
            </div>

            {!stats?.unavailable && (
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className={`inline-flex items-center gap-1 rounded-full p-1 ${isDaylight ? 'bg-black/[0.045]' : 'bg-white/[0.06]'}`}>
                        {RANGES.map(option => {
                            const active = range === option.id;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setRange(option.id)}
                                    aria-pressed={active}
                                    className="rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                                    style={active
                                        ? { backgroundColor: accent, color: '#fff' }
                                        : { color: 'var(--text-secondary)' }}
                                >
                                    {t(option.labelKey)}
                                </button>
                            );
                        })}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        {signedIn ? <Cloud size={12} /> : <ShieldCheck size={12} />}
                        {signedIn
                            ? (accountEmail
                                ? t('listeningStats.cloudAutoSync', { email: accountEmail })
                                : t('listeningStats.cloudAutoSyncGeneric'))
                            : t('listeningStats.localOnly')}
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                    <StatTile label={t('listeningStats.totalTime')} value={formatDuration(summary?.totalSeconds || 0)} />
                    <StatTile label={t('listeningStats.plays')} value={numberFormatter.format(summary?.totalPlays || 0)} />
                    <StatTile label={t('listeningStats.songs')} value={numberFormatter.format(summary?.uniqueSongs || 0)} />
                    <StatTile label={t('listeningStats.artists')} value={numberFormatter.format(summary?.uniqueArtists || 0)} />
                </div>
                <div className="mt-4 text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {t('listeningStats.activeDaysHint', {
                        days: numberFormatter.format(summary?.activeDays || 0),
                        completed: numberFormatter.format(summary?.completedPlays || 0),
                    })}
                </div>
                {(summary?.totalPlays || 0) > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        <span>{t('listeningStats.averageHint', { duration: formatDuration(averageSeconds) })}</span>
                        <span>{t('listeningStats.streakHint', {
                            current: numberFormatter.format(stats?.streak.current || 0),
                            longest: numberFormatter.format(stats?.streak.longest || 0),
                        })}</span>
                    </div>
                )}
                {stats?.firstPlayedAt ? (
                    <div className="mt-1 text-[11px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                        {t('listeningStats.firstPlayedHint', { date: firstPlayedFormatter.format(new Date(stats.firstPlayedAt)) })}
                    </div>
                ) : null}
                {summary && summary.totalPlays === 0 && (
                    <div className="mt-2 text-[11px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        {t('listeningStats.rangeEmpty')}
                    </div>
                )}
            </div>
            )}

            {stats?.unavailable ? (
                <div className={`p-6 rounded-xl border text-center ${settingsCardClass}`}>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('listeningStats.unavailableTitle')}
                    </div>
                    <div className="mx-auto mt-2 max-w-[420px] text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        {t('listeningStats.unavailableBody')}
                    </div>
                </div>
            ) : !hasHistory ? (
                <div className={`p-6 rounded-xl border text-center ${settingsCardClass}`}>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('listeningStats.emptyTitle')}
                    </div>
                    <div className="mx-auto mt-2 max-w-[420px] text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        {t('listeningStats.emptyBody')}
                    </div>
                </div>
            ) : (
                <>
                    <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('listeningStats.heatmapTitle')}
                                </div>
                                <div className="mt-0.5 text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                    {t('listeningStats.heatmapYearTotal', { duration: formatDuration(heatmap.yearSeconds) })}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                <span>{t('listeningStats.heatmapLess')}</span>
                                {[0, 1, 2, 3, 4].map(level => (
                                    <span
                                        key={level}
                                        className="h-2 w-2 rounded-[2px]"
                                        style={{
                                            backgroundColor: level === 0
                                                ? neutralCell
                                                : `color-mix(in srgb, ${accent} ${18 + level * 20}%, transparent)`,
                                        }}
                                    />
                                ))}
                                <span>{t('listeningStats.heatmapMore')}</span>
                            </div>
                        </div>

                        <div className="mt-4 overflow-x-auto pb-1">
                            <div className="w-max">
                                <div
                                    className="relative h-3"
                                    style={{ marginLeft: HEATMAP_WEEKDAY_WIDTH, width: heatmap.columns * HEATMAP_COLUMN_WIDTH }}
                                >
                                    {heatmapMonths.map(month => (
                                        <span
                                            key={month.timestamp}
                                            className="absolute top-0 text-[9px] leading-none opacity-40"
                                            style={{ left: month.column * HEATMAP_COLUMN_WIDTH, color: 'var(--text-secondary)' }}
                                        >
                                            {monthFormatter.format(new Date(month.timestamp))}
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-[3px]">
                                    <div
                                        className="grid text-[9px] leading-[10px] opacity-40"
                                        style={{ gridTemplateRows: 'repeat(7, 10px)', rowGap: 3, color: 'var(--text-secondary)' }}
                                    >
                                        {weekdayNarrowLabels.map((label, index) => (
                                            <span key={index} className="w-3">{index % 2 === 0 ? label : ''}</span>
                                        ))}
                                    </div>
                                    <div
                                        role="img"
                                        aria-label={t('listeningStats.heatmapAria', {
                                            duration: formatDuration(heatmap.yearSeconds),
                                            days: numberFormatter.format(heatmapActiveDays),
                                        })}
                                        className="grid grid-flow-col gap-[3px]"
                                        style={{ gridTemplateRows: 'repeat(7, 10px)', width: 'max-content' }}
                                    >
                                        {heatmap.cells.map(cell => (
                                            <div
                                                key={cell.key}
                                                className={`h-[10px] w-[10px] rounded-[2px] ${calm ? '' : 'transition-transform hover:scale-125'}`}
                                                style={{
                                                    backgroundColor: cell.level === 0
                                                        ? neutralCell
                                                        : `color-mix(in srgb, ${accent} ${18 + cell.level * 20}%, transparent)`,
                                                }}
                                                title={`${cell.key} · ${formatDuration(cell.seconds)}`}
                                                onMouseEnter={() => setHoveredDay(cell.key)}
                                                onMouseLeave={() => setHoveredDay(current => current === cell.key ? null : current)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-2 text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                            {hoveredCell
                                ? `${hoveredCell.key} · ${formatDuration(hoveredCell.seconds)}`
                                : t('listeningStats.heatmapHint')}
                        </div>
                    </div>

                    <BucketList
                        title={t('listeningStats.topSongs')}
                        items={summary?.topSongs || []}
                        emptyLabel={t('listeningStats.topEmpty')}
                        settingsCardClass={settingsCardClass}
                        dividerClass={dividerClass}
                        formatDuration={formatDuration}
                        formatPlays={formatPlays}
                        isDaylight={isDaylight}
                        showCover
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                        <BucketList
                            title={t('listeningStats.topArtists')}
                            items={summary?.topArtists || []}
                            emptyLabel={t('listeningStats.topEmpty')}
                            settingsCardClass={settingsCardClass}
                            dividerClass={dividerClass}
                            formatDuration={formatDuration}
                            formatPlays={formatPlays}
                            isDaylight={isDaylight}
                        />
                        <BucketList
                            title={t('listeningStats.topAlbums')}
                            items={summary?.topAlbums || []}
                            emptyLabel={t('listeningStats.topEmpty')}
                            settingsCardClass={settingsCardClass}
                            dividerClass={dividerClass}
                            formatDuration={formatDuration}
                            formatPlays={formatPlays}
                            isDaylight={isDaylight}
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('listeningStats.hourlyTitle')}
                            </div>
                            <div className="mt-4 flex h-24 items-end gap-[3px]">
                                {(summary?.byHour || []).map((seconds, hour) => (
                                    <div
                                        key={hour}
                                        className="min-w-0 flex-1 rounded-t-[2px]"
                                        style={{
                                            height: `${Math.max(seconds > 0 ? 3 : 0, (seconds / hourMax) * 100)}%`,
                                            backgroundColor: seconds > 0 ? accent : neutralCell,
                                            opacity: seconds > 0 ? 0.9 : 1,
                                        }}
                                        title={`${String(hour).padStart(2, '0')}:00 · ${formatDuration(seconds)}`}
                                    />
                                ))}
                            </div>
                            <div className="mt-2 flex justify-between text-[10px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                                <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('listeningStats.weekdayTitle')}
                            </div>
                            <div className="mt-4 flex h-24 items-end gap-[3px]">
                                {(summary?.byWeekday || []).map((seconds, index) => (
                                    <div
                                        key={index}
                                        className="min-w-0 flex-1 rounded-t-[2px]"
                                        style={{
                                            height: `${Math.max(seconds > 0 ? 3 : 0, (seconds / weekdayMax) * 100)}%`,
                                            backgroundColor: seconds > 0 ? accent : neutralCell,
                                            opacity: seconds > 0 ? 0.9 : 1,
                                        }}
                                        title={`${weekdayLabels[index]} · ${formatDuration(seconds)}`}
                                    />
                                ))}
                            </div>
                            <div className="mt-2 flex gap-[3px] text-[10px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                                {weekdayLabels.map((label, index) => (
                                    <span key={index} className="min-w-0 flex-1 text-center">{label}</span>
                                ))}
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('listeningStats.sourceTitle')}
                            </div>
                            {sourceTotal <= 0 ? (
                                <div className="mt-3 text-xs opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                    {t('listeningStats.topEmpty')}
                                </div>
                            ) : (
                                <>
                                    <div className="mt-4 flex h-2 overflow-hidden rounded-full">
                                        {(summary?.bySource || []).map((bucket, index) => (
                                            <div
                                                key={bucket.key}
                                                style={{
                                                    width: `${(bucket.seconds / sourceTotal) * 100}%`,
                                                    backgroundColor: sourceColors[index % sourceColors.length],
                                                }}
                                                title={`${sourceLabel(bucket.key)} · ${Math.round((bucket.seconds / sourceTotal) * 100)}%`}
                                            />
                                        ))}
                                    </div>
                                    <div className="mt-3 space-y-1.5">
                                        {(summary?.bySource || []).map((bucket, index) => (
                                            <div key={bucket.key} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                                <span
                                                    className="h-2 w-2 shrink-0 rounded-full"
                                                    style={{ backgroundColor: sourceColors[index % sourceColors.length] }}
                                                />
                                                <span className="min-w-0 flex-1 truncate">{sourceLabel(bucket.key)}</span>
                                                <span className="tabular-nums opacity-55">
                                                    {Math.round((bucket.seconds / sourceTotal) * 100)}%
                                                </span>
                                                <span className="w-16 shrink-0 text-right tabular-nums opacity-40">
                                                    {formatDuration(bucket.seconds)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('listeningStats.recentTitle')}
                        </div>
                        <div className={`mt-2 divide-y ${dividerClass}`}>
                            {(stats?.recent || []).map(play => (
                                <div key={play.sessionId} className="flex items-center gap-3 py-2">
                                    <CoverThumb coverUrl={play.coverUrl} isDaylight={isDaylight} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px]" style={{ color: 'var(--text-primary)' }}>{play.title}</div>
                                        <div className="truncate text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                            {play.artist || t('listeningStats.unknownArtist')}
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <div className="text-[11px] tabular-nums opacity-55" style={{ color: 'var(--text-secondary)' }}>
                                            {formatDuration(play.listenedSec)}
                                        </div>
                                        <div className="text-[10px] opacity-35" style={{ color: 'var(--text-secondary)' }}>
                                            {recentDateFormatter.format(new Date(play.playedAt))}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { void handleDeletePlay(play.sessionId); }}
                                        aria-label={t('listeningStats.deletePlay')}
                                        title={t('listeningStats.deletePlay')}
                                        className={`shrink-0 rounded-md p-1 opacity-40 transition-all hover:opacity-90 focus-visible:opacity-90 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => { void handleExport(); }}
                    disabled={!hasHistory}
                    className={ghostButtonClass}
                    style={{ color: 'var(--text-secondary)' }}
                >
                    <Download size={12} />
                    {t('listeningStats.export')}
                </button>
                <button
                    type="button"
                    onClick={() => { void handleClear(); }}
                    disabled={!hasHistory}
                    className={`${ghostButtonClass} ${clearArmed ? 'border-red-400/40 text-red-500' : ''}`}
                    style={clearArmed ? undefined : { color: 'var(--text-secondary)' }}
                >
                    <Trash2 size={12} />
                    {clearArmed ? t('listeningStats.clearConfirm') : t('listeningStats.clear')}
                </button>
                {actionMessage && (
                    <span className="text-[11px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                        {actionMessage}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ListeningStatsSettingsSection;
