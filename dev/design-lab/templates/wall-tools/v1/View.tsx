import { useState } from 'react';
import { LocateFixed, Settings2, SlidersHorizontal } from 'lucide-react';
import { Backdrop } from '../../../shared/v1/Backdrop';
import { Choice, DemoNotice, DemoPanel, Toggle, useDemoNotice } from '../../../shared/v1/primitives';
import { useScene } from '../../../runtime/scene';
import styles from './style.module.css';

export default function WallToolsView() {
    const { scene } = useScene();
    const [open, setOpen] = useState(scene !== 'closed');
    const [anchor, setAnchor] = useState(scene === 'left' ? '左下' : '右下');
    const [lights, setLights] = useState(true);
    const [look, setLook] = useState('实色');
    const { notice, notify } = useDemoNotice();
    return <main className={styles.page} data-template="wall-tools" data-lights={lights}><Backdrop /><div className={styles.shade} hidden={lights} /><div className={styles.hint}><h1>墙面工具</h1><p>固定锚点 · 分组菜单 · 本地开关</p><Choice label="浮层位置" choices={['左下', '右下']} value={anchor} onChange={setAnchor} /></div>
        <div className={styles.dock} data-anchor={anchor}>
            <DemoPanel title="墙面工具" open={open} onClose={() => setOpen(false)} className={styles.panel}>
                <h3>墙面材质</h3><Choice label="墙面材质" choices={['实色', '透光', '透明']} value={look} onChange={value => { setLook(value); notify(`已选择${value}材质，未运行真实墙引擎`); }} />
                <h3>画面</h3><Toggle label="海报叠色" description="模拟开关，不写入偏好" /><Toggle label="墙面灯光" value={lights} onChange={setLights} /><Toggle label="显示标题" initial />
                <h3>快捷操作</h3><button className={styles.action} onClick={() => notify('定位到正在播放的海报')}><LocateFixed size={18} />定位正在播放</button><button className={styles.action} onClick={() => notify('设置入口，请切换设置模板')}><Settings2 size={18} />播放器设置</button>
            </DemoPanel><button className="demo-secondary" data-demo-trigger aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal size={18} />墙面工具</button>
        </div><DemoNotice text={notice} />
    </main>;
}
