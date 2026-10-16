import { describe, expect, it } from 'vitest';
import { message, parseMessage } from '../runtime/protocol';

describe('版本化场景通信', () => {
    it('合法配置、时间、动作可往返', () => {
        const config = message({ type: 'config', time: 42, config: { theme: 'dark', scene: 'default', epoch: 2, playing: false, reducedMotion: false } });
        expect(parseMessage(config)).toEqual(config);
        for (const item of [message({ type: 'ready' }), message({ type: 'tick', time: 0 }), message({ type: 'action', command: { action: 'toggle' } }), message({ type: 'action', command: { action: 'seek', time: 240 } })]) expect(parseMessage(item)).toEqual(item);
    });
    it.each([null, [], {}, { channel: 'other', version: 1, type: 'ready' }, { ...message({ type: 'ready' }), version: 2 }, message({ type: 'tick', time: NaN }), message({ type: 'tick', time: -1 }), message({ type: 'tick', time: Infinity }), message({ type: 'tick', time: 241 }), { ...message({ type: 'ready' }), type: 'execute', code: 'bad' }])('丢弃无效载荷 %#', value => {
        expect(parseMessage(value)).toBeNull();
    });
    it('拒绝不安全场景名与错误字段类型', () => {
        const config = { theme: 'dark', scene: '../src', epoch: 0, playing: false, reducedMotion: false };
        expect(parseMessage({ ...message({ type: 'ready' }), type: 'config', config, time: 42 })).toBeNull();
        expect(parseMessage({ ...message({ type: 'ready' }), type: 'config', config: { ...config, scene: 'default', playing: 'true' }, time: 42 })).toBeNull();
    });
});
