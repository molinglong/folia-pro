import type { SongResult, StageSource } from '../../../types';
import type { GridViewCollectionDescriptor } from './gridViewCollectionAdapters';
import type { HomeSurfaceProps } from './homeSurfaceTypes';
import { resolveSearchSource, useSearchNavigationStore, type SearchSource } from '../../../stores/useSearchNavigationStore';
import i18n from '../../../i18n/config';
import type { ProviderAccountSummary } from '../../../types/onlineMusic';
import type { LibraryAccountController } from '../../../library/core/contracts/account';
import { openSettings } from '../../../stores/useSettingsModalStore';

// src/components/app/home/buildHomeModel.ts

export type HomeViewModel = {
    surfaceProps: HomeSurfaceProps;
    /** 在线账户 controller（App 持有，见 library/app/useLibraryAccountController），首页外壳交给首页 surface。 */
    account: LibraryAccountController;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    /** 跳到集合栈的第 depth 层（保留的层数，0 为整个关掉），浏览器历史同步退回；见 useAppNavigation 的 popCollectionTo。 */
    onPopCollectionTo: (depth: number) => void;
    onBackCollection: () => void;
};

// What this file can read for itself, so the caller never names it. See useHomeModel below.
type HomeModelAmbient = {
    currentSong: HomeSurfaceProps['currentTrack'];
    activePlaybackContext: 'main' | 'stage';
    navidromeEnabled: HomeSurfaceProps['navidromeEnabled'];
};

export type HomeModelDeps = {
    account: LibraryAccountController;
    /** controller 快照里的当前平台摘要（未变时身份稳定）；首页的账户与在线歌单优先取它。 */
    activeProvider?: ProviderAccountSummary;
    playSong: HomeSurfaceProps['onPlaySong'];
    navigateToPlayer: HomeSurfaceProps['onBackToPlayer'];
    navigateToLattice: NonNullable<HomeSurfaceProps['onOpenLattice']>;
    /** 墙上工具面板的宿主动作（library/app/useLibraryStageToolsPort，身份稳定）。 */
    stageTools?: HomeSurfaceProps['stageTools'];
    /** fb3：暂停 / 继续（应用的 togglePlay；useHomeModel 给它稳定身份）。 */
    togglePlayback: NonNullable<HomeSurfaceProps['onTogglePlayback']>;
    /** fb3：按「播放后进入的视图」进入播放视图（播放胶囊的同一个导航）。 */
    enterPlaybackView: NonNullable<HomeSurfaceProps['onEnterPlaybackView']>;
    refreshOnlineProviderPlaylists: () => Promise<unknown>;
    user: HomeSurfaceProps['user'];
    playlists: HomeSurfaceProps['playlists'];
    cloudPlaylist?: HomeSurfaceProps['cloudPlaylist'];
    focusedPlaylistIndex?: HomeSurfaceProps['focusedPlaylistIndex'];
    setFocusedPlaylistIndex?: HomeSurfaceProps['setFocusedPlaylistIndex'];
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean }) => void;
    localSongs: HomeSurfaceProps['localSongs'];
    localLibraryCatalog: HomeSurfaceProps['localLibraryCatalog'];
    localPlaylists: HomeSurfaceProps['localPlaylists'];
    onRefreshLocalSongs: HomeSurfaceProps['onRefreshLocalSongs'];
    onAddLocalSongToQueue?: HomeSurfaceProps['onAddLocalSongToQueue'];
    localMusicState: HomeSurfaceProps['localMusicState'];
    setLocalMusicState: HomeSurfaceProps['setLocalMusicState'];
    onAddNavidromeSongsToQueue?: HomeSurfaceProps['onAddNavidromeSongsToQueue'];
    navidromeFocusedAlbumIndex?: HomeSurfaceProps['navidromeFocusedAlbumIndex'];
    setNavidromeFocusedAlbumIndex?: HomeSurfaceProps['setNavidromeFocusedAlbumIndex'];
    stageSource?: StageSource | null;
    openStagePlayer: () => Promise<void>;
    theme: HomeSurfaceProps['theme'];
    playAll: (songs: SongResult[]) => void;
    addAllToQueue: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    addSongToQueue: (song: SongResult) => void;
    onStatusMessage?: HomeSurfaceProps['onStatusMessage'];
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onPopCollectionTo: (depth: number) => void;
    onBackCollection: () => void;
};

type BuildHomeModelParams = HomeModelAmbient & HomeModelDeps;

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    account,
    activeProvider,
    playSong,
    navigateToPlayer,
    navigateToLattice,
    stageTools,
    togglePlayback,
    enterPlaybackView,
    refreshOnlineProviderPlaylists,
    user,
    playlists,
    cloudPlaylist,
    currentSong,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    navigateToSearch,
    localSongs,
    localLibraryCatalog,
    localPlaylists,
    onRefreshLocalSongs,
    onAddLocalSongToQueue,
    localMusicState,
    setLocalMusicState,
    onAddNavidromeSongsToQueue,
    navidromeFocusedAlbumIndex,
    setNavidromeFocusedAlbumIndex,
    stageSource,
    activePlaybackContext,
    openStagePlayer,
    theme,
    navidromeEnabled,
    playAll,
    addAllToQueue,
    addSongToQueue,
    onStatusMessage,
    onOpenCollection,
    onPushCollection,
    onPopCollectionTo,
    onBackCollection,
}: BuildHomeModelParams): HomeViewModel => {
    return {
        account,
        onOpenCollection,
        onPushCollection,
        onPopCollectionTo,
        onBackCollection,
        surfaceProps: {
            onPlaySong: playSong,
            onBackToPlayer: navigateToPlayer,
            onOpenLattice: navigateToLattice,
            stageTools,
            onTogglePlayback: togglePlayback,
            onEnterPlaybackView: enterPlaybackView,
            onRefreshUser: () => refreshOnlineProviderPlaylists(),
            // An anonymous selected provider must not inherit a different platform's account.
            user: activeProvider ? activeProvider.user : user,
            playlists: activeProvider?.collections.filter(collection => collection.type !== 'cloud') ?? playlists,
            cloudPlaylist: activeProvider?.collections.find(collection => collection.type === 'cloud') ?? cloudPlaylist,
            currentTrack: currentSong,
            onPlayAll: playAll,
            onAddAllToQueue: addAllToQueue,
            onAddSongToQueue: addSongToQueue,
            onStatusMessage,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            onOpenSettings: openSettings,
            // 提交即搜：导航只带词不带请求，若先跳转再让浮层自己触发，用户要在结果页再按一次回车才出结果。
            // seam 全局搜索只有这一条路（grid 首页框自己先 submitSearch 再回调这里跳转）；同词同源自检
            // （isSearchOpen 且 query 已收进 store）说明刚提交过，不重复发请求，缓存命中也直接跳转。
            onSearchCommitted: (query, sourceTab, replace = false) => {
                const resolvedSource = resolveSearchSource(sourceTab);
                const trimmed = query.trim();
                const state = useSearchNavigationStore.getState();
                if (trimmed && state.searchSourceTab === resolvedSource && state.searchQuery === trimmed && state.isSearchOpen) {
                    navigateToSearch({ query: trimmed, sourceTab: resolvedSource, replace });
                    return;
                }
                void state.submitSearch({
                    query: trimmed,
                    sourceTab: resolvedSource,
                    deps: {
                        localSongs,
                        localLibraryCatalog,
                        t: (key, fallback) => i18n.t(key, fallback ?? ''),
                    },
                });
                navigateToSearch({ query: trimmed, sourceTab: resolvedSource, replace });
            },
            localSongs,
            localLibraryCatalog,
            localPlaylists,
            onRefreshLocalSongs,
            onAddLocalSongToQueue,
            localMusicState,
            setLocalMusicState,
            onAddNavidromeSongsToQueue,
            navidromeFocusedAlbumIndex,
            setNavidromeFocusedAlbumIndex,
            stageEnabled: Boolean(stageSource),
            stageIsActive: activePlaybackContext === 'stage',
            onOpenStagePlayer: () => {
                void openStagePlayer();
            },
            theme,
            navidromeEnabled,
        },
    };
};
