import { useRef } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { useScene } from '../../runtime/scene';
import { DURATION } from '../../types';
import { formatTime } from './fixtures';
import { IconButton } from './primitives';

// dev/design-lab/shared/v1/Progress.tsx：时间直接更新 DOM；不让进度拖动引发整页逐帧渲染。
export function Progress() {
    const { time, command } = useScene();
    const range = useRef<HTMLInputElement>(null);
    const label = useRef<HTMLOutputElement>(null);
    useMotionValueEvent(time, 'change', value => {
        if (range.current) range.current.value = String(value);
        if (label.current) label.current.value = formatTime(value);
    });
    return <div className="demo-progress"><output ref={label}>{formatTime(time.get())}</output><input ref={range} aria-label="播放进度" type="range" min={0} max={DURATION} step={0.1} defaultValue={time.get()} onChange={e => command({ action: 'seek', time: Number(e.target.value) })} /><span>04:00</span></div>;
}
export function PlayButton() {
    const { playing, command, reducedMotion } = useScene();
    return <IconButton label={playing ? '暂停' : '播放'} disabled={reducedMotion} onClick={() => command({ action: 'toggle' })}>{playing ? <Pause size={20} /> : <Play size={20} />}</IconButton>;
}
