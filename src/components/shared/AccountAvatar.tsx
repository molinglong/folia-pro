import React from 'react';
import { resolveAccountAvatarInitial } from '../../utils/accountAvatar';

// src/components/shared/AccountAvatar.tsx
// Folia 账号头像（圆形）。有图就显示图，没有就用邮箱首字母占位：
// 占位底色与字色都跟 currentColor 走（浅底深字、深底浅字都自适应），不做彩色渐变——
// 这是账号自己的头像，不是平台徽章。
// 尺寸由 size 定（宿主也可以只在 className 里写宽高），装饰性：可访问名由外面的按钮给。

type AccountAvatarProps = {
    email: string | null;
    src: string | null;
    size?: number;
    className?: string;
};

const AccountAvatar: React.FC<AccountAvatarProps> = ({ email, src, size = 36, className }) => {
    const shell: React.CSSProperties = {
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
    };

    if (src) {
        return (
            <img
                src={src}
                alt=""
                aria-hidden
                draggable={false}
                data-account-avatar="image"
                className={className}
                style={{ ...shell, objectFit: 'cover' }}
            />
        );
    }

    return (
        <span
            aria-hidden
            data-account-avatar="initial"
            className={className}
            style={{
                ...shell,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'color-mix(in srgb, currentColor 14%, transparent)',
                fontWeight: 700,
                fontSize: Math.round(size * 0.42),
                lineHeight: 1,
                letterSpacing: '0.02em',
                userSelect: 'none',
            }}
        >
            {resolveAccountAvatarInitial(email)}
        </span>
    );
};

export default AccountAvatar;
