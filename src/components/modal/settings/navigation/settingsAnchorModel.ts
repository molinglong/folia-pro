import type { SettingsSubviewId } from '../../../../stores/useSettingsModalStore';

// src/components/modal/settings/navigation/settingsAnchorModel.ts
// Which options-tab section each <SettingsAnchor> lives in and which translated label its expanded
// sidebar entry uses. Commands and inactive sidebar sections both need this information before the
// destination panel exists, so it is declared once here. settingsAnchorCoverage.test.ts holds the
// table against the anchors actually rendered, so a section cannot silently drift away from its
// navigation destination.
//
// 主页外观不在这里登记（2026-10-19）：卡片样式 / 首页标签 / 记住卡片位置 / 拼贴墙 / 海报墙 / Bravais 墙面
// 整组搬到主页样式浮层（src/components/home/HomeStylePanel.tsx，调什么底下那面墙立刻跟着变），
// 侧栏那颗 homeStyle 入口是直接回到主页开它，不再是一个设置页。

export const SETTINGS_ANCHOR_DEFINITIONS = {
    // AppearanceSettingsSubview（part='player'：播放页那一屏的样子）
    lyricsRenderer: { section: 'appearance', labelKey: 'options.lyricsRenderer' },
    stageTrackPill: { section: 'appearance', labelKey: 'options.stageTrackPill' },
    videoLayerSettings: { section: 'appearance', labelKey: 'options.videoLayerSettings' },

    // AppearanceSettingsSubview（part='theme'：配色与配置）
    themePresets: { section: 'theme', labelKey: 'options.themePresets' },
    importExportTitle: { section: 'theme', labelKey: 'options.importExportTitle' },

    // GeneralSettingsSubview (PinnedCommandSettings and PonderTouchButtonSettingsSection render inside it)
    languageSettings: { section: 'general', labelKey: 'options.languageSettings' },
    playbackEntryView: { section: 'general', labelKey: 'options.playbackEntryView' },
    // Rendered only when more than one library suite is available (hasLibrarySuiteChoice).
    librarySuite: { section: 'general', labelKey: 'options.librarySuite', requiresLibrarySuiteChoice: true },
    bottomUiSettings: { section: 'general', labelKey: 'options.bottomUiSettings' },
    pinnedCommands: { section: 'general', labelKey: 'options.pinnedCommands' },
    // @fork 本地魔改版：原 ponderHints（思索教程提示三档）随胶囊一起摘掉。锚点 id 换成
    // ponderTouchButton —— 那一档设置没了，但同一个位置还剩触屏灯泡开关，它需要自己的目的地。
    // 留着旧 id 等于让侧栏链到一个不再渲染的锚点；删掉整行则会让触屏开关从目录里消失。
    ponderTouchButton: { section: 'general', labelKey: 'options.ponderTouchButton' },

    // PlaybackSettingsSubview (TransitionSettingsSection renders inside it)
    queueSettings: { section: 'playback', labelKey: 'options.queueSettings' },
    scrobbleSettings: { section: 'playback', labelKey: 'options.scrobbleSettings' },
    crossReplaceSettings: { section: 'playback', labelKey: 'options.crossReplaceSettings' },
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
    // 2026-10-19：原来手填服务器地址 / 开关 / 兼容 token 的「同步服务」区块已删（登录 Folia 账号即自动同步），
    // 那个 r2Sync 锚点跟着消失；同一位置改登记账号区块，侧栏与搜索仍能定位到 Folia 账号。
    foliaAccount: { section: 'storage', labelKey: 'ui.storage.accountTitle' },
    cacheDetails: { section: 'storage', labelKey: 'options.cacheDetails' },
    localLibraryWatch: { section: 'storage', labelKey: 'options.localLibraryWatch' },
    mediaCache: { section: 'storage', labelKey: 'options.mediaCache' },

    // DesktopSettingsSubview
    desktopTrayBehavior: { section: 'desktop', labelKey: 'options.desktopTrayBehavior', electronOnly: true },
    wallpaperMode: { section: 'desktop', labelKey: 'options.wallpaperMode', electronOnly: true },
    updateCheck: { section: 'desktop', labelKey: 'options.updateCheck', electronOnly: true },
    electronSettings: { section: 'desktop', labelKey: 'options.electronSettings', electronOnly: true },

    // GraphicsSettingsSubview
    // 档位选择器常驻；它选中非「自定义」时，下面两个被档位接管的细粒度栏位（画质开关、减少动效）会折叠
    // 隐藏，侧栏目录跟着收起，不然会链到一个不存在的目的地。
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
} as const satisfies Record<string, { section: SettingsSubviewId; labelKey: string; electronOnly?: boolean; requiresLibrarySuiteChoice?: boolean; requiresCustomPreset?: boolean }>;

export type SettingsAnchorId = keyof typeof SETTINGS_ANCHOR_DEFINITIONS;

export const SETTINGS_ANCHOR_SECTION = Object.fromEntries(
    Object.entries(SETTINGS_ANCHOR_DEFINITIONS).map(([id, definition]) => [id, definition.section]),
) as Record<SettingsAnchorId, SettingsSubviewId>;

export const settingsAnchorSubview = (anchorId: SettingsAnchorId): SettingsSubviewId => (
    SETTINGS_ANCHOR_SECTION[anchorId]
);
