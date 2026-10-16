import { useEffect, useState } from 'react';
import { ChevronLeft, Headphones, Palette, SlidersHorizontal, Type, X } from 'lucide-react';
import { useScene } from '../../../../runtime/scene';
import { Backdrop } from '../../../../shared/v1/Backdrop';
import { IconButton } from '../../../../shared/v1/primitives';
import { SECTIONS, type SectionId } from '../../../../shared/v1/settings';
import { SettingsContent } from './SettingsContent';
import styles from './style.module.css';

// dev/design-lab/templates/settings/v1/View.tsx：当前设置布局的交互参考稿，关闭与开关只作用于本预览。
const icons = { appearance: Palette, graphics: SlidersHorizontal, playback: Headphones, lyrics: Type };
export default function SettingsView() {
    const { scene } = useScene();
    const [section, setSection] = useState<SectionId>(scene === 'default' ? 'appearance' : SECTIONS.find(s => s.id === scene)?.id ?? 'appearance');
    const [open, setOpen] = useState(true);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    const selected = SECTIONS.find(s => s.id === section)!;
    return <main className={styles.page} data-template="settings">
        <Backdrop />
        {!open && <button className={`demo-primary ${styles.reopen}`} onClick={() => setOpen(true)}>打开设置</button>}
        {open && <div className={styles.scrim}><section role="dialog" aria-label="播放器设置" className={styles.dialog}>
            <header className={styles.header}><div><ChevronLeft size={19} /><span>Folia</span><span className={styles.headerDivider}>/</span><strong>播放器设置</strong></div><IconButton label="关闭设置" onClick={() => setOpen(false)}><X size={18} /></IconButton></header>
            <div className={styles.layout}>
                <nav className={styles.nav} aria-label="设置分区"><span className={styles.navCaption}>偏好设置</span>{SECTIONS.map(item => {
                    const Icon = icons[item.id];
                    return <button key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
                })}<div className={styles.navFoot}>为你的聆听习惯而设</div></nav>
                <div className={styles.content}><div className={styles.intro}><span className="eyebrow">PERSONAL PREFERENCES</span><h1>{selected.label}</h1><p>{selected.description}</p></div><SettingsContent key={section} section={section} /></div>
            </div>
        </section></div>}
    </main>;
}
