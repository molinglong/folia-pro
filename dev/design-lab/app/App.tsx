import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, FlaskConical, Layers3, Plus } from 'lucide-react';
import { catalog } from '../runtime/catalog';
import { getVariants } from '../runtime/catalogModel';
import { VIEWPORTS, type LabState } from '../types';
import { parseState, serializeState } from './urlState';
import { useLabClock } from './useLabClock';
import { Toolbar } from './Toolbar';
import { PreviewFrame } from './PreviewFrame';
import { CopyPrompt } from './CopyPrompt';
import { buildPrompt } from './prompt';

// dev/design-lab/app/App.tsx：只装配导航与比较区域；不装载任何正式应用模块。
export default function App() {
    const [resolved, setResolved] = useState(() => parseState(location.search, catalog));
    const [epoch, setEpoch] = useState(0);
    const clock = useLabClock();
    const { state } = resolved;
    const pages = catalog.templates.filter((t, index, all) => all.findIndex(item => item.id === t.id) === index);
    const experiments = catalog.experiments.filter(e => e.templateId === state.page);
    const experiment = experiments.find(e => e.id === state.experiment);
    const template = catalog.templates.find(t => t.id === state.page && (!experiment || t.version === experiment.templateVersion));
    const variants = getVariants(catalog, state.page, state.experiment);
    useEffect(() => { history.replaceState(null, '', serializeState(state)); }, [state]);
    useEffect(() => {
        const onPop = () => { clock.reset(); setEpoch(e => e + 1); setResolved(parseState(location.search, catalog)); };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [clock.reset]);
    const change = useCallback((patch: Partial<LabState>) => {
        if (patch.page !== undefined || patch.experiment !== undefined || patch.scene !== undefined) {
            clock.reset(); setEpoch(e => e + 1);
        }
        setResolved(previous => parseState(serializeState({ ...previous.state, ...patch }), catalog));
    }, [clock.reset]);
    const config = useMemo(() => ({ theme: state.theme, scene: state.scene, epoch, playing: clock.playing, reducedMotion: clock.reducedMotion }), [state.theme, state.scene, epoch, clock.playing, clock.reducedMotion]);
    const reset = () => { clock.reset(); setEpoch(e => e + 1); };
    const shown = state.mode === 'grid' ? variants : state.mode === 'single'
        ? variants.filter(v => v.id === state.left)
        : [variants.find(v => v.id === state.left), variants.find(v => v.id === state.right)].filter((v, i, all) => v && all.findIndex(x => x?.id === v.id) === i);
    const size = VIEWPORTS[state.device];
    if (!template) return <main className="empty-catalog"><h1>还没有可用模板</h1><p>请检查模板目录和元数据。</p>{catalog.issues.map(issue => <p key={issue}>{issue}</p>)}</main>;
    return <div className="lab-shell">
        <a className="skip-link" href="#workspace">跳到对比区域</a>
        <aside className="lab-sidebar">
            <a className="lab-brand" href="/"><Layers3 size={24} strokeWidth={1.4} /><div>Folia<span>DESIGN LAB</span></div></a>
            <div className="sidebar-heading">页面模板 <span>{String(pages.length).padStart(2, '0')}</span></div>
            <nav aria-label="页面模板">{pages.map((page, index) => <button
                key={page.id} aria-current={state.page === page.id ? 'page' : undefined}
                onClick={() => change({ page: page.id, experiment: '', scene: page.scenes[0].id, left: 'baseline', right: 'baseline', mode: 'single' })}
            ><span className="nav-index">{String(index + 1).padStart(2, '0')}</span>{page.title}<ArrowUpRight size={13} /></button>)}</nav>
            <div className="sidebar-note"><FlaskConical size={17} /><p>先试想法，再改产品。</p><span>独立原型 · 示例数据<br />不连接正式账户</span></div>
        </aside>
        <main className="lab-main" id="workspace">
            <header className="lab-header">
                <div><div className="eyebrow">页面试验 / {template.id}</div><h1>{template.title}<span className="version-label">{template.version}</span></h1><p>{template.description}</p></div>
                <CopyPrompt text={buildPrompt({ ...state, experiment: '' }, template)} label="复制新方案需求" />
            </header>
            {(resolved.issues.length > 0 || catalog.issues.length > 0) && <div className="lab-warning" role="alert">{[...resolved.issues, ...catalog.issues].map(issue => <p key={issue}>{issue}</p>)}</div>}
            <section className="experiment-row" aria-label="试验选择">
                <div><span className="status-dot" />{experiment ? '正在比较' : '模板预览'}</div>
                <select aria-label="选择试验" value={state.experiment} onChange={e => change({ experiment: e.target.value, left: 'baseline', right: e.target.value ? 'a' : 'baseline', mode: e.target.value ? 'split' : 'single' })}>
                    <option value="">基准模板 · 准备新试验</option>{experiments.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <span className="experiment-count">{variants.length} 个版本</span>
            </section>
            <Toolbar state={state} template={template} variants={variants} change={change} time={clock.time} playing={clock.playing} reducedMotion={clock.reducedMotion} toggle={() => clock.command({ action: 'toggle' })} seek={time => clock.command({ action: 'seek', time })} reset={reset} />
            <div className="canvas-caption"><span>{state.mode === 'single' ? '专注一个版本，体验细节' : '相同内容与画布，只比较设计差异'}</span><span>模拟环境 · 不播放声音{clock.reducedMotion ? ' · 已减少动态效果' : ''}</span></div>
            <section className={`preview-grid ${state.mode === 'single' || shown.length === 1 ? 'is-single' : ''}`} aria-label="方案对比">
                {shown.map(v => v && <PreviewFrame key={v.entryPath} variant={v} config={config} time={clock.time} width={size.width} height={size.height} onAction={clock.command} prompt={buildPrompt(state, template, v)} onFocus={() => change({ mode: 'single', left: v.id })} />)}
            </section>
            {!experiment && <div className="new-experiment"><Plus size={19} /><div><h2>下一轮想试什么？</h2><p>点击「复制新方案需求」，交给 AI 补上你的想法。它会从这一份模板创建独立的 A／B／C。</p></div></div>}
            <footer className="lab-footer"><span>基准参考版本 · {template.createdAt} · 公共素材 {template.sharedVersion}</span><details><summary>参考源码与使用边界</summary>{template.sourcePaths.map(p => <code key={p}>{p}</code>)}<p>此处为界面设计原型，不是实时正式页面，也不是性能测试。确认方案后，另行要求 AI 合并与验证。</p></details></footer>
        </main>
    </div>;
}
