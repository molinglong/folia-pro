import { createContext, useContext, type ReactNode } from 'react';
import type { MotionValue } from 'framer-motion';
import type { SceneConfig } from '../types';
import type { FrameAction } from './protocol';

// dev/design-lab/runtime/scene.tsx：方案只获得内存场景和模拟时钟，没有真实业务端口。
export type SceneRuntime = SceneConfig & { time: MotionValue<number>; command: (action: FrameAction) => void };
const Context = createContext<SceneRuntime | null>(null);
export function SceneProvider({ value, children }: { value: SceneRuntime; children: ReactNode }) {
    return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useScene(): SceneRuntime {
    const value = useContext(Context);
    if (!value) throw new Error('方案必须在设计试验台的预览环境中打开。');
    return value;
}
