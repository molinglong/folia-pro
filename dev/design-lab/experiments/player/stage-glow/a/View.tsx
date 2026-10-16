import { useRef, useState } from 'react';
import { Heart, ListMusic, SkipBack, SkipForward, X } from 'lucide-react';
import { TRACKS } from '../../../../shared/v1/fixtures';
import { DemoNotice, IconButton, useDemoNotice } from '../../../../shared/v1/primitives';
import { PlayButton, Progress } from '../../../../shared/v1/Progress';
import { useScene } from '../../../../runtime/scene';
import { Lyrics } from './Lyrics';
import StageGlowCanvas from './stage';
import styles from './style.module.css';

export default function PlayerView() {
    const { scene } = useScene();
    const [queue, setQueue] = useState(scene === 'queue');
    const [liked, setLiked] = useState(false);
    const [lights, setLights] = useState(true);
    const [beat, setBeat] = useState(true);
    const coverRef = useRef<HTMLImageElement>(null);
    const { notice, notify } = useDemoNotice();
    const track = TRACKS[0];
    return <main className={styles.page} data-template="player" data-lights={lights ? 'on' : 'out'}>
        <div className={styles.fxVeil} aria-hidden="true" />
        <header><span>Folia / 正在聆听</span><IconButton label="播放队列" onClick={() => setQueue(!queue)} aria-expanded={queue}><ListMusic size={20} /></IconButton></header>
        <div className={styles.layout}><section className={styles.album}><StageGlowCanvas anchorRef={coverRef} enabled={!lights} gain={beat ? 1 : 0} /><img ref={coverRef} src={track.cover} width={480} height={480} alt={`${track.album}封面`} /><div className={styles.title}><div><h1>{track.title}</h1><p>{track.artist} · {track.album}</p></div><IconButton label="喜欢" aria-pressed={liked} onClick={() => setLiked(!liked)}><Heart size={21} fill={liked ? 'currentColor' : 'none'} /></IconButton></div>
            <Progress /><div className={styles.controls}><IconButton label="上一首" onClick={() => notify('上一首仅展示导航反馈')}><SkipBack size={20} /></IconButton><PlayButton /><IconButton label="下一首" onClick={() => notify('下一首仅展示导航反馈')}><SkipForward size={20} /></IconButton></div>
            <small>模拟播放 · 原创示例歌词 · 无真实音频</small>
        </section><Lyrics empty={scene === 'no-lyrics'} /></div>
        {queue && <aside className={styles.queue} role="dialog" aria-label="播放队列" onKeyDown={e => { if (e.key === 'Escape') setQueue(false); }}><header><h2>接下来播放</h2><IconButton label="关闭队列" onClick={() => setQueue(false)}><X size={18} /></IconButton></header>{TRACKS.map((item, i) => <button key={item.id} onClick={() => notify(`选择队列歌曲「${item.title}」`)}><span>{String(i + 1).padStart(2, '0')}</span><img src={item.cover} alt="" width={40} height={40} /><div>{item.title}<small>{item.artist}</small></div></button>)}</aside>}
        <DemoNotice text={notice} />
        <div className={styles.fxControls}>
            <button aria-pressed={!lights} onClick={() => setLights(l => !l)}>{lights ? '关灯' : '开灯'}</button>
            <button aria-pressed={beat} onClick={() => setBeat(b => !b)}>节拍{beat ? '跟随' : '停止'}</button>
        </div>
    </main>;
}
