import { describe, expect, it } from 'vitest';
import { DEFAULT_LUMIERE_TUNING } from '@/types';
import {
    LUMIERE_MV_DARK_FIELD_CAP,
    LUMIERE_MV_DARK_FIELD_SCALE,
    LUMIERE_MV_TEXT_REGION_DIM,
    applyLumiereMvSceneOverrides,
    resolveLumiereMvAdaptActive,
    resolveLumiereMvDarkField,
} from '@/components/visualizer/lumiere/lumiereMv';
import {
    LUMIERE_LIVE_SCENE_KEYS,
    requiresLumiereSceneRebuild,
    toLumiereSceneTuning,
} from '@/components/visualizer/lumiere/lumiereRuntimeTuning';
import {
    LUMIERE_BRIGHT_DARK_FIELD_FLOOR,
    resolveLumiereDarkField,
} from '@/components/visualizer/lumiere/lumiereDarkField';

// src/components/visualizer/lumiere/lumiereMv.ts 的契约：背景是 MV 时绘光把自己当背景的那几层让位。
// 这里只测纯函数（判定、暗场折叠、场景 tuning 覆盖、重建与实时读的划分、浅色保底绕行），
// 真机上的叠加观感由 test/component 的用例负责。

const darkTheme = { backgroundColor: '#0b0d12', accentColor: '#88aaff' } as never;
const brightTheme = { backgroundColor: '#f4efe6', accentColor: '#88aaff' } as never;

describe('绘光 MV 适配的判定', () => {
    it('只有背景类型为 mv 才生效，其余背景与缺省都不生效', () => {
        expect(resolveLumiereMvAdaptActive({ mode: 'mv' })).toBe(true);
        expect(resolveLumiereMvAdaptActive({ mode: 'common' })).toBe(false);
        expect(resolveLumiereMvAdaptActive({ mode: 'monet' })).toBe(false);
        expect(resolveLumiereMvAdaptActive({ mode: null })).toBe(false);
        expect(resolveLumiereMvAdaptActive(undefined)).toBe(false);
    });
});

describe('绘光 MV 适配的暗场', () => {
    it('按倍率压低再封顶，越界与非法值先钳到 0..1', () => {
        expect(resolveLumiereMvDarkField(0.75, false)).toBe(0.75);
        expect(resolveLumiereMvDarkField(0.75, true)).toBeCloseTo(0.75 * LUMIERE_MV_DARK_FIELD_SCALE);
        // 满格暗场折出来也只剩封顶值，视频不会被完全盖死。
        expect(resolveLumiereMvDarkField(1, true)).toBeCloseTo(LUMIERE_MV_DARK_FIELD_CAP);
        expect(resolveLumiereMvDarkField(0, true)).toBe(0);
        expect(resolveLumiereMvDarkField(3, true)).toBeCloseTo(LUMIERE_MV_DARK_FIELD_CAP);
        expect(resolveLumiereMvDarkField(Number.NaN, true)).toBe(0);
    });

    it('浅色主题的保底只在适配不生效时兜住', () => {
        expect(resolveLumiereDarkField(brightTheme, 0.2).alpha).toBeCloseTo(LUMIERE_BRIGHT_DARK_FIELD_FLOOR);
        expect(resolveLumiereDarkField(brightTheme, 0.2, true).alpha).toBeCloseTo(0.2);
        // 深色主题本来就没有保底，旁路与否同一个值。
        expect(resolveLumiereDarkField(darkTheme, 0.2, true).alpha).toBeCloseTo(0.2);
    });
});

describe('绘光 MV 适配折进场景 tuning', () => {
    it('非 MV 路径原样返回同一个对象', () => {
        const scene = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        expect(applyLumiereMvSceneOverrides(scene, false)).toBe(scene);
        expect(scene.mvDarkFieldBypassFloor).toBe(false);
        expect(scene.darkField).toBe(DEFAULT_LUMIERE_TUNING.darkField);
    });

    it('MV 让位：暗场折叠 + 旁路、背景歌词 / 线稿 / 主题图标关掉、文字区亮带吸掉，字上的效果不动', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const mv = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true, mvAdapt: true });
        expect(mv.darkField).toBe(resolveLumiereMvDarkField(base.darkField, true));
        expect(mv.mvDarkFieldBypassFloor).toBe(true);
        expect(mv.echo).toBe(0);
        expect(mv.lineArt).toBe(false);
        expect(mv.themeIcons).toBe(false);
        expect(mv.textGlowScale).toBe(0);
        expect(mv.textRegionDim).toBe(LUMIERE_MV_TEXT_REGION_DIM);
        // 绘光本身保留：光强与烟的倍率不动，只是文字区那一块的光被吸走；浮尘、前景散景、辉光、崩解、文字区都在。
        expect(mv.lightIntensity).toBe(base.lightIntensity);
        expect(mv.fogDensity).toBe(base.fogDensity);
        expect(mv.moteAmount).toBe(base.moteAmount);
        expect(mv.frontBokeh).toBe(base.frontBokeh);
        expect(mv.bloom).toBe(base.bloom);
        expect(mv.textBloom).toBe(base.textBloom);
        expect(mv.decay).toBe(base.decay);
        expect(mv.windowNeighbors).toBe(base.windowNeighbors);
        // 用户把光强或烟雾调过也照常折过来，适配只改"当背景"的那几层。
        const tuned = toLumiereSceneTuning(
            { ...DEFAULT_LUMIERE_TUNING, lightIntensity: 1.6, fogDensity: 0.4, lineArt: true, themeIcons: true },
            { showText: true, mvAdapt: true },
        );
        expect(tuned.lightIntensity).toBe(1.6);
        expect(tuned.fogDensity).toBe(0.4);
        expect(tuned.lineArt).toBe(false);
        expect(tuned.themeIcons).toBe(false);
    });

    it('不显示歌词时的背景歌词关闭与 MV 让位互不干扰', () => {
        expect(toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: false, mvAdapt: true }).echo).toBe(0);
        expect(toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: false }).echo).toBe(0);
    });

    it('切到 MV 要重建场景（线稿与背景歌词是建场景时烘焙的），暗场本身是每帧现读', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const mv = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true, mvAdapt: true });
        expect(requiresLumiereSceneRebuild(base, mv)).toBe(true);
        expect(requiresLumiereSceneRebuild(mv, base)).toBe(true);
        expect(LUMIERE_LIVE_SCENE_KEYS).toContain('darkField');
        expect(LUMIERE_LIVE_SCENE_KEYS).toContain('mvDarkFieldBypassFloor');
        // 只有暗场变的场合（用户拖滑块）不该触发重建。
        expect(requiresLumiereSceneRebuild(base, { ...base, darkField: 0.1 })).toBe(false);
    });

    it('画框不在场景覆盖里，由运行时的 overlay 层直接读用户 tuning', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const mv = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true, mvAdapt: true });
        expect(mv.overlayFrame).toBe(base.overlayFrame);
    });

    it('字后面的柔光只折追字光斑与下光晕，且每帧现读不重建', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const mv = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true, mvAdapt: true });
        // 不让位时按原样：这两团是绘光的常态观感，亮带也不吸。
        expect(base.textGlowScale).toBe(1);
        expect(base.textRegionDim).toBe(0);
        // 让位时两团不画，但贴在笔画上的闪点与十字爆闪、径迹都没开关可关，也不受适配影响。
        expect(mv.textGlowScale).toBe(0);
        expect(mv.keywordColors).toBe(base.keywordColors);
        expect(mv.hideTrails).toBe(base.hideTrails);
        expect(mv.unlitOpacity).toBe(base.unlitOpacity);
        // 每帧从共享 tuning 现读：单改这两项不触发重建。
        expect(LUMIERE_LIVE_SCENE_KEYS).toContain('textGlowScale');
        expect(LUMIERE_LIVE_SCENE_KEYS).toContain('textRegionDim');
        expect(requiresLumiereSceneRebuild(base, { ...base, textGlowScale: 0 })).toBe(false);
        expect(requiresLumiereSceneRebuild(base, { ...base, textRegionDim: LUMIERE_MV_TEXT_REGION_DIM })).toBe(false);
    });
});
