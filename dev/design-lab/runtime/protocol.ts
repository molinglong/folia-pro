import { DURATION, type SceneConfig } from '../types';

// dev/design-lab/runtime/protocol.ts：仅接收登记的场景消息，不执行代码或传输 HTML。
export const CHANNEL = 'folia-design-lab';
export const VERSION = 1;
export type FrameAction = { action: 'toggle' } | { action: 'seek'; time: number };
type Payload =
    | { type: 'ready' }
    | { type: 'config'; config: SceneConfig; time: number }
    | { type: 'tick'; time: number }
    | { type: 'action'; command: FrameAction };
export type LabMessage = Payload & { channel: typeof CHANNEL; version: typeof VERSION };
export const message = (payload: Payload): LabMessage => ({ channel: CHANNEL, version: VERSION, ...payload });
export const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= DURATION;
export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);

export function parseMessage(value: unknown): LabMessage | null {
    if (!isRecord(value) || value.channel !== CHANNEL || value.version !== VERSION) return null;
    if (value.type === 'ready') return message({ type: 'ready' });
    if (value.type === 'tick' && validTime(value.time)) return message({ type: 'tick', time: value.time });
    if (value.type === 'action' && isRecord(value.command)) {
        if (value.command.action === 'toggle') return message({ type: 'action', command: { action: 'toggle' } });
        if (value.command.action === 'seek' && validTime(value.command.time)) {
            return message({ type: 'action', command: { action: 'seek', time: value.command.time } });
        }
    }
    if (value.type === 'config' && isRecord(value.config) && validTime(value.time)) {
        const c = value.config;
        if ((c.theme === 'light' || c.theme === 'dark') && validId(c.scene)
            && Number.isSafeInteger(c.epoch) && (c.epoch as number) >= 0
            && typeof c.playing === 'boolean' && typeof c.reducedMotion === 'boolean') {
            return message({ type: 'config', config: c as SceneConfig, time: value.time });
        }
    }
    return null;
}
