import type { AccountAvatarErrorCode } from './accountAvatarTypes';

// src/utils/accountAvatar.ts
// Folia 账号头像：把用户选的图片中心裁成方形、压到 192px 的 data URL（服务端只收 data URL，
// 见 sync-server/src/profile.ts），未设置时用邮箱首字母做占位（中性色，深浅底都合得来）。
// 压缩走 canvas，只在浏览器 / Electron 渲染进程里调用。

export const ACCOUNT_AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const ACCOUNT_AVATAR_PIXELS = 192;
/** 与服务端 MAX_AVATAR_LENGTH 对齐；超出就再压一档，仍超出则报错。 */
export const ACCOUNT_AVATAR_MAX_DATA_URL_LENGTH = 200_000;

const AVATAR_COMPRESSED_PIXELS = 128;

export class AccountAvatarError extends Error {
    code: AccountAvatarErrorCode;

    constructor(code: AccountAvatarErrorCode, message?: string) {
        super(message ?? code);
        this.name = 'AccountAvatarError';
        this.code = code;
    }
}

/** 邮箱首字母：foo.bar@x.com → F；中文 / emoji 取第一个码点；空邮箱退回 Folia 的 F。 */
export const resolveAccountAvatarInitial = (email: string | null | undefined): string => {
    const local = (email ?? '').split('@')[0].trim();
    const first = Array.from(local)[0];
    return first ? first.toUpperCase() : 'F';
};

const drawSquare = (bitmap: ImageBitmap, canvas: HTMLCanvasElement, pixels: number) => {
    const side = Math.min(bitmap.width, bitmap.height);
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext('2d');
    if (!context) throw new AccountAvatarError('process_failed');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        pixels,
        pixels,
    );
};

export const readAccountAvatarFile = async (file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) {
        throw new AccountAvatarError('not_image');
    }
    if (file.size > ACCOUNT_AVATAR_MAX_INPUT_BYTES) {
        throw new AccountAvatarError('too_large');
    }
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) {
        throw new AccountAvatarError('not_image');
    }
    try {
        const canvas = document.createElement('canvas');
        drawSquare(bitmap, canvas, ACCOUNT_AVATAR_PIXELS);
        let dataUrl = canvas.toDataURL('image/webp', 0.86);
        // 不支持 webp 的运行时 toDataURL 会退回 png；体积仍超限时缩到 128 再压一档。
        if (dataUrl.length > ACCOUNT_AVATAR_MAX_DATA_URL_LENGTH) {
            drawSquare(bitmap, canvas, AVATAR_COMPRESSED_PIXELS);
            dataUrl = canvas.toDataURL('image/webp', 0.7);
        }
        if (dataUrl.length > ACCOUNT_AVATAR_MAX_DATA_URL_LENGTH) {
            throw new AccountAvatarError('too_large');
        }
        return dataUrl;
    } finally {
        bitmap.close?.();
    }
};
