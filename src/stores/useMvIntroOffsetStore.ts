import { create } from 'zustand';
import { getStoredString } from './storagePrimitives';

// src/stores/useMvIntroOffsetStore.ts
// Per-song intro-skip offsets for the MV background. Some MV sources ship with a black screen,
// a label logo or an ad before the actual content, and only a handful of songs are affected --
// the code cannot tell a skippable intro from an artistic transition, so the user adjusts it
// live on the MV itself with the capsule the background renders. Offsets ride the playback-song
// key: every track remembers its own value, everything else stays 0.

const MV_INTRO_OFFSETS_KEY = 'mv_intro_offsets';

export const MV_INTRO_OFFSET_STEP = 1;
export const MV_INTRO_OFFSET_MAX_SEC = 30;

export const clampMvIntroOffset = (value: number) => (
    Number.isFinite(value)
        ? Math.max(0, Math.min(MV_INTRO_OFFSET_MAX_SEC, Math.round(value)))
        : 0
);

type MvIntroOffsets = Record<string, number>;

const readStoredOffsets = (): MvIntroOffsets => {
    const raw = getStoredString(MV_INTRO_OFFSETS_KEY, '');
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const next: MvIntroOffsets = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            const offset = clampMvIntroOffset(Number(value));
            if (offset > 0) next[key] = offset;
        }
        return next;
    } catch {
        return {};
    }
};

/**
 * Where the MV should sit for a song position, or null when the MV is too short to reach it:
 * null means leave the video alone and let the loop cycle, rather than chasing the song past
 * the end of the stream and stalling on the last frame.
 */
export const resolveMvAlignedSeekTarget = (
    songSeconds: number,
    offsetSeconds: number,
    mvDurationSeconds: number,
): number | null => {
    const target = songSeconds + offsetSeconds;
    if (!Number.isFinite(target) || target < 0) return 0;
    if (Number.isFinite(mvDurationSeconds) && mvDurationSeconds > 0 && target >= mvDurationSeconds - 0.25) return null;
    return target;
};

type MvIntroOffsetState = {
    offsets: MvIntroOffsets;
    setOffset: (trackKey: string, seconds: number) => void;
};

export const useMvIntroOffsetStore = create<MvIntroOffsetState>((set, get) => ({
    offsets: readStoredOffsets(),
    setOffset: (trackKey, seconds) => {
        const offset = clampMvIntroOffset(seconds);
        const next = { ...get().offsets };
        // 0 means "no intro": the song leaves the table so the stored JSON never swells with defaults.
        if (offset > 0) next[trackKey] = offset;
        else delete next[trackKey];
        set({ offsets: next });
        if (typeof window !== 'undefined') localStorage.setItem(MV_INTRO_OFFSETS_KEY, JSON.stringify(next));
    },
}));
