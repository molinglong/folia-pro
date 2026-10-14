import { create } from 'zustand';
import i18n from '../i18n/config';
import type { VisualizerFrameRate } from '../types';
import { detectDeviceTierHint } from '../utils/deviceCapability';
import { getStoredBoolean, readStoredStringOrNull, setStoredBoolean, setStoredString } from './storagePrimitives';
import { MOTION_SURFACE_IDS, useMotionSettingsStore, type MotionSurfaceId } from './useMotionSettingsStore';
import { setStatusMessage } from './useStatusMessageStore';
import { useThemeSettingsStore } from './useThemeSettingsStore';
import { useVisualizerSettingsStore } from './useVisualizerSettingsStore';

// src/stores/useGraphicsPresetStore.ts
// 把散落在帧率、动态背景、6 项减少动效里的性能开关收敛成一个能看懂的"画质档位"。
//
// 三条核心原则（见 Graphics Quality Tier Preset 方案）：
// 1. 首次进入本版只做"只读指纹判定"落盘档位 id，绝不反向改写任何旧开关值 —— 老用户配置 100% 保留。
// 2. 设备能力检测只用来发一条可忽略的提示，永不自作主张落盘档位，也永不改写开关。
// 3. 档位 id 与实际开关值不一致时（比如通过命令面板单独切了一面动效），UI 展示为"自定义"并提示，
//    同样只读不写 —— 不替用户改设置，只说"你现在看到的不是档位标的那个状态"。
//
// `staticMode` / `glowBlurQuantize` / `enablePlayerPageNativeBlur` 刻意不归档位管：分别是"整体停用
// 可视化"的特殊开关、Linux fd 泄漏的 workaround、带二次确认弹窗的平台专属开关，都不是"画质换流畅"
// 的连续量，跟着档位自动翻转会误伤。
//
// 和 useMotionSettingsStore 出于同样的理由不进外观导入导出（appearanceCodec / visualSettingsConfig）：
// 档位是设备相关设置，不该跟着一个分享出去的主题短码跑到别人的机器上。

export type GraphicsPresetId = 'smooth' | 'balanced' | 'quality' | 'custom';

export const GRAPHICS_PRESET_STORAGE_KEY = 'graphics_preset';
const LOW_SPEC_HINT_SEEN_KEY = 'graphics_preset_low_spec_hint_seen';

const isGraphicsPresetId = (value: unknown): value is GraphicsPresetId => (
    value === 'smooth' || value === 'balanced' || value === 'quality' || value === 'custom'
);

/** 与当前三个预设档一一对应的"完整开关指纹"；`custom` 没有指纹，它不改写任何值。 */
export type GraphicsPresetSwitchSnapshot = {
    visualizerFrameRate: VisualizerFrameRate;
    disableHomeDynamicBackground: boolean;
    reducedMotionSurfaces: Record<MotionSurfaceId, boolean>;
};

const surfacesOf = (reduced: readonly MotionSurfaceId[]): Record<MotionSurfaceId, boolean> => (
    Object.fromEntries(MOTION_SURFACE_IDS.map(surface => [surface, reduced.includes(surface)])) as Record<MotionSurfaceId, boolean>
);

export const GRAPHICS_PRESET_SIGNATURES: Record<Exclude<GraphicsPresetId, 'custom'>, GraphicsPresetSwitchSnapshot> = {
    smooth: {
        visualizerFrameRate: 60,
        disableHomeDynamicBackground: true,
        reducedMotionSurfaces: surfacesOf(MOTION_SURFACE_IDS),
    },
    // 只压最贵的两项（依据 tv-probe 结论：Monet / backdrop-filter 与 WebGL 叠加会放大填充率压力），
    // 其余 4 面是廉价的界面微动效，压了收益不明显、观感损失却很大。
    balanced: {
        visualizerFrameRate: 'off',
        disableHomeDynamicBackground: false,
        reducedMotionSurfaces: surfacesOf(['monetBackground', 'collectionMorph']),
    },
    // 与出厂默认值完全一致，"画质优先"因此等价于"什么都没改"，老用户不会感到行为变化。
    quality: {
        visualizerFrameRate: 'off',
        disableHomeDynamicBackground: false,
        reducedMotionSurfaces: surfacesOf([]),
    },
};

export const readGraphicsPresetSwitchSnapshot = (): GraphicsPresetSwitchSnapshot => ({
    visualizerFrameRate: useVisualizerSettingsStore.getState().visualizerFrameRate,
    disableHomeDynamicBackground: useThemeSettingsStore.getState().disableHomeDynamicBackground,
    reducedMotionSurfaces: useMotionSettingsStore.getState().reducedMotionSurfaces,
});

const surfacesMatch = (a: Record<MotionSurfaceId, boolean>, b: Record<MotionSurfaceId, boolean>) => (
    MOTION_SURFACE_IDS.every(surface => a[surface] === b[surface])
);

/** 指纹匹配：命中某档的完整签名就返回那档，否则返回 `custom`（表示"当前状态不属于任何预设档"）。 */
export const matchGraphicsPresetSignature = (snapshot: GraphicsPresetSwitchSnapshot): GraphicsPresetId => {
    const entry = (Object.entries(GRAPHICS_PRESET_SIGNATURES) as Array<[Exclude<GraphicsPresetId, 'custom'>, GraphicsPresetSwitchSnapshot]>)
        .find(([, signature]) => (
            signature.visualizerFrameRate === snapshot.visualizerFrameRate
            && signature.disableHomeDynamicBackground === snapshot.disableHomeDynamicBackground
            && surfacesMatch(signature.reducedMotionSurfaces, snapshot.reducedMotionSurfaces)
        ));

    return entry ? entry[0] : 'custom';
};

/**
 * 档位此刻实际展示成什么。已经是 `custom` 时不再重新判定（用户主动选的自定义，即使值刚好碰巧
 * 等于某个档位指纹，也不该被自动改标成那个档位）；否则用指纹校验一下，不匹配就退回 `custom`。
 */
export const resolveDisplayedGraphicsPreset = (
    storedPreset: GraphicsPresetId,
    snapshot: GraphicsPresetSwitchSnapshot,
): { preset: GraphicsPresetId; isDrifted: boolean } => {
    if (storedPreset === 'custom') {
        return { preset: 'custom', isDrifted: false };
    }

    const fingerprint = matchGraphicsPresetSignature(snapshot);
    if (fingerprint === storedPreset) {
        return { preset: storedPreset, isDrifted: false };
    }

    return { preset: 'custom', isDrifted: true };
};

const writePresetSwitches = (signature: GraphicsPresetSwitchSnapshot) => {
    const visualizer = useVisualizerSettingsStore.getState();
    const theme = useThemeSettingsStore.getState();
    const motion = useMotionSettingsStore.getState();

    visualizer.handleSetVisualizerFrameRate(signature.visualizerFrameRate);
    theme.handleToggleDisableHomeDynamicBackground(signature.disableHomeDynamicBackground);
    MOTION_SURFACE_IDS.forEach(surface => {
        if (motion.reducedMotionSurfaces[surface] !== signature.reducedMotionSurfaces[surface]) {
            motion.handleToggleReducedMotionSurface(surface, signature.reducedMotionSurfaces[surface]);
        }
    });
};

export type GraphicsPresetState = {
    /** `null` 只存在于模块加载到 initGraphicsPresetOnFirstRun() 之间（bootstrap 在首次渲染前同步调用）。 */
    graphicsPreset: GraphicsPresetId;
    isDrifted: boolean;
    handleSelectGraphicsPreset: (preset: GraphicsPresetId) => void;
    /** 只重算展示用的档位/漂移标记，不改写任何开关、不持久化 —— 供底层 store 变化后刷新标签用。 */
    refreshGraphicsPresetFromLiveSwitches: () => void;
};

const storedPresetOrInitial = (): GraphicsPresetId => {
    const stored = readStoredStringOrNull(GRAPHICS_PRESET_STORAGE_KEY);
    return isGraphicsPresetId(stored) ? stored : 'quality';
};

const initialResolution = resolveDisplayedGraphicsPreset(storedPresetOrInitial(), readGraphicsPresetSwitchSnapshot());

export const useGraphicsPresetStore = create<GraphicsPresetState>((set, get) => ({
    graphicsPreset: initialResolution.preset,
    isDrifted: initialResolution.isDrifted,

    handleSelectGraphicsPreset: (preset) => {
        setStoredString(GRAPHICS_PRESET_STORAGE_KEY, preset);

        // custom 不写任何开关值：它只是"把细粒度开关露出来"，当前值原样保留。
        if (preset !== 'custom') {
            writePresetSwitches(GRAPHICS_PRESET_SIGNATURES[preset]);
        }

        set({ graphicsPreset: preset, isDrifted: false });

        // 每个档位自己的开关切换（帧率限制、首页动态背景）都会各自发一条 toast，见对应 store；
        // 这里只在"自定义"这种不改值的分支补一条，避免选了档位却毫无反馈。
        if (preset === 'custom') {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.graphicsPresetCustom'),
            });
        }
    },

    refreshGraphicsPresetFromLiveSwitches: () => {
        const resolution = resolveDisplayedGraphicsPreset(get().graphicsPreset, readGraphicsPresetSwitchSnapshot());
        if (resolution.preset !== get().graphicsPreset || resolution.isDrifted !== get().isDrifted) {
            set({ graphicsPreset: resolution.preset, isDrifted: resolution.isDrifted });
        }
    },
}));

/**
 * 只在启动时同步跑一次（见 bootstrap.tsx）：
 * - `graphics_preset` 键为 null（从没写过，全新安装或首次升级到带这个功能的版本）：用指纹判定当前
 *   真实开关状态落在哪一档，只写 `graphics_preset` 这一个新键本身，不反向改写任何旧开关。
 * - 紧接着跑一次设备能力检测；如果判出来是"流畅优先"级别、且这台机器目前不在那一档，发一条
 *   一次性、可忽略的提示，不自动跳转、不自动应用。
 */
export const initGraphicsPresetOnFirstRun = () => {
    const stored = readStoredStringOrNull(GRAPHICS_PRESET_STORAGE_KEY);
    if (!isGraphicsPresetId(stored)) {
        const resolved = matchGraphicsPresetSignature(readGraphicsPresetSwitchSnapshot());
        setStoredString(GRAPHICS_PRESET_STORAGE_KEY, resolved);
        useGraphicsPresetStore.setState({ graphicsPreset: resolved, isDrifted: false });
    }

    if (getStoredBoolean(LOW_SPEC_HINT_SEEN_KEY, false)) return;

    const hint = detectDeviceTierHint();
    setStoredBoolean(LOW_SPEC_HINT_SEEN_KEY, true);

    if (!hint) return;

    const current = matchGraphicsPresetSignature(readGraphicsPresetSwitchSnapshot());
    if (current === hint) return;

    setStatusMessage({
        type: 'info',
        text: i18n.t('notifications.graphicsPresetLowSpecHint', { preset: i18n.t(`options.graphicsPreset${hint[0].toUpperCase()}${hint.slice(1)}`) }),
    });
};

// 命令面板或别的入口单独改了某一项动效/帧率时，档位标签要跟着重新判定，不等到下次打开设置面板
// 才更新（订阅而不是轮询，和 useMotionSettingsStore 同步 <html data-reduce-motion> 是同一个路子）。
const refreshOnStoreChange = () => useGraphicsPresetStore.getState().refreshGraphicsPresetFromLiveSwitches();
useVisualizerSettingsStore.subscribe(refreshOnStoreChange);
useThemeSettingsStore.subscribe(refreshOnStoreChange);
useMotionSettingsStore.subscribe(refreshOnStoreChange);
