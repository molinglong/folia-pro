import type { SettingsSubviewId } from '../../../../stores/useSettingsModalStore';

// src/components/modal/settings/navigation/settingsAnchorModel.ts
// Which options-tab section each <SettingsAnchor> lives in and which translated label its expanded
// sidebar entry uses. Commands and inactive sidebar sections both need this information before the
// destination panel exists, so it is declared once here. settingsAnchorCoverage.test.ts holds the
// table against the anchors actually rendered, so a section cannot silently drift away from its
// navigation destination.

export const SETTINGS_ANCHOR_DEFINITIONS = {
    // AppearanceSettingsSubview
    lyricsRenderer: { section: 'appearance', labelKey: 'options.lyricsRenderer' },
    themePresets: { section: 'appearance', labelKey: 'options.themePresets' },
    stageTrackPill: { section: 'appearance', labelKey: 'options.stageTrackPill' },
    grid3dCardStyle: { section: 'appearance', labelKey: 'options.grid3dCardStyle' },
    latticeSettings: { section: 'appearance', labelKey: 'options.latticeSettings' },
    gridViewCardSettings: { section: 'appearance', labelKey: 'options.gridViewCardSettings' },
    videoLayerSettings: { section: 'appearance', labelKey: 'options.videoLayerSettings' },
    importExportTitle: { section: 'appearance', labelKey: 'options.importExportTitle' },

    // GeneralSettingsSubview (PinnedCommandSettings and PonderTouchButtonSettingsSection render inside it)
    languageSettings: { section: 'general', labelKey: 'options.languageSettings' },
    homeTabsVisibility: { section: 'general', labelKey: 'options.homeTabsVisibility' },
    rememberHomeCardPosition: { section: 'general', labelKey: 'options.rememberHomeCardPosition' },
    playbackEntryView: { section: 'general', labelKey: 'options.playbackEntryView' },
    // Rendered only when more than one library suite is available (hasLibrarySuiteChoice).
    librarySuite: { section: 'general', labelKey: 'options.librarySuite', requiresLibrarySuiteChoice: true },
    // bravais 独有的设置（透光、每块窗数、集合叠页边）：只在生效 suite 是 bravais 时渲染（isBravaisLibraryActive）。
    bravaisSettings: { section: 'general', labelKey: 'options.bravaisSettings', requiresBravaisSuite: true },
    bottomUiSettings: { section: 'general', labelKey: 'options.bottomUiSettings' },
    pinnedCommands: { section: 'general', labelKey: 'options.pinnedCommands' },
    // @fork 本地魔改版：原 ponderHints（思索教程提示三档）随胶囊一起摘掉。锚点 id 换成
    // ponderTouchButton —— 那一档设置没了，但同一个位置还剩触屏灯泡开关，它需要自己的目的地。
    // 留着旧 id 等于让侧栏链到一个不再渲染的锚点；删掉整行则会让触屏开关从目录里消失。
    ponderTouchButton: { section: 'general', labelKey: 'options.ponderTouchButton' },

    // PlaybackSettingsSubview (TransitionSettingsSection renders inside it)
    queueSettings: { section: 'playback', labelKey: 'options.queueSettings' },
    scrobbleSettings: { section: 'playback', labelKey: 'options.scrobbleSettings' },
    transitionSettings: { section: 'playback', labelKey: 'options.transitionSettings' },
    replayGainSettings: { section: 'playback', labelKey: 'options.replayGainSettings' },
    lyrics: { section: 'playback', labelKey: 'options.lyrics' },
    audioOutputSettings: { section: 'playback', labelKey: 'options.audioOutputSettings' },

    // InteractionSettingsSubview
    gridActionButton: { section: 'interaction', labelKey: 'options.gridActionButton' },
    gridPaletteHotkey: { section: 'interaction', labelKey: 'options.gridPaletteHotkey' },
    customShortcut: { section: 'interaction', labelKey: 'options.customShortcut' },

    // IntegrationSettingsSubview — stageMode is declared twice on purpose, the Electron and web
    // panels being mutually exclusive; it is still one destination.
    discordRichPresence: { section: 'integration', labelKey: 'options.discordRichPresence', electronOnly: true },
    obsBrowserSource: { section: 'integration', labelKey: 'options.obsBrowserSource', electronOnly: true },
    lyricApi: { section: 'integration', labelKey: 'options.lyricApi', electronOnly: true },
    stageMode: { section: 'integration', labelKey: 'options.stageMode' },
    navidrome: { section: 'integration', labelKey: 'navidrome.settings' },

    // StorageSettingsSection (LocalLibraryWatchSection renders inside it)
    cacheDetails: { section: 'storage', labelKey: 'options.cacheDetails' },
    r2Sync: { section: 'storage', labelKey: 'options.r2Sync' },
    localLibraryWatch: { section: 'storage', labelKey: 'options.localLibraryWatch' },
    mediaCache: { section: 'storage', labelKey: 'options.mediaCache' },

    // DesktopSettingsSubview
    desktopTrayBehavior: { section: 'desktop', labelKey: 'options.desktopTrayBehavior', electronOnly: true },
    wallpaperMode: { section: 'desktop', labelKey: 'options.wallpaperMode', electronOnly: true },
    updateCheck: { section: 'desktop', labelKey: 'options.updateCheck', electronOnly: true },
    electronSettings: { section: 'desktop', labelKey: 'options.electronSettings', electronOnly: true },

    // GraphicsSettingsSubview
    // 档位选择器常驻；它选中非「自定义」时，下面两个被档位接管的细粒度栏位（画质开关、减少动效）会折叠
    // 隐藏，侧栏目录跟着收起，不然会链到一个不存在的目的地（同 requiresBravaisSuite 的处理路子）。
    // graphicsPerformance（静态模式/原生模糊/光晕量化）不受档位管，任何时候都常驻。
    graphicsPreset: { section: 'graphics', labelKey: 'options.graphicsPresetSection' },
    graphicsQualitySwitches: { section: 'graphics', labelKey: 'options.graphicsQualitySwitchesSection', requiresCustomPreset: true },
    graphicsMotion: { section: 'graphics', labelKey: 'options.reduceMotionSection', requiresCustomPreset: true },
    graphicsPerformance: { section: 'graphics', labelKey: 'options.labPerformanceSection' },

    // ModsSettingsSubview
    modSystem: { section: 'mods', labelKey: 'options.enableModSystem', electronOnly: true },
    modList: { section: 'mods', labelKey: 'mods.title', electronOnly: true },

    // LabSettingsModal
    labPlayerUi: { section: 'lab', labelKey: 'options.labPlayerUiSection' },
    labWindowAndTools: { section: 'lab', labelKey: 'options.labWindowAndToolsSection' },
} as const satisfies Record<string, { section: SettingsSubviewId; labelKey: string; electronOnly?: boolean; requiresLibrarySuiteChoice?: boolean; requiresBravaisSuite?: boolean; requiresCustomPreset?: boolean }>;

export type SettingsAnchorId = keyof typeof SETTINGS_ANCHOR_DEFINITIONS;

export const SETTINGS_ANCHOR_SECTION = Object.fromEntries(
    Object.entries(SETTINGS_ANCHOR_DEFINITIONS).map(([id, definition]) => [id, definition.section]),
) as Record<SettingsAnchorId, SettingsSubviewId>;

export const settingsAnchorSubview = (anchorId: SettingsAnchorId): SettingsSubviewId => (
    SETTINGS_ANCHOR_SECTION[anchorId]
);
