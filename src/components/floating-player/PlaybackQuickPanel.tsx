import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Shuffle, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackQuickPanelStore, closePlaybackQuickPanel } from '../../stores/usePlaybackQuickPanelStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';

// src/components/floating-player/PlaybackQuickPanel.tsx
// 播放胶囊的「播放快捷」二级浮层：音量 + 静音 + 队列洗牌，贴在胶囊正上方。
// @fork 本地魔改版（2026-10-14）：这几项原本挤在 bravais 墙的「墙面工具」面板里（音量滑条 + 洗牌快捷格），
// 和透光 / 主题那堆外观项混在一起被吐槽；播放的事该跟着播放器走，于是搬到这里。
// 壳的开关按 HomeStylePanel 那套（纯 UI store、Esc 关闭、isDaylight 两副面孔），但它**不铺全屏背板**：
// 轻浮层不该压住胶囊与进度条，收场改用全局 pointerdown 的「点外部」判定（槽位按钮自己豁免，留下 toggle 语义）。
// bottom 走 usePlayerBottomBarBottomPx，跟着胶囊一起被用户的底栏抬升量抬高。
// 音量读写的是 useAudioSettingsStore 那份全局音量（与播放页面板、命令面板音量条同一个 store），
// 洗牌直接吃 App 传下来的 shuffleQueue（与命令面板 playback-shuffle 同一条实现）。

/** 胶囊展开态约占 96px（48 播放键行 + 两行信息 + padding），再加一点缝让卡片不贴着胶囊。 */
const QUICK_PANEL_BASE_BOTTOM_PX = 132;

/** 音量图标随显示的值变（与墙面滑条、播放页面板同一套：0 / 小于一半 / 其余）。 */
const volumeIcon = (value: number) => (value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2);

type PlaybackQuickPanelProps = {
    isDaylight: boolean;
    /** App 的 shuffleQueue（命令面板的同一条实现）。 */
    onShuffle: () => void;
};

const PlaybackQuickPanel: React.FC<PlaybackQuickPanelProps> = ({ isDaylight, onShuffle }) => {
    const { t } = useTranslation();
    const isOpen = usePlaybackQuickPanelStore(state => state.isOpen);
    const bottom = usePlayerBottomBarBottomPx(QUICK_PANEL_BASE_BOTTOM_PX);

    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const displayValue = isMuted ? 0 : volume;
    const VolumeIcon = volumeIcon(displayValue);

    const canShuffle = usePlaybackStore(state => !state.isFmMode && state.playQueue.length > 1);

    // Esc 收起（与主页样式浮层、工具面板同一阶梯）；preventDefault 免得底下的墙再吃一次这次按键。
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePlaybackQuickPanel();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    // 点浮层外任意处收起。不铺全屏背板（那会压掉胶囊的悬停展开与槽位的再点收起），
    // 改用捕获阶段的 pointerdown 判定；槽位按钮自己豁免 —— 它的 onClick 就是 toggle，交给它。
    useEffect(() => {
        if (!isOpen) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('[data-playback-quick-panel]')) return;
            if (target.closest('[data-ponder-slot="playback-quick"]')) return;
            closePlaybackQuickPanel();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [isOpen]);

    const setVolume = (value: number) => {
        const audio = useAudioSettingsStore.getState();
        // 拖音量就是想听见它：非零值先解除静音（与墙面滑条的旧行为一致）。
        if (value > 0 && audio.isMuted) audio.handleToggleMute();
        audio.handleSetVolume(value);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    role="dialog"
                    aria-label={t('playbackQuick.title')}
                    data-playback-quick-panel=""
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 12, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    style={{
                        bottom,
                        borderColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(18,18,22,0.9)',
                        boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
                    }}
                    className="fixed right-3 z-[145] w-72 max-w-[calc(100vw-24px)] rounded-2xl border p-4 backdrop-blur-2xl sm:right-4"
                >
                    {/* 音量行：左侧图标按钮静音，右侧读百分比。 */}
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={isMuted}
                            aria-label={isMuted ? t('playbackQuick.unmute') : t('playbackQuick.mute')}
                            title={isMuted ? t('playbackQuick.unmute') : t('playbackQuick.mute')}
                            onClick={() => useAudioSettingsStore.getState().handleToggleMute()}
                            className="h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition-colors"
                            style={{
                                borderColor: isDaylight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            <VolumeIcon size={16} />
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={displayValue}
                            aria-label={t('ui.volume')}
                            aria-valuetext={isMuted ? t('playbackQuick.muted') : `${Math.round(displayValue * 100)}%`}
                            onChange={event => setVolume(Number(event.target.value))}
                            className="flex-1 accent-current"
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {isMuted ? t('playbackQuick.muted') : `${Math.round(displayValue * 100)}%`}
                        </span>
                    </div>

                    {/* 洗牌行：队列不足两首 / 私人 FM 里禁用并写原因；洗完浮层不收起（还能再洗）。 */}
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }}>
                        <button
                            type="button"
                            onClick={onShuffle}
                            disabled={!canShuffle}
                            aria-label={t('playbackQuick.shuffle')}
                            title={canShuffle ? t('playbackQuick.shuffle') : t('playbackQuick.shuffleUnavailable')}
                            className="w-full flex items-center gap-2.5 text-sm font-medium py-2 px-2.5 rounded-xl transition-colors disabled:opacity-40"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <Shuffle size={16} className="shrink-0" />
                            <span className="min-w-0 truncate">{t('playbackQuick.shuffle')}</span>
                            {!canShuffle && (
                                <span className="ml-auto text-[10px] opacity-60 shrink-0">{t('playbackQuick.shuffleUnavailable')}</span>
                            )}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default PlaybackQuickPanel;
