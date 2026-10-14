import React from 'react';
import { ChevronLeft, Palette, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/modal/theme-park/ThemeParkHeader.tsx
// Theme Park title bar: the session hint, the session reset, and the save action.

type ThemeParkHeaderProps = {
    targetHint: string;
    isDaylight: boolean;
    canSave: boolean;
    onReset: () => void;
    onSave: () => void;
    onClose: () => void;
};

const ThemeParkHeader: React.FC<ThemeParkHeaderProps> = ({
    targetHint,
    isDaylight,
    canSave,
    onReset,
    onSave,
    onClose,
}) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={18} />
                </button>
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                        Theme Park
                    </div>
                    <div className="mt-1 truncate text-xs opacity-55" style={{ color: 'var(--text-secondary)' }}>
                        {targetHint}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                    type="button"
                    onClick={onReset}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm leading-none whitespace-nowrap transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <RotateCcw size={14} />
                    <span>{t('ui.resetToDefaultTheme')}</span>
                </button>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!canSave}
                    title={canSave ? undefined : t('theme.themeNameRequired')}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm leading-none whitespace-nowrap transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <Palette size={14} />
                    <span>{t('options.aiThemeQuickEditSave')}</span>
                </button>
            </div>
        </div>
    );
};

export default ThemeParkHeader;
