import React from 'react';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/modal/SettingsHelpActions.tsx
// @fork 本地魔改版：「版本更新」入口（打开 ReleaseNotesDialog 的那张卡）已删除，帮助页只留「思索帮助页」。
// ReleaseNotesDialog 组件本身保留（首启新功能弹窗仍走 App.tsx），要恢复这张卡见 git 历史 mine-base 之前的本文件。

type SettingsHelpActionsProps = {
    onOpenPonder: () => void;
};

const SettingsHelpActions: React.FC<SettingsHelpActionsProps> = ({ onOpenPonder }) => {
    const { t } = useTranslation();

    return (
        <div className="grid grid-cols-1 gap-3">
            <button
                type="button"
                data-testid="help-page-ponder"
                onClick={onOpenPonder}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-primary)' }}
            >
                <Lightbulb size={19} className="shrink-0 opacity-75" aria-hidden="true" />
                <span>
                    <span className="block text-sm font-semibold">{t('help.ponder')}</span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.ponderDescription')}</span>
                </span>
            </button>
        </div>
    );
};

export default SettingsHelpActions;
