import React from 'react';
import { Loader2, LogIn, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';

// src/components/modal/settings/AccountAuthForm.tsx
// Folia 账号的登录/注册/登出交互：设置页存储区与侧栏账号页共用同一份状态机与文案。
// 同步服务器地址有内置默认值（syncConfig），表单不再依赖宿主注入“地址是否就绪”。
// 登录态读写全部走 useAccountSessionStore，本组件不自持任何会话状态。

type AccountAuthFormProps = {
    /** 错误文案强调色（沿用宿主 errorTextColor 配方）。 */
    errorTextColor: string;
    /** 已登录态追加在邮箱行之后的内容（账号页放同步状态与立即同步；存储区不需要）。 */
    signedInExtras?: React.ReactNode;
};

const AccountAuthForm: React.FC<AccountAuthFormProps> = ({
    errorTextColor,
    signedInExtras,
}) => {
    const { t } = useTranslation();
    const accountSession = useAccountSessionStore();
    const [authMode, setAuthMode] = React.useState<'sign-in' | 'sign-up'>('sign-in');
    const [authEmail, setAuthEmail] = React.useState('');
    const [authPassword, setAuthPassword] = React.useState('');

    const authErrorCodeText = (code: string): string => {
        switch (code) {
            case 'invalid_credentials':
                return t('ui.storage.accountErrorInvalidCredentials') || 'Email or password is incorrect';
            case 'email_taken':
                return t('ui.storage.accountErrorEmailTaken') || 'This email is already registered';
            case 'rate_limited':
                return t('ui.storage.accountErrorRateLimited') || 'Too many attempts, try again later';
            case 'registration_disabled':
                return t('ui.storage.accountErrorRegistrationDisabled') || 'Registration is disabled on this server';
            case 'network_error':
                return t('ui.storage.accountErrorNetwork') || 'Cannot reach the sync server';
            default:
                return t('ui.storage.accountErrorGeneric') || 'Sign in failed';
        }
    };

    const handleAuthSubmit = async () => {
        if (accountSession.busy || !authEmail.trim() || !authPassword) return;
        const succeeded = authMode === 'sign-in'
            ? await accountSession.signIn(authEmail, authPassword)
            : await accountSession.signUp(authEmail, authPassword);
        if (succeeded) {
            setAuthPassword('');
        }
    };

    const handleSwitchAuthMode = () => {
        setAuthMode(prev => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
        accountSession.clearError();
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
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 bg-black/10 rounded-lg border border-white/5 px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{accountSession.email}</div>
                        <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('ui.storage.accountSignedIn') || 'Signed in — playlists and likes sync to this account.'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => { void accountSession.signOut(); }}
                        disabled={accountSession.busy}
                        className={`shrink-0 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-1.5 disabled:opacity-40 ${errorTextColor}`}
                    >
                        {accountSession.busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                        {t('ui.storage.accountSignOut') || 'Sign out'}
                    </button>
                </div>
                {signedInExtras}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                    type="email"
                    autoComplete="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder={t('ui.storage.accountEmail') || 'Email'}
                    className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                    style={{ color: 'var(--text-primary)' }}
                />
                <input
                    type="password"
                    autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleAuthSubmit();
                    }}
                    placeholder={t('ui.storage.accountPassword') || 'Password'}
                    className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                    style={{ color: 'var(--text-primary)' }}
                />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => void handleAuthSubmit()}
                    disabled={accountSession.busy || !authEmail.trim() || !authPassword}
                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {accountSession.busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                    {authMode === 'sign-in'
                        ? (t('ui.storage.accountSignIn') || 'Sign in')
                        : (t('ui.storage.accountSignUp') || 'Sign up')}
                </button>
                <button
                    type="button"
                    onClick={handleSwitchAuthMode}
                    className="text-xs opacity-60 hover:opacity-90 underline underline-offset-2 transition-opacity"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {authMode === 'sign-in'
                        ? (t('ui.storage.accountSwitchToSignUp') || 'No account? Sign up')
                        : (t('ui.storage.accountSwitchToSignIn') || 'Have an account? Sign in')}
                </button>
            </div>
            {accountSession.errorCode && (
                <div className="text-xs rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    <span className={errorTextColor}>{authErrorCodeText(accountSession.errorCode)}</span>
                </div>
            )}
        </div>
    );
};

export default AccountAuthForm;
