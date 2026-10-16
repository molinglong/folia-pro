import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { useMotionValue } from 'framer-motion';
import type { SceneConfig } from '../types';
import { message, parseMessage, type FrameAction } from './protocol';
import { FrameBoundary, FrameError } from './FrameBoundary';
import { SceneProvider } from './scene';
import '../shared/v1/base.css';

// dev/design-lab/runtime/frame.tsx：独立预览宿主；路径必须在编译期目录白名单内。
const modules = import.meta.glob<{ default: ComponentType }>(['/templates/*/*/View.tsx', '/experiments/*/*/*/View.tsx']);
const path = new URLSearchParams(window.location.search).get('entry') ?? '';
const loader = modules[path];
const View = loader ? lazy(loader) : null;
const INITIAL: SceneConfig = { theme: 'light', scene: 'default', epoch: 0, playing: false, reducedMotion: false };

function Frame() {
    const [config, setConfig] = useState(INITIAL);
    const [runtimeError, setRuntimeError] = useState<string | null>(null);
    const time = useMotionValue(42);
    const command = useCallback((action: FrameAction) => {
        if (window.parent !== window) window.parent.postMessage(message({ type: 'action', command: action }), window.location.origin);
    }, []);
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin !== window.location.origin || window.parent === window) return;
            const data = parseMessage(event.data);
            if (data?.type === 'config') {
                time.set(data.time);
                setConfig(data.config);
            } else if (data?.type === 'tick') time.set(data.time);
        };
        window.addEventListener('message', onMessage);
        if (window.parent !== window) window.parent.postMessage(message({ type: 'ready' }), window.location.origin);
        return () => window.removeEventListener('message', onMessage);
    }, [time]);
    useEffect(() => {
        document.documentElement.dataset.theme = config.theme;
        document.documentElement.dataset.reducedMotion = String(config.reducedMotion);
        document.documentElement.dataset.playing = String(config.playing);
    }, [config.theme, config.reducedMotion, config.playing]);
    useEffect(() => {
        const onError = (event: ErrorEvent) => setRuntimeError(event.message);
        const onRejection = (event: PromiseRejectionEvent) => setRuntimeError(String(event.reason));
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, []);
    const value = useMemo(() => ({ ...config, time, command }), [config, time, command]);
    if (!View || runtimeError) return <FrameError path={path} error={runtimeError ?? '未登记的方案路径，或方案缺少 View.tsx。'} />;
    return <SceneProvider value={value}>
        <FrameBoundary key={`${path}:${config.scene}:${config.epoch}`} path={path}>
            <Suspense fallback={<p className="frame-loading" role="status">正在准备方案…</p>}>
                <View />
            </Suspense>
        </FrameBoundary>
    </SceneProvider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Frame /></StrictMode>);
