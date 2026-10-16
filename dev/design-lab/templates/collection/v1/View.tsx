import { useState } from 'react';
import { ArrowLeft, Heart, ListMusic, Play, Plus } from 'lucide-react';
import { TRACKS } from '../../../shared/v1/fixtures';
import { DemoNotice, IconButton, useDemoNotice } from '../../../shared/v1/primitives';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function CollectionView() {
    const { scene } = useScene();
    const [selected, setSelected] = useState(scene === 'selected' ? TRACKS[0].id as string : '');
    const [liked, setLiked] = useState(false);
    const { notice, notify } = useDemoNotice();
    const tracks = scene === 'empty' ? [] : TRACKS;
    return <main className={styles.page} data-template="collection">
        <header><IconButton label="返回音乐库" onClick={() => notify('返回音乐库入口')}><ArrowLeft size={19} /></IconButton><span>音乐库 / {scene === 'album' ? '专辑' : '歌单'}</span></header>
        <section className={styles.hero}><img src={TRACKS[0].cover} alt="留白歌单封面" width={240} height={240} /><div><span className="eyebrow">{scene === 'album' ? 'ALBUM' : 'PLAYLIST'} · FOLIA SESSIONS</span><h1>留一点空白</h1><p>把时间交给旋律，把片刻留给自己。</p><small>林间来信 · {tracks.length} 首歌曲 · 本地示例</small><div className={styles.actions}><button className="demo-primary" disabled={!tracks.length} onClick={() => notify('播放全部仅作演示')}><Play size={17} />播放全部</button><button className="demo-secondary" aria-pressed={liked} onClick={() => setLiked(!liked)}><Heart size={17} fill={liked ? 'currentColor' : 'none'} />{liked ? '已标记喜欢' : '喜欢'}</button></div></div></section>
        <section className={styles.list} aria-label="歌曲列表"><div className={styles.listHead}><h2>歌曲</h2><span>{tracks.length} 首</span></div>
            {!tracks.length ? <div className={styles.empty}><ListMusic size={34} /><h3>还没有歌曲</h3><p>从喜欢的一首开始。</p><button className="demo-secondary" onClick={() => notify('添加歌曲，不导入真实文件')}><Plus size={16} />添加歌曲</button></div> : <><div className={styles.columns}><span>#</span><span>标题</span><span>专辑</span><span>时长</span></div>{tracks.map((track, i) => <button key={track.id} className={styles.row} aria-pressed={selected === track.id} onClick={() => setSelected(track.id)} onDoubleClick={() => notify(`播放「${track.title}」仅作演示`)}><span>{String(i + 1).padStart(2, '0')}</span><div><img src={track.cover} alt="" width={42} height={42} /><span>{track.title}<small>{track.artist}</small></span></div><span>{track.album}</span><span>{track.duration}</span></button>)}</>}
        </section><DemoNotice text={notice} />
    </main>;
}
