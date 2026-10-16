import { useState } from 'react';
import { ArrowUpRight, Layers3, Search } from 'lucide-react';
import { TRACKS } from '../../../shared/v1/fixtures';
import { DemoNotice, useDemoNotice } from '../../../shared/v1/primitives';
import { PlayButton, Progress } from '../../../shared/v1/Progress';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

// 首页仅保留海报与中缝布局，不启动无限墙引擎。
export default function HomeView() {
    const { scene } = useScene();
    const [selected, setSelected] = useState(scene === 'selected' ? 0 : -1);
    const [tab, setTab] = useState('歌单');
    const { notice, notify } = useDemoNotice();
    const posters = (offset: number) => TRACKS.slice(offset, offset + 4).map((track, index) => <button key={track.id} className={styles.poster} aria-pressed={selected === offset + index} onClick={() => setSelected(offset + index)}>
        <img src={track.cover} alt={`${track.album}封面`} width={480} height={480} /><span>{track.album}<small>{track.artist}</small></span>{selected === offset + index && <ArrowUpRight size={22} />}
    </button>);
    return <main className={styles.page} data-template="home">
        <div className={styles.wall}>{posters(0)}</div>
        <aside className={styles.seam}><Layers3 size={28} strokeWidth={1.2} /><h1>Folia</h1><p>让音乐，慢慢发生。</p>
            <nav aria-label="音乐分类">{['歌单', '专辑', '本地'].map(item => <button key={item} aria-pressed={item === tab} onClick={() => { setTab(item); notify(`切换到${item}示例`); }}>{item}</button>)}</nav>
            <button className="demo-secondary" onClick={() => notify('搜索入口仅展示，不连接音乐平台')}><Search size={16} />搜索音乐</button>
            <div className={styles.detail}><span className="eyebrow">{selected < 0 ? 'YOUR COLLECTION' : 'SELECTED ALBUM'}</span><h2>{selected < 0 ? '收藏里的片刻' : TRACKS[selected].album}</h2><p>{selected < 0 ? '选择一张海报，查看专辑信息。' : `${TRACKS[selected].artist} · 本地示例专辑`}</p></div>
            <small>BRAVAIS · 界面参考稿</small>
        </aside>
        <div className={styles.wall}>{posters(4)}</div>
        <div className={styles.player}><PlayButton /><div><strong>{TRACKS[0].title}</strong><Progress /></div></div>
        <DemoNotice text={notice} />
    </main>;
}
