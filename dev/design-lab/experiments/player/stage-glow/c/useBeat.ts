import { useEffect } from 'react';
import type { RefObject } from 'react';

// B/C 共用思路（各自目录里独立一份）：自包含模拟节拍源，每帧把包络写成 CSS 变量 --env / --sway，
// 光层纯 CSS 用变量做 scale/opacity/旋转——渲染线程消费，React 零重渲染。
// 真 App 接线时这里的节拍段整块替换为读全局 audioPower/bass 信号（MotionValue，.get() 即取）。
export function useStageBeat(target: RefObject<HTMLElement | null>, active: boolean, bpm = 96) {
    useEffect(() => {
        const el = target.current;
        if (!el) return;
        if (!active) { el.style.setProperty('--env', '0'); return; }
        let raf = 0, time = 0, env = 0, level = 0, beat = -1, clock = 0;
        let last = performance.now();
        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now; time += dt;
            clock += dt;
            const period = 60 / bpm;
            while (clock >= period) {
                clock -= period;
                beat = (beat + 1) % 4;
                level = beat === 0 ? 1 : beat === 2 ? 0.78 : 0.4;
            }
            level *= Math.exp(-dt / 0.16);
            const lfo = 0.5 + 0.5 * Math.sin(time * 0.25);
            const targetEnv = Math.min(1, level * (0.72 + 0.28 * lfo));
            // 快起峰慢衰减：30ms 追上鼓点，350ms 缓缓退去
            env += (targetEnv - env) * (targetEnv > env ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.35));
            el.style.setProperty('--env', env.toFixed(3));
            el.style.setProperty('--sway', (Math.sin(time * 0.8) + Math.sin(time * 1.9) * 0.5).toFixed(3));
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [target, active, bpm]);
}
