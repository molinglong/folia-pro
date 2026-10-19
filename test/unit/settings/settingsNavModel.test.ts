import { describe, expect, it } from 'vitest';
import { SETTINGS_ANCHOR_DEFINITIONS } from '../../../src/components/modal/settings/navigation/settingsAnchorModel';
import { SETTINGS_NAV_GROUP_SPECS, buildSettingsNavGroups, findSettingsNavItem, flattenSettingsNavItems, type SettingsNavGroup, type SettingsSectionId } from '../../../src/components/modal/settings/navigation/settingsNavModel';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import id from '../../../src/i18n/locales/in';

// test/unit/settings/settingsNavModel.test.ts
// The nav model replaced four parallel id-keyed lists in SettingsModal; these lock in that every
// section still appears exactly once and that every key it points at actually exists in all locales.

const echo = (key: string) => key;

const ALL_SECTIONS: SettingsSectionId[] = [
    'overview', 'appearance', 'theme', 'general', 'playback', 'listeningStats', 'interaction', 'integration', 'storage', 'desktop', 'graphics', 'mods', 'lab', 'developer',
];

/** Sidebar rows that are real pages; the home-style command entry is not one and keys off `.command`. */
const sectionIdsOf = (groups: SettingsNavGroup[]): SettingsSectionId[] => (
    flattenSettingsNavItems(groups).filter(item => !item.command).map(item => item.id as SettingsSectionId)
);

const lookup = (bundle: Record<string, unknown>, key: string): unknown => (
    key.split('.').reduce<unknown>((node, part) => (
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), bundle)
);

describe('settingsNavModel', () => {
    it('lists every section exactly once on desktop', () => {
        const ids = sectionIdsOf(buildSettingsNavGroups(echo, { isElectron: true }));
        expect([...ids].sort()).toEqual([...ALL_SECTIONS].sort());
    });

    it('drops desktop-only sections on web without leaving an empty group', () => {
        const groups = buildSettingsNavGroups(echo, { isElectron: false });
        const ids = sectionIdsOf(groups);

        expect(ids).not.toContain('desktop');
        expect(ids).not.toContain('mods');
        expect(ids).toHaveLength(ALL_SECTIONS.length - 2);
        expect(groups.every(group => group.items.length > 0)).toBe(true);
    });

    it('keeps the section order the flat sidebar list used', () => {
        const ids = sectionIdsOf(buildSettingsNavGroups(echo, { isElectron: true }));
        expect(ids).toEqual(ALL_SECTIONS);
    });

    it('resolves a nav item for every section id', () => {
        const groups = buildSettingsNavGroups(echo, { isElectron: true });
        for (const sectionId of ALL_SECTIONS) {
            expect(findSettingsNavItem(groups, sectionId)?.id).toBe(sectionId);
        }
    });

    it('expands every declared anchor under its owning section', () => {
        const items = flattenSettingsNavItems(buildSettingsNavGroups(echo, { isElectron: true, hasLibrarySuiteChoice: true, isCustomPresetActive: true }));
        const rendered = items.flatMap(item => item.anchors.map(anchor => [anchor.id, item.id]));
        const declared = Object.entries(SETTINGS_ANCHOR_DEFINITIONS).map(([id, definition]) => [id, definition.section]);

        expect(rendered).toEqual(declared);
    });

    it('lists the library suite anchor only when there is a suite to choose (its section renders nothing otherwise)', () => {
        const anchorsOf = (hasLibrarySuiteChoice: boolean) => findSettingsNavItem(
            buildSettingsNavGroups(echo, { isElectron: false, hasLibrarySuiteChoice }),
            'general',
        )?.anchors.map(anchor => anchor.id);

        expect(anchorsOf(true)).toContain('librarySuite');
        expect(anchorsOf(false)).not.toContain('librarySuite');
        expect(anchorsOf(false)).toContain('playbackEntryView');
    });

    it('exposes the home-style sidebar entry as a command, not a page', () => {
        // 主页样式不再是设置里的一个分区表单，而是一颗离开对话框、回主页拉开现场调浮层的 command。
        const items = flattenSettingsNavItems(buildSettingsNavGroups(echo, { isElectron: true }));
        const homeStyle = items.find(item => item.command === 'homeStyle');

        expect(homeStyle?.id).toBe('homeStyle');
        expect(homeStyle?.anchors, 'command 入口没有页面可指，不该带任何锚点').toEqual([]);
        expect(sectionIdsOf(buildSettingsNavGroups(echo, { isElectron: true }))).not.toContain('homeStyle');
    });

    it('lists the detailed graphics anchors only while the quality tier is set to custom (they collapse otherwise)', () => {
        const anchorsOf = (isCustomPresetActive: boolean) => findSettingsNavItem(
            buildSettingsNavGroups(echo, { isElectron: true, isCustomPresetActive }),
            'graphics',
        )?.anchors.map(anchor => anchor.id);

        // 档位选择器和常驻的静态模式/原生模糊/光晕量化不受这个标记管；只有被档位接管的两栏跟着走。
        expect(anchorsOf(false)).toEqual(['graphicsPreset', 'graphicsPerformance']);
        expect(anchorsOf(true)).toEqual(['graphicsPreset', 'graphicsQualitySwitches', 'graphicsMotion', 'graphicsPerformance']);
    });

    it.each([['en', en], ['zh-CN', zhCN], ['in', id]] as const)('has every label and description key in %s', (_name, bundle) => {
        const keys = SETTINGS_NAV_GROUP_SPECS.flatMap(group => [
            group.labelKey,
            ...group.sections.flatMap(section => [section.labelKey, section.descriptionKey]),
        ]);
        keys.push(...Object.values(SETTINGS_ANCHOR_DEFINITIONS).map(definition => definition.labelKey));

        for (const key of keys) {
            expect(typeof lookup(bundle as unknown as Record<string, unknown>, key), `${key} missing`).toBe('string');
        }
    });
});
