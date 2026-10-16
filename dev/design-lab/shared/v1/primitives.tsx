import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

// dev/design-lab/shared/v1/primitives.tsx：只负责演示外观的基础件；不读取任何存储。
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
    return <button type="button" className="demo-icon" aria-label={label} title={label} {...props}>{children}</button>;
}
export function Toggle({ label, description, initial = false, value, onChange }: { label: string; description?: string; initial?: boolean; value?: boolean; onChange?: (value: boolean) => void }) {
    const [local, setLocal] = useState(initial);
    const checked = value ?? local;
    return <div className="demo-toggle-row"><div><span>{label}</span>{description && <small>{description}</small>}</div><button
        type="button" className="demo-toggle" role="switch" aria-label={label} aria-checked={checked}
        onClick={() => { setLocal(!checked); onChange?.(!checked); }}
    ><span /></button></div>;
}
export function Choice({ label, choices, value, onChange }: { label: string; choices: readonly string[]; value: string; onChange: (value: string) => void }) {
    return <div role="group" aria-label={label} className="demo-choices">{choices.map(choice => <button type="button" key={choice} aria-pressed={choice === value} onClick={() => onChange(choice)}>{choice}</button>)}</div>;
}
export function DemoNotice({ text }: { text: string }) {
    return <div className="demo-notice" role="status">{text ? `演示操作：${text}，不会影响正式应用。` : ''}</div>;
}
export function useDemoNotice() {
    const [notice, setNotice] = useState('');
    return { notice, notify: setNotice };
}
export function DemoPanel({ title, children, open, onClose, className = '' }: { title: string; children: ReactNode; open: boolean; onClose: () => void; className?: string }) {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault(); onClose();
            document.querySelector<HTMLElement>('[data-demo-trigger]')?.focus();
        };
        const outside = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && !ref.current?.contains(target) && !target.closest('[data-demo-trigger]')) onClose();
        };
        document.addEventListener('keydown', close);
        document.addEventListener('pointerdown', outside, true);
        return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside, true); };
    }, [open, onClose]);
    if (!open) return null;
    return <section ref={ref} role="dialog" aria-label={title} className={`demo-panel ${className}`}>
        <header><h2>{title}</h2><IconButton label={`关闭${title}`} onClick={onClose}><X size={18} /></IconButton></header>{children}
    </section>;
}
