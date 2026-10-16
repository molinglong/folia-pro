import { useTranslation } from 'react-i18next';
import { Shuffle, Volume1, Volume2, VolumeX } from 'lucide-react';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId } from '../../floating-player/playerControlSlotActions';
import { useLatticePlaybackActions } from './LatticePlaybackProvider';

// src/components/app/lattice/LatticeExtraControls.tsx
// Transport and the main bar's configured slots share their handlers, icons and availability.
// @fork 本地魔改版（2026-10-14）：Lattice 里不再出现「播放快捷」浮层入口 —— 那颗按钮打开的浮层是 fixed 定在
// 底部胶囊正上方的（胶囊不在场，浮层就飘在屏幕右下角空位上，用户反馈位置错误）。播放的事就地内联：
// 「下一首」右边直接放静音键 + 音量滑条 + 洗牌（与浮层同一套 store / handler，点击不再弹层）。
// 胶囊路径（播放页 / 首页底栏）不受影响，playback-quick 槽位照常弹浮层。

/** 音量图标随显示的值变（与胶囊浮层、墙面滑条同一套：0 / 小于一半 / 其余）。 */
const volumeIcon = (value: number) => (value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2);

export default function LatticeExtraControls({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const context = useLatticePlaybackActions();
    const primary = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondary = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const actions: PlayerControlSlotActionId[] = (['prev', primary, secondary, 'next'] as PlayerControlSlotActionId[])
        .filter(action => action !== 'playback-quick');

    // 内联播放快捷三件套：音量读写全局 store（与胶囊浮层、播放页面板同一份），洗牌吃 provider 的 shuffleQueue。
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const rawVolume = useAudioSettingsStore(state => state.volume);
    const displayValue = isMuted ? 0 : rawVolume;
    const MuteIcon = volumeIcon(displayValue);
    const setVolume = (value: number) => {
        const audio = useAudioSettingsStore.getState();
        // 拖音量就是想听见它：非零值先解除静音（与浮层、墙面滑条的旧行为一致）。
        if (value > 0 && audio.isMuted) audio.handleToggleMute();
        audio.handleSetVolume(value);
    };
    return <div className="lattice-chrome-actions">
        {actions.map((action, index) => {
            const slot = resolvePlayerControlSlot(action, context);
            const Icon = slot.icon;
            return <button key={index} type="button" data-action={action} className={slot.active ? 'is-active' : ''}
                disabled={disabled || slot.disabled} onClick={() => slot.onActivate()}
                aria-label={t(slot.labelKey)} title={t(slot.labelKey)}
                aria-pressed={action === 'loop' || action === 'like' ? slot.active : undefined}>
                <Icon size={20} fill={slot.filled ? 'currentColor' : 'none'} />
            </button>;
        })}
        {/* 「下一首」右边的内联快捷排（@fork 2026-10-14）：静音 + 滑条 + 百分比 + 洗牌。包进 wrapper 后与 slot 排拉开间距，
            用左侧极淡竖线分隔；静音是 switch（测试定位器别写成 button）；滑条常驻挂载，收起态由外层 details 的 inert/0fr 一起接管隐藏。 */}
        <span className="lattice-chrome-quick">
            <button
                type="button"
                role="switch"
                aria-checked={isMuted}
                data-action="mute"
                className={`lattice-chrome-mute${isMuted ? ' is-active' : ''}`}
                aria-label={isMuted ? t('playbackQuick.unmute') : t('playbackQuick.mute')}
                title={isMuted ? t('playbackQuick.unmute') : t('playbackQuick.mute')}
                onClick={() => useAudioSettingsStore.getState().handleToggleMute()}
            >
                <MuteIcon size={20} />
            </button>
            <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={displayValue}
                aria-label={t('ui.volume')}
                aria-valuetext={isMuted ? t('playbackQuick.muted') : `${Math.round(displayValue * 100)}%`}
                onChange={event => setVolume(Number(event.target.value))}
                className="lattice-chrome-volume"
            />
            <span className="lattice-chrome-volume-value">{isMuted ? t('playbackQuick.muted') : `${Math.round(displayValue * 100)}%`}</span>
            <button
                type="button"
                data-action="shuffle"
                disabled={disabled || !context.canShuffle}
                onClick={context.onShuffle}
                aria-label={t('playbackQuick.shuffle')}
                title={context.canShuffle ? t('playbackQuick.shuffle') : t('playbackQuick.shuffleUnavailable')}
            >
                <Shuffle size={20} />
            </button>
        </span>
    </div>;
}
