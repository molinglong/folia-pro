import { useState } from 'react';
import { LoaderCircle, Music2, Plus, Search } from 'lucide-react';
import { TRACKS } from '../../../shared/v1/fixtures';
import { DemoNotice, IconButton, useDemoNotice } from '../../../shared/v1/primitives';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function SearchView() {
    const { scene } = useScene();
    const [input, setInput] = useState(scene === 'empty' ? '未收录的旋律' : '');
    const [query, setQuery] = useState(input);
    const [category, setCategory] = useState('歌曲');
    const [loading, setLoading] = useState(scene === 'loading');
    const { notice, notify } = useDemoNotice();
    const results = TRACKS.filter(t => `${t.title}${t.artist}${t.album}`.includes(query.trim()));
    return <main className={styles.page} data-template="search"><header><span className="eyebrow">FOLIA / SEARCH</span><h1>寻找下一段旋律</h1><p>搜索本地示例音乐，不连接任何平台。</p></header>
        <form className={styles.search} onSubmit={e => { e.preventDefault(); setQuery(input); setLoading(false); }}><label htmlFor="music-search"><Search size={20} /><span>搜索音乐</span></label><input id="music-search" type="search" placeholder="歌曲、歌手或专辑" value={input} onChange={e => setInput(e.target.value)} /><button className="demo-primary" type="submit">搜索</button></form>
        <nav className={styles.tabs} aria-label="结果分类">{['歌曲', '专辑', '歌手'].map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
        {loading ? <div className={styles.empty} role="status"><LoaderCircle className={styles.spinner} size={30} /><h2>正在寻找音乐…</h2><p>固定加载场景；提交搜索可查看本地结果。</p></div> : !results.length ? <div className={styles.empty}><Music2 size={34} /><h2>没有找到相关音乐</h2><p>试试「风」「林间」或清空关键词。</p><button className="demo-secondary" onClick={() => { setInput(''); setQuery(''); }}>查看全部示例</button></div> : <section aria-label="搜索结果"><div className={styles.caption}><h2>{category}结果</h2><span>{category === '歌曲' ? results.length : new Set(results.map(t => category === '专辑' ? t.album : t.artist)).size} 项</span></div>
            {category === '歌曲' ? results.map(track => <div className={styles.row} key={track.id}><button className={styles.track} onClick={() => notify(`播放「${track.title}」仅作演示`)}><img src={track.cover} alt="" width={48} height={48} /><span>{track.title}<small>{track.artist} · {track.album}</small></span></button><span>{track.duration}</span><IconButton label={`添加${track.title}到队列`} onClick={() => notify(`添加「${track.title}」到示例队列`)}><Plus size={18} /></IconButton></div>) : <div className={styles.cards}>{[...new Map(results.map(t => [category === '专辑' ? t.album : t.artist, t])).entries()].map(([name, track]) => <button key={name} onClick={() => notify(`打开${category}「${name}」`)}><img src={track.cover} alt={`${name}封面`} width={160} height={160} /><strong>{name}</strong><small>本地示例{category}</small></button>)}</div>}
        </section>}<DemoNotice text={notice} />
    </main>;
}
