import { useState } from 'react';
import { TRACKS } from '../../../shared/v1/fixtures';
import { DemoNotice, useDemoNotice } from '../../../shared/v1/primitives';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

// 海报墙最小复刻：7×6 网格、点卡切换"正在播放"、关灯时按距离逐张涟漪熄灯（真墙同款公式），
// 当前卡保持明亮并带主题色发光。卡片带 data-poster / data-current 属性，供方案层每帧查询定位。
const COLS = 7, TOTAL = 42;
const CARDS = Array.from({ length: TOTAL }, (_, i) => TRACKS[i % TRACKS.length]);

export default function WallView() {
    const { scene } = useScene();
    const [lights, setLights] = useState(scene !== 'lights-out');
    const [current, setCurrent] = useState(17);
    const { notice, notify } = useDemoNotice();
    const curCol = current % COLS, curRow = Math.floor(current / COLS);
    return <main className={styles.page} data-template="wall" data-lights={lights ? 'on' : 'out'}>
        <header className={styles.bar}>
            <span>Folia / 海报墙 · 正在播放「{CARDS[current].title}」</span>
            <button className={styles.lightsBtn} aria-pressed={!lights} onClick={() => setLights(l => !l)}>{lights ? '关灯' : '开灯'}</button>
        </header>
        <div className={styles.field}>
            <div className={styles.grid}>
                {CARDS.map((track, i) => {
                    const delay = Math.min(900, Math.hypot(i % COLS - curCol, Math.floor(i / COLS) - curRow) * 78);
                    return <button key={i} data-poster={''} data-current={i === current ? '' : undefined}
                        className={`${styles.poster} ${i === current ? styles.current : ''}`}
                        onClick={() => { setCurrent(i); notify(`切换到「${track.title}」`); }}>
                        <img src={track.cover} alt="" loading="lazy" />
                        <span className={styles.label}><b>{track.title}</b><i>{track.artist}</i></span>
                        <span className={styles.veil} style={{ transitionDelay: `${delay}ms` }} />
                    </button>;
                })}
            </div>
        </div>
        <DemoNotice text={notice} />
    </main>;
}
