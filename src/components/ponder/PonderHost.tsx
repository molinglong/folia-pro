import React, { Suspense, lazy, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { countRender } from '../../dev/renderCount';
import { usePonderStore } from '../../stores/usePonderStore';
import { usePonderHoverProbe } from '../../hooks/usePonderHoverProbe';
import { usePonderHoldToEnter } from '../../hooks/usePonderHoldToEnter';
import { usePagePonderShortcut } from '../../hooks/usePagePonderShortcut';
import PagePonderTouchButton from './PagePonderTouchButton';
import PonderNavigationPage from './PonderNavigationPage';
import type { Theme } from '../../types';

// src/components/ponder/PonderHost.tsx
// 思索功能的唯一挂载点：常驻的悬停探测，以及按需懒加载的教程层。
//
// @fork 本地魔改版（用户：「把这个删了」→ 选定「彻底删掉胶囊 + 摘掉设置项」）：跟随光标的
// 「按 G 思索」提示胶囊（PonderHintCapsule）在这里不再渲染。源文件、悬停探测、长按状态机都留着，
// 所以长按 G 进教程、Ctrl+G 讲整页、思索导航页、触屏右上角那颗灯泡、命令面板入口全部照旧。
//
// 教程层单独走 React.lazy，理由和 App.tsx:22 对 AutomixTransitionAnimation 的处理一样：
// animejs 约 38KB gz，只有真的要看教程时才该下载它。

const PonderStage = lazy(() => import('./PonderStage'));

type PonderHostProps = {
    theme?: Theme;
    isDaylight: boolean;
};

const PonderHost: React.FC<PonderHostProps> = ({ theme, isDaylight }) => {
    // 光标跟随必须一次重渲染都不产生，这个计数是那条约束唯一可验证的出口。
    countRender('PonderHost');
    const hasSession = usePonderStore(state => state.session !== null);

    // @fork 本地魔改版：胶囊不再渲染，这三枚 ref 也永远拿不到节点。仍然传给长按链是因为
    // startPonderHoldProgress（hooks/ponderHoldProgress.ts）对每一枚都判了 null —— 拿不到就不起
    // 动画，长按 400ms 的门、命中判断、开教程全都照旧，只是没有进度擦除这一条视觉反馈（用户选的）。
    const wipeRef = useRef<HTMLDivElement | null>(null);
    const labelRef = useRef<HTMLSpanElement | null>(null);
    const holdLabelRef = useRef<HTMLSpanElement | null>(null);

    const hoveredElementRef = usePonderHoverProbe();
    usePonderHoldToEnter({ hoveredElementRef, wipeRef, labelRef, holdLabelRef });
    // 页面级 Ctrl+G 同样是长按，返回值以前只用来决定胶囊写哪段文案，现在没人读了。
    usePagePonderShortcut({ wipeRef, labelRef, holdLabelRef });

    return (
        <>
            <PonderNavigationPage theme={theme} isDaylight={isDaylight} />

            <PagePonderTouchButton
                accent={theme?.accentColor || (isDaylight ? '#27272a' : '#fafafa')}
                isDaylight={isDaylight}
            />

            {/* 教程层自己带进出场，AnimatePresence 负责在 session 清掉之后留住它把退场播完。 */}
            <AnimatePresence>
                {hasSession && (
                    <Suspense key="ponder-stage" fallback={null}>
                        <PonderStage theme={theme} isDaylight={isDaylight} />
                    </Suspense>
                )}
            </AnimatePresence>
        </>
    );
};

export default PonderHost;
