import React from 'react';
import { Camera, Loader2, LogIn, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';
import AccountAvatar from '../../shared/AccountAvatar';
import { AccountAvatarError, readAccountAvatarFile } from '../../../utils/accountAvatar';
import type { AccountAvatarErrorCode } from '../../../utils/accountAvatarTypes';
import AccountAuthDialog from './AccountAuthDialog';

// src/components/modal/settings/AccountAuthForm.tsx
// Folia 账号的展示与登出：设置存储区、侧栏账号页与首页平台列表共用。
// 登录 / 注册统一收进 AccountAuthDialog：未登录只留一颗「登录 / 注册」按钮，表单不再内嵌。
// 登录态读写全部走 useAccountSessionStore，本组件不自持任何会话状态。
// 已登录那一行带账号头像（点一下选图：裁成方形、压到 192px、传 /account/profile）。

type AccountAuthFormProps = {
    /** 错误文案强调色（沿用宿主 errorTextColor 配方）。 */
    errorTextColor: string;
    /** 已登录态追加在邮箱行之后的内容（账号页放同步状态与立即同步；存储区不需要）。 */
    signedInExtras?: React.ReactNode;
    /**
     * 窄容器（首页平台列表的 Folia 区块，约 270px）：名称 / 邮箱两行、登出收成图标圆。
     * 列表的未登录入口由 BravaisFoliaAccount 自己渲染，stacked 的未登录态返回 null。
     */
    stacked?: boolean;
};

const AccountAuthForm: React.FC<AccountAuthFormProps> = ({
    errorTextColor,
    signedInExtras,
    stacked = false,
}) => {
    const { t } = useTranslation();
    const accountSession = useAccountSessionStore();
    const avatarInputRef = React.useRef<HTMLInputElement>(null);
    const [avatarFileError, setAvatarFileError] = React.useState<AccountAvatarErrorCode | null>(null);
    const [authDialogOpen, setAuthDialogOpen] = React.useState(false);

    const avatarHint = accountSession.avatar
        ? (t('ui.storage.accountAvatarChange') || 'Change avatar')
        : (t('ui.storage.accountAvatarAdd') || 'Set avatar');

    const avatarErrorText = (): string | null => {
        const code = avatarFileError ?? accountSession.avatarErrorCode;
        if (!code) return null;
        switch (code) {
            case 'not_image':
                return t('ui.storage.accountAvatarInvalid') || 'Choose an image file';
            case 'too_large':
                return t('ui.storage.accountAvatarTooLarge') || 'That image is too large';
            default:
                return t('ui.storage.accountAvatarFailed') || 'Could not update the avatar';
        }
    };

    // 选图 → 本地裁方形 / 压到 192px → PATCH /account/profile；上传中头像上盖一层转圈。
    const handleAvatarPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 同一张图再选一次也要触发 change：先清空 input。
        event.target.value = '';
        if (!file) return;
        setAvatarFileError(null);
        accountSession.clearAvatarError();
        try {
            const dataUrl = await readAccountAvatarFile(file);
            await accountSession.updateAvatar(dataUrl);
        } catch (error) {
            setAvatarFileError(error instanceof AccountAvatarError ? error.code : 'process_failed');
        }
    };

    if (accountSession.status === 'hydrating') {
        return (
            <div className="flex items-center gap-2 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={14} className="animate-spin" />
                {t('ui.storage.accountHydrating') || 'Checking session...'}
            </div>
        );
    }

    if (accountSession.status === 'signed-in') {
        // 一行：头像 / 名称 + 邮箱 / 登出。列表（stacked）里名称与邮箱上下两行，和平台行同一节奏，
        // 外层不再多一行入口；设置页仍只显示邮箱，说明另起一行。
        // 头像悬停 / 键盘聚焦时右下角浮出相机角标，提示可点换图。
        const signedInRow = (
            <>
                <button
                    type="button"
                    className="account-avatar-button group relative shrink-0 rounded-full p-0 border-0 bg-transparent transition-opacity hover:opacity-85 disabled:opacity-60"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={accountSession.avatarBusy}
                    aria-label={avatarHint}
                    title={avatarHint}
                >
                    <AccountAvatar email={accountSession.email} src={accountSession.avatar} size={stacked ? 40 : 36} />
                    <span
                        className="pointer-events-none absolute -right-0.5 -bottom-0.5 grid h-4 w-4 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        style={{
                            background: 'var(--bg-color, #111)',
                            border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
                            color: 'var(--text-secondary)',
                        }}
                        aria-hidden
                    >
                        <Camera size={8} />
                    </span>
                    {accountSession.avatarBusy && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45" aria-hidden>
                            <Loader2 size={14} className="animate-spin" />
                        </span>
                    )}
                </button>
                {stacked ? (
                    // 列表里：名称 + 邮箱两行。
                    <span className="bravais-account-folia-text min-w-0 flex-1">
                        <span className="bravais-account-folia-name truncate">{t('account.foliaTitle')}</span>
                        <span className="bravais-account-folia-mail truncate" title={accountSession.email ?? undefined}>
                            {accountSession.email || (t('ui.storage.accountSignedInOnly') || 'Signed in')}
                        </span>
                    </span>
                ) : (
                    <div className="min-w-0 flex-1 truncate text-sm font-medium" title={accountSession.email ?? undefined} style={{ color: 'var(--text-primary)' }}>
                        {accountSession.email || (t('ui.storage.accountSignedInOnly') || 'Signed in')}
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => { void accountSession.signOut(); }}
                    disabled={accountSession.busy}
                    aria-label={t('ui.storage.accountSignOut') || 'Sign out'}
                    title={t('ui.storage.accountSignOut') || 'Sign out'}
                    className={stacked
                        // 窄容器只留 32px 的图标圆（同平台行的登出），把宽度让给邮箱。
                        ? `account-logout-button shrink-0 grid h-8 w-8 place-items-center rounded-full text-xs transition-colors disabled:opacity-40 ${errorTextColor}`
                        : `shrink-0 px-2.5 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-1.5 disabled:opacity-40 ${errorTextColor}`}
                >
                    {accountSession.busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                    {!stacked && (t('ui.storage.accountSignOut') || 'Sign out')}
                </button>
            </>
        );
        return (
            <div className="space-y-2">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                    data-account-avatar-input onChange={(event) => void handleAvatarPicked(event)} />
                {stacked ? (
                    // 列表里：头像与平台行同尺寸（40），左右各留 10 与平台行的内边距对齐。
                    <div className="flex items-center gap-3 px-2.5 py-2">{signedInRow}</div>
                ) : (
                    <div className="bg-black/10 rounded-lg border border-white/5 px-3 py-2">
                        <div className="flex items-center gap-3">{signedInRow}</div>
                        <div className="mt-1.5 text-[11px] leading-snug opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('ui.storage.accountSignedIn') || 'Signed in — playlists and likes sync to this account.'}
                        </div>
                    </div>
                )}
                {avatarErrorText() && (
                    <div className="text-xs rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                        <span className={errorTextColor}>{avatarErrorText()}</span>
                    </div>
                )}
                {signedInExtras}
            </div>
        );
    }

    // 未登录：表单收进弹窗，这里只留一颗入口按钮。
    // 平台列表（stacked）的未登录入口由 BravaisFoliaAccount 渲染在标题行右侧。
    if (stacked) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setAuthDialogOpen(true)}
                className="account-auth-open inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors"
            >
                <LogIn size={14} />
                {t('ui.storage.accountSignInOrSignUp') || 'Sign in / Sign up'}
            </button>
            <AccountAuthDialog
                open={authDialogOpen}
                onClose={() => setAuthDialogOpen(false)}
                errorTextColor={errorTextColor}
            />
        </>
    );
};

export default AccountAuthForm;
