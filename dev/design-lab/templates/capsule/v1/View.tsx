import { useState } from 'react';
import { ChevronDown, ChevronUp, ListMusic, Repeat2, Volume2 } from 'lucide-react';
import { Backdrop } from '../../../shared/v1/Backdrop';
import { TRACKS } from '../../../shared/v1/fixtures';
import { Choice, DemoNotice, IconButton, useDemoNotice } from '../../../shared/v1/primitives';
import { PlayButton, Progress } from '../../../shared/v1/Progress';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function CapsuleView() {
    const { scene } = useScene();
    const [pinned, setPinned] = useState(scene !== 'collapsed');
    const [hovered, setHovered] = useState(false);
    const [slot, setSlot] = useState('循环模式');
    const [loop, setLoop] = useState(false);
    const { notice, notify } = useDemoNotice();
    const expanded = pinned || hovered;
    return <main className={styles.page} data-template="capsule"><Backdrop /><section className={styles.note}><h1>播放胶囊</h1><p>悬停或点击展开，播放与进度连接模拟时钟。</p><span>左侧槽位</span><Choice label="左侧槽位" choices={['循环模式', '播放快捷']} value={slot} onChange={setSlot} /></section>
        <section className={styles.capsule} data-expanded={expanded} aria-label="播放胶囊" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onKeyDown={e => { if (e.key === 'Escape') { setPinned(false); setHovered(false); } }}>
            <button className={styles.expand} aria-label={pinned ? '收起胶囊' : '展开胶囊'} aria-expanded={expanded} onClick={() => { setPinned(!pinned); setHovered(false); }}>{pinned ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
            {expanded && <><h2>{TRACKS[0].title}</h2><div className={styles.controls}><IconButton label={slot} aria-pressed={slot === '循环模式' ? loop : undefined} onClick={() => slot === '循环模式' ? setLoop(!loop) : notify('播放快捷入口，请在对应模板中体验')} >{slot === '循环模式' ? <Repeat2 size={19} /> : <Volume2 size={19} />}</IconButton><PlayButton /><IconButton label="右侧槽位：歌词时间轴" onClick={() => notify('歌词时间轴入口')}><ListMusic size={19} /></IconButton></div>{loop && <small>单曲循环</small>}</>}
            <Progress />
        </section><DemoNotice text={notice} />
    </main>;
}
