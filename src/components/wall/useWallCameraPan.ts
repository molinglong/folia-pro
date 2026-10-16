// src/components/wall/useWallCameraPan.ts

import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { WALL_CAMERA_SETTLE_SPRING } from './wallPanMotion';

// Centres the viewport on a world rect without routing per-frame movement through React state.

export type LatticeCamera = { x: number; y: number; scale: number };

type WallRect = { x: number; y: number; width: number; height: number };

type WallCameraPanOptions = {
    cameraRef: MutableRefObject<LatticeCamera>;
    viewportRef: MutableRefObject<{ width: number; height: number }>;
    reducedMotion: boolean | null;
    applyCamera: (camera: LatticeCamera, updateBounds?: boolean) => void;
    /**
     * Publishes cull bounds covering where the camera is headed. Called once when a pan starts,
     * never per frame: an interrupted pan never reaches onComplete, so waiting for the animation
     * to settle before re-culling loses the race against held arrow keys.
     */
    reserveBounds: (camera: LatticeCamera) => void;
};

export const useWallCameraPan = ({
    cameraRef,
    viewportRef,
    reducedMotion,
    applyCamera,
    reserveBounds,
}: WallCameraPanOptions) => {
    const animationRef = useRef<{ stop: () => void } | null>(null);

    const stopPan = useCallback(() => {
        animationRef.current?.stop();
        animationRef.current = null;
    }, []);

    // `instant` skips the flight: entering the wall centres on the playing song before the first
    // paint, where a 0.4s pan from the default camera would only look like a stray drift.
    // `motion.spring` 换用弹簧（吸附用）：从静止缓起、到位缓收，大小距离同一条曲线，小距离也不猛拉。
    const panTo = useCallback((rect: WallRect, instant = false, motion?: { spring?: boolean }) => {
        animationRef.current?.stop();
        const from = cameraRef.current;
        const viewport = viewportRef.current;
        const target = {
            x: viewport.width / 2 - (rect.x + rect.width / 2) * from.scale,
            y: viewport.height / 2 - (rect.y + rect.height / 2) * from.scale,
            scale: from.scale,
        };
        reserveBounds(target);
        if (reducedMotion || instant) {
            animationRef.current = null;
            applyCamera(target, true);
            return;
        }
        if (motion?.spring) {
            // 逐值起弹簧：对象式 animate(from, to, { spring, onUpdate }) 在 motion-dom 的
            // propEffect 路径上 onUpdate 不按帧回调（实测吸附一帧跳到位），两个单值弹簧同参
            // 同帧启动，归一化轨迹相同，x/y 合成的路径与单个向量弹簧一致。
            const live = { x: from.x, y: from.y };
            let remaining = 2;
            let cancelled = false;
            console.log('[snap] 弹簧启动 dx=%s dy=%s', target.x - from.x, target.y - from.y);
            const controls = [
                animate(from.x, target.x, {
                    ...WALL_CAMERA_SETTLE_SPRING,
                    onUpdate: latest => {
                        live.x = latest;
                        applyCamera({ x: live.x, y: live.y, scale: from.scale });
                    },
                    onComplete: () => {
                        if (cancelled || --remaining > 0) {
                            console.log('[snap] x 弹簧落定：remaining=%s cancelled=%s', remaining, cancelled);
                            return;
                        }
                        console.log('[snap] x 弹簧最后落定：清句柄');
                        animationRef.current = null;
                        applyCamera(target, true);
                    },
                }),
                animate(from.y, target.y, {
                    ...WALL_CAMERA_SETTLE_SPRING,
                    onUpdate: latest => {
                        live.y = latest;
                        applyCamera({ x: live.x, y: live.y, scale: from.scale });
                    },
                    onComplete: () => {
                        if (cancelled || --remaining > 0) {
                            console.log('[snap] y 弹簧落定：remaining=%s cancelled=%s', remaining, cancelled);
                            return;
                        }
                        console.log('[snap] y 弹簧最后落定：清句柄');
                        animationRef.current = null;
                        applyCamera(target, true);
                    },
                }),
            ];
            // 中途被新 panTo 顶掉时置 cancelled：两个弹簧的落定时刻略有先后，先落定的那个
            // 不能提前清 animationRef，否则最后一帧的写入会与新动画打架。
            animationRef.current = {
                stop: () => {
                    cancelled = true;
                    controls.forEach(control => control.stop());
                },
            };
            return;
        }
        animationRef.current = animate(0, 1, {
            duration: 0.42,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: progress => applyCamera({
                x: from.x + (target.x - from.x) * progress,
                y: from.y + (target.y - from.y) * progress,
                scale: from.scale,
            }),
            onComplete: () => {
                animationRef.current = null;
                applyCamera(target, true);
            },
        });
    }, [applyCamera, cameraRef, reducedMotion, reserveBounds, viewportRef]);

    useEffect(() => () => animationRef.current?.stop(), []);

    return { panTo, stopPan, animationRef };
};
