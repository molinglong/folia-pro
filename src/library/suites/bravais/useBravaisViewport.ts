import { useEffect, useState, type RefObject } from 'react';
import type { WallView } from '../../../components/wall/wallView';
import { BRAVAIS_PORTRAIT_LINE_RATIO, getBravaisScale, isBravaisPortraitView } from './bravaisConstants';

// src/library/suites/bravais/useBravaisViewport.ts
// stage 的视口尺寸与相机缩放：ResizeObserver 量出来，只有尺寸真的变了才写 state（离散；缩放档位按宽度断点）。
// 还没量到之前是 null：墙不画，免得用默认尺寸摆一遍再挪。
// 竖屏墙：缩放用固定档（128 的格约 112px），缝的基准线放在屏高 34% 处（wallView 的 lineY）。

export const useBravaisViewport = (rootRef: RefObject<HTMLElement | null>): WallView | null => {
    const [view, setView] = useState<WallView | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const update = (width: number, height: number) => {
            if (width <= 0 || height <= 0) return;
            setView(current => {
                if (current && current.width === width && current.height === height) return current;
                const portrait = isBravaisPortraitView({ width, height });
                return {
                    width,
                    height,
                    scale: getBravaisScale(width, height),
                    lineY: portrait ? height * BRAVAIS_PORTRAIT_LINE_RATIO : undefined,
                };
            });
        };
        update(root.clientWidth, root.clientHeight);
        const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
        observer.observe(root);
        return () => observer.disconnect();
    }, [rootRef]);

    return view;
};
