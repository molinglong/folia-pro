import React, { useState } from 'react';
import { Gauge, MonitorCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, VisualizerFrameRate } from '../../../types';
import { VISUALIZER_FRAME_RATE_OPTIONS } from '../../../utils/frameRateLimiter';
import ThemedDialog from '../../shared/ThemedDialog';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import MotionReductionSettingsSection from './MotionReductionSettingsSection';
import SettingsRow, { SettingsToggle } from './SettingsRow';
import { settingsDividerClassFor } from './settingsCardClasses';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { MOTION_SURFACE_IDS, useMotionSettingsStore } from '../../../stores/useMotionSettingsStore';
import { useGraphicsPresetStore, type GraphicsPresetId } from '../../../stores/useGraphicsPresetStore';

// src/components/modal/settings/GraphicsSettingsSubview.tsx
// 画质档位选择器 + 摘要说明，加上「其他」那几个不受档位管的开关（静态模式、原生模糊、光晕量化）。
//
// 「帧率上限」「首页动态背景」和整块「减少动效」被档位接管：选中流畅/均衡/画质时折叠隐藏，只留
// 一张摘要卡说清楚这个档位到底改了什么，切到「自定义」才逐项露出来。理由见 useGraphicsPresetStore。

/** Docs page behind the "Fix lyric animation freeze on Linux" switch. */
const CHROMIUM_FD_EXHAUSTION_DOCS_URL = 'https://folia-site.cielaniska.top/guide/chromium-fd-exhaustion';

/** On desktop a plain link would open inside the app window; hand it to the system browser instead. */
const openDocsLinkExternally = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!window.electron?.openExternalUrl) return;
    event.preventDefault();
    void window.electron.openExternalUrl(event.currentTarget.href);
};

const getFrameRateLabel = (frameRate: VisualizerFrameRate) => `${frameRate} FPS`;

const PRESET_ORDER: GraphicsPresetId[] = ['smooth', 'balanced', 'quality', 'custom'];
const presetLabelKey = (preset: GraphicsPresetId) => `options.graphicsPreset${preset[0].toUpperCase()}${preset.slice(1)}`;

type GraphicsSettingsSubviewProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    utilityGhostButtonClass: string;
    rangeInputClass: string;
    theme?: Theme;
};

const GraphicsSettingsSubview: React.FC<GraphicsSettingsSubviewProps> = ({
    isDaylight,
    settingsCardClass,
    toggleOffBackgroundClass,
    utilityGhostButtonClass,
    rangeInputClass,
    theme,
}) => {
    const { t } = useTranslation();
    const [isNativeBlurNoticeOpen, setIsNativeBlurNoticeOpen] = useState(false);
    const {
        disableHomeDynamicBackground,
        staticMode,
        onToggleDisableHomeDynamicBackground,
        onToggleStaticMode,
    } = useThemeSettingsStore(useShallow(state => ({
        disableHomeDynamicBackground: state.disableHomeDynamicBackground,
        staticMode: state.staticMode,
        onToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
        onToggleStaticMode: state.handleToggleStaticMode,
    })));
    const enablePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const onTogglePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.handleTogglePlayerPageNativeBlur);
    const visualizerFrameRate = useVisualizerSettingsStore(state => state.visualizerFrameRate);
    const onVisualizerFrameRateChange = useVisualizerSettingsStore(state => state.handleSetVisualizerFrameRate);
    const glowBlurQuantize = useVisualizerSettingsStore(state => state.glowBlurQuantize);
    const onToggleGlowBlurQuantize = useVisualizerSettingsStore(state => state.handleToggleGlowBlurQuantize);
    const reducedMotionSurfaces = useMotionSettingsStore(state => state.reducedMotionSurfaces);

    const { graphicsPreset, isDrifted, onSelectGraphicsPreset } = useGraphicsPresetStore(useShallow(state => ({
        graphicsPreset: state.graphicsPreset,
        isDrifted: state.isDrifted,
        onSelectGraphicsPreset: state.handleSelectGraphicsPreset,
    })));

    const isCustomPresetActive = graphicsPreset === 'custom';
    const reducedMotionCount = MOTION_SURFACE_IDS.filter(surface => reducedMotionSurfaces[surface]).length;
    const isFrameRateUnlimited = visualizerFrameRate === 'off';
    const frameRateSummaryValue = isFrameRateUnlimited
        ? t('options.graphicsPresetSummaryFrameRateUnlimited')
        : getFrameRateLabel(visualizerFrameRate);

    const dividerClass = settingsDividerClassFor(isDaylight);
    const isLinux = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');
    const isVisualizerFrameRateLimiterEnabled = visualizerFrameRate !== 'off';
    const selectedVisualizerFrameRate = isVisualizerFrameRateLimiterEnabled ? visualizerFrameRate : 120;
    const selectedVisualizerFrameRateIndex = VISUALIZER_FRAME_RATE_OPTIONS.indexOf(selectedVisualizerFrameRate);

    const renderToggle = (checked: boolean, onChange: () => void) => (
        <SettingsToggle checked={checked} onChange={onChange} offClass={toggleOffBackgroundClass} onColor={theme?.secondaryColor} />
    );

    // Native blur can drop frames on some GPUs, so switching it on goes through a confirmation.
    const handleNativeBlurToggle = () => {
        if (enablePlayerPageNativeBlur) {
            onTogglePlayerPageNativeBlur(false);
            return;
        }
        setIsNativeBlurNoticeOpen(true);
    };

    const confirmNativeBlur = () => {
        onTogglePlayerPageNativeBlur(true);
        setIsNativeBlurNoticeOpen(false);
    };

    const handleFrameRateSliderChange = (value: string) => {
        const nextIndex = Math.min(VISUALIZER_FRAME_RATE_OPTIONS.length - 1, Math.max(0, Number(value)));
        onVisualizerFrameRateChange(VISUALIZER_FRAME_RATE_OPTIONS[nextIndex]);
    };

    return (
        <div className="space-y-5">
            <SettingsAnchor anchorId="graphicsPreset" label={t('options.graphicsPresetSection')} className="space-y-4">
                <SettingsSectionHeading icon={Gauge} label={t('options.graphicsPresetSection')} />
                <div className={`rounded-xl border p-4 space-y-4 ${settingsCardClass}`}>
                    <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.graphicsPresetDesc')}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {PRESET_ORDER.map(preset => {
                            const isActive = graphicsPreset === preset;
                            return (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => onSelectGraphicsPreset(preset)}
                                    aria-pressed={isActive}
                                    className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${isDaylight ? 'border-black/10 hover:bg-black/[0.05]' : 'border-white/10 hover:bg-white/[0.07]'} ${isActive ? (isDaylight ? 'bg-black/[0.08]' : 'bg-white/[0.12]') : 'opacity-55'}`}
                                >
                                    {t(presetLabelKey(preset))}
                                </button>
                            );
                        })}
                    </div>

                    {!isCustomPresetActive && (
                        <div className="space-y-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <div>{t('options.graphicsPresetSummaryFrameRate', { value: frameRateSummaryValue })}</div>
                            <div>
                                {t('options.graphicsPresetSummaryHomeBackground', {
                                    state: t(disableHomeDynamicBackground
                                        ? 'options.graphicsPresetSummaryStateDisabled'
                                        : 'options.graphicsPresetSummaryStateEnabled'),
                                })}
                            </div>
                            <div>{t('options.graphicsPresetSummaryMotion', { count: reducedMotionCount })}</div>
                        </div>
                    )}

                    {isDrifted && (
                        <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.graphicsPresetDriftNotice')}
                        </div>
                    )}
                </div>
            </SettingsAnchor>

            {isCustomPresetActive && (
                <SettingsAnchor anchorId="graphicsQualitySwitches" label={t('options.graphicsQualitySwitchesSection')} className="space-y-4">
                    <SettingsSectionHeading icon={MonitorCog} label={t('options.graphicsQualitySwitchesSection')} />
                    <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                        <SettingsRow
                            title={t('options.disableHomeDynamicBackground')}
                            description={t('options.disableHomeDynamicBackgroundDesc')}
                            note={t('options.disableHomeDynamicBackgroundWarning')}
                            control={renderToggle(disableHomeDynamicBackground, () => onToggleDisableHomeDynamicBackground(!disableHomeDynamicBackground))}
                            dividerClass={dividerClass}
                        />
                        <SettingsRow
                            title={t('options.visualizerFrameRate')}
                            description={t('options.visualizerFrameRateDesc')}
                            control={renderToggle(
                                isVisualizerFrameRateLimiterEnabled,
                                () => onVisualizerFrameRateChange(isVisualizerFrameRateLimiterEnabled ? 'off' : selectedVisualizerFrameRate),
                            )}
                            dividerClass={dividerClass}
                            isLast
                        >
                            <div className={`space-y-3 transition-opacity ${isVisualizerFrameRateLimiterEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
                                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    <span className="opacity-60">{t('options.visualizerFrameRateValue')}</span>
                                    <span className="font-mono opacity-70">{getFrameRateLabel(selectedVisualizerFrameRate)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max={VISUALIZER_FRAME_RATE_OPTIONS.length - 1}
                                    step="1"
                                    value={Math.max(0, selectedVisualizerFrameRateIndex)}
                                    onChange={(event) => handleFrameRateSliderChange(event.target.value)}
                                    className={rangeInputClass}
                                    aria-label={t('options.visualizerFrameRateValue')}
                                    disabled={!isVisualizerFrameRateLimiterEnabled}
                                />
                                <div className="grid grid-cols-3 text-[11px] font-mono opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {VISUALIZER_FRAME_RATE_OPTIONS.map((frameRate, index) => (
                                        <span key={frameRate} className={index === 1 ? 'text-center' : index === 2 ? 'text-right' : ''}>
                                            {frameRate}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </SettingsRow>
                    </div>
                </SettingsAnchor>
            )}

            {isCustomPresetActive && (
                <SettingsAnchor anchorId="graphicsMotion" label={t('options.reduceMotionSection')} className="space-y-4">
                    <SettingsSectionHeading icon={Gauge} label={t('options.reduceMotionSection')} />
                    <MotionReductionSettingsSection
                        settingsCardClass={settingsCardClass}
                        settingsDividerClass={dividerClass}
                        toggleOffBackgroundClass={toggleOffBackgroundClass}
                        theme={theme}
                    />
                </SettingsAnchor>
            )}

            <SettingsAnchor anchorId="graphicsPerformance" label={t('options.labPerformanceSection')} className="space-y-4">
                <SettingsSectionHeading icon={MonitorCog} label={t('options.labPerformanceSection')} />
                <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                    <SettingsRow
                        title={t('options.enableStaticMode')}
                        description={t('options.enableStaticModeDesc')}
                        note={t('options.enableStaticModeDescSub')}
                        control={renderToggle(staticMode, () => onToggleStaticMode(!staticMode))}
                        dividerClass={dividerClass}
                    />
                    {!isLinux && (
                        <SettingsRow
                            title={t('options.enablePlayerPageNativeBlur')}
                            description={t('options.enablePlayerPageNativeBlurDesc')}
                            control={renderToggle(enablePlayerPageNativeBlur, handleNativeBlurToggle)}
                            dividerClass={dividerClass}
                        />
                    )}
                    <SettingsRow
                        title={t('options.glowBlurQuantize')}
                        description={(
                            <>
                                {t('options.glowBlurQuantizeDesc')}{' '}
                                <a
                                    href={CHROMIUM_FD_EXHAUSTION_DOCS_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={openDocsLinkExternally}
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    {t('options.glowBlurQuantizeDocs')}
                                </a>
                            </>
                        )}
                        control={renderToggle(glowBlurQuantize, () => onToggleGlowBlurQuantize(!glowBlurQuantize))}
                        dividerClass={dividerClass}
                        isLast
                    />
                </div>
            </SettingsAnchor>

            <ThemedDialog
                isOpen={isNativeBlurNoticeOpen}
                onClose={() => setIsNativeBlurNoticeOpen(false)}
                isDaylight={isDaylight}
                title={t('options.nativeBlurConfirmTitle')}
                footer={(
                    <>
                        <button
                            type="button"
                            onClick={() => setIsNativeBlurNoticeOpen(false)}
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('localMusic.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={confirmNativeBlur}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: theme?.accentColor || '#3b82f6' }}
                        >
                            {t('options.nativeBlurConfirmAction')}
                        </button>
                    </>
                )}
            >
                <p className="text-sm leading-6 opacity-75" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.nativeBlurConfirmDesc')}
                </p>
            </ThemedDialog>
        </div>
    );
};

export default GraphicsSettingsSubview;
