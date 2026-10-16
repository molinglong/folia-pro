// Copyright (c) 2026 chthollyphile
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_RINGS_TUNING, type RingsTuning } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixiRuntimeHost';
import VisualizerShell from '../VisualizerShell';
import type { RingsPixiRuntime, RingsSongContext } from './createRingsPixiRuntime';
import type { RingsAudioSample } from './ringsBeatDetector';

// src/components/visualizer/rings/VisualizerRings.tsx
// 年轮的 React 外壳：歌词大字与年轮画在同一张 Pixi 画布上（字是环的源头，必须像素级对齐），
// 因此不挂共享字幕层，只挂共享 shell（背景 / 返回键 / 整体透明度）。Pixi 运行时建一次，
// 换歌、tuning、主题、显示开关都就地推给它。每帧时间只在运行时的循环里读 currentTime。

const VisualizerRings: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        isDaylight = false,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        staticMode = false,
        seed = 'rings',
        ringsTuning = DEFAULT_RINGS_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ tuning: ringsTuning, showText, staticMode, currentLineIndex, audioPower, audioBands });
    latestRef.current = { tuning: ringsTuning, showText, staticMode, currentLineIndex, audioPower, audioBands };

    // 每帧一次的音频采样：宿主的 MotionValue 是 0..255，归一化到模组算法期望的 0..1。
    const readAudioSample = useCallback((): RingsAudioSample => {
        const { audioPower: power, audioBands: bands } = latestRef.current;
        return {
            power: power.get() / 255,
            bass: bands.bass.get() / 255,
            lowMid: bands.lowMid.get() / 255,
            spectrum: bands.spectrum?.get() ?? null,
        };
    }, []);

    const song = useMemo<RingsSongContext>(() => ({ lines, seed }), [lines, seed]);

    const runtimeRef = useVisualizerPixiHost<RingsPixiRuntime, RingsSongContext>({
        hostRef,
        label: 'Rings',
        // 运行时建一次；歌、tuning、主题、暂停、静态模式都就地推给运行时。
        rebuildKey: [],
        song,
        create: async (host, songContext, signal) => {
            const { RingsPixiRuntime: createRuntime } = await import('./createRingsPixiRuntime');
            const latest = latestRef.current;
            return createRuntime.create({
                host,
                song: songContext,
                tuning: latest.tuning,
                theme,
                isDaylight,
                lyricsFontScale,
                currentTime,
                audio: readAudioSample,
                staticMode: latest.staticMode,
                lineIndex: latest.currentLineIndex,
                showText: latest.showText,
                signal,
            });
        },
        swap: (runtime, songContext) => {
            runtime.setSong(songContext);
        },
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        runtimeRef.current?.setTuning(ringsTuning);
    }, [ringsTuning, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setLook(theme, isDaylight, lyricsFontScale);
    }, [theme, isDaylight, lyricsFontScale, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setShowText(showText);
    }, [showText, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setStaticMode(staticMode);
    }, [staticMode, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setLineIndex(currentLineIndex);
    }, [currentLineIndex, runtimeRef]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 500);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <div ref={hostRef} className="absolute inset-0 z-10" aria-hidden="true" />
                {runtimeFailed && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-10 text-center transition-opacity duration-300"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: fallbackFontFamily,
                            fontWeight: fallbackFontWeight,
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText && lines[currentLineIndex]?.fullText ? lines[currentLineIndex].fullText : null}
                    </div>
                )}
            </div>
        </VisualizerShell>
    );
};

export default VisualizerRings;
