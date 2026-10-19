import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../../types';
import type { SettingsAnchorId } from './settingsAnchorModel';
import type { SettingsNavCommandId, SettingsNavGroup, SettingsSectionId } from './settingsNavModel';
import { searchSettingsNav } from './settingsNavSearch';
// src/components/modal/settings/navigation/SettingsSidebarWide.tsx
// Wide-layout settings navigation: a flat list of grouped sections under a search box that
// narrows the list. The anchor table of contents used to hang under the active section; it was
// removed on purpose, so the sidebar is sections only. The narrow chip strip has no search either.
// One row is not a page: `homeStyle` hands the user back to the wall and opens the live panel there.

type SettingsSidebarWideProps = {
    groups: SettingsNavGroup[];
    activeSectionId: SettingsSectionId;
    onSelectSection: (sectionId: SettingsSectionId) => void;
    /** The command rows (主页样式) leave the dialog instead of switching page. */
    onSelectCommand: (command: SettingsNavCommandId) => void;
    activeAnchorId: string | null;
    onSelectAnchor: (sectionId: SettingsSectionId, anchorId: SettingsAnchorId) => void;
    isDaylight: boolean;
    theme?: Theme;
};

export const SettingsSidebarWide: React.FC<SettingsSidebarWideProps> = ({
    groups,
    activeSectionId,
    onSelectSection,
    onSelectCommand,
    activeAnchorId,
    onSelectAnchor,
    isDaylight,
    theme,
}) => {
    const { t, i18n } = useTranslation();
    const [query, setQuery] = useState('');
    const search = useMemo(
        () => searchSettingsNav(groups, query, i18n.language),
        [groups, query, i18n.language],
    );
    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && search.firstHit) {
            event.preventDefault();
            const { sectionId, anchorId, command } = search.firstHit;
            if (command) {
                onSelectCommand(command);
            } else if (anchorId) {
                onSelectAnchor(sectionId as SettingsSectionId, anchorId);
            } else {
                onSelectSection(sectionId as SettingsSectionId);
            }
            return;
        }
        // The first Escape clears the query; only an empty box lets it through to close the dialog.
        if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
        }
    };

    return (
        <div className="w-1/3 max-w-[264px] shrink-0 overflow-y-auto custom-scrollbar pr-3 flex flex-col gap-5 border-r border-white/10 pb-4 items-stretch">
            <div className="sticky top-0 z-10 -mb-2 pb-2">
                <label
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur-md transition-colors ${
                        isDaylight
                            ? 'border-black/10 bg-white/70 focus-within:border-black/25'
                            : 'border-white/10 bg-zinc-900/70 focus-within:border-white/25'
                    }`}
                >
                    <Search size={14} className="shrink-0 opacity-50" style={{ color: 'var(--text-secondary)' }} />
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={t('options.settingsSearchPlaceholder')}
                        aria-label={t('options.settingsSearchPlaceholder')}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-50 [&::-webkit-search-cancel-button]:hidden"
                        style={{ color: 'var(--text-primary)' }}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            aria-label={t('options.settingsSearchClear')}
                            className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <X size={14} />
                        </button>
                    )}
                </label>
            </div>
            {search.groups.length === 0 && (
                <div className="px-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.settingsSearchEmpty')}
                </div>
            )}
            {search.groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-1">
                    <div
                        className="px-1 pb-1 text-xs font-bold uppercase tracking-widest opacity-50"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {group.label}
                    </div>
                    {group.items.map((section) => {
                        const Icon = section.icon;
                        const isActive = !section.command && activeSectionId === section.id;
                        return (
                            <div key={section.id}>
                                <button
                                    type="button"
                                    onClick={() => (section.command ? onSelectCommand(section.command) : onSelectSection(section.id as SettingsSectionId))}
                                    // Active state was carried by the highlight alone; say it out loud now.
                                    aria-current={isActive ? 'true' : undefined}
                                    className={`w-full p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 text-left ${isActive ? (isDaylight ? 'border-zinc-300/70 bg-white/80' : 'border-white/20 bg-white/10') : (isDaylight ? 'border-transparent hover:bg-white/50' : 'border-transparent hover:bg-white/5')}`}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="shrink-0 opacity-70" style={{ color: 'var(--text-primary)' }}>
                                            <Icon size={18} />
                                        </div>
                                        <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {section.label}
                                        </div>
                                    </div>
                                </button>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
};

export default SettingsSidebarWide;
