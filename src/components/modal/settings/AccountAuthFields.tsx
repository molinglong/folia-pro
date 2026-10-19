import React from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountSessionStore } from '../../../stores/useAccountSessionStore';

// src/components/modal/settings/AccountAuthFields.tsx
// Folia 账号的邮箱 / 密码表单本体：登录与注册共用一套字段（下方链接切换模式）。
// 现在只出现在登录弹窗（AccountAuthDialog）里——宿主页不再内嵌表单，只留一颗「登录 / 注册」按钮。
// 字段配色交给 accountAuthDialog.css（跟 --text-primary 走，深色设置弹窗与日光主题共用一份）。

type AccountAuthFieldsProps = {
    /** 错误文案强调色（沿用宿主的 errorTextColor 配方）。 */
    errorTextColor: string;
    /** 登录 / 注册成功（弹窗据此收起）。 */
    onSuccess?: () => void;
};

const AccountAuthFields: React.FC<AccountAuthFieldsProps> = ({ errorTextColor, onSuccess }) => {
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
            onSuccess?.();
        }
    };

    const handleSwitchAuthMode = () => {
        setAuthMode(prev => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
        accountSession.clearError();
    };

    return (
        <div className="space-y-2">
            <input
                type="email"
                autoComplete="email"
                autoFocus
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder={t('ui.storage.accountEmail') || 'Email'}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
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
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
            />
            <button
                type="button"
                onClick={() => void handleAuthSubmit()}
                disabled={accountSession.busy || !authEmail.trim() || !authPassword}
                className="account-auth-primary flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
                {accountSession.busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                {authMode === 'sign-in'
                    ? (t('ui.storage.accountSignIn') || 'Sign in')
                    : (t('ui.storage.accountSignUp') || 'Sign up')}
            </button>
            <button
                type="button"
                onClick={handleSwitchAuthMode}
                className="account-auth-switch text-xs underline underline-offset-2 transition-opacity hover:opacity-90"
            >
                {authMode === 'sign-in'
                    ? (t('ui.storage.accountSwitchToSignUp') || 'No account? Sign up')
                    : (t('ui.storage.accountSwitchToSignIn') || 'Have an account? Sign in')}
            </button>
            {accountSession.errorCode && (
                <div className="text-xs rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                    <span className={errorTextColor}>{authErrorCodeText(accountSession.errorCode)}</span>
                </div>
            )}
        </div>
    );
};

export default AccountAuthFields;
