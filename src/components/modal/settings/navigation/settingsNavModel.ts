import { Boxes, Command, Database, FlaskConical, Gauge, Home, Keyboard, Languages, LayoutDashboard, Palette, PlayCircle, Server, Sparkles, Terminal, Activity, type LucideIcon } from 'lucide-react';
import { SETTINGS_ANCHOR_DEFINITIONS, type SettingsAnchorId } from './settingsAnchorModel';
// src/components/modal/settings/navigation/settingsNavModel.ts
// Single source of truth for the options-tab sections: sidebar order, grouping, titles and descriptions.

export type SettingsSectionId =
    | 'overview'
    | 'appearance'
    | 'theme'
    | 'general'
    | 'playback'
    | 'listeningStats'
    | 'interaction'
    | 'integration'
    | 'storage'
    | 'desktop'
    | 'graphics'
    | 'mods'
    | 'lab'
    | 'developer';

/**
 * Sidebar entries that are not a page: they leave the dialog and open something elsewhere.
 * `homeStyle` is the live workbench for the home wall (src/components/home/HomeStylePanel.tsx) —
 * the wall is the thing being edited, so the panel paints over it instead of a page of switches.
 */
export type SettingsNavCommandId = 'homeStyle';

/** A sidebar row is either a section page or one of those exits. */
export type SettingsNavItemId = SettingsSectionId | SettingsNavCommandId;

export interface SettingsNavItem {
    id: SettingsNavItemId;
    icon: LucideIcon;
    label: string;
    description: string;
    /** Set on the entries that run something instead of showing a page; `id` is then a command id. */
    command?: SettingsNavCommandId;
    anchors: SettingsNavAnchor[];
}

/** A sidebar row that points at a real options-tab page (i.e. not a command exit). */
export type SettingsNavSectionItem = SettingsNavItem & { id: SettingsSectionId; command?: undefined };

export interface SettingsNavAnchor {
    id: SettingsAnchorId;
    label: string;
}

export interface SettingsNavGroup {
    id: string;
    label: string;
    items: SettingsNavItem[];
}

type Translate = (key: string) => string;

interface SectionSpec {
    id: SettingsSectionId;
    icon: LucideIcon;
    labelKey: string;
    descriptionKey: string;
    /** Sections that only exist on the desktop build. */
    electronOnly?: boolean;
}

interface CommandSpec {
    id: SettingsNavCommandId;
    /** Present on command entries only; the guard below keys off it instead of off `id`. */
    command: SettingsNavCommandId;
    icon: LucideIcon;
    labelKey: string;
    descriptionKey: string;
}

type NavEntrySpec = SectionSpec | CommandSpec;

/** True for the sidebar rows that run a command instead of opening a page. */
export const isSettingsNavCommandSpec = (entry: NavEntrySpec): entry is CommandSpec => 'command' in entry;

/** The other half: a row that is a real options-tab page (and therefore carries `electronOnly`). */
export const isSettingsNavSectionSpec = (entry: NavEntrySpec): entry is SectionSpec => !isSettingsNavCommandSpec(entry);

interface GroupSpec {
    id: string;
    labelKey: string;
    sections: NavEntrySpec[];
}

/**
 * Sidebar grouping. Section order matches the flat list this replaced, so the desktop grouping is
 * purely additive and the narrow chip strip keeps its existing sequence.
 */
export const SETTINGS_NAV_GROUP_SPECS: GroupSpec[] = [
    {
        id: 'appearance',
        labelKey: 'options.settingsGroupAppearance',
        sections: [
            // 2026-10-19：顶层总览。打开设置且没有上次记录时落在这里——一屏看见账户、听歌与各分区
            // 当前状态，卡片只读、点击跳到对应分区。它不承载任何设置项，所以没有锚点。
            { id: 'overview', icon: LayoutDashboard, labelKey: 'options.overviewSettings', descriptionKey: 'options.overviewSettingsDesc' },
            // 2026-10-19 拆分（用户：视觉设置一屏塞了八块）：这一组原来是一个 8 个分区的巨型「视觉设置」，
            // 现在按「播放页的样子 / 配色 / 界面与入口」切开，主页外观不再在设置里做表单——它整组搬进
            // 主页样式浮层（HomeStylePanel），侧栏这里只留一颗回主页的出口（homeStyle）。
            { id: 'appearance', icon: Sparkles, labelKey: 'options.playerLookSettings', descriptionKey: 'options.playerLookSettingsDesc' },
            { id: 'theme', icon: Palette, labelKey: 'options.themeGroupSettings', descriptionKey: 'options.themeGroupSettingsDesc' },
            { id: 'general', icon: Languages, labelKey: 'options.generalSettings', descriptionKey: 'options.generalSettingsDesc' },
            { id: 'homeStyle', command: 'homeStyle', icon: Home, labelKey: 'options.homeStyleSettings', descriptionKey: 'options.homeStyleSettingsDesc' },
        ],
    },
    {
        // Named for what the group is about rather than for its first section: it now holds how the
        // listener drives the app as well as how the app plays.
        id: 'controls',
        labelKey: 'options.settingsGroupControls',
        sections: [
            { id: 'playback', icon: PlayCircle, labelKey: 'options.playbackSettings', descriptionKey: 'options.playbackSettingsPanelDesc' },
            { id: 'listeningStats', icon: Activity, labelKey: 'options.listeningStatsSettings', descriptionKey: 'options.listeningStatsSettingsDesc' },
            { id: 'interaction', icon: Keyboard, labelKey: 'options.interactionSettings', descriptionKey: 'options.interactionSettingsPanelDesc' },
        ],
    },
    {
        id: 'connections',
        labelKey: 'options.settingsGroupConnections',
        sections: [
            { id: 'integration', icon: Server, labelKey: 'options.integrationSettings', descriptionKey: 'options.integrationSettingsDesc' },
            { id: 'storage', icon: Database, labelKey: 'options.storageSettings', descriptionKey: 'options.storageSettingsPanelDesc' },
        ],
    },
    {
        id: 'system',
        labelKey: 'options.settingsGroupSystem',
        sections: [
            { id: 'desktop', icon: Command, labelKey: 'options.desktopSettings', descriptionKey: 'options.desktopSettingsPanelDesc', electronOnly: true },
            { id: 'graphics', icon: Gauge, labelKey: 'options.graphicsSettings', descriptionKey: 'options.graphicsSettingsDesc' },
            // The loader only exists in the desktop main process; on web there is nothing to switch on.
            { id: 'mods', icon: Boxes, labelKey: 'options.modSettings', descriptionKey: 'options.modSettingsDesc', electronOnly: true },
            { id: 'lab', icon: FlaskConical, labelKey: 'options.labSettings', descriptionKey: 'options.labSettingsDesc' },
            { id: 'developer', icon: Terminal, labelKey: 'options.developerSettings', descriptionKey: 'options.developerSettingsDesc' },
        ],
    },
];

/**
 * Resolves the grouping into translated nav items, dropping desktop-only sections (and groups left empty) on web.
 * An anchor that marks itself `requiresLibrarySuiteChoice` is listed only when `hasLibrarySuiteChoice` is set,
 * because its section renders nothing while a single library suite is available. Likewise `requiresCustomPreset`
 * only while the graphics quality tier is set to custom (`isCustomPresetActive`) — the two detailed graphics
 * switches collapse out of the DOM whenever a preset tier is chosen instead.
 * Command entries carry no anchors: they have no page to point at.
 */
export const buildSettingsNavGroups = (
    t: Translate,
    options: { isElectron: boolean; hasLibrarySuiteChoice?: boolean; isCustomPresetActive?: boolean },
): SettingsNavGroup[] => (
    SETTINGS_NAV_GROUP_SPECS
        .map(group => ({
            id: group.id,
            label: t(group.labelKey),
            items: group.sections
                .filter(section => isSettingsNavCommandSpec(section) || !section.electronOnly || options.isElectron)
                .map(section => ({
                    id: section.id,
                    ...(isSettingsNavCommandSpec(section) ? { command: section.command } : {}),
                    icon: section.icon,
                    label: t(section.labelKey),
                    description: t(section.descriptionKey),
                    anchors: isSettingsNavCommandSpec(section) ? [] : (Object.entries(SETTINGS_ANCHOR_DEFINITIONS) as [SettingsAnchorId, typeof SETTINGS_ANCHOR_DEFINITIONS[SettingsAnchorId]][])
                        .filter(([, definition]) => (
                            definition.section === section.id
                            && (!('electronOnly' in definition) || !definition.electronOnly || options.isElectron)
                            && (!('requiresLibrarySuiteChoice' in definition) || !definition.requiresLibrarySuiteChoice || Boolean(options.hasLibrarySuiteChoice))
                            && (!('requiresCustomPreset' in definition) || !definition.requiresCustomPreset || Boolean(options.isCustomPresetActive))
                        ))
                        .map(([id, definition]) => ({ id, label: t(definition.labelKey) })),
                })),
        }))
        .filter(group => group.items.length > 0)
);

export const flattenSettingsNavItems = (groups: SettingsNavGroup[]): SettingsNavItem[] => (
    groups.flatMap(group => group.items)
);

export const findSettingsNavItem = (groups: SettingsNavGroup[], id: SettingsSectionId): SettingsNavItem | undefined => (
    flattenSettingsNavItems(groups).find(item => item.id === id)
);

/** The command entry with this id, if the sidebar shows one on this runtime. */
export const findSettingsNavCommandItem = (groups: SettingsNavGroup[], command: SettingsNavCommandId): SettingsNavItem | undefined => (
    flattenSettingsNavItems(groups).find(item => item.command === command)
);
