import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Cloud, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AccountAuthFields from './AccountAuthFields';
import './accountAuthDialog.css';

// src/components/modal/settings/AccountAuthDialog.tsx
// Folia 账号的登录 / 注册弹窗：首页平台列表、设置存储区、侧栏账号页三处共用这一份。
// 挂到应用根（AppShell，找不到再退 body）：首页的缝带 transform，就地 fixed 会跟着跑偏；挂根上还能继承
// `--bg-color` / `--text-primary`，日光 / 深色主题的底色与文字自然跟着切。
// data-account-auth-dialog 让平台列表的外点收起逻辑放行——点弹窗不算「点别处」，登录完列表还在。
// Esc 挂在 document 捕获阶段：先收弹窗并截断传播，避免同一次按键又让设置页 / 平台列表跟着收起。

type AccountAuthDialogProps = {
    open: boolean;
    onClose: () => void;
    /** 错误文案强调色（设置页传 errorTextColor，列表里用 text-red-400）。 */
    errorTextColor?: string;
};

const AccountAuthDialog: React.FC<AccountAuthDialogProps> = ({
    open,
    onClose,
    errorTextColor = 'text-red-400',
}) => {
    const { t } = useTranslation();

    React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [open, onClose]);

    const portalHost = typeof document === 'undefined'
        ? null
        : (document.querySelector<HTMLElement>('[data-app-shell]') ?? document.body);
    if (!portalHost) return null;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    data-account-auth-dialog
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xl"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) onClose();
                    }}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('ui.storage.accountTitle') || 'Folia Account'}
                        initial={{ opacity: 0, scale: 0.94, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: 10 }}
                        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                        className="account-auth-dialog-card relative w-full max-w-sm rounded-3xl border p-6 shadow-2xl"
                        style={{
                            background: 'color-mix(in srgb, var(--bg-color, #0b0b0d) 94%, var(--text-primary, #f7f4ee))',
                            borderColor: 'color-mix(in srgb, var(--text-primary, #f7f4ee) 14%, transparent)',
                            color: 'var(--text-primary, #f7f4ee)',
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('ui.close') || 'Close'}
                            title={t('ui.close') || 'Close'}
                            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full opacity-45 transition-opacity hover:opacity-90"
                            style={{ background: 'color-mix(in srgb, var(--text-primary, #f7f4ee) 8%, transparent)' }}
                        >
                            <X size={16} />
                        </button>
                        {/* 图标与标题同一行居中；说明整行放下方——说明有两三行时不会把图标挤得比标题低。 */}
                        <div className="mb-4 pr-8">
                            <div className="flex items-center gap-3">
                                <span
                                    className="grid h-10 w-10 flex-none place-items-center rounded-full"
                                    style={{ background: 'color-mix(in srgb, var(--text-primary, #f7f4ee) 10%, transparent)' }}
                                    aria-hidden
                                >
                                    <Cloud size={20} />
                                </span>
                                <div className="min-w-0 text-base font-bold leading-tight">
                                    {t('ui.storage.accountTitle') || 'Folia Account'}
                                </div>
                            </div>
                            <div
                                className="mt-2.5 text-[11px] leading-snug"
                                style={{ color: 'var(--text-secondary, color-mix(in srgb, var(--text-primary, #f7f4ee) 60%, transparent))' }}
                            >
                                {t('ui.storage.accountDesc') || 'Sign in to sync playlists and likes across devices.'}
                            </div>
                        </div>
                        <AccountAuthFields errorTextColor={errorTextColor} onSuccess={onClose} />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        portalHost,
    );
};

export default AccountAuthDialog;
