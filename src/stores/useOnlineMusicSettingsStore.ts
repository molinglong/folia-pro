import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useOnlineMusicSettingsStore.ts
// Online-music behaviour settings shared by the cross-platform replacement service and the
// settings UI. One switch today: whether a high-confidence same-song match on another platform
// replaces the unplayable track by itself, or always asks first.

const AUTO_CROSS_REPLACE_STORAGE_KEY = 'online_auto_cross_replace';

export type OnlineMusicSettingsState = {
    /** On by default: the high-confidence bar (exact title + exact artist + near duration) is
     *  deliberately narrow, and in FM/auto-advance queues a prompt per grey song is unusable. */
    autoCrossReplace: boolean;
    setAutoCrossReplace: (enabled: boolean) => void;
};

export const useOnlineMusicSettingsStore = create<OnlineMusicSettingsState>((set, get) => ({
    autoCrossReplace: getStoredBoolean(AUTO_CROSS_REPLACE_STORAGE_KEY, true),

    setAutoCrossReplace: (enabled) => {
        setStoredBoolean(AUTO_CROSS_REPLACE_STORAGE_KEY, enabled);
        set({ autoCrossReplace: enabled });
    },
}));
