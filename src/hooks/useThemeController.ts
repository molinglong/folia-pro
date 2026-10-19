import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { generateThemeFromLyrics, isMissingAiApiKeyError } from '../services/gemini';
import { polishAiDualTheme } from '../services/aiThemePolish';
import { saveToCache } from '../services/db';
import { DualTheme, LyricData, SongResult, StatusMessage, Theme, ThemeMode } from '../types';
import { getCachedThemeState, getCachedThemeStateForSong, getLastDualTheme, getLastLegacyTheme, type ThemeCacheSongKey } from '../services/themeCache';
import { saveSyncedThemeForSong } from '../services/sync/syncRepository';
import {
    applyStoredAnimationIntensityToDualTheme,
    applyStoredAnimationIntensityToTheme,
    isThemeAnimationIntensity,
    readStoredLastAppliedThemePointer,
    readStoredThemeAutoGenerateEnabled,
    readStoredThemeAutoSwitchEnabled,
    readStoredThemeGenerationSource,
    resolveSongThemeAutoGenerateChange,
    resolveSongThemeAutoSwitchChange,
    saveStoredAnimationIntensity,
    saveStoredLastAppliedThemePointer,
    saveStoredThemeAutoGenerateEnabled,
    saveStoredThemeAutoSwitchEnabled,
    saveStoredThemeGenerationSource,
    type ThemeGenerationSource,
    type ThemePreferenceSwitchState,
} from '../services/themePreferences';
import { FALLBACK_AI_DUAL_THEME, sanitizeDualTheme, sanitizeTheme } from '../services/themeSanitizer';
import { extractRepresentativeColors } from '../utils/colorExtractor';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import {
    buildThemeSourceModel,
    buildBuiltinDualTheme,
    getBaseThemeForMode,
    resolveBgModeTheme,
} from './themeControllerState';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { useStableCallbacks } from './useStableCallbacks';

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;
export type GenerateAIThemeOptions = {
    source?: 'manual' | 'auto';
    shouldApply?: () => boolean;
    /** Manual panel button: route to the AI provider even under the cover source. */
    forceAi?: boolean;
};

export type GenerateAIThemeResult =
    | { status: 'generated'; applied: boolean }
    | { status: 'skipped'; reason: 'in-flight' | 'empty-prompt' | 'no-cover' }
    | { status: 'failed' };

// Keeps local theme operations successful when the optional sync server is unavailable.
const saveSyncedThemeWithoutBlocking = (...args: Parameters<typeof saveSyncedThemeForSong>) => {
    void saveSyncedThemeForSong(...args).catch((error) => {
        console.warn('[sync] Failed to upload theme:', error);
    });
};

const sanitizeLegacyTheme = (
    theme: Theme,
    fallbackName: string,
    fallbackTheme: Theme,
): Theme => {
    const sanitized = sanitizeTheme(theme, {
        ...fallbackTheme,
        name: fallbackName,
        description: '',
        wordColors: [],
        lyricsIcons: [],
        provider: 'AI',
    });

    return {
        ...sanitized,
        name: sanitized.name?.trim() || fallbackName,
        description: sanitized.description || '',
        provider: sanitized.provider || 'AI',
    };
};

const getSelectedDualTheme = (dualTheme: DualTheme, isDaylight: boolean) => (
    isDaylight ? dualTheme.light : dualTheme.dark
);

export function useThemeController({
    defaultTheme,
    daylightTheme,
    isDaylight,
    setDaylightPreference,
    coverUrl,
    t,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
    setDaylightPreference: (enabled: boolean) => void;
    coverUrl?: string | null;
    t: (key: string, options?: Record<string, unknown>) => string;
}) {
    const getBaseTheme = () => getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
    const initialThemePreferenceState = useMemo<ThemePreferenceSwitchState>(() => {
        const autoSwitchEnabled = readStoredThemeAutoSwitchEnabled();
        return {
            songThemeAutoSwitchEnabled: autoSwitchEnabled,
            songThemeAutoGenerateEnabled: autoSwitchEnabled && readStoredThemeAutoGenerateEnabled(),
        };
    }, []);

    const [theme, setTheme] = useState<Theme>(() => applyStoredAnimationIntensityToTheme(getBaseTheme()));
    const [aiTheme, setAiTheme] = useState<DualTheme | null>(null);
    const [legacyTheme, setLegacyTheme] = useState<Theme | null>(null);
    const [songThemeAutoSwitchEnabled, setSongThemeAutoSwitchEnabled] = useState(initialThemePreferenceState.songThemeAutoSwitchEnabled);
    const [songThemeAutoGenerateEnabled, setSongThemeAutoGenerateEnabled] = useState(initialThemePreferenceState.songThemeAutoGenerateEnabled);
    const [themeGenerationSource, setThemeGenerationSource] = useState<ThemeGenerationSource>(() => readStoredThemeGenerationSource());
    const [bgMode, setBgMode] = useState<ThemeMode>('default');
    const [currentSongHasLocalAiTheme, setCurrentSongHasLocalAiTheme] = useState(false);
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
    const activeThemeGenerationCountRef = useRef(0);
    const themeGenerationSongKeysRef = useRef(new Set<string>());

    const themeSourceModel = useMemo(() => buildThemeSourceModel({
        bgMode,
        aiTheme,
        legacyTheme,
        isDaylight,
        defaultTheme,
        daylightTheme,
        currentSongHasLocalAiTheme,
    }), [aiTheme, bgMode, daylightTheme, defaultTheme, isDaylight, legacyTheme, currentSongHasLocalAiTheme]);

    // The two switches are mutually constrained by the resolvers, so they are only ever written
    // together through applyPreferenceSwitchState -- which lets a ref mirror them exactly. Reading the
    // render-scoped state instead would make two resolver calls in one handler (config import applies
    // both song-theme flags back to back) both start from the pre-import snapshot, so the second
    // write would silently discard the first.
    const preferenceSwitchRef = useRef<ThemePreferenceSwitchState>(initialThemePreferenceState);

    const getPreferenceSwitchState = (): ThemePreferenceSwitchState => preferenceSwitchRef.current;

    const applyPreferenceSwitchState = (state: ThemePreferenceSwitchState) => {
        preferenceSwitchRef.current = state;
        setSongThemeAutoSwitchEnabled(state.songThemeAutoSwitchEnabled);
        setSongThemeAutoGenerateEnabled(state.songThemeAutoGenerateEnabled);
    };

    const beginThemeGeneration = () => {
        activeThemeGenerationCountRef.current += 1;
        setIsGeneratingTheme(true);
    };

    const endThemeGeneration = () => {
        activeThemeGenerationCountRef.current = Math.max(0, activeThemeGenerationCountRef.current - 1);
        setIsGeneratingTheme(activeThemeGenerationCountRef.current > 0);
    };

    useEffect(() => {
        saveStoredAnimationIntensity(theme.animationIntensity);
    }, [theme.animationIntensity]);

    useEffect(() => {
        saveStoredThemeAutoSwitchEnabled(songThemeAutoSwitchEnabled);
    }, [songThemeAutoSwitchEnabled]);

    useEffect(() => {
        saveStoredThemeAutoGenerateEnabled(songThemeAutoGenerateEnabled);
    }, [songThemeAutoGenerateEnabled]);

    useEffect(() => {
        saveStoredThemeGenerationSource(themeGenerationSource);
    }, [themeGenerationSource]);

    useEffect(() => {
        const pointer = bgMode === 'ai' && (aiTheme || legacyTheme) ? 'ai' : 'default';
        saveStoredLastAppliedThemePointer(pointer);
    }, [aiTheme, bgMode, legacyTheme]);

    useEffect(() => {
        setTheme(previousTheme => {
            const normalizeTheme = (nextTheme: Theme) => applyStoredAnimationIntensityToTheme(nextTheme);

            if (bgMode === 'ai') {
                if (aiTheme) {
                    return normalizeTheme(getSelectedDualTheme(aiTheme, isDaylight));
                }

                if (legacyTheme) {
                    return normalizeTheme(legacyTheme);
                }
            }

            const baseTheme = getBaseTheme();
            if (legacyTheme) {
                return normalizeTheme({
                    ...legacyTheme,
                    backgroundColor: baseTheme.backgroundColor,
                });
            }

            return normalizeTheme(resolveBgModeTheme({
                mode: bgMode,
                aiTheme,
                isDaylight,
                defaultTheme,
                daylightTheme,
                previousTheme,
            }));
        });
    }, [aiTheme, bgMode, daylightTheme, defaultTheme, isDaylight, legacyTheme]);

    const handleToggleDaylight = (isLight: boolean) => {
        setDaylightPreference(isLight);
    };

    const handleBgModeChange = (mode: ThemeMode) => {
        setBgMode(mode);
    };

    const handleResetTheme = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
    };

    const applyDefaultTheme = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
        setStatusMsg({
            type: 'success',
            text: t('notifications.appliedDefaultTheme', { themeName: isDaylight ? 'Daylight Default' : 'Midnight Default' }),
        });
    };

    const applyDualTheme = (dualTheme: DualTheme) => {
        const normalizedDualTheme = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme));
        setLegacyTheme(null);
        setAiTheme(normalizedDualTheme);
        void saveToCache('last_dual_theme', normalizedDualTheme);
        setBgMode('ai');
    };

    const applyLegacyTheme = (nextLegacyTheme: Theme) => {
        const normalizedLegacyTheme = applyStoredAnimationIntensityToTheme(
            sanitizeTheme(nextLegacyTheme, FALLBACK_AI_DUAL_THEME.dark),
        );
        setAiTheme(null);
        setLegacyTheme(normalizedLegacyTheme);
        void saveToCache('last_theme', normalizedLegacyTheme);
        setBgMode('ai');
    };

    const applyThemeFallback = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
    };

    const getThemeParkSeedTheme = (): DualTheme => {
        if (aiTheme) {
            return aiTheme;
        }

        const baseDualTheme = applyStoredAnimationIntensityToDualTheme({
            light: {
                ...daylightTheme,
                wordColors: [],
                lyricsIcons: [],
            },
            dark: {
                ...defaultTheme,
                wordColors: [],
                lyricsIcons: [],
            },
        });

        if (legacyTheme) {
            if (isDaylight) {
                baseDualTheme.light = sanitizeLegacyTheme({ ...legacyTheme }, legacyTheme.name || 'Theme Park Light', FALLBACK_AI_DUAL_THEME.light);
            } else {
                baseDualTheme.dark = sanitizeLegacyTheme({ ...legacyTheme }, legacyTheme.name || 'Theme Park Dark', FALLBACK_AI_DUAL_THEME.dark);
            }
            return baseDualTheme;
        }

        if (isDaylight) {
            baseDualTheme.light = sanitizeLegacyTheme({ ...theme }, theme.name || 'Theme Park Light', FALLBACK_AI_DUAL_THEME.light);
        } else {
            baseDualTheme.dark = sanitizeLegacyTheme({ ...theme }, theme.name || 'Theme Park Dark', FALLBACK_AI_DUAL_THEME.dark);
        }

        return baseDualTheme;
    };

    const saveEditedAiDualTheme = (
        dualTheme: DualTheme,
        songOrKey?: SongResult | ThemeCacheSongKey | null,
    ) => {
        const sanitized = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme));
        setLegacyTheme(null);
        setAiTheme(sanitized);
        setBgMode('ai');
        void saveToCache('last_dual_theme', sanitized);
        const syncSong = songOrKey && typeof songOrKey === 'object' ? songOrKey : null;
        const songKey = syncSong ? getPlaybackSongKey(syncSong) : songOrKey;
        if (songKey != null) {
            void saveToCache(`dual_theme_${songKey}`, sanitized);
        }
        if (syncSong) {
            saveSyncedThemeWithoutBlocking(syncSong, sanitized, 'edited');
        }
        setStatusMsg({
            type: 'success',
            text: t('status.aiThemeUpdated', { themeName: getSelectedDualTheme(sanitized, isDaylight).name }),
        });
        return sanitized;
    };

    const handleSongThemeAutoSwitchChange = (enabled: boolean) => {
        applyPreferenceSwitchState(resolveSongThemeAutoSwitchChange(getPreferenceSwitchState(), enabled));
        setStatusMsg({
            type: 'info',
            text: t('notifications.' + (enabled ? 'autoSwitchThemeOn' : 'autoSwitchThemeOff')),
        });
    };

    const handleSongThemeAutoGenerateChange = (enabled: boolean) => {
        applyPreferenceSwitchState(resolveSongThemeAutoGenerateChange(getPreferenceSwitchState(), enabled));
        setStatusMsg({
            type: 'info',
            text: t('notifications.' + (enabled ? 'autoGenerateThemeOn' : 'autoGenerateThemeOff')),
        });
    };

    const handleThemeGenerationSourceChange = (source: ThemeGenerationSource) => {
        setThemeGenerationSource(source);
        setStatusMsg({
            type: 'info',
            text: t(source === 'cover' ? 'notifications.themeSourceCover' : 'notifications.themeSourceAi'),
        });
    };

    const restoreThemeFromLastAppliedPointer = async () => {
        const pointer = readStoredLastAppliedThemePointer();

        if (pointer === 'ai') {
            const lastDualTheme = await getLastDualTheme();
            if (lastDualTheme) {
                applyDualTheme(lastDualTheme);
                return 'fallback-dual' as const;
            }

            const lastLegacyTheme = await getLastLegacyTheme();
            if (lastLegacyTheme) {
                applyLegacyTheme(lastLegacyTheme);
                return 'legacy' as const;
            }
        }

        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
        return 'restored' as const;
    };

    const restoreCachedThemeForSong = async (
        songOrId: ThemeCacheSongKey | SongResult,
        options?: { allowLastUsedFallback?: boolean; preserveCurrentOnMiss?: boolean }
    ) => {
        if (!songThemeAutoSwitchEnabled) {
            if (options?.allowLastUsedFallback) {
                return restoreThemeFromLastAppliedPointer();
            }
            return 'restored' as const;
        }

        // Only the cover source re-derives stale caches on the fly; under the AI source a cached
        // theme must stay put or the auto path would start spending tokens on every old cache.
        const ignoreStaleCoverThemes = themeGenerationSource === 'cover';
        const cachedTheme = typeof songOrId === 'object'
            ? await getCachedThemeStateForSong(songOrId, { ignoreStaleCoverThemes })
            : await getCachedThemeState(songOrId, { ignoreStaleCoverThemes });

        if (cachedTheme.kind === 'dual') {
            setCurrentSongHasLocalAiTheme(true);
            applyDualTheme(cachedTheme.theme);
            return 'dual' as const;
        }

        if (cachedTheme.kind === 'legacy') {
            setCurrentSongHasLocalAiTheme(true);
            applyLegacyTheme(cachedTheme.theme);
            return 'legacy' as const;
        }

        setCurrentSongHasLocalAiTheme(false);

        if (options?.allowLastUsedFallback) {
            const lastDualTheme = await getLastDualTheme();
            if (lastDualTheme) {
                applyDualTheme(lastDualTheme);
                return 'fallback-dual' as const;
            }

            const lastLegacyTheme = await getLastLegacyTheme();
            if (lastLegacyTheme) {
                applyLegacyTheme(lastLegacyTheme);
                return 'legacy' as const;
            }
        }

        if (options?.preserveCurrentOnMiss ?? true) {
            return 'none' as const;
        }

        applyThemeFallback();
        return 'none' as const;
    };

    // Cover-derived theme: the no-AI path. Shared by the "cover" generation source the user can
    // pick and by the fallback taken when the AI call fails for a missing API key.
    const applyCoverDerivedTheme = async (
        currentSong: SongResult | null,
        shouldApply: () => boolean,
        origin: 'chosen' | 'fallback',
        source: 'manual' | 'auto' = 'manual',
    ): Promise<GenerateAIThemeResult> => {
        const coverColors = coverUrl ? await extractRepresentativeColors(coverUrl, 5) : [];
        // Without artwork there is nothing honest to derive: an empty palette would bake the
        // neutral fallback theme into the song's cache. Skip without caching -- a later attempt
        // (cover resolved, manual retry) can still build the real thing.
        if (coverColors.length === 0) {
            if (source === 'manual' && shouldApply()) {
                setStatusMsg({ type: 'error', text: t('status.coverThemeUnavailable') });
            }
            return { status: 'skipped', reason: 'no-cover' };
        }
        const coverTheme = applyStoredAnimationIntensityToDualTheme(buildBuiltinDualTheme({ coverColors }));

        if (currentSong) {
            await saveToCache(`dual_theme_${getPlaybackSongKey(currentSong)}`, coverTheme);
            saveSyncedThemeWithoutBlocking(currentSong, coverTheme, 'fallback');
            setCurrentSongHasLocalAiTheme(true);
        }

        if (!shouldApply()) {
            return { status: 'generated', applied: false };
        }

        applyDualTheme(coverTheme);
        // Auto cover generation is ambient -- it fires on every song switch, and the palette
        // change itself is the feedback. Keep the toast for explicit manual generation only;
        // the AI-fallback note stays in both paths since it explains a surprise.
        if (origin === 'fallback') {
            setStatusMsg({ type: 'info', text: t('status.aiFallbackThemeUsed') });
        } else if (source === 'manual') {
            setStatusMsg({
                type: 'success',
                text: t('status.coverThemeApplied', {
                    themeName: getSelectedDualTheme(coverTheme, isDaylight).name,
                }),
            });
        }

        return { status: 'generated', applied: true };
    };

    const generateAITheme = async (
        lyrics: LyricData | null,
        currentSong: SongResult | null,
        options: GenerateAIThemeOptions = {},
    ): Promise<GenerateAIThemeResult> => {
        const source = options.source ?? 'manual';
        const songKey = currentSong ? getPlaybackSongKey(currentSong) : '__no_song__';
        if (themeGenerationSongKeysRef.current.has(songKey)) {
            return { status: 'skipped', reason: 'in-flight' };
        }

        themeGenerationSongKeysRef.current.add(songKey);
        beginThemeGeneration();
        setStatusMsg({ type: 'info', text: t('status.generatingTheme') });
        try {
            // The cover source never touches the model, so it also never needs a lyric prompt:
            // an instrumental with no title still gets a theme from its artwork. The panel
            // button forces the AI path regardless -- "Generate AI Theme" must mean AI.
            if (themeGenerationSource === 'cover' && !options.forceAi) {
                return await applyCoverDerivedTheme(
                    currentSong,
                    () => options.shouldApply?.() ?? true,
                    'chosen',
                    source,
                );
            }

            const allText = lyrics?.lines.map(line => line.fullText).join('\n').trim() || '';
            const songTitle = currentSong?.name?.trim() || lyrics?.title?.trim() || '';
            const isPureMusic = Boolean(currentSong?.isPureMusic) || isPureMusicLyricText(allText);
            const promptText = (isPureMusic ? songTitle : allText) || allText;

            if (!promptText) {
                if (source === 'manual') {
                    setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
                }
                return { status: 'skipped', reason: 'empty-prompt' };
            }

            const dualTheme = await generateThemeFromLyrics(promptText, {
                isPureMusic,
                songTitle: songTitle || undefined,
            });
            // Contrast floors and the duotone wash ride on top of whatever the model returned;
            // cached and user-edited themes are never re-polished.
            const normalizedDualTheme = applyStoredAnimationIntensityToDualTheme(
                polishAiDualTheme(sanitizeDualTheme(dualTheme)),
            );
            if (currentSong) {
                await saveToCache(`dual_theme_${getPlaybackSongKey(currentSong)}`, normalizedDualTheme);
                saveSyncedThemeWithoutBlocking(currentSong, normalizedDualTheme, source === 'auto' ? 'auto' : 'manual');
                setCurrentSongHasLocalAiTheme(true);
            }

            const shouldApply = options.shouldApply?.() ?? true;
            if (!shouldApply) {
                return { status: 'generated', applied: false };
            }

            applyDualTheme(normalizedDualTheme);

            const selectedTheme = getSelectedDualTheme(normalizedDualTheme, isDaylight);
            setStatusMsg({
                type: 'success',
                text: t('status.themeApplied', { themeName: selectedTheme.name }),
            });

            return { status: 'generated', applied: true };
        } catch (error: unknown) {
            console.error(error);
            if (isMissingAiApiKeyError(error)) {
                return await applyCoverDerivedTheme(
                    currentSong,
                    () => options.shouldApply?.() ?? true,
                    'fallback',
                    source,
                );
            }

            if (options.shouldApply?.() ?? true) {
                setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
            }
            return { status: 'failed' };
        } finally {
            themeGenerationSongKeysRef.current.delete(songKey);
            endThemeGeneration();
        }
    };

    const setThemeWithStoredIntensity = (nextTheme: Theme) => {
        if (isThemeAnimationIntensity(nextTheme.animationIntensity)) {
            saveStoredAnimationIntensity(nextTheme.animationIntensity);
        }
        setTheme(applyStoredAnimationIntensityToTheme(nextTheme));
    };

    // Every one of these is invoked from an event, an effect or async work - never read during
    // render for its identity - so a permanent identity is safe here and is what lets the five
    // build*Model memos in App.tsx hold. Before this they changed on every render of this hook,
    // which cascaded into playSong and from there into all four view models.
    const actions = useStableCallbacks({
        setTheme: setThemeWithStoredIntensity,
        setAiTheme,
        setBgMode,
        handleToggleDaylight,
        handleBgModeChange,
        handleResetTheme,
        applyDefaultTheme,
        applyDualTheme,
        applyLegacyTheme,
        applyThemeFallback,
        restoreCachedThemeForSong,
        generateAITheme,
        getThemeParkSeedTheme,
        saveEditedAiDualTheme,
        handleSongThemeAutoSwitchChange,
        handleSongThemeAutoGenerateChange,
        handleThemeGenerationSourceChange,
    });

    return {
        theme,
        aiTheme,
        themeSourceModel,
        songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled,
        themeGenerationSource,
        bgMode,
        isGeneratingTheme,
        ...actions,
    };
}
