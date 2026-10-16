import { useState } from 'react';
import { Shuffle, Volume2, VolumeX } from 'lucide-react';
import { Backdrop } from '../../../shared/v1/Backdrop';
import { TRACKS } from '../../../shared/v1/fixtures';
import { DemoPanel, IconButton } from '../../../shared/v1/primitives';
import { PlayButton, Progress } from '../../../shared/v1/Progress';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function QuickView() {
    const { scene } = useScene();
    const [open, setOpen] = useState(scene !== 'closed');
    const [volume, setVolume] = useState(65);
    const [muted, setMuted] = useState(scene === 'muted');
    const [reversed, setReversed] = useState(false);
    const tracks = reversed ? [...TRACKS].reverse() : [...TRACKS];
    return <main className={styles.page} data-template="playback-quick"><Backdrop /><div className={styles.hint}><h1>播放快捷</h1><p>音量、静音与洗牌，只作用于本预览。</p></div>
        <DemoPanel title="播放快捷" open={open} onClose={() => setOpen(false)} className={styles.panel}>
            <label htmlFor="volume">音量 · {muted ? '已静音' : `${volume}%`}</label><div className={styles.volume}><IconButton label={muted ? '取消静音' : '静音'} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</IconButton><input id="volume" type="range" min={0} max={100} value={muted ? 0 : volume} onChange={e => { setVolume(Number(e.target.value)); if (Number(e.target.value) > 0) setMuted(false); }} /></div>
            <button className={styles.shuffle} onClick={() => setReversed(!reversed)}><Shuffle size={18} />洗牌示例队列</button><ol aria-label="示例队列">{tracks.slice(0, 3).map(track => <li key={track.id}>{track.title}</li>)}</ol><p role="status">{reversed ? '演示操作：已反转示例顺序，未修改真实队列。' : '本地示例 · 不输出声音'}</p>
        </DemoPanel>
        <div className={styles.capsule}><PlayButton /><div><strong>{TRACKS[0].title}</strong><Progress /></div><button className="demo-icon" data-demo-trigger aria-label="打开播放快捷" aria-expanded={open} onClick={() => setOpen(!open)}><Volume2 size={20} /></button></div>
    </main>;
}
