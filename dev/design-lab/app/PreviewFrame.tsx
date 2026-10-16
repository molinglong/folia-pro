import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import type { PreviewVariant, SceneConfig } from '../types';
import { message, parseMessage, type FrameAction } from '../runtime/protocol';
import { CopyPrompt } from './CopyPrompt';

// dev/design-lab/app/PreviewFrame.tsx：保持 iframe 的逻辑尺寸，仅缩放外部画布。
type Props = {
    variant: PreviewVariant;
    config: SceneConfig;
    time: MotionValue<number>;
    width: number;
    height: number;
    prompt: string;
    onAction: (action: FrameAction) => void;
    onFocus: () => void;
};
export function PreviewFrame({ variant, config, time, width, height, prompt, onAction, onFocus }: Props) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const container = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState(480);
    const [availableHeight, setAvailableHeight] = useState(() => Math.max(320, window.innerHeight - 440));
    const [ready, setReady] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const sendConfig = useCallback(() => iframe.current?.contentWindow?.postMessage(message({ type: 'config', config, time: time.get() }), location.origin), [config, time]);
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow) return;
            const data = parseMessage(event.data);
            if (data?.type === 'ready') { setReady(true); setTimedOut(false); sendConfig(); }
            else if (data?.type === 'action') onAction(data.command);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [sendConfig, onAction]);
    useEffect(() => { sendConfig(); }, [sendConfig]);
    useEffect(() => {
        if (ready) return;
        const timer = setTimeout(() => setTimedOut(true), 20000);
        return () => clearTimeout(timer);
    }, [ready]);
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setAvailable(previous => Math.abs(previous - entry.contentRect.width) > 0.5 ? entry.contentRect.width : previous));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useMotionValueEvent(time, 'change', value => {
        if (ready) iframe.current?.contentWindow?.postMessage(message({ type: 'tick', time: value }), location.origin);
    });
    useEffect(() => {
        const resize = () => setAvailableHeight(Math.max(320, window.innerHeight - 440));
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    const scale = Math.min(1, Math.max(0.05, available / width), availableHeight / height);
    return <article className="preview-card" data-variant={variant.id}>
        <header className="preview-heading">
            <div className="variant-title"><span className="variant-tag">{variant.id === 'baseline' ? '原' : variant.id.toUpperCase()}</span><h2>{variant.title}</h2></div>
            <button className="icon-button" aria-label={`单独查看${variant.title}`} title="单独查看" onClick={onFocus}><Maximize2 size={15} /></button>
        </header>
        <div className="preview-description">{variant.description}</div>
        <div className="preview-canvas" ref={container}>
            {timedOut && <div className="lab-warning" role="alert">预览未能启动，请检查此方案的导入错误。<button onClick={() => { setReady(false); setTimedOut(false); iframe.current?.contentWindow?.location.reload(); }}>重试</button></div>}
            <div className="scaled-stage" style={{ width: width * scale, height: height * scale }}>
                <iframe
                    ref={iframe}
                    className="lab-frame"
                    title={`${variant.title}预览`}
                    src={`/frame.html?${new URLSearchParams({ entry: variant.entryPath })}`}
                    style={{ width, height, transform: `scale(${scale})` }}
                    onLoad={sendConfig}
                />
            </div>
        </div>
        <footer className="preview-footer">
            <span>{width} × {height} <span className="muted">· {Math.round(scale * 100)}%</span></span>
            <CopyPrompt text={prompt} label={`复制${variant.title}需求`} />
        </footer>
        <details className="source-path"><summary>方案文件</summary><code>dev/design-lab{variant.entryPath}</code></details>
    </article>;
}
