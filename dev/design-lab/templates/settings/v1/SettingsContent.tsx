import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Choice, Toggle } from '../../../shared/v1/primitives';
import { SETTINGS, type SectionId } from '../../../shared/v1/settings';
import styles from './style.module.css';

// dev/design-lab/templates/settings/v1/SettingsContent.tsx：设置字段的本地副本，可随方案独立调整。
export function SettingsContent({ section, focused = false }: { section: SectionId; focused?: boolean }) {
    const [closed, setClosed] = useState<string[]>(focused ? SETTINGS[section].slice(1).map(g => g.id) : []);
    const [values, setValues] = useState<Record<string, boolean | number | string>>({});
    const change = (id: string, value: boolean | number | string) => setValues(v => ({ ...v, [id]: value }));
    return <div className={styles.groups}>{SETTINGS[section].map(group => <section className={styles.card} key={group.id}>
        <button className={styles.cardHeader} aria-expanded={!closed.includes(group.id)} onClick={() => setClosed(v => v.includes(group.id) ? v.filter(id => id !== group.id) : [...v, group.id])}>
            <span><strong>{group.title}</strong><small>{group.description}</small></span><ChevronDown size={18} style={{ transform: closed.includes(group.id) ? 'rotate(-90deg)' : undefined }} />
        </button>
        {!closed.includes(group.id) && <div className={styles.fields}>{group.fields.map(field => {
            const current = values[field.id] ?? field.initial;
            if (field.kind === 'switch') return <Toggle key={field.id} label={field.label} description={field.description} value={Boolean(current)} onChange={value => change(field.id, value)} />;
            return <div key={field.id} className={styles.field}>
                <label htmlFor={field.id}>{field.label}{field.kind === 'range' && <span>{current}{field.unit}</span>}</label><small>{field.description}</small>
                {field.kind === 'choice'
                    ? <Choice label={field.label} choices={field.choices} value={String(current)} onChange={value => change(field.id, value)} />
                    : <input id={field.id} type="range" min={field.min} max={field.max} value={Number(current)} onChange={e => change(field.id, Number(e.target.value))} />}
            </div>;
        })}</div>}
    </section>)}</div>;
}
