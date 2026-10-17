import type { WallMetrics } from '../../../components/wall/layout';

// src/library/suites/bravais/bravaisConstants.ts
// bravais 的几何与开口常量。wall 引擎只认「开口宽度」这个参数（B5 的决定），开口等级的宽度、窄屏阈值、
// 相机缩放档位这些 bravais 自己的 UI 语义放在这里。数值来自原型（dev/prototypes/bravais/index.html）。

/** 与 Lattice、原型相同的格子：128 的格，8 的缝隙。 */
export const BRAVAIS_METRICS: WallMetrics = { cellSize: 128, gap: 8 };

/** 完整信息条（集合页）的开口。 */
export const BRAVAIS_SEAM_FULL_WIDTH = 300;
/** 首页窄缝（只放页签与入口）的开口。 */
export const BRAVAIS_SEAM_HOME_WIDTH = 120;
/** 书脊。 */
export const BRAVAIS_SEAM_SPINE_WIDTH = 64;
/** 视口窄于它时默认收成书脊（设计稿 §5 的 NARROW_VW）。 */
export const BRAVAIS_NARROW_VIEWPORT_PX = 900;

/**
 * 竖屏墙（手机）：视口窄于它且高大于宽时，缝转成横向——开在两行磁贴之间，墙分上下两半（桌面窄窗是竖缝收书脊，
 * 竖屏收书脊放不下内容，所以换轴）。阈值取 700：折叠屏展开、平板竖屏仍走竖缝。
 */
export const BRAVAIS_PORTRAIT_MAX_WIDTH_PX = 700;

export const isBravaisPortraitView = (view: { width: number; height: number }) => (
    view.width < BRAVAIS_PORTRAIT_MAX_WIDTH_PX && view.height > view.width
);

/** 竖屏的相机缩放：128 的格缩到约 112px（与手机原型一致），一屏三列半。 */
export const BRAVAIS_PORTRAIT_SCALE = 0.88;
/** 竖屏缝的基准线：屏幕高度的 34% 处（缝中心停在这，上下两半让出半个开口）。 */
export const BRAVAIS_PORTRAIT_LINE_RATIO = 0.34;

/** 竖屏开口高度：首页横缝两行（页签行 + 切换 / 工具行）。 */
export const BRAVAIS_SEAM_HOME_HEIGHT = 132;
/** 竖屏完整信息条：面包屑 + 标题 + 操作 / 过滤三行。 */
export const BRAVAIS_SEAM_FULL_HEIGHT = 196;
/** 竖屏账户登录 / 确认态（要放得下二维码）。 */
export const BRAVAIS_SEAM_ACCOUNT_HEIGHT = 320;

/** 视口外多渲染的世界距离（世界单位）；翻牌也只翻这个范围以内的磁贴。 */
export const BRAVAIS_OVERSCAN = 420;
/** 离已渲染范围的边缘还剩这么多（世界单位）时重新裁剪。 */
export const BRAVAIS_CULL_EDGE_MARGIN = 160;

/** 相机缩放档位，与 Lattice 的 PosterWall 相同（<640: .52，<1100: .64，否则 .76）。竖屏墙用固定档。 */
export const getBravaisScale = (viewportWidth: number, viewportHeight?: number) => (
    viewportHeight !== undefined && isBravaisPortraitView({ width: viewportWidth, height: viewportHeight })
        ? BRAVAIS_PORTRAIT_SCALE
        : viewportWidth < 640 ? 0.52 : viewportWidth < 1100 ? 0.64 : 0.76
);

/** 缝开合与相机让位的补间时长（秒）。 */
export const BRAVAIS_SEAM_TWEEN_S = 0.36;
export const BRAVAIS_CAMERA_TWEEN_S = 0.42;

/** 缝内容翻转：转到 90° 换内容，再转回来（毫秒）。 */
export const BRAVAIS_SEAM_FLIP_OUT_MS = 160;
export const BRAVAIS_SEAM_FLIP_IN_MS = 240;

/** 磁贴翻牌：前半段转到 90°，后半段转回来；两段合计等于 wall 的 FLIP_DURATION_MS（360）。 */
export const BRAVAIS_TILE_FLIP_OUT_MS = 150;
export const BRAVAIS_TILE_FLIP_IN_MS = 210;
/**
 * 降低动态效果时（B11，bravaisMotion）翻牌换成的淡出 → 换内容 → 淡入：两段合计 0.18s（与宿主中性背景板同一个时长），
 * 所有磁贴同时、不错开；整墙波次（换页签、从搜索 / 播放页进出）也换成它。
 */
export const BRAVAIS_REDUCED_FADE_MS = 180;

/** 聚焦卡 / 键盘焦点让相机露出一个矩形时保留的屏幕边距。 */
export const BRAVAIS_REVEAL_PAD_PX = 24;
/** 缝内容底部在「播放条安全区」之上再多留的距离（设计稿 §5：底距 + 80 + 8）。 */
export const BRAVAIS_SEAM_SAFE_AREA_EXTRA_PX = 8;
/** 没有播放条时缝内容的底边距。 */
export const BRAVAIS_SEAM_BASE_BOTTOM_PX = 20;

/**
 * 两个透明档下缝的纸条要不要加 backdrop blur（亚克力）。先不加：纸条宽 300px，blur 是一笔随分辨率增长、
 * 每帧都要重算的 GPU 成本，要不要加按 B12 的换机实测决定（plan/bravais-transparency-handoff.md）。
 */
export const BRAVAIS_SEAM_ACRYLIC_BLUR = false;
