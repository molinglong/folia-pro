// src/stores/usePlaybackEntryViewStore.ts
// Which surface a "play this song" action lands on, plus the one-time prompt that asks for it.
//
// Kept out of useAppViewStore on purpose: that store is where the app *is*, this one is a stored
// preference about where playback should take it. The prompt's open state lives here too, because
// the only thing that opens it is this preference never having been chosen.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';
import { FINE_POINTER_QUERY } from '../hooks/useSupportsFinePointer';

/**
 * Where pressing play lands. `player` is the visualizer page, `lattice` the queue collage, and
 * `stay` leaves the listener where they pressed it (the library card or wall just shows that the
 * song is playing). `stay` was added later (fb3, 2026-10-07): stored values from before still read
 * back as what they were, and anything unknown falls back to `player`.
 */
export type PlaybackEntryView = 'player' | 'lattice' | 'stay';

export const PLAYBACK_ENTRY_VIEWS: readonly PlaybackEntryView[] = ['player', 'lattice', 'stay'];

export const isPlaybackEntryView = (value: unknown): value is PlaybackEntryView => (
    typeof value === 'string' && (PLAYBACK_ENTRY_VIEWS as readonly string[]).includes(value)
);

/**
 * The surface an explicit "open the playback view" lands on (the player capsule, the startup view,
 * bravais' enter button on the playing card). `stay` has no surface of its own, so it opens the
 * player — the listener asked to go somewhere, and the visualizer is the default somewhere.
 */
export const resolvePlaybackSurface = (view: PlaybackEntryView): 'player' | 'lattice' => (
    view === 'lattice' ? 'lattice' : 'player'
);

const ENTRY_VIEW_KEY = 'playback_entry_view';
const ENTRY_VIEW_CHOSEN_KEY = 'playback_entry_view_chosen';
/**
 * The library-interface page (grid / bravais) of the startup prompt has been shown once on this install.
 * Its own flag, not tied to any version: everyone sees that page exactly once (2026-10-10), including installs
 * that answered the older single-page prompt — and it must not ride on the release-notes version, which moves
 * every release.
 */
const LIBRARY_SUITE_PROMPT_SEEN_KEY = 'library_suite_prompt_seen';

/** The pages the startup prompt can show, in order. */
export type StartupPromptPage = 'library-suite' | 'playback-entry-view';

const readEntryView = (): PlaybackEntryView => {
    const stored = getStoredString(ENTRY_VIEW_KEY, '');
    return isPlaybackEntryView(stored) ? stored : resolvePlaybackEntryViewDefault();
};

/**
 * 从没选过时的缺省：竖屏窄窗且主指针不是细指针（手机）缺省进海报墙，否则进可视化播放页。
 * 2026-10-17 用户定：手机上「海报显示不完」的诉求最终落在歌词入口——竖屏没有悬停，点开播放
 * 直接落到带逐字歌词的 Lattice 最顺手。两个条件缺一不可：指针媒体特性在无头浏览器里不可靠
 * （e2e 实测报非细指针），单靠它会把这些窗口和窄桌面窗误判成手机；宽度阈值与 bravais 竖屏墙
 * 同源（BRAVAIS_PORTRAIT_MAX_WIDTH_PX = 700，不 import 它：store 不碰 suite 内部）。选过的人
 * （含首启提问里没点卡直接关掉的）存储里有值，永远以存储为准。
 */
const PHONE_MAX_WIDTH_PX = 700;

export const resolvePlaybackEntryViewDefault = (): PlaybackEntryView => {
    if (typeof window === 'undefined') return 'player';
    const portraitNarrow = window.innerHeight > window.innerWidth && window.innerWidth < PHONE_MAX_WIDTH_PX;
    const coarsePointer = typeof window.matchMedia === 'function' && !window.matchMedia(FINE_POINTER_QUERY).matches;
    return portraitNarrow && coarsePointer ? 'lattice' : 'player';
};

export type PlaybackEntryViewState = {
    playbackEntryView: PlaybackEntryView;
    /** True once the listener has answered the prompt, or changed the setting by hand. */
    hasChosenPlaybackEntryView: boolean;
    /** True once the library-interface page has been shown (see LIBRARY_SUITE_PROMPT_SEEN_KEY). */
    hasSeenLibrarySuitePrompt: boolean;
    isPlaybackEntryViewPromptOpen: boolean;
    /** The pages of the prompt that is open (empty while closed); fixed for one opening. */
    promptPages: readonly StartupPromptPage[];
    /**
     * Non-zero while the "Lattice cannot host Personal FM" notice is up, and a different value on
     * every raise so a repeat restarts its own timer.
     *
     * Deliberately not a status toast: starting FM fills that single-slot channel with the song
     * fetch and the lyric match, either of which would cut this explanation short.
     */
    latticeFmNoticeToken: number;

    setPlaybackEntryView: (view: PlaybackEntryView) => void;
    /**
     * Opens the prompt with the pages still unanswered: the library-interface page when `withLibrarySuite`
     * (both suites exist in this build) and it has not been shown yet, the playback page when that has not been
     * chosen. Returns whether it opened (nothing left to ask → false).
     */
    requestPlaybackEntryViewPrompt: (options?: { withLibrarySuite?: boolean }) => boolean;
    /** Closes the prompt and records both questions as answered, so it never opens again. */
    closePlaybackEntryViewPrompt: () => void;
    /** Raises the FM notice, restarting it if one is already showing. */
    showLatticeFmNotice: () => void;
    dismissLatticeFmNotice: () => void;
};

export const usePlaybackEntryViewStore = create<PlaybackEntryViewState>((set, get) => ({
    playbackEntryView: readEntryView(),
    hasChosenPlaybackEntryView: getStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, false),
    hasSeenLibrarySuitePrompt: getStoredBoolean(LIBRARY_SUITE_PROMPT_SEEN_KEY, false),
    isPlaybackEntryViewPromptOpen: false,
    promptPages: [],
    latticeFmNoticeToken: 0,

    // Picking a view *is* answering the question, wherever it is picked, so this also retires the
    // prompt: someone who set it in the options should not be asked about it again afterwards.
    setPlaybackEntryView: (view) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(ENTRY_VIEW_KEY, view);
        }
        setStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, true);
        set({ playbackEntryView: view, hasChosenPlaybackEntryView: true });
    },
    requestPlaybackEntryViewPrompt: ({ withLibrarySuite = false } = {}) => {
        const state = get();
        if (state.isPlaybackEntryViewPromptOpen) {
            return false;
        }
        const pages: StartupPromptPage[] = [];
        if (withLibrarySuite && !state.hasSeenLibrarySuitePrompt) pages.push('library-suite');
        if (!state.hasChosenPlaybackEntryView) pages.push('playback-entry-view');
        if (pages.length === 0) {
            return false;
        }
        set({ isPlaybackEntryViewPromptOpen: true, promptPages: pages });
        return true;
    },
    closePlaybackEntryViewPrompt: () => {
        setStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, true);
        setStoredBoolean(LIBRARY_SUITE_PROMPT_SEEN_KEY, true);
        set({ isPlaybackEntryViewPromptOpen: false, hasChosenPlaybackEntryView: true, hasSeenLibrarySuitePrompt: true });
    },
    // Date.now() rather than a counter so the token also changes when the notice is raised again
    // while still on screen, which is what restarts the dismissal timer.
    showLatticeFmNotice: () => set({ latticeFmNoticeToken: Date.now() }),
    dismissLatticeFmNotice: () => set({ latticeFmNoticeToken: 0 }),
}));

/** Module-level handle for the assembly layer; it is an action, so it needs no subscription. */
export const requestPlaybackEntryViewPrompt = (options?: { withLibrarySuite?: boolean }) => (
    usePlaybackEntryViewStore.getState().requestPlaybackEntryViewPrompt(options)
);

/** Module-level handle for the playback controller, which is not a component. */
export const showLatticeFmNotice = () => (
    usePlaybackEntryViewStore.getState().showLatticeFmNotice()
);
