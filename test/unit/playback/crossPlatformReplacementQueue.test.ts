import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';

// test/unit/playback/crossPlatformReplacementQueue.test.ts — the queue controller's cross-platform
// leg: exact matches auto-switch when the setting is on, everything else goes through the existing
// replacement dialog, and "no candidate" keeps the ordinary unavailable path. Same fake-react
// harness as onlinePlaybackStop.test.ts: the hook is exercised once, without a renderer.

const h = vi.hoisted(() => ({ state: {} as {
    setters?: Array<{ key: string; value: unknown }>;
    autoCrossReplace?: boolean;
    setState?: (value: unknown) => void;
} }));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => {
        let value = initial;
        const setter = (next: unknown) => {
            const resolved = typeof next === 'function' ? (next as (prev: unknown) => unknown)(value) : next;
            if (!h.state.setters) h.state.setters = [];
            h.state.setters.push({ key: String(initial), value: resolved });
            value = resolved;
        };
        return [value, setter];
    },
    useEffect: vi.fn(),
}));
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string, options?: { provider?: string }) => (options?.provider ? `${key}:${options.provider}` : key),
    }),
}));
vi.mock('@/stores/usePlaybackStore', async importOriginal => {
    const actual = await importOriginal<typeof import('@/stores/usePlaybackStore')>();
    return { ...actual, usePlaybackStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector(actual.usePlaybackStore.getState()), actual.usePlaybackStore) };
});
vi.mock('@/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: (selector: (state: unknown) => unknown) => selector({ audioQuality: 'high', loopMode: 'all' }),
}));
vi.mock('@/stores/useSearchNavigationStore', () => ({
    useSearchNavigationStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/stores/motionSignals', async importOriginal => ({
    ...(await importOriginal<object>()), currentTime: { set: vi.fn() },
}));
vi.mock('@/services/hostExtensionHooks', async importOriginal => ({
    ...(await importOriginal<object>()), hasBeforePlayHook: () => false,
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true } }));
vi.mock('@/services/onlineMusic/resourceCache', async importOriginal => ({
    ...(await importOriginal<object>()),
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async () => null,
}));
vi.mock('@/services/prefetchService', async importOriginal => ({
    ...(await importOriginal<object>()), getPrefetchedData: () => null,
}));
vi.mock('@/services/onlinePlayback', async importOriginal => ({
    ...(await importOriginal<object>()),
    applyOnlineAudioSourceMetadata: (song: SongResult) => song,
    loadOnlineSongAudioSource: vi.fn(),
    loadOnlineSongLyrics: vi.fn(async () => undefined),
}));
vi.mock('@/utils/onlineLyricsState', async importOriginal => ({
    ...(await importOriginal<object>()), loadOnlineLyricsState: async () => null,
}));
vi.mock('@/services/onlineMusic/songAvailability', async importOriginal => ({
    ...(await importOriginal<object>()),
    isSongUnavailable: (song: { id?: unknown }) => song?.id === 'grey',
    getSongReplacement: vi.fn(async () => null),
}));
vi.mock('@/services/onlineMusic/crossPlatformReplacement', () => ({
    findCrossPlatformCandidates: vi.fn(),
}));
vi.mock('@/stores/useOnlineMusicSettingsStore', () => ({
    useOnlineMusicSettingsStore: { getState: () => ({ autoCrossReplace: h.state.autoCrossReplace }) },
}));

const { usePlaybackQueueController } = await import('@/hooks/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { findCrossPlatformCandidates } = await import('@/services/onlineMusic/crossPlatformReplacement');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');

const onlineSong = (id: string, name: string): SongResult => ({
    id, name, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
} as SongResult);

const grey = onlineSong('grey', '晴天');
const candidate = onlineSong('qq-1', '晴天');

function controller() {
    const result = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        audioRef: { current: { pause: vi.fn() } }, shouldAutoPlayRef: { current: true },
        currentSongRef: { current: null }, blobUrlRef: { current: null },
        pendingResumeTimeRef: { current: null }, currentOnlineAudioUrlFetchedAtRef: { current: null },
        lastAudioRecoverySourceRef: { current: null }, mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: { current: 0 }, setIsLyricsLoading: vi.fn(),
        setLyrics: vi.fn(), navigateToPlaybackView: vi.fn(), navigateToSearch: vi.fn(),
        persistLastPlaybackCache: vi.fn(async () => undefined),
        restoreCachedThemeForSong: vi.fn(async () => null),
        onPlayLocalSong: vi.fn(), onPlayNavidromeSong: vi.fn(),
        onAddLocalSongToQueue: vi.fn(), onAddNavidromeSongsToQueue: vi.fn(),
        searchDeps: { submitSearch: vi.fn(), loadMoreSearchResults: vi.fn() },
        interruptStagePlaybackForMainTransition: vi.fn(),
    } as never);
    return { ...result, setState: h.state.setState! };
}

const settle = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

beforeEach(() => {
    vi.clearAllMocks();
    h.state = {};
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: grey, playQueue: [grey],
        playerState: PlayerState.PLAYING, isFmMode: false });
    useStatusMessageStore.setState({ message: null });
    h.state.setState = () => {};
    vi.mocked(loadOnlineSongAudioSource).mockResolvedValue({
        kind: 'ok', audioSrc: 'https://stream.test/qq-1', blobUrl: null, replayGain: null,
    } as never);
    vi.stubGlobal('URL', { ...globalThis.URL, revokeObjectURL: vi.fn() });
});

describe('queue cross-platform replacement branches', () => {
    it('plays the exact candidate straight away and swaps it into the queue when auto-replace is on', async () => {
        h.state.autoCrossReplace = true;
        vi.mocked(findCrossPlatformCandidates).mockResolvedValue([
            { providerId: 'qq', providerLabel: 'QQ', song: candidate, confidence: 'exact', durationDiffMs: 120 },
        ] as never);
        const queue = controller();
        await queue.playSong(grey, [grey]);
        await settle();

        expect(findCrossPlatformCandidates).toHaveBeenCalledWith(grey, { validatePlayability: true });
        // The queue item was swapped and the candidate handed to playSong: reaching here at all
        // means the exact+switch-on branch ran (the dialog branch leaves playQueue untouched).
        expect(usePlaybackStore.getState().playQueue).toEqual([candidate]);
        expect(usePlaybackStore.getState().currentSong).toEqual(candidate);
    });

    it('routes a near candidate through the confirmation dialog instead of playing it', async () => {
        h.state.autoCrossReplace = true;
        vi.mocked(findCrossPlatformCandidates).mockResolvedValue([
            { providerId: 'kugou', providerLabel: '酷狗', song: candidate, confidence: 'near', durationDiffMs: 12_000 },
        ] as never);
        const queue = controller();
        await queue.playSong(grey, [grey]);
        await settle();

        expect(usePlaybackStore.getState().playQueue).toEqual([grey]);
        const dialogEntry = h.state.setters!.find(entry => (entry.value as { typeDesc?: string })?.typeDesc === 'status.crossReplacePrompt:酷狗');
        expect((dialogEntry!.value as { replacementSong: SongResult }).replacementSong).toBe(candidate);
    });

    it('asks for confirmation on an exact candidate too when the auto-replace switch is off', async () => {
        h.state.autoCrossReplace = false;
        vi.mocked(findCrossPlatformCandidates).mockResolvedValue([
            { providerId: 'qq', providerLabel: 'QQ', song: candidate, confidence: 'exact', durationDiffMs: 0 },
        ] as never);
        const queue = controller();
        await queue.playSong(grey, [grey]);
        await settle();

        expect(usePlaybackStore.getState().playQueue).toEqual([grey]);
        const dialogEntry = h.state.setters!.find(entry => (entry.value as { typeDesc?: string })?.typeDesc === 'status.crossReplacePrompt:QQ');
        expect(dialogEntry).toBeTruthy();
    });

    it('keeps the ordinary unavailable message when no platform has the song', async () => {
        h.state.autoCrossReplace = true;
        vi.mocked(findCrossPlatformCandidates).mockResolvedValue([] as never);
        const queue = controller();
        await queue.playSong(grey, [grey]);
        await settle();

        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error', text: 'status.songUnavailable' });
        expect(usePlaybackStore.getState().playQueue).toEqual([grey]);
    });

    it('the manual queue-row entry runs the same lazy lookup on click', async () => {
        h.state.autoCrossReplace = true;
        vi.mocked(findCrossPlatformCandidates).mockResolvedValue([
            { providerId: 'qq', providerLabel: 'QQ', song: candidate, confidence: 'exact', durationDiffMs: 3_000 },
        ] as never);
        const queue = controller();
        const handled = await queue.requestCrossPlatformReplacement(grey, [grey]);
        await settle();

        expect(handled).toBe(true);
        expect(findCrossPlatformCandidates).toHaveBeenCalledWith(grey, { validatePlayability: true });
        expect(usePlaybackStore.getState().playQueue).toEqual([candidate]);
    });
});
