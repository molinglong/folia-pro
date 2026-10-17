import React, { type MutableRefObject, type RefObject } from 'react';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { computeLightsRippleDelay } from '../../../components/wall/lightsRipple';
import { EMPTY_PLATE_BLOCKS, type PlateBlockSet } from './bravaisBlockPlate';
import BravaisBlockPlates from './BravaisBlockPlates';
import { resolveSlotFace, type BravaisDisplay } from './bravaisDisplay';
import { isSeeThroughFace } from './bravaisLook';
import BravaisTile, { type BravaisTileHandlers, type BravaisTileRect } from './BravaisTile';

// src/library/suites/bravais/BravaisWall.tsx
// 墙的两半：缝锚点左边的 slot 进左边的世界层，右边的进右边的（缝只开在块边界上，没有 slot 跨过它）。两个世界层的
// transform 由 stage 每帧直接写（bravaisFrame），这里只在裁剪范围、显示的层、聚焦 / 焦点变化时渲染。
// 透光档（B12b）：每一半先画各自块的实色底板（BravaisBlockPlates，在磁贴之下），底板随世界层一起平移。

type BravaisWallProps = {
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    anchorX: number | null;
    /** 竖屏横缝的锚点（世界 y）：给了它墙就按行分上下两半（left / right 两半即上 / 下）。 */
    anchorY?: number | null;
    /** 聚焦卡所在块的让位矩形（slot key → 新矩形）。 */
    reflow: ReadonlyMap<string, BravaisTileRect>;
    expandedSlotKey: string | null;
    focusedSlotKey: string | null;
    /** B7：列表面板里悬停的那一项。 */
    linkedKey?: string | null;
    pixelScale: number;
    reducedMotion: boolean;
    didDragRef: MutableRefObject<boolean>;
    handlers: BravaisTileHandlers;
    leftRef: RefObject<HTMLDivElement | null>;
    rightRef: RefObject<HTMLDivElement | null>;
    /** 透光档的块底板（按缝锚点分好左右）；实色档为空。 */
    plates?: PlateBlockSet;
};

const BravaisWall: React.FC<BravaisWallProps> = ({
    slots,
    display,
    anchorX,
    anchorY = null,
    reflow,
    expandedSlotKey,
    focusedSlotKey,
    linkedKey = null,
    pixelScale,
    reducedMotion,
    didDragRef,
    handlers,
    leftRef,
    rightRef,
    plates = EMPTY_PLATE_BLOCKS,
}) => {
    const left: React.ReactNode[] = [];
    const right: React.ReactNode[] = [];
    const nowPlayingKey = display?.layer.nowPlayingKey ?? null;
    // 涟漪熄灯中心：正在播放那一项所在 slot 的矩形中心（世界坐标）。reflow 里拿得到就用让位后的矩形，与下面给
    // 磁贴的 rect 一致；否则用 slot 自己。没在播 / 当前层里没现在播这一项时 origin 为 null，延迟固定 0。
    let lightsRippleOrigin: { x: number; y: number } | null = null;
    if (nowPlayingKey) {
        for (const slot of slots) {
            const { item } = resolveSlotFace(display, slot);
            if (!item || item.key !== nowPlayingKey) continue;
            const rect = reflow.get(slot.key) ?? slot;
            lightsRippleOrigin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            break;
        }
    }
    for (const slot of slots) {
        const { item, kind } = resolveSlotFace(display, slot);
        const expanded = slot.key === expandedSlotKey;
        const rect = reflow.get(slot.key) ?? slot;
        const tile = (
            <BravaisTile
                key={slot.key}
                slotKey={slot.key}
                rect={rect}
                item={item}
                kind={kind}
                seeThrough={isSeeThroughFace(display?.look ?? 'solid', kind, expanded)}
                step={display?.flips.get(slot.key)}
                nowPlayingKey={nowPlayingKey}
                expanded={expanded}
                keyboardFocused={slot.key === focusedSlotKey}
                queued={expanded && Boolean(item && display?.layer.queuedKeys.has(item.key))}
                linked={Boolean(item && linkedKey !== null && item.key === linkedKey)}
                pixelScale={pixelScale}
                reducedMotion={reducedMotion}
                entrance={display?.entrance ?? null}
                didDragRef={didDragRef}
                handlers={handlers}
                lightsRippleDelay={computeLightsRippleDelay(rect, lightsRippleOrigin)}
            />
        );
        const before = anchorY !== null ? slot.y < anchorY : anchorX !== null && slot.x < anchorX;
        (before ? left : right).push(tile);
    }
    return (
        <>
            <div ref={leftRef} className="lattice-world" data-bravais-half="left">
                <BravaisBlockPlates blocks={plates.left} />
                {left}
            </div>
            <div ref={rightRef} className="lattice-world" data-bravais-half="right">
                <BravaisBlockPlates blocks={plates.right} />
                {right}
            </div>
        </>
    );
};

export default BravaisWall;
