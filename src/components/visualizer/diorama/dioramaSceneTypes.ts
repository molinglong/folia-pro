import * as THREE from 'three';
import { type Line } from '../../../types';
import { type DioramaTextPlacement } from './cameraPath';

// src/components/visualizer/diorama/dioramaSceneTypes.ts
// 镜台场景内部结构：可见行、阻尼主题色、当前行的单元与其栅格。

export interface VisibleLineEntry {
    index: number;
    line: Line;
    placement: DioramaTextPlacement;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    /** True for lines belonging to the OUTGOING corridor during a transition (a different segment than
     * the active one): rendered as a receding departing cluster rather than the current-song neighbours. */
    isOutgoing: boolean;
}

export interface DampedThemeColors {
    primary: THREE.Color;
    accent: THREE.Color;
    secondary: THREE.Color;
    bg: THREE.Color;
}

// One "unit" of the active line, rendered as its OWN plane: a single grapheme for CJK (每个字单独),
// a whole word for other scripts (每个词单独). charStart/charEnd are code-unit indices into the line
// string, used to measure the unit's exact slot in the full-line layout (kerning preserved).
export interface LyricUnit {
    text: string;
    charStart: number;
    charEnd: number;
    startTime: number;
    endTime: number;
}

// Graphemes that split per character: han, kana, compatibility ideographs, half-width kana, PLUS
// bullets/geometric shapes (the interlude countdown dots ●●● must each be their own unit so the
// glow can centre on each dot). Everything else (latin etc.) groups into per-word units.
export const CJK_GRAPHEME_RE = /[⺀-鿿぀-ヿ豈-﫿ｦ-ﾟ•·■-◿]/;

// A laid-out, rasterised unit of the active line, in world units at scale 1.
// @fork 性能刀A-2：原来这里挂的是整张 `DioramaUnitRaster`（每单元两张独立画布）。图集化之后，无论走
// 图集还是走 `diorama_unit_atlas=off` 的逐张老路，平面层拿到的都是同一份「两张纹理 + 各自世界尺寸」，
// 所以类型只描述平面需要知道的事，不再关心纹理是不是共享一张图集。
export interface PlacedUnitRaster {
    baseTexture: THREE.Texture;
    glowTexture: THREE.Texture;
    centerX: number;
    /** 字身平面尺寸（世界单位）。 */
    baseWidth: number;
    baseHeight: number;
    /** 辉光平面尺寸（世界单位，比字身大一圈）。 */
    glowWidth: number;
    glowHeight: number;
}

/** 当前行全部单元的栅格结果 + 这一行的整体排版宽度，外加「这一行的 GPU 资源」的统一出口。 */
export interface DioramaActiveUnitsRaster {
    units: PlacedUnitRaster[];
    lineWidth: number;
    /** 真正要上传 GPU 的纹理：图集模式 2 张，逐张模式 2N 张。预热看这个，别去数 clone。 */
    textures: THREE.Texture[];
    dispose: () => void;
}
