// src/types/playerControlSlots.ts
// 进度条胶囊右侧两个可自定义槽位的跨层合同。
//
// 只放 id、默认值和校验：store 需要它们来持久化，但不该为此依赖组件层的图标模块。
// 图标和 handler 解析在 src/components/floating-player/playerControlSlotActions.ts。

export type PlayerControlSlotActionId =
    | 'loop'
    | 'prev'
    | 'next'
    | 'shuffle'
    | 'like'
    | 'lyrics-timeline'
    | 'volume'
    | 'playback-quick'
    | 'queue'
    | 'song-wall'
    | 'record-video'
    | 'sleep-timer';

export const PLAYER_CONTROL_SLOT_ACTION_IDS: readonly PlayerControlSlotActionId[] = [
    'loop',
    'prev',
    'next',
    'shuffle',
    'like',
    'lyrics-timeline',
    'volume',
    'playback-quick',
    'queue',
    'song-wall',
    'record-video',
    'sleep-timer',
];

/** 默认：左槽循环模式；右槽见下方 @fork 注释。 */
export const DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY: PlayerControlSlotActionId = 'loop';
// @fork 本地魔改版（2026-10-14）：右槽默认从「歌词时间轴」换成「播放快捷」二级浮层（音量 + 静音 + 洗牌），
// 接替 bravais 墙工具面板里搬出来的播放项。时间轴与纯音量槽都不删除，设置里随时换回；此处只改「默认」。
export const DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY: PlayerControlSlotActionId = 'playback-quick';

export const isPlayerControlSlotActionId = (value: unknown): value is PlayerControlSlotActionId => (
    typeof value === 'string' && (PLAYER_CONTROL_SLOT_ACTION_IDS as readonly string[]).includes(value)
);
