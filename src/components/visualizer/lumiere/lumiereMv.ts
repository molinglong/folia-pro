// Copyright (c) 2026 chthollyphile
import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import type { LumiereSceneTuning } from './types';

// src/components/visualizer/lumiere/lumiereMv.ts
// 绘光的 MV 适配（纯函数，运行时与单测共用）：背景类型选成 MV 时，绘光不换渲染管线，只把"自己当背景"的
// 那几层让位——光场本来就是合法预乘色、近似 screen 的混合（lightFieldShader.ts），叠在视频上与叠在透明底上
// 观感一致，体积光 / 烟雾 / 浮尘 / 散景 / 字上的效果全部保留（它们是绘光本身，不是背景）。
// 让位的几样：暗场底（唯一真正盖住画面的）、背景歌词（巨大空心字）、线稿与主题图标、画框，
// 以及垫在字后面的追字光斑与下光晕（它们在一行字后面抹出一块跟着走的柔光，在视频上看着像一块小背景）。
// 再往下是 MV 特供版真正的那一刀：光场在文字区汇聚出的那条亮带也吸掉（着色器的 uTextDim），
// 字仍按没吸之前的光强点亮，所以字还是被光照着的样子，只是光不在它身后留下一块。
// 自动生效、不加开关、不存新键（跟现有背景类变体一致）；只看用户选的背景类型，
// 不探测这首歌到底有没有 MV——没有时背景回退通用底，压低的暗场在通用底上同样成立。

/** MV 适配生效时暗场的封顶：再压一点也要留住"字打在烟里"的底，不让视频满亮抢字的戏。 */
export const LUMIERE_MV_DARK_FIELD_CAP = 0.45;
/** MV 适配生效时用户暗场的倍率：保留相对档位，滑块仍有效，只是整体往下压。 */
export const LUMIERE_MV_DARK_FIELD_SCALE = 0.5;
/**
 * MV 适配生效时文字区里光被吸走多少：光束在文字区汇聚、叠上烟与光源眩光，就是字后面那条亮带。
 * 留一点不吸完，是为了让遮罩的边缘有个过渡，不在半空中硬切出一个洞。
 */
export const LUMIERE_MV_TEXT_REGION_DIM = 0.9;

/** 绘光自己按 props 判定是否走 MV 适配：背景类型为 mv 即生效。 */
export const resolveLumiereMvAdaptActive = (background?: VisualizerBackgroundConfig): boolean => (
    background?.mode === 'mv'
);

/** MV 适配生效时暗场滑块的生效值：×倍率再封顶；不生效时原样返回。 */
export const resolveLumiereMvDarkField = (darkField: number, mvAdapt: boolean): number => {
    if (!mvAdapt) return darkField;
    const scaled = Number.isFinite(darkField) ? Math.min(1, Math.max(0, darkField)) * LUMIERE_MV_DARK_FIELD_SCALE : 0;
    return Math.min(scaled, LUMIERE_MV_DARK_FIELD_CAP);
};

/**
 * 把"自己当背景"的几层让位折进场景 tuning：暗场压低 + 绕过浅色保底、背景歌词 / 线稿 / 主题图标关掉，
 * 字后面的两团柔光（追字光斑、下光晕）不画，文字区里那条亮带吸掉。
 * 画框不在这里（它由运行时的 overlay 层直接读用户 tuning，见 createLumierePixiRuntime.drawOverlay）。
 * mvAdapt 为 false 时原样返回同一个对象，非 MV 路径的取值与引用都不变。
 */
export const applyLumiereMvSceneOverrides = (
    scene: LumiereSceneTuning,
    mvAdapt: boolean,
): LumiereSceneTuning => {
    if (!mvAdapt) return scene;
    return {
        ...scene,
        darkField: resolveLumiereMvDarkField(scene.darkField, true),
        mvDarkFieldBypassFloor: true,
        echo: 0,
        lineArt: false,
        themeIcons: false,
        textGlowScale: 0,
        textRegionDim: LUMIERE_MV_TEXT_REGION_DIM,
    };
};
