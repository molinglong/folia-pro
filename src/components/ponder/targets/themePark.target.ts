import { THEME_PARK_GEOMETRY as G } from '../surfaces/ponderSurfaceGeometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../types/ponder';

// src/components/ponder/targets/themePark.target.ts
// Theme Park：配色主题那一组标题行右端那颗圆按钮打开的整屏配色编辑器。
//
// 它此前只在 theme-settings 里当一个一闪而过的结果层出现过，而它本身是一整屏、
// 四页标签、两套明暗配色的编辑器，藏着两件说不清就走不通的事：
//
// - 亮和暗是两份独立配色，右栏那对切的是「现在编辑哪一面」，不是预览开关；
// - 保存会因为名字没填而灰着 —— 而名字的输入框在「信息」那一页，不在你正看着的
//   「颜色」这一页上。按不动的原因在另一页，这是最典型的「屏幕上没写」。

const headerPart = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'header', rect, role: 'region', labelKey }
);

const panelPart = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'editorPanel', rect, role: 'region', labelKey }
);

const anchors = {
    panel: settingsPanel('theme-park', 'ponder.anchors.themePark.panel', { top: 0.5, width: 0.92, height: 0.9 }),
    header: settingsRegion(G.header, 'ponder.anchors.themePark.header'),
    reset: headerPart(G.reset, 'ponder.anchors.themePark.reset'),
    save: headerPart(G.save, 'ponder.anchors.themePark.save'),
    preview: settingsRegion(G.preview, 'ponder.anchors.themePark.preview'),
    editorPanel: settingsRegion(G.panel, 'ponder.anchors.themePark.editorPanel'),
    tabs: panelPart(G.tabs, 'ponder.anchors.themePark.tabs'),
    tabDetails: panelPart(G.tabDetails, 'ponder.anchors.themePark.tabDetails'),
    modeToggle: panelPart(G.modeToggle, 'ponder.anchors.themePark.modeToggle'),
    colorRows: panelPart(G.colorRows, 'ponder.anchors.themePark.colorRows'),
    picker: panelPart(G.picker, 'ponder.anchors.themePark.picker'),
    hex: panelPart(G.hex, 'ponder.anchors.themePark.hex'),
    recommended: panelPart(G.recommended, 'ponder.anchors.themePark.recommended'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：亮和暗是两份配色，以及改颜色的那几样工具。 */
const colors: PonderSceneScript = {
    id: 'theme-park-colors',
    titleKey: 'ponder.scenes.themeParkColors',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markMode', anchor: 'modeToggle', intensity: [0, 0.95], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'twoSides', at: 'bottom',
            textKey: 'ponder.captions.themePark.twoSides',
            pointTo: { anchor: 'modeToggle' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readTwoSides' },

        { kind: 'highlight', id: 'dimMode', anchor: 'modeToggle', intensity: [0.95, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markRows', anchor: 'colorRows', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'fourColors', at: 'bottom',
            textKey: 'ponder.captions.themePark.fourColors',
            pointTo: { anchor: 'colorRows' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readFourColors' },

        { kind: 'highlight', id: 'dimRows', anchor: 'colorRows', intensity: [0.85, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markRecommended', anchor: 'recommended', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'recommended', at: 'bottom',
            textKey: 'ponder.captions.themePark.recommended',
            pointTo: { anchor: 'recommended' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readRecommended' },
    ],
};

/** 第二章：保存为什么按不动 —— 原因在另一页上。 */
const saving: PonderSceneScript = {
    id: 'theme-park-saving',
    titleKey: 'ponder.scenes.themeParkSaving',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'greyOut', anchor: 'panel', state: 'save-blocked', durationMs: 480, keyframe: true },
        {
            kind: 'caption', id: 'blocked', at: 'bottom',
            textKey: 'ponder.captions.themePark.blocked',
            pointTo: { anchor: 'save' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readBlocked' },

        { kind: 'cursor', id: 'goDetails', to: { anchor: 'tabDetails' }, press: 'tap', durationMs: 700, keyframe: true },
        {
            kind: 'caption', id: 'nameLivesHere', at: 'bottom',
            textKey: 'ponder.captions.themePark.nameLivesHere',
            pointTo: { anchor: 'tabDetails' }, durationMs: 7400, withPrevious: true,
        },
        { kind: 'pause', id: 'readNameLivesHere' },

        {
            kind: 'caption', id: 'applies', at: 'bottom',
            textKey: 'ponder.captions.themePark.applies',
            pointTo: { anchor: 'save' }, durationMs: 6600, keyframe: true,
        },
        { kind: 'pause', id: 'readApplies' },
    ],
};

export default {
    id: 'theme-park',
    titleKey: 'ponder.targets.themePark',
    category: 'appearance',
    summaryKey: 'ponder.summaries.theme_park',
    hoverSelector: '[data-ponder="theme-park"]',
    relatedTargetIds: ['theme-settings', 'vis-playground', 'import-export-settings'],
    scenes: [colors, saving],
} satisfies PonderTargetDefinition;
