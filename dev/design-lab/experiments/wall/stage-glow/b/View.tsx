import { useLayoutEffect, useRef, useState } from 'react';
import { TRACKS } from '../../../../shared/v1/fixtures';
import { DemoNotice, useDemoNotice } from '../../../../shared/v1/primitives';
import { useScene } from '../../../../runtime/scene';
import { useStageBeat } from './useBeat';
import styles from './style.module.css';

// 海报墙最小复刻：7×6 网格、点卡切换"正在播放"、关灯时按距离逐张涟漪熄灯（真墙同款公式），
// 当前卡保持明亮并带主题色发光。卡片带 data-poster / data-current 属性，供方案层每帧查询定位。
const COLS = 7, TOTAL = 42;
const CARDS = Array.from({ length: TOTAL }, (_, i) => TRACKS[i % TRACKS.length]);

export default function WallView() {
    const { scene } = useScene();
    const [lights, setLights] = useState(scene !== 'lights-out');
    const [beat, setBeat] = useState(true);
    const [current, setCurrent] = useState(17);
    const mainRef = useRef<HTMLElement>(null);
    const fieldRef = useRef<HTMLDivElement>(null);
    const [halo, setHalo] = useState({ x: 0, y: 0, size: 0 });
    useStageBeat(mainRef, !lights && beat);
    // 把光斑对准当前卡（层级在卡面之上、当前卡本身之上）：只在换卡/尺寸变化时量一次矩形（纯 CSS 方案不做逐帧 DOM 查询）
    useLayoutEffect(() => {
        const field = fieldRef.current;
        if (!field) return;
        const calc = () => {
            const cur = field.querySelector<HTMLElement>('[data-poster][data-current]');
            if (!cur) return;
            const f = field.getBoundingClientRect(), c = cur.getBoundingClientRect();
            setHalo({ x: c.left - f.left + c.width / 2, y: c.top - f.top + c.height / 2, size: c.width * 3.1 });
        };
        calc();
        const ro = new ResizeObserver(calc);
        ro.observe(field);
        return () => ro.disconnect();
    }, [current]);
    const { notice, notify } = useDemoNotice();
    const curCol = current % COLS, curRow = Math.floor(current / COLS);
    return <main ref={mainRef} className={styles.page} data-template="wall" data-lights={lights ? 'on' : 'out'}>
        <header className={styles.bar}>
            <span>Folia / 海报墙 · 正在播放「{CARDS[current].title}」</span>
            <span className={styles.barBtns}>
                <button className={styles.lightsBtn} aria-pressed={!lights} onClick={() => setLights(l => !l)}>{lights ? '关灯' : '开灯'}</button>
                <button className={styles.lightsBtn} aria-pressed={beat} onClick={() => setBeat(b => !b)}>节拍{beat ? '跟随' : '停止'}</button>
            </span>
        </header>
        <div className={styles.field} ref={fieldRef}>
            <div className={styles.haloLayer} aria-hidden="true">
                <i className={styles.haloFar} style={{ left: halo.x - halo.size * 0.75, top: halo.y - halo.size * 0.75, width: halo.size * 1.5, height: halo.size * 1.5 }} />
                <i className={styles.haloNear} style={{ left: halo.x - halo.size / 2, top: halo.y - halo.size / 2, width: halo.size, height: halo.size }} />
            </div>
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
