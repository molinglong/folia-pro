import { useState } from 'react';
import { Palette } from 'lucide-react';
import { Backdrop } from '../../../shared/v1/Backdrop';
import { TRACKS } from '../../../shared/v1/fixtures';
import { Choice, DemoNotice, DemoPanel, Toggle, useDemoNotice } from '../../../shared/v1/primitives';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function HomeStyleView() {
    const { scene } = useScene();
    const [open, setOpen] = useState(scene !== 'closed');
    const [style, setStyle] = useState(scene === 'card' ? '卡片' : '图片');
    const { notice, notify } = useDemoNotice();
    return <main className={styles.page} data-template="home-style"><Backdrop /><button className={`demo-secondary ${styles.trigger}`} data-demo-trigger onClick={() => setOpen(!open)} aria-expanded={open}><Palette size={18} />主页样式</button>
        {open && <div className={styles.scrim} />}
        <DemoPanel title="主页样式" open={open} onClose={() => setOpen(false)} className={styles.panel}>
            <p className={styles.subtitle}>让音乐库以你喜欢的方式呈现</p>
            <h3>卡片外观</h3><div className={styles.sample} data-style={style}><img src={TRACKS[0].cover} alt="样式预览封面" width={160} height={160} />{style === '卡片' && <div>留白<small>林间来信</small></div>}</div><Choice label="卡片样式" choices={['图片', '卡片']} value={style} onChange={setStyle} /><p className={styles.feedback} role="status">当前选择：{style}样式 · 仅供预览</p>
            <h3>主页栏目</h3><Toggle label="歌单" initial /><Toggle label="专辑" initial /><Toggle label="本地音乐" initial /><Toggle label="记住卡片位置" description="演示开关，不保存到浏览器" />
            <h3>其他</h3><Toggle label="背景视频" description="仅展示开关，不加载视频" />
            <button className={`demo-secondary ${styles.full}`} onClick={() => notify('完整设置入口，请切换设置模板')}>打开完整设置</button>
        </DemoPanel><DemoNotice text={notice} />
    </main>;
}
