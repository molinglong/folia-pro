import { describe, expect, it } from 'vitest';
import { resolveAccountAvatarInitial } from '@/utils/accountAvatar';

// test/unit/utils/accountAvatar.test.ts
// 未设置头像时的占位字母：取邮箱 @ 前第一个码点（中文 / emoji 也各算一个），空邮箱退回 F。

describe('resolveAccountAvatarInitial', () => {
    it('takes the first letter of the local part, upper-cased', () => {
        expect(resolveAccountAvatarInitial('someone@example.com')).toBe('S');
        expect(resolveAccountAvatarInitial('  alice@example.com ')).toBe('A');
    });

    it('keeps non-latin and emoji as one code point', () => {
        expect(resolveAccountAvatarInitial('小明@example.com')).toBe('小');
        expect(resolveAccountAvatarInitial('🍵tea@example.com')).toBe('🍵');
    });

    it('falls back to F when there is nothing to take', () => {
        expect(resolveAccountAvatarInitial(null)).toBe('F');
        expect(resolveAccountAvatarInitial('')).toBe('F');
        expect(resolveAccountAvatarInitial('@example.com')).toBe('F');
    });
});
