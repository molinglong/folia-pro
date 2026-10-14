import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme, ThemeMode } from '../../../types';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';

// src/components/panelTab/controls/ThemeSourceRow.tsx
// 主题来源选择（默认 / 歌曲主题），和歌词样式、背景同属外观区。
// 歌曲主题格承载封面取色与 AI 推断两条生成路径的存档。

interface ThemeSourceRowProps {
    themeSourceModel: ThemeSourceModel;
    onBgModeChange: (mode: ThemeMode) => void;
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}

const ThemeSourceRow: React.FC<ThemeSourceRowProps> = ({
    themeSourceModel,
    onBgModeChange,
    defaultTheme,
    daylightTheme,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm hover:bg-white/90' : 'bg-white/20 shadow-sm hover:bg-white/30';
    const aiThemeSource = themeSourceModel.options.ai;

    const sources: {
        mode: ThemeMode;
        label: string;
        swatch: string;
        available: boolean;
        bordered: boolean;
        // Shown when the slot only holds the hard-coded placeholder: the swatch must read empty.
        isEmpty?: boolean;
    }[] = [
        {
            mode: 'default',
            label: t('ui.default'),
            swatch: isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor,
            available: true,
            bordered: false,
        },
        {
            mode: 'ai',
            label: t('ui.songTheme'),
            swatch: aiThemeSource.theme?.backgroundColor ?? 'rgba(114,119,134,0.4)',
            available: aiThemeSource.available,
            bordered: true,
            isEmpty: !themeSourceModel.hasSavedAiTheme,
        },
    ];

    return (
        <div className={`flex ${wellBg} p-1 rounded-xl`}>
            {sources.map(source => {
                const isActive = themeSourceModel.activeSource === source.mode;

                return (
                    <button
                        key={source.mode}
                        onClick={() => source.available && onBgModeChange(source.mode)}
                        disabled={!source.available}
                        title={source.isEmpty ? t('ui.aiThemeNotGenerated') : source.label}
                        className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${
                            isActive
                                ? activeOptionBg
                                : source.available
                                    ? 'opacity-40 hover:opacity-100'
                                    : 'opacity-25 cursor-not-allowed'
                        }`}
                    >
                        <div
                            className={`w-3 h-3 rounded-full ${source.bordered ? 'border border-white/20' : ''} ${source.available && !source.isEmpty ? '' : 'border-dashed'}`}
                            style={{ backgroundColor: source.available && !source.isEmpty ? source.swatch : 'transparent' }}
                        />
                        {source.label}
                    </button>
                );
            })}
        </div>
    );
};

export default ThemeSourceRow;
