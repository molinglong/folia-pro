import React from 'react';
import { motion } from 'framer-motion';
import { SlidersHorizontal, HardDrive, Trash2, RefreshCw, Crown, Cloud, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AudioQualityPreference, ProviderUser } from '../../types/onlineMusic';
import type { LibraryAccountController } from '../../library/core/contracts/account';
import { useLibraryAccountProviders } from '../../library/core/bindings/useLibraryAccount';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { useAccountSessionStore } from '../../stores/useAccountSessionStore';
import { omni } from '../../services/onlineMusic/omni';
import { syncNow } from '../../services/sync/syncCoordinator';
import { getSyncStatus, subscribeSyncStatus } from '../../services/sync/syncConfig';
import type { SyncRuntimeStatus } from '../../services/sync/syncTypes';
import AccountAuthForm from '../modal/settings/AccountAuthForm';
import CollapsibleCard from './CollapsibleCard';

interface AccountTabProps {
    user: ProviderUser | null;
    /** 在线账户 controller：登出走它（各 provider 自己的登出，与首页切换器同一条路径）。 */
    accountController: LibraryAccountController;
    audioQuality: AudioQualityPreference;
    onAudioQualityChange: (quality: AudioQualityPreference) => void;
    cacheSize: string;
    onClearCache: () => void;
    onSyncData: () => void;
    isSyncing: boolean;
    onNavigateHome: () => void;
}

const AUDIO_QUALITY_OPTIONS: Array<{
    value: AudioQualityPreference;
    labelKey: string;
}> = [
    { value: 'standard', labelKey: 'account.qualityStandard' },
    { value: 'high', labelKey: 'account.qualityExhigh' },
    { value: 'lossless', labelKey: 'account.qualityLossless' },
    { value: 'hires', labelKey: 'account.qualityHires' },
];

const AccountTab: React.FC<AccountTabProps> = ({
    user,
    accountController,
    audioQuality,
    onAudioQualityChange,
    cacheSize,
    onClearCache,
    onSyncData,
    isSyncing,
    onNavigateHome,
}) => {
    const { t } = useTranslation();
    // 当前平台取 controller 快照里回落过的那个。
    const { activeProviderId } = useLibraryAccountProviders(accountController);
    const providerAccount = useOnlineProviderAccountStore(state => state.accounts[activeProviderId]);
    const activeUser = providerAccount?.user || (activeProviderId === 'netease' ? user : null);

    // Folia 云同步账号卡：登录态常驻可见（docs/folia-account-entry-design.md）。
    // 同步状态从 syncStatus 订阅而来；服务器地址有内置默认值，无需在此判断配置。
    const accountSession = useAccountSessionStore();
    const [cloudSyncStatus, setCloudSyncStatus] = React.useState<SyncRuntimeStatus>(() => getSyncStatus());
    const [cloudSyncing, setCloudSyncing] = React.useState(false);

    React.useEffect(() => {
        const unsubscribeStatus = subscribeSyncStatus(() => setCloudSyncStatus(getSyncStatus()));
        return () => {
            unsubscribeStatus();
        };
    }, []);

    const handleCloudSyncNow = async () => {
        if (cloudSyncing) return;
        setCloudSyncing(true);
        try {
            // 只对账收藏域；主题/设置的同步按钮仍在存储区，各自语义不混淆。
            await syncNow({ syncThemes: false, applyRemoteSettings: false, pushSettings: false, syncCollections: true });
        } finally {
            setCloudSyncing(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col justify-start gap-4 h-full"
        >
            {/* Folia 云同步账号卡：登录态与同步入口常驻，表单与存储区共用 AccountAuthForm。 */}
            <div className="bg-white/5 p-3 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 opacity-60">
                        <Cloud size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">
                            {t('account.foliaTitle')}
                        </span>
                    </div>
                    {accountSession.status === 'signed-in' && cloudSyncStatus.lastSyncAt && (
                        <span className="text-[10px] opacity-50 truncate">
                            {t('account.foliaLastSync', { time: new Date(cloudSyncStatus.lastSyncAt).toLocaleString() })}
                        </span>
                    )}
                </div>

                {/* 未登录只留一颗「登录 / 注册」，邮箱 / 密码在 AccountAuthDialog 弹窗里；登录成功自动同步。 */}
                <AccountAuthForm
                    errorTextColor="text-red-400"
                    signedInExtras={(
                        <button
                            type="button"
                            onClick={() => void handleCloudSyncNow()}
                            disabled={cloudSyncing}
                            className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center gap-2 text-xs font-bold opacity-80 transition-colors disabled:opacity-50"
                        >
                            {cloudSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {cloudSyncing ? t('account.foliaSyncing') : t('account.foliaSyncNow')}
                        </button>
                    )}
                />
            </div>

            {activeUser ? (
                /* User Info in Header */
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden">
                            <img
                                src={activeUser.avatarUrl?.replace('http:', 'https:')}
                                className="w-full h-full object-cover"
                                alt={activeUser.nickname}
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <h3 className="font-bold text-sm">{activeUser.nickname}</h3>
                                {Boolean(activeUser.vipType && activeUser.vipType !== 0) && (
                                    <Crown size={14} className="text-white fill-white" />
                                )}
                            </div>
                            <span className="block text-[10px] opacity-50">{omni.getProviderLabel(activeProviderId)}</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-4 text-center opacity-50">
                    <p>{t('account.guestMode')}</p>
                    <button
                        onClick={onNavigateHome}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold"
                    >
                        {t('account.loginOnHome')}
                    </button>
                </div>
            )}

            {/* Provider-independent audio quality preference; each online provider maps these semantic presets. */}
            <CollapsibleCard
                className="bg-white/5 p-3 rounded-xl"
                bodyClassName="mt-2"
                title={
                    <div className="flex items-center gap-2 opacity-60">
                        <SlidersHorizontal size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">
                            {t('account.audioQuality')}
                        </span>
                    </div>
                }
            >
                <div className="grid grid-cols-2 gap-2">
                    {AUDIO_QUALITY_OPTIONS.map(option => (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={audioQuality === option.value}
                            onClick={() => onAudioQualityChange(option.value)}
                            className={`py-1.5 text-[10px] font-medium rounded-lg transition-all ${audioQuality === option.value
                                ? 'bg-white/20 shadow-sm'
                                : 'opacity-40 hover:opacity-100 hover:bg-white/5'
                                }`}
                        >
                            {t(option.labelKey)}
                        </button>
                    ))}
                </div>
            </CollapsibleCard>

            {/* Cache Management Section */}
            {/* <div className="bg-white/5 p-3 rounded-xl mb-2">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 opacity-60">
                        <HardDrive size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">
                            {t('account.storage')}
                        </span>
                    </div>
                    <span className="text-[10px] font-mono">{cacheSize}</span>
                </div>
                <button
                    onClick={onClearCache}
                    className="w-full py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold transition-colors"
                >
                    <Trash2 size={12} />
                    {t('account.clearCache')}
                </button>
            </div> */}

            {activeUser && <button
                onClick={onSyncData}
                disabled={isSyncing}
                className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center gap-2 text-xs font-bold opacity-80 transition-colors disabled:opacity-50"
            >
                <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? t('account.syncing') : t('account.syncData')}
            </button>}
        </motion.div>
    );
};

export default AccountTab;

