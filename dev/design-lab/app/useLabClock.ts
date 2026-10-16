import { useCallback, useEffect, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { DURATION } from '../types';
import type { FrameAction } from '../runtime/protocol';

// dev/design-lab/app/useLabClock.ts：单一模拟时间源；每秒最多广播 30 次，不逐帧更新 React。
export function useLabClock() {
    const time = useMotionValue(42);
    const [playing, setPlaying] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => { setReducedMotion(media.matches); setPlaying(false); };
        const onHidden = () => { if (document.hidden) setPlaying(false); };
        media.addEventListener('change', onChange);
        document.addEventListener('visibilitychange', onHidden);
        return () => { media.removeEventListener('change', onChange); document.removeEventListener('visibilitychange', onHidden); };
    }, []);
    useEffect(() => {
        if (!playing || reducedMotion) return;
        let frame = 0;
        const initialTime = time.get();
        const started = performance.now();
        let lastSent = started;
        const tick = (now: number) => {
            if (now - lastSent >= 1000 / 30) {
                time.set((initialTime + (now - started) / 1000) % DURATION);
                lastSent = now;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, reducedMotion, time]);
    const command = useCallback((action: FrameAction) => {
        if (action.action === 'toggle') setPlaying(p => reducedMotion ? false : !p);
        else { setPlaying(false); time.set(action.time); }
    }, [reducedMotion, time]);
    const reset = useCallback(() => { setPlaying(false); time.set(42); }, [time]);
    return { time, playing, reducedMotion, command, reset };
}
