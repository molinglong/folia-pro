import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import type { ListeningPlayRecord } from '../../../src/types/listeningStats';

// test/unit/hooks/useListeningHistoryRecorder.test.ts
// The hook decides when one local history row is written. The repo runs vitest on node without
// jsdom, so this reuses the minimal React runtime from useNeteaseScrobbleReporter.test.ts and a
// hand-rolled audio element instead of pulling in a rendering stack.

const runtime = vi.hoisted(() => ({
    slots: [] as { current: any }[],
    cursor: 0,
    effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', () => ({
    useRef: (initial: unknown) => {
        const index = runtime.cursor++;
        runtime.slots[index] ??= { current: initial };
        return runtime.slots[index];
    },
    useEffect: (effect: () => void | (() => void)) => { runtime.effects.push(effect); },
}));

vi.mock('../../../src/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: SongResult) => ({
        durationMs: song.durationMs ?? 0,
        artists: [],
        album: { name: '' },
        coverUrl: '',
    }),
}));

const repository = vi.hoisted(() => ({
    recordListeningPlay: vi.fn(async (_record: unknown) => {}),
}));
vi.mock('../../../src/services/listeningStats/listeningStatsRepository', () => repository);

const audioSettings = vi.hoisted(() => ({ listeningStatsEnabled: true }));
const useAudioSettingsStore = vi.hoisted(() => {
    const hook = (selector: (state: { listeningStatsEnabled: boolean }) => unknown) => selector(audioSettings);
    hook.getState = () => audioSettings;
    return hook;
});
vi.mock('../../../src/stores/useAudioSettingsStore', () => ({ useAudioSettingsStore }));

const { useListeningHistoryRecorder } = await import('../../../src/hooks/useListeningHistoryRecorder');

/**
 * A clock that moves with playback. PlaybackListenTracker cross-checks accumulated media time
 * against the wall clock, so every quarter-second tick advances both by the same amount.
 */
const clock = { now: 1_700_000_000_000 };

const createDeck = () => {
    const listeners = new Map<string, Set<() => void>>();
    return {
        currentTime: 0,
        paused: false,
        ended: false,
        addEventListener: (type: string, listener: () => void) => {
            listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
        },
        removeEventListener: (type: string, listener: () => void) => {
            listeners.get(type)?.delete(listener);
        },
        emit(type: string) {
            listeners.get(type)?.forEach(listener => listener());
        },
        playFor(seconds: number) {
            for (let step = 0; step <= Math.round(seconds / 0.25); step += 1) {
                if (step > 0) {
                    this.currentTime = Number((this.currentTime + 0.25).toFixed(4));
                    clock.now += 250;
                }
                this.emit('timeupdate');
            }
        },
    };
};

type Deck = ReturnType<typeof createDeck>;

const song = (mediaId: string, overrides: Partial<SongResult> = {}): SongResult => ({
    id: mediaId,
    name: 'song-' + mediaId,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 240_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId },
    ...overrides,
} as SongResult);

const written = (call = 0): ListeningPlayRecord => (
    repository.recordListeningPlay.mock.calls[call]?.[0] as ListeningPlayRecord
);

let cleanups: Array<() => void> = [];
const audioRef: { current: Deck | null } = { current: null };

const render = (currentSong: SongResult | null, activeDeck = 'A') => {
    cleanups.forEach(cleanup => cleanup());
    runtime.cursor = 0;
    runtime.effects.length = 0;
    useListeningHistoryRecorder({ audioRef: audioRef as never, currentSong, activeDeck });
    cleanups = runtime.effects
        .map(effect => effect())
        .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
};

describe('useListeningHistoryRecorder', () => {
    let deck: Deck;

    beforeEach(() => {
        runtime.slots.length = 0;
        runtime.cursor = 0;
        runtime.effects.length = 0;
        cleanups = [];
        repository.recordListeningPlay.mockReset().mockResolvedValue(undefined);
        audioSettings.listeningStatsEnabled = true;
        clock.now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
        deck = createDeck();
        audioRef.current = deck;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('writes one row once 30 seconds really played', () => {
        render(song('1'));
        deck.playFor(45);
        render(song('2'));

        expect(repository.recordListeningPlay).toHaveBeenCalledTimes(1);
        expect(written()).toMatchObject({
            songKey: 'online:netease:1',
            source: 'netease',
            title: 'song-1',
            listenedSec: 45,
            durationSec: 240,
            completed: false,
            playedAt: clock.now,
        });
    });

    it('says nothing about a track that was skipped early', () => {
        render(song('1'));
        deck.playFor(10);
        render(song('2'));

        expect(repository.recordListeningPlay).not.toHaveBeenCalled();
    });

    it('counts nothing while the deck is paused', () => {
        render(song('1'));
        deck.playFor(20);
        deck.paused = true;
        deck.playFor(60);
        deck.paused = false;
        render(song('2'));

        expect(repository.recordListeningPlay).not.toHaveBeenCalled();
    });

    it('dates the row by the last progress, not by a long pause before settle', () => {
        render(song('1'));
        deck.playFor(45);
        const lastProgressAt = clock.now;

        clock.now += 6 * 60 * 60 * 1000;
        render(song('2'));

        expect(written().playedAt).toBe(lastProgressAt);
    });

    it('writes each pass of a loop-one repeat separately', () => {
        render(song('1'));
        deck.playFor(40);

        deck.currentTime = 0.25;
        deck.emit('timeupdate');
        expect(repository.recordListeningPlay).toHaveBeenCalledTimes(1);

        deck.playFor(40);
        render(song('2'));
        expect(repository.recordListeningPlay).toHaveBeenCalledTimes(2);
        expect(written(1)).toMatchObject({ songKey: 'online:netease:1' });
    });

    it('settles the outgoing track on an automix handover', () => {
        render(song('1'));
        deck.playFor(50);

        audioRef.current = createDeck();
        render(song('2'), 'B');

        expect(repository.recordListeningPlay).toHaveBeenCalledTimes(1);
        expect(written()).toMatchObject({ songKey: 'online:netease:1' });
    });

    it('writes nothing when history recording is switched off', () => {
        audioSettings.listeningStatsEnabled = false;
        render(song('1'));
        deck.playFor(45);
        render(song('2'));

        expect(repository.recordListeningPlay).not.toHaveBeenCalled();
    });

    it('drops the listen in progress when the switch is turned off mid-track', () => {
        render(song('1'));
        deck.playFor(45);

        audioSettings.listeningStatsEnabled = false;
        render(song('1'));
        render(song('2'));

        expect(repository.recordListeningPlay).not.toHaveBeenCalled();
    });

    it('never opens a session for stage playback', () => {
        render(song('1', { sourceRef: { kind: 'stage', mediaId: 'stage-1' } } as Partial<SongResult>));
        deck.playFor(45);
        render(song('2'));

        expect(repository.recordListeningPlay).not.toHaveBeenCalled();
    });
});
