import { useRef } from 'react';
import { Columns2, Grid2X2, Maximize, Pause, Play, RotateCcw } from 'lucide-react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { DURATION, VIEWPORTS, type LabState, type PreviewVariant, type TemplateRecord } from '../types';

// dev/design-lab/app/Toolbar.tsx：控制比较条件，不透传真实应用设置。
type Props = {
    state: LabState;
    template: TemplateRecord;
    variants: PreviewVariant[];
    change: (patch: Partial<LabState>) => void;
    time: MotionValue<number>;
    playing: boolean;
    reducedMotion: boolean;
    toggle: () => void;
    seek: (time: number) => void;
    reset: () => void;
};
export function Toolbar({ state, template, variants, change, time, playing, reducedMotion, toggle, seek, reset }: Props) {
    const progress = useRef<HTMLInputElement>(null);
    const stamp = useRef<HTMLOutputElement>(null);
    useMotionValueEvent(time, 'change', value => {
        if (progress.current) progress.current.value = String(value);
        if (stamp.current) stamp.current.value = `${Math.floor(value)} s`;
    });
    return <div className="lab-toolbar">
        <div className="toolbar-row">
            <div className="segmented" role="group" aria-label="对比布局">
                {([{ id: 'single', label: '单独查看', Icon: Maximize }, { id: 'split', label: '双栏对比', Icon: Columns2 }, { id: 'grid', label: '四格总览', Icon: Grid2X2 }] as const).map(({ id, label, Icon }) =>
                    <button key={id} aria-pressed={state.mode === id} onClick={() => change({ mode: id })}><Icon size={14} />{label}</button>)}
            </div>
            <div className="toolbar-divider" />
            <label>画布<select aria-label="画布尺寸" value={state.device} onChange={e => change({ device: e.target.value as LabState['device'] })}>
                {Object.entries(VIEWPORTS).map(([id, v]) => <option key={id} value={id}>{v.label} · {v.width} × {v.height}</option>)}
            </select></label>
            <label>主题<select aria-label="预览主题" value={state.theme} onChange={e => change({ theme: e.target.value as LabState['theme'] })}><option value="light">浅色</option><option value="dark">深色</option></select></label>
        </div>
        <div className="toolbar-row secondary-row">
            {state.mode !== 'grid' && <>
                <label>{state.mode === 'single' ? '版本' : '左侧'}<select aria-label="左侧方案" value={state.left} onChange={e => change({ left: e.target.value })}>{variants.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
                {state.mode === 'split' && <label>右侧<select aria-label="右侧方案" value={state.right} onChange={e => change({ right: e.target.value })}>{variants.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>}
            </>}
            <label>场景<select aria-label="示例场景" value={state.scene} onChange={e => change({ scene: e.target.value })}>{template.scenes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <div className="clock-tools">
                <button className="icon-button" aria-label={playing ? '暂停模拟动画' : '播放模拟动画'} disabled={reducedMotion} title={reducedMotion ? '系统已开启减少动态效果' : '只播放模拟时间，不播放声音'} onClick={toggle}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                <input ref={progress} aria-label="模拟时间" type="range" min="0" max={DURATION} step="0.1" defaultValue={time.get()} onChange={e => seek(Number(e.target.value))} />
                <output ref={stamp}>{Math.floor(time.get())} s</output>
                <button className="icon-button" aria-label="重置所有可见方案" title="重置所有可见方案" onClick={reset}><RotateCcw size={15} /></button>
            </div>
        </div>
    </div>;
}
