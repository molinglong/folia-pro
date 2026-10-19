import React from 'react';
import { Languages, Move } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../../../types';
import type { AppLanguagePreference } from '../../../i18n/config';
import { CustomSelect } from '../../shared/CustomSelect';
import PinnedCommandSettings from './PinnedCommandSettings';
import PonderTouchButtonSettingsSection from './PonderTouchButtonSettingsSection';
import PlaybackEntryViewSection from './PlaybackEntryViewSection';
import LibrarySuiteSection from './LibrarySuiteSection';
import PlayerBottomBarSection from './PlayerBottomBarSection';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';

// src/components/modal/settings/GeneralSettingsSubview.tsx
// Global app preferences that should stay independent from playback and desktop-only settings.
// 2026-10-19 拆分（用户：主页外观不该在设置里做表单）：首页标签开关 / 记住卡片位置 / Bravais 墙面
// 三块整组搬进主页样式浮层（HomeStylePanel，站在墙上现场调），这里不再重复渲染。

type GeneralSettingsSubviewProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
    utilityGhostButtonClass: string;
};

const GeneralSettingsSubview: React.FC<GeneralSettingsSubviewProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
    utilityGhostButtonClass,
}) => {
    const { t, i18n } = useTranslation();
    const {
        appLanguagePreference,
        onAppLanguagePreferenceChange,
    } = useSettingsModalStore(useShallow(state => ({
        appLanguagePreference: state.appLanguagePreference,
        onAppLanguagePreferenceChange: state.handleSetAppLanguagePreference,
    })));
    const getResolvedLanguageLabel = (): string => {
        const lang = i18n.resolvedLanguage;
        if (lang?.startsWith('zh')) {
            return t('options.appLanguageZhCN');
        }
        if (lang === 'in' || lang?.startsWith('id')) {
            return t('options.appLanguageInID') || 'Bahasa Indonesia';
        }
        return t('options.appLanguageEnUS') || 'English';
    };

    const currentResolvedLanguage = getResolvedLanguageLabel();

    const languageOptions: Array<{ value: AppLanguagePreference; label: string; }> = [
        { value: 'system', label: t('options.appLanguageSystem') },
        { value: 'zh-CN', label: t('options.appLanguageZhCN') },
        { value: 'en', label: t('options.appLanguageEnUS') || 'English' },
        { value: 'in', label: t('options.appLanguageInID') || 'Bahasa Indonesia' },
    ];

    const languageHint = appLanguagePreference === 'system'
        ? (t('options.appLanguageSystemHint')).replace('{{language}}', currentResolvedLanguage)
        : null;

    const rangeInputClass = [
        'w-full accent-current',
        isDaylight ? 'text-zinc-900' : 'text-white',
    ].join(' ');

    return (
        <div className="space-y-5">
            <SettingsAnchor anchorId="languageSettings" label={t('options.languageSettings')}>
                <SettingsSectionHeading icon={Languages} label={t('options.languageSettings')} />
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.appLanguage')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.appLanguageDesc')}
                        </div>
                    </div>
                    <CustomSelect
                        value={appLanguagePreference}
                        onChange={(value) => {
                            void onAppLanguagePreferenceChange(value as AppLanguagePreference);
                        }}
                        options={languageOptions}
                        isDaylight={isDaylight}
                        theme={theme}
                    />
                    {languageHint && (
                        <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {languageHint}
                        </div>
                    )}
                </div>
            </SettingsAnchor>

            <PlaybackEntryViewSection
                isDaylight={isDaylight}
                settingsCardClass={settingsCardClass}
                theme={theme}
            />

            <LibrarySuiteSection
                isDaylight={isDaylight}
                settingsCardClass={settingsCardClass}
                theme={theme}
            />

            <SettingsAnchor anchorId="bottomUiSettings" label={t('options.bottomUiSettings')} className="space-y-4">
                <SettingsSectionHeading icon={Move} label={t('options.bottomUiSettings')} />
                <PlayerBottomBarSection
                    settingsCardClass={settingsCardClass}
                    utilityGhostButtonClass={utilityGhostButtonClass}
                    rangeInputClass={rangeInputClass}
                    isDaylight={isDaylight}
                    theme={theme}
                />
            </SettingsAnchor>

            <PinnedCommandSettings
                isDaylight={isDaylight}
                settingsCardClass={settingsCardClass}
                theme={theme}
            />

            {/* @fork 本地魔改版（用户：「把这个删了」→ 选定「彻底删掉胶囊 + 摘掉设置项」）：
                原 PonderHintSettingsSection 里那组三档「思索教程提示」整块摘掉 —— 跟随光标的胶囊
                不再渲染，这档设置就没有任何行为可以作用，留着是一处死配置。
                同一个上游文件里还装着触屏灯泡的开关，它不在删除范围内，所以那一半搬到
                PonderTouchButtonSettingsSection 继续挂在这里（原位、原样式、原锚点位置）。 */}
            <PonderTouchButtonSettingsSection
                settingsCardClass={settingsCardClass}
                isDaylight={isDaylight}
                accentColor={theme?.accentColor}
            />
        </div>
    );
};

export default GeneralSettingsSubview;
