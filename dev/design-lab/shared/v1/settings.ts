// dev/design-lab/shared/v1/settings.ts：各设置方案使用同一组字段与默认值，比较布局而非内容。
export const SECTIONS = [
    { id: 'appearance', label: '外观', description: '主题、界面与首页' },
    { id: 'graphics', label: '图形', description: '画质与动态效果' },
    { id: 'playback', label: '播放', description: '播放体验与队列' },
    { id: 'lyrics', label: '歌词', description: '排版与阅读体验' },
] as const;
export type SectionId = typeof SECTIONS[number]['id'];
type Field = { id: string; label: string; description: string } & (
    { kind: 'switch'; initial: boolean } | { kind: 'range'; initial: number; min: number; max: number; unit: string } | { kind: 'choice'; initial: string; choices: string[] }
);
export type SettingsGroup = { id: string; title: string; description: string; fields: Field[] };
export const SETTINGS: Record<SectionId, SettingsGroup[]> = {
    appearance: [
        { id: 'theme', title: '主题与配色', description: '让界面与你正在听的音乐保持一致', fields: [
            { id: 'cover-color', label: '跟随封面取色', description: '使用专辑封面中的颜色', kind: 'switch', initial: true },
            { id: 'light-follow', label: '跟随系统明暗', description: '根据系统外观自动切换', kind: 'switch', initial: false },
        ] },
        { id: 'home', title: '首页与海报', description: '调整唱片收藏的展示方式', fields: [
            { id: 'poster-style', label: '海报卡片样式', description: '图片与文字的组合方式', kind: 'choice', choices: ['海报', '卡片', '简洁'], initial: '海报' },
            { id: 'keep-position', label: '记住浏览位置', description: '回到首页时保留刚才的位置', kind: 'switch', initial: true },
            { id: 'poster-tint', label: '封面叠色', description: '用歌曲主题轻轻染色', kind: 'switch', initial: false },
        ] },
    ],
    graphics: [
        { id: 'quality', title: '画质预设', description: '在视觉效果与流畅度之间选择', fields: [
            { id: 'quality-preset', label: '画质档位', description: '仅演示选择反馈，不调用渲染引擎', kind: 'choice', choices: ['轻量', '均衡', '精致'], initial: '均衡' },
            { id: 'background-strength', label: '背景浓度', description: '控制背景在画面中的存在感', kind: 'range', min: 0, max: 100, unit: '%', initial: 65 },
        ] },
        { id: 'motion', title: '动态效果', description: '保留必要的动效与空间感', fields: [
            { id: 'animations', label: '界面过渡动画', description: '切换面板时平滑过渡', kind: 'switch', initial: true },
            { id: 'background-motion', label: '动态背景', description: '让播放画面缓慢流动', kind: 'switch', initial: true },
        ] },
    ],
    playback: [
        { id: 'transport', title: '播放体验', description: '让歌曲之间自然衔接', fields: [
            { id: 'crossfade', label: '歌曲淡入淡出', description: '仅演示设置，不播放真实音频', kind: 'switch', initial: true },
            { id: 'fade-duration', label: '淡出时长', description: '调整曲目结束时的过渡长度', kind: 'range', min: 0, max: 10, unit: ' s', initial: 3 },
        ] },
        { id: 'queue', title: '播放队列', description: '决定下一首音乐的去向', fields: [
            { id: 'loop-mode', label: '循环模式', description: '选择队列的默认播放顺序', kind: 'choice', choices: ['顺序', '列表循环', '单曲循环'], initial: '列表循环' },
            { id: 'restore-queue', label: '保留上次队列', description: '下次打开时从熟悉的地方继续', kind: 'switch', initial: true },
        ] },
    ],
    lyrics: [
        { id: 'typography', title: '歌词排版', description: '调整适合你的阅读节奏', fields: [
            { id: 'lyric-size', label: '歌词字号', description: '同时影响主歌词与当前行', kind: 'range', min: 24, max: 72, unit: ' px', initial: 42 },
            { id: 'lyric-weight', label: '文字粗细', description: '为当前歌词选择字重', kind: 'choice', choices: ['纤细', '常规', '粗体'], initial: '常规' },
        ] },
        { id: 'translation', title: '翻译与辅助', description: '按需要显示更多歌词信息', fields: [
            { id: 'translation', label: '显示翻译', description: '在原文下方显示译文', kind: 'switch', initial: true },
            { id: 'upcoming', label: '显示下一句', description: '提前看到即将出现的歌词', kind: 'switch', initial: true },
        ] },
    ],
};
