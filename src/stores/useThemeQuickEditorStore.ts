import { create } from 'zustand';
import type { DualTheme, SongResult, ThemeMode } from '../types';
import type { ThemeCacheSongKey } from '../services/themeCache';

// src/stores/useThemeQuickEditorStore.ts
// Holds the quick editor's open state and the latest editable theme snapshots.

export type ThemeQuickEditorKind = 'ai';

type ThemeQuickEditorContext = {
    aiTheme: DualTheme | null;
    bgMode: ThemeMode;
    coverUrl: string | null;
    song: SongResult | null;
    songKey: ThemeCacheSongKey | null;
    isDaylight: boolean;
    promptSourceText: string | null;
    isPureMusic: boolean;
    songTitle: string | undefined;
};

type ThemeQuickEditorState = ThemeQuickEditorContext & {
    isOpen: boolean;
    editorKind: ThemeQuickEditorKind | null;
    canOpenEditor: boolean;
    setContext: (context: ThemeQuickEditorContext) => void;
    openEditor: (kind?: ThemeQuickEditorKind) => void;
    closeEditor: () => void;
};

export const useThemeQuickEditorStore = create<ThemeQuickEditorState>((set) => ({
    aiTheme: null,
    bgMode: 'default',
    coverUrl: null,
    song: null,
    songKey: null,
    isDaylight: false,
    promptSourceText: null,
    isPureMusic: false,
    songTitle: undefined,
    isOpen: false,
    editorKind: null,
    canOpenEditor: false,
    setContext: (context) => set(state => ({
        ...context,
        isOpen: state.isOpen,
        editorKind: state.editorKind,
        canOpenEditor: true,
    })),
    openEditor: () => {
        set({ isOpen: true, editorKind: 'ai' });
    },
    closeEditor: () => set({ isOpen: false, editorKind: null }),
}));
