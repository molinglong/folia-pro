import React from 'react';
import { motion } from 'framer-motion';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { Globe, ListEnd, ListPlus, PanelsTopLeft, Play, Shuffle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult } from '../../types';
import TextInputDialog from '../shared/TextInputDialog';
import { getSongUnavailableLabel, isSongUnavailable } from '../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/components/panelTab/QueueTab.tsx

interface QueueTabProps {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    /**
     * 点一行不再直接切歌，而是把这一首交给面板预览（上方封面换成它、这一行浮出播放键）。
     * 不给就退回老行为：点行即播。
     */
    onPreviewSong?: (song: SongResult) => void;
    /** 正在预览的那首的 key；那一行会一直亮着播放键，不必等指针悬上去。 */
    previewSongKey?: string | null;
    queueScrollRef: React.RefObject<HTMLDivElement | null>;
    shouldScrollToCurrent?: boolean;
    onShuffle?: () => void;
    onRemoveSong: (index: number) => void;
    onMoveSongToEnd: (index: number) => void;
    onMoveSongToNext: (index: number) => void;
    /** Manual cross-platform switch for greyed-out rows: searches the other logged-in platforms
     *  on click and replaces/plays (or confirms) the best match. Absent where the host has no
     *  such action wired (stage context, palette), so the row simply does not offer it. */
    onRequestCrossPlatformReplacement?: (song: SongResult, queue: SongResult[]) => void | Promise<boolean>;
    canSaveLocalPlaylist?: boolean;
    /** Opens the same queue as a poster wall; absent when the host has no wall to show. */
    onOpenLattice?: () => void;
    onSaveCurrentQueueAsPlaylist?: (name: string) => Promise<void>;
    isDaylight?: boolean;
}

type QueueRowProps = {
    playQueue: SongResult[];
    currentSongKey: string | null;
    onPlaySong: QueueTabProps['onPlaySong'];
    onPreviewSong?: QueueTabProps['onPreviewSong'];
    previewSongKey?: string | null;
    onMoveSongToNext: QueueTabProps['onMoveSongToNext'];
    onMoveSongToEnd: QueueTabProps['onMoveSongToEnd'];
    onRequestCrossPlatformReplacement?: QueueTabProps['onRequestCrossPlatformReplacement'];
    onRemoveSong: QueueTabProps['onRemoveSong'];
    isDaylight: boolean;
    labels: {
        unavailable: string;
        play: string;
        playNext: string;
        moveToEnd: string;
        remove: string;
        playOnOtherPlatform: string;
    };
};

// Kept outside QueueTab so track changes update row data without remounting hovered action buttons.
const QueueRow = ({
    index,
    style,
    ariaAttributes,
    playQueue,
    currentSongKey,
    onPlaySong,
    onPreviewSong,
    previewSongKey,
    onMoveSongToNext,
    onMoveSongToEnd,
    onRequestCrossPlatformReplacement,
    onRemoveSong,
    isDaylight,
    labels,
}: RowComponentProps<QueueRowProps>): React.ReactElement => {
    const song = playQueue[index];
    const songKey = getPlaybackSongKey(song);
    const isActive = currentSongKey === songKey;
    const isPreviewed = !isActive && !!previewSongKey && songKey === previewSongKey;
    const isUnavailable = isSongUnavailable(song);
    const unavailableTagText = getSongUnavailableLabel(song, labels.unavailable);
    const activeRowClass = isDaylight ? 'bg-black/[0.08]' : 'bg-white/20';
    const activeMarkerClass = isDaylight ? 'bg-zinc-700' : 'bg-white';
    const hoverRowClass = isDaylight ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';
    // 预览中的那一行：淡淡的底色 + 半亮的标记条，和正在播放的那首区分开。
    const previewRowClass = isDaylight ? 'bg-black/[0.05]' : 'bg-white/10';
    const previewMarkerClass = isDaylight ? 'bg-zinc-400' : 'bg-white/50';
    // 动作键：预览中那行一直露出来（播放键要点得到），其余还是悬停 / 聚焦才浮出。
    const actionsClass = isPreviewed
        ? 'opacity-100 pointer-events-auto'
        : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';

    return (
        <div
            style={style}
            onClick={isUnavailable ? undefined : (onPreviewSong ? () => onPreviewSong(song) : () => onPlaySong(song, playQueue))}
            data-active={isActive}
            data-previewed={isPreviewed}
            {...ariaAttributes}
            className={`group flex items-center gap-3 px-2 py-1 rounded-lg cursor-pointer transition-colors
                ${isActive ? activeRowClass : isPreviewed ? previewRowClass : hoverRowClass} ${isUnavailable ? 'opacity-55' : ''}`}
        >
            <div className={`w-1 h-6 rounded-full ${isActive ? activeMarkerClass : isPreviewed ? previewMarkerClass : 'bg-transparent'}`} />
            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">
                    {song.name}
                    {isUnavailable && (
                        <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium align-middle ${isDaylight ? 'border-black/8 bg-black/[0.04] text-zinc-600' : 'border-white/10 bg-white/[0.05] text-zinc-300'}`}>
                            {unavailableTagText}
                        </span>
                    )}
                </div>
                <div className="text-[10px] opacity-40 truncate">{getSongArtistLabel(song)}</div>
            </div>
            <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${actionsClass} focus-within:opacity-100 focus-within:pointer-events-auto`}>
                {[
                    { label: labels.play, icon: Play, action: (_index: number) => onPlaySong(song, playQueue) },
                    { label: labels.playNext, icon: ListPlus, action: onMoveSongToNext },
                    { label: labels.moveToEnd, icon: ListEnd, action: onMoveSongToEnd },
                    { label: labels.remove, icon: Trash2, action: onRemoveSong },
                ].map(({ label, icon: Icon, action }) => (
                    <button
                        key={label}
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (event.detail > 0) {
                                event.currentTarget.blur();
                            }
                            action(index);
                        }}
                        className={`rounded-md p-1.5 transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                    >
                        <Icon size={13} />
                    </button>
                ))}
                {isUnavailable && onRequestCrossPlatformReplacement && (
                    <button
                        type="button"
                        title={labels.playOnOtherPlatform}
                        aria-label={labels.playOnOtherPlatform}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (event.detail > 0) {
                                event.currentTarget.blur();
                            }
                            void onRequestCrossPlatformReplacement(song, playQueue);
                        }}
                        className={`rounded-md p-1.5 transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                    >
                        <Globe size={13} />
                    </button>
                )}
            </div>
        </div>
    );
};

const QueueTab: React.FC<QueueTabProps> = ({
    playQueue,
    currentSong,
    onPlaySong,
    onPreviewSong,
    previewSongKey = null,
    queueScrollRef,
    shouldScrollToCurrent = false,
    onShuffle,
    onRemoveSong,
    onMoveSongToEnd,
    onMoveSongToNext,
    onRequestCrossPlatformReplacement,
    canSaveLocalPlaylist = false,
    onOpenLattice,
    onSaveCurrentQueueAsPlaylist,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const ITEM_HEIGHT = 50;
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // Adjust container height calculation if needed, or rely on flex
    // previously CONTAINER_HEIGHT = 200 was passed to List. 
    // We should make List take available space.
    // However, react-window List needs explicit height.
    // The parent has max-h-[300px]. 
    // If we add a header, we need to subtract its height from the List height or use AutoSizer.
    // For simplicity given the constraints, let's try to fit it.
    // The parent is flex-col. 
    // Let's reduce List height slightly to accommodate header? 
    // Or better, use Autoizer? No, let's stick to simple fixed height for now but slightly reduced: 300 - 32 (header) = 268?
    // User asked for "about 5 songs height". 5 * 50 = 250.
    // Let's set CONTAINER_HEIGHT to 250.
    const CONTAINER_HEIGHT = 250;

    const listRef = useListRef(null);
    const isInitialMountRef = React.useRef(true);
    const lastScrolledIndexRef = React.useRef<number>(-1);
    const wasOpenRef = React.useRef(false);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = React.useState(false);
    const rowProps = React.useMemo<QueueRowProps>(() => ({
        playQueue,
        currentSongKey,
        onPlaySong,
        onPreviewSong,
        previewSongKey,
        onMoveSongToNext,
        onMoveSongToEnd,
        onRequestCrossPlatformReplacement,
        onRemoveSong,
        isDaylight,
        labels: {
            unavailable: t('status.songUnavailableTag'),
            play: t('queue.play'),
            playNext: t('queue.playNext'),
            moveToEnd: t('queue.moveToEnd'),
            remove: t('queue.remove'),
            playOnOtherPlatform: t('queue.playOnOtherPlatform'),
        },
    }), [
        currentSongKey,
        isDaylight,
        onMoveSongToEnd,
        onMoveSongToNext,
        onRequestCrossPlatformReplacement,
        onPlaySong,
        onPreviewSong,
        previewSongKey,
        onRemoveSong,
        playQueue,
        t,
    ]);

    // Reset initial mount state when panel is opened
    React.useEffect(() => {
        if (shouldScrollToCurrent && !wasOpenRef.current) {
            isInitialMountRef.current = true;
            wasOpenRef.current = true;
        } else if (!shouldScrollToCurrent) {
            wasOpenRef.current = false;
        }
    }, [shouldScrollToCurrent]);

    // Auto-scroll to current song
    React.useEffect(() => {
        if (shouldScrollToCurrent && currentSongKey && listRef.current) {
            const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey);
            if (currentIndex >= 0) {
                const isInitialMount = isInitialMountRef.current;
                const songChanged = lastScrolledIndexRef.current !== currentIndex && lastScrolledIndexRef.current !== -1;

                const behavior = (isInitialMount || !songChanged) ? 'instant' : 'smooth';
                const delay = isInitialMount ? 0 : 50;

                setTimeout(() => {
                    if (listRef.current) {
                        listRef.current.scrollToRow({
                            index: currentIndex,
                            align: 'center',
                            behavior: behavior as 'instant' | 'smooth'
                        });
                        lastScrolledIndexRef.current = currentIndex;
                        isInitialMountRef.current = false;
                    }
                }, delay);
            }
        }
    }, [shouldScrollToCurrent, currentSongKey, playQueue, listRef]);

    const handleSavePlaylist = async () => {
        if (!onSaveCurrentQueueAsPlaylist) {
            return;
        }
        setIsSaveDialogOpen(true);
    };

    if (playQueue.length === 0) {
        return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px] select-none">
                <div className="flex items-center justify-center h-full text-xs opacity-40">
                    {t('queue.empty')}
                </div>
            </motion.div>
        );
    }

    return (
        <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px] select-none">
                <div className="flex items-center justify-between px-2 pb-2 shrink-0">
                    <span className="text-xs font-medium opacity-60">
                        {t('queue.title')} ({playQueue.length})
                    </span>
                    <div className="flex items-center gap-1">
                        {onOpenLattice && (
                            <button
                                onClick={onOpenLattice}
                                className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
                                title={t('home.lattice')}
                                aria-label={t('home.lattice')}
                            >
                                <PanelsTopLeft size={14} />
                            </button>
                        )}
                        {canSaveLocalPlaylist && (
                            <button
                                onClick={handleSavePlaylist}
                                className="px-2 py-1 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100 text-[10px] font-medium"
                                title={t('localMusic.saveQueueAsPlaylist')}
                            >
                                {t('localMusic.saveQueueAsPlaylist')}
                            </button>
                        )}
                        {onShuffle && (
                            <button
                                onClick={onShuffle}
                                className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
                                title={t('queue.shuffle')}
                            >
                                <Shuffle size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div
                    ref={queueScrollRef}
                    className="flex-1 -mx-2 px-2 overflow-hidden"
                >
                    <List
                        listRef={listRef}
                        rowCount={playQueue.length}
                        rowHeight={ITEM_HEIGHT}
                        rowComponent={QueueRow}
                        rowProps={rowProps}
                        overscanCount={5}
                        className="custom-scrollbar"
                        style={{ height: CONTAINER_HEIGHT, width: '100%' }}
                    />
                </div>
            </motion.div>

            <TextInputDialog
                isOpen={isSaveDialogOpen}
                onClose={() => setIsSaveDialogOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.saveQueueAsPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.save')}
                onConfirm={async (playlistName) => {
                    try {
                        await onSaveCurrentQueueAsPlaylist?.(playlistName);
                    } catch (error) {
                        console.error('Failed to save local playlist', error);
                    }
                }}
            />
        </>
    );
};

export default QueueTab;
