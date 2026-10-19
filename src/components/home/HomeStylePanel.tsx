import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Image as ImageIcon, LayoutGrid, LayoutList, PanelsTopLeft, Wand2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import { useHomeStylePanelStore, closeHomeStylePanel } from '../../stores/useHomeStylePanelStore';
import { useHomeLayoutSettingsStore } from '../../stores/useHomeLayoutSettingsStore';
import { useVideoLayerSettingsStore } from '../../stores/useVideoLayerSettingsStore';
import { useIsBravaisLibraryActive } from '../../library/app/bravaisLibraryActive';
import { settingsCardClassFor, settingsDividerClassFor } from '../modal/settings/settingsCardClasses';
import SettingsSectionHeading from '../modal/settings/navigation/SettingsSectionHeading';
import BravaisSettingsSection from '../modal/settings/BravaisSettingsSection';
import LatticeSettingsSection from '../modal/settings/LatticeSettingsSection';
import GridViewSettingsSection from '../modal/settings/GridViewSettingsSection';

// src/components/home/HomeStylePanel.tsx
// 主页样式的内联浮层：把散在设置「外观 / 通用」两处的主页外观开关聚到一处，站在墙上现场调、改动即时反映到底下的主页。
// 2026-10-19 拆分（用户：视觉设置一屏塞了八块，主页外观不该在设置里做表单）：这里现在是主页外观的唯一阵地，
// 卡片样式 / 拼贴墙外观 / 海报墙卡片 / 首页标签 / 记住位置 / Bravais 墙面全部在这一层现场调，设置侧栏只留一颗回主页的出口。
// 读写的是同一批 store——useHomeLayoutSettingsStore（卡片样式 / 顶部入口 / 记住位置）、useLatticeSettingsStore（拼贴墙）、
// useGridViewSettingsStore（海报墙卡片）、useVideoLayerSettingsStore（视频层开关）、Bravais 那一组直接复用设置里的
// <BravaisSettingsSection>（自带 suite 门控）。拼贴墙 / 海报墙两块直接搬设置里的分区组件，样式、文案、store 一行不改。
// 面板壳沿用设置子视图那一套（圆角、玻璃背板、返回箭头、可滚动正文），按 isDaylight 走亮 / 暗两副面孔。
// @fork 本地魔改版（2026-10-19）：去掉全屏压黑背板、面板改真玻璃（用户：不太好观察到主页样式）——
//   这个面板编辑的对象就是背后的墙（透光 / 信息条透明 / 墙后画面全是亮度与透明相关项），50% 黑背板一压
//   等于把效果预览图糊了三层灰；背板留透明只收「点外部关闭」，面板底色降透明度 + backdrop-blur，
//   靠 blur / 边框 / 投影与墙分离。

type HomeStylePanelProps = {
    isDaylight: boolean;
    theme?: Theme;
};

/** 一个开关行：与「Bravais 墙面」分组同款（整行标题在左、w-12 h-6 胶囊在右），行间用内缩的柔化细线。 */
const ToggleRow: React.FC<{
    label: string;
    description?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    isDaylight: boolean;
    /** 开着时的底色（主题第二色），与设置面板一致。 */
    onColor?: string;
    /** 顶部细分隔线（分组里第一行给 false）。 */
    divider?: boolean;
}> = ({ label, description, checked, onChange, isDaylight, onColor, divider = true }) => {
    const dividerColor = isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';
    return (
        <div
            className={`flex items-center justify-between gap-4${divider ? ' border-t pt-4' : ''}`}
            style={divider ? { borderColor: dividerColor } : undefined}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                {description && (
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>{description}</div>
                )}
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={() => onChange(!checked)}
                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0${!checked ? ` ${toggleOffBackgroundClass}` : ''}`}
                style={{ backgroundColor: checked ? (onColor || (isDaylight ? '#1D1D1F' : 'rgba(114,119,134,1)')) : undefined }}
            >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
        </div>
    );
};

/** 分段选择（卡片样式那种二选一 / 三选一）。 */
const Segmented: React.FC<{
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    isDaylight: boolean;
}> = ({ options, value, onChange, isDaylight }) => (
    <div role="radiogroup" className="flex gap-2">
        {options.map(opt => {
            const selected = opt.value === value;
            return (
                <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(opt.value)}
                    className="flex-1 text-xs font-semibold py-2.5 px-2 rounded-lg border transition-all"
                    style={selected
                        ? { borderColor: 'transparent', backgroundColor: isDaylight ? '#1D1D1F' : 'rgba(255,255,255,0.16)', color: isDaylight ? '#fff' : 'var(--text-primary)' }
                        : { borderColor: isDaylight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}
                >
                    {opt.label}
                </button>
            );
        })}
    </div>
);

const HomeStylePanel: React.FC<HomeStylePanelProps> = ({ isDaylight, theme }) => {
    const { t } = useTranslation();
    const isOpen = useHomeStylePanelStore(state => state.isOpen);

    // 打开时 Esc 收起浮层（与设置子视图、工具面板一致的阶梯）；preventDefault 让底下的墙不再重复处理这一次 Esc。
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeHomeStylePanel();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    const grid3dCardStyle = useHomeLayoutSettingsStore(state => state.grid3dCardStyle);
    const handleSetGrid3dCardStyle = useHomeLayoutSettingsStore(state => state.handleSetGrid3dCardStyle);
    const rememberHomeCardPosition = useHomeLayoutSettingsStore(state => state.rememberHomeCardPosition);
    const handleToggleRememberHomeCardPosition = useHomeLayoutSettingsStore(state => state.handleToggleRememberHomeCardPosition);
    const showHomeTabPlaylist = useHomeLayoutSettingsStore(state => state.showHomeTabPlaylist);
    const showHomeTabRadio = useHomeLayoutSettingsStore(state => state.showHomeTabRadio);
    const showHomeTabAlbums = useHomeLayoutSettingsStore(state => state.showHomeTabAlbums);
    const showHomeTabLocal = useHomeLayoutSettingsStore(state => state.showHomeTabLocal);
    const handleToggleHomeTabPlaylist = useHomeLayoutSettingsStore(state => state.handleToggleHomeTabPlaylist);
    const handleToggleHomeTabRadio = useHomeLayoutSettingsStore(state => state.handleToggleHomeTabRadio);
    const handleToggleHomeTabAlbums = useHomeLayoutSettingsStore(state => state.handleToggleHomeTabAlbums);
    const handleToggleHomeTabLocal = useHomeLayoutSettingsStore(state => state.handleToggleHomeTabLocal);

    const videoLayerEnabled = useVideoLayerSettingsStore(state => state.videoLayerEnabled);
    const setVideoLayerEnabled = useVideoLayerSettingsStore(state => state.setVideoLayerEnabled);

    const isBravaisActive = useIsBravaisLibraryActive();
    const settingsCardClass = settingsCardClassFor(isDaylight);
    const settingsDividerClass = settingsDividerClassFor(isDaylight);
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';
    const toggleOnColor = theme?.secondaryColor;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    // 透明背板：不再压黑整屏，只负责接住「点外部关闭」；墙的亮度就是切换开关时看到的真实亮度。
                    className="fixed inset-0 z-[150] flex justify-end p-3 sm:p-5"
                    onMouseDown={closeHomeStylePanel}
                    data-home-style-panel-scrim=""
                >
                    <motion.div
                        role="dialog"
                        aria-label={t('homeStyle.title')}
                        data-home-style-panel=""
                        initial={{ x: 40, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 40, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                        onMouseDown={event => event.stopPropagation()}
                        className="flex h-full w-[400px] max-w-full flex-col overflow-hidden rounded-[28px] border backdrop-blur-2xl"
                        style={{
                            borderColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
                            // 半透玻璃底：配合上面的 backdrop-blur-2xl，字仍可读，但墙能隐约透过来。
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.68)' : 'rgba(18,18,22,0.58)',
                            color: 'var(--text-primary)',
                            boxShadow: '0 24px 80px rgba(0,0,0,0.28)',
                        }}
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }}>
                            <div className="min-w-0">
                                <div className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{t('homeStyle.title')}</div>
                                <div className="text-[11px] opacity-55 mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('homeStyle.subtitle')}</div>
                            </div>
                            <button
                                type="button"
                                aria-label={t('homeStyle.close')}
                                title={t('homeStyle.close')}
                                onClick={closeHomeStylePanel}
                                className="h-9 w-9 rounded-full border flex items-center justify-center transition-colors"
                                style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-6">
                            <div data-home-style-anchor="grid3dCardStyle">
                                <SettingsSectionHeading icon={ImageIcon} label={t('homeStyle.cardGroup')} />
                                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                                    <div>
                                        <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{t('options.grid3dCardStyle')}</div>
                                        <Segmented
                                            isDaylight={isDaylight}
                                            value={grid3dCardStyle}
                                            onChange={v => handleSetGrid3dCardStyle(v as 'image' | 'card')}
                                            options={[
                                                { value: 'image', label: t('options.grid3dCardStyleImage') },
                                                { value: 'card', label: t('options.grid3dCardStyleCard') },
                                            ]}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div data-home-style-anchor="latticeSettings">
                                <SettingsSectionHeading icon={LayoutGrid} label={t('options.latticeSettings')} />
                                <LatticeSettingsSection
                                    settingsCardClass={settingsCardClass}
                                    toggleOffBackgroundClass={toggleOffBackgroundClass}
                                    isDaylight={isDaylight}
                                    theme={theme}
                                />
                            </div>

                            <div data-home-style-anchor="gridViewCardSettings">
                                <SettingsSectionHeading icon={PanelsTopLeft} label={t('options.gridViewCardSettings')} />
                                <GridViewSettingsSection
                                    settingsCardClass={settingsCardClass}
                                    settingsDividerClass={settingsDividerClass}
                                    toggleOffBackgroundClass={toggleOffBackgroundClass}
                                    theme={theme}
                                />
                            </div>

                            <div>
                                <SettingsSectionHeading icon={LayoutList} label={t('homeStyle.tabsGroup')} />
                                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                                    <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>{t('options.homeTabsVisibility')}</div>
                                    <ToggleRow isDaylight={isDaylight} onColor={toggleOnColor} divider={false} label={t('options.showHomeTabPlaylist')} checked={showHomeTabPlaylist} onChange={handleToggleHomeTabPlaylist} />
                                    <ToggleRow isDaylight={isDaylight} onColor={toggleOnColor} label={t('options.showHomeTabRadio')} checked={showHomeTabRadio} onChange={handleToggleHomeTabRadio} />
                                    <ToggleRow isDaylight={isDaylight} onColor={toggleOnColor} label={t('options.showHomeTabAlbums')} checked={showHomeTabAlbums} onChange={handleToggleHomeTabAlbums} />
                                    <ToggleRow isDaylight={isDaylight} onColor={toggleOnColor} label={t('options.showHomeTabLocal')} checked={showHomeTabLocal} onChange={handleToggleHomeTabLocal} />
                                    <ToggleRow isDaylight={isDaylight} onColor={toggleOnColor} label={t('options.rememberHomeCardPosition')} checked={rememberHomeCardPosition} onChange={handleToggleRememberHomeCardPosition} />
                                </div>
                            </div>

                            <div>
                                <SettingsSectionHeading icon={Wand2} label={t('homeStyle.miscGroup')} />
                                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                                    <ToggleRow
                                        isDaylight={isDaylight}
                                        onColor={toggleOnColor}
                                        divider={false}
                                        label={t('options.videoLayerSettings')}
                                        description={t('homeStyle.videoLayerHint')}
                                        checked={videoLayerEnabled}
                                        onChange={setVideoLayerEnabled}
                                    />
                                </div>
                            </div>

                            {isBravaisActive && (
                                <div data-home-style-anchor="bravaisSettings">
                                    <BravaisSettingsSection isDaylight={isDaylight} settingsCardClass={settingsCardClass} theme={theme} />
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default HomeStylePanel;
