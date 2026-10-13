import React from 'react';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { selectPonderSettingsSnapshot, usePonderStore } from '../../../stores/usePonderStore';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';

// src/components/modal/settings/PonderTouchButtonSettingsSection.tsx
//
// @fork 本地魔改版（用户：「把这个删了」→「彻底删掉胶囊 + 摘掉设置项」）：
// 上游这里叫 PonderHintSettingsSection.tsx，一个锚点里装着两样东西：悬停提示的三档可见性，
// 和触屏灯泡的开关。删胶囊那一刀如果整文件删掉，会顺手把触屏开关也删了 —— 而触屏那套
// 明确不在这次范围内（用户选的选项写的是「思索功能本身全留：教程、导航页、命令面板、触屏灯泡」）。
// 所以把文件拆小：三档可见性那半随胶囊一起消失，这半原样搬过来，锚点、卡片样式、
// aria 属性一律照旧。锚点 id 换成 ponderTouchButton，因为 settingsAnchorCoverage 拿这张表
// 和真实渲染的锚点双向核对，沿用旧 id 就是留一个不存在的目的地。
//
// 文件名不叫 PonderHintSettingsSection 是刻意的：还原上游时按名字找，找到的应当是那个
// 装着两样东西的旧文件，而不是这个只剩一样的小文件。

type PonderTouchButtonSettingsSectionProps = {
    settingsCardClass: string;
    isDaylight: boolean;
    accentColor?: string;
};

const PonderTouchButtonSettingsSection: React.FC<PonderTouchButtonSettingsSectionProps> = ({
    settingsCardClass,
    isDaylight,
    accentColor,
}) => {
    const { t } = useTranslation();
    const { showPonderTouchButton, setShowPonderTouchButton } = usePonderStore(
        useShallow(selectPonderSettingsSnapshot),
    );

    return (
        <SettingsAnchor anchorId="ponderTouchButton" label={t('options.ponderTouchButton')} className="space-y-4">
            <SettingsSectionHeading icon={Lightbulb} label={t('options.ponderTouchButton')} />

            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            <Lightbulb size={14} />
                            {t('options.ponderTouchButton')}
                        </div>
                        <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.ponderTouchButtonDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowPonderTouchButton(!showPonderTouchButton)}
                        aria-pressed={showPonderTouchButton}
                        aria-label={t('options.ponderTouchButton')}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${
                            showPonderTouchButton ? '' : (isDaylight ? 'bg-black/10' : 'bg-white/10')
                        }`}
                        style={showPonderTouchButton
                            ? { backgroundColor: accentColor || (isDaylight ? '#27272a' : '#fafafa') }
                            : undefined}
                    >
                        <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${showPonderTouchButton ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        </SettingsAnchor>
    );
};

export default PonderTouchButtonSettingsSection;
