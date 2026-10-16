import { useState } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import { LYRICS } from '../../../shared/v1/fixtures';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export function Lyrics({ empty }: { empty: boolean }) {
    const { time, command } = useScene();
    const [line, setLine] = useState(Math.floor(time.get() / 12) % LYRICS.length);
    useMotionValueEvent(time, 'change', value => setLine(Math.floor(value / 12) % LYRICS.length));
    return <section className={styles.lyrics} aria-label="原创示例歌词">{empty ? <p>这首歌，留一点安静。<small>暂无歌词</small></p> : LYRICS.map((text, i) => <button key={text} aria-current={i === line ? 'true' : undefined} onClick={() => command({ action: 'seek', time: i * 12 })}>{text}</button>)}</section>;
}
