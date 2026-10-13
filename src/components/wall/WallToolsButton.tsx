import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { CircleHelp, Command, Layers3, Settings, Settings2, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeSettingsStore } from '../../stores/useLatticeSettingsStore';
import { openCommandPalette } from '../../stores/useAppViewStore';
import { openSettings } from '../../stores/useSettingsModalStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';
import { SlideActionButton } from '../shared/SlideActionButton';
import './WallToolsButton.css';

// src/components/wall/WallToolsButton.tsx
// 海报墙右下角的工具按钮（Lattice 与 bravais 共用）：点按打开锚定的玻璃面板，向左滑打开命令面板。
// 面板里与内容无关的部分在这里：底距（避开播放胶囊）、点外部 / Esc 关闭、海报叠色开关、开灯 / 关灯、帮助的展开；
// 上面那几行条目与帮助的内容由使用方传入（Lattice：聚焦当前歌曲、切歌自动聚焦、队列命令；bravais：定位正在播放、透光）。
// 叠色与灯光读写同一个 useLatticeSettingsStore——一套墙面外观设置同时作用于 Lattice 与资料库墙。
// 从 LatticeFocusButton 抽出（实测反馈 1），Lattice 的 DOM 与样式不变，只多了叠色那一行。
// 两项可选能力（bravais 的工具面板用；Lattice 不传，DOM 与样式不变）：面板顶部一排图标快捷动作（quickActions：图标 + 短字，
// tooltip 是全名与按键提示，可带「生成中」一类的状态）；条目里的滑条（kind: 'slider'：左侧图标可点——音量的静音切换——，
// 拖动时只预览、松手才提交，方向键按步长直接提交）与分组小标题（kind: 'heading'）。
// 翻牌交接（设计稿 §7「进入队列」）：App 在首页层与 Lattice 之上挂一个 WallToolsDock，两面墙的按钮都「认领」进同一个
// dock、由它画出唯一的一颗——进 / 出 Lattice 时按钮节点不重建、原地不动，只换条目与帮助。没有 dock 的地方（组件探针、
// Ponder 的合成界面）照旧就地渲染。
// @fork 本地魔改版：底部那一行多了「设置」齿轮（`[data-wall-tools-settings]`，在操作提示的左边），点了先收面板再 openSettings('options')。
// 用户实测：设置入口只在主页窄缝的工具格里，站在墙上要改设置得跑回主页。加在共享组件里，bravais 资料库墙与 Lattice 两面都有它；
// 帮助弹层 `.lattice-tools-help` 仍是 help-section 的直接子节点（flex-basis: 100% 靠这一点）。
// @fork 本地魔改版（2026-10-13）：可选的 `companion`——工具按钮正上方常驻的一颗直达图标（bravais 给的是「前往 Lattice」）。
// 加在这里而不是各墙自己画，是因为它跟着 dock 的认领走：进了 Lattice 最上面那份归 Lattice、它不给 companion，这颗自然消失，
// 回资料库墙又出现，全程同一个 DOM 节点。不给 companion 时（Lattice、组件探针）渲染出的 DOM 与原来等价。

/** 面板里的一行：动作（点了默认收起面板）或开关（menuitemcheckbox，点了不收起）。 */
export type WallToolsEntry =
    | {
        kind: 'action';
        id: string;
        icon: LucideIcon;
        label: string;
        /** 右侧的按键提示（`: + C` 这类）。 */
        kbd?: string;
        /** 按键提示不进可访问名（Lattice 的「聚焦当前歌曲」那一行如此）。 */
        kbdHidden?: boolean;
        /** 右侧的当前值（不是按键，不画框）。 */
        value?: string;
        disabled?: boolean;
        /** 点了不收起面板（循环切换一类的条目，让人看到新值）。 */
        keepOpen?: boolean;
        onSelect: () => void;
    }
    | {
        kind: 'toggle';
        id: string;
        icon: LucideIcon;
        label: string;
        checked: boolean;
        onToggle: (next: boolean) => void;
    }
    | {
        /** 一条 0–1 的滑条（音量一类）：拖动时 onPreview，松手 / 失焦时 onCommit；方向键、PageUp/Down、Home/End 直接 onCommit。 */
        kind: 'slider';
        id: string;
        /** 滑条的可访问名（也是这一组的名字）。 */
        label: string;
        value: number;
        /** 左侧图标。 */
        icon: LucideIcon;
        /** 按此刻显示的值换图标（音量：静音 / 小 / 大）；不给就一直是 icon。 */
        iconFor?: (value: number) => LucideIcon;
        /** 点左侧图标做的事（音量的静音切换）；不给时图标只是装饰。 */
        iconAction?: { label: string; pressed: boolean; onPress: () => void };
        /** 方向键一步（缺省 0.05）；PageUp / PageDown 是它的两倍。 */
        keyStep?: number;
        /** 右侧数值与 aria-valuetext。 */
        formatValue: (value: number) => string;
        onPreview?: (value: number) => void;
        onCommit: (value: number) => void;
    }
    | {
        /** 分组的小标题（之后的几行属于它）；只是视觉分组，读屏读作带名字的分隔线。 */
        kind: 'heading';
        id: string;
        label: string;
    };

/** 面板顶部一排的图标快捷动作：图标 + 短字，tooltip 是全名（与按键提示）；点了默认收起面板。 */
export type WallToolsQuickAction = {
    id: string;
    icon: LucideIcon;
    /** 全名：可访问名与 tooltip。 */
    label: string;
    /** 图标下的短字。 */
    shortLabel: string;
    /** tooltip 里的按键提示（`: + C`、`Ctrl + B`），不进可访问名。 */
    kbd?: string;
    disabled?: boolean;
    /**
     * 此刻的状态（「正在生成主题…」、不可用的原因）：进 tooltip 与 aria-description。
     * `busy` 时图标轻轻呼吸、短字换成 `statusShort`，按钮挂 aria-busy。
     */
    status?: string;
    statusShort?: string;
    busy?: boolean;
    /** 点了不收起面板（让人看到状态变化：洗牌、生成主题）。 */
    keepOpen?: boolean;
    onSelect: () => void;
};

export type WallToolsButtonProps = {
    /** 面板与帮助的 id 前缀（`<前缀>-panel` / `<前缀>-help`）。 */
    idPrefix: string;
    /** 按钮的 title 与面板的可访问名。 */
    label: string;
    isDaylight: boolean;
    /** 上面那几行；给函数时只在面板打开着渲染时求值（条目的可用性随时变，例如正在播放的那首在不在墙上）。 */
    entries: readonly WallToolsEntry[] | (() => readonly WallToolsEntry[]);
    /** 帮助列表的内容（若干 `<li>`）。 */
    help: ReactNode;
    /** 面板顶部的一排图标快捷动作（可选）；给函数时同 entries，只在面板打开着渲染时求值。不给（或为空）时面板与原来一样。 */
    quickActions?: readonly WallToolsQuickAction[] | (() => readonly WallToolsQuickAction[]);
    /**
     * 在 dock 里时要不要认领（缺省要）：墙此刻不显示（首页层被盖住、当前层不归这面墙）时不认领，dock 里就没有它这一份。
     * 不在 dock 里（就地渲染）时不看它。
     */
    claimed?: boolean;
    /**
     * @fork 本地魔改版：工具按钮正上方常驻的那一颗直达动作（不给时 DOM 与原来一样）。
     * 走 dock 的认领机制：哪面墙在最上面，画的就是它那一份——bravais 给了「前往 Lattice」，Lattice 不给，
     * 于是进了海报墙这颗自然消失，回资料库墙又回来，与按钮同一个节点、不闪。
     */
    companion?: WallToolsCompanion;
};

/**
 * @fork 本地魔改版：常驻那颗的形状。图标按钮，与工具按钮同一套玻璃质感；点了不做二次确认、不展开面板。
 * `kbd` 只进 tooltip，不进可访问名（与快捷动作那一排同一处理）。
 */
export type WallToolsCompanion = {
    id: string;
    icon: LucideIcon;
    label: string;
    kbd?: string;
    onSelect: () => void;
};

/** dock 的登记处（WallToolsDock 提供）：按钮把自己的 props 认领进去，dock 画最后认领的那一份。 */
export type WallToolsDockRegistry = {
    claim: (id: string, props: WallToolsButtonProps) => void;
    release: (id: string) => void;
};

export const WallToolsDockContext = createContext<WallToolsDockRegistry | null>(null);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** 取到百分之一，免得 0.1 + 0.05 一类的浮点尾巴进了存储。 */
const roundPercent = (value: number) => Math.round(value * 100) / 100;

/** 滑条一行（kind: 'slider'）。拖动中的值留在本地（只预览），松手 / 失焦才提交，免得每一帧都写偏好、重渲染应用。 */
function WallToolsSliderRow({ entry }: { entry: Extract<WallToolsEntry, { kind: 'slider' }> }) {
    const [draft, setDraft] = useState<number | null>(null);
    const draftRef = useRef<number | null>(null);
    const shown = draft ?? entry.value;
    const Icon = entry.iconFor ? entry.iconFor(shown) : entry.icon;
    const step = entry.keyStep ?? 0.05;

    const commitDraft = () => {
        const pending = draftRef.current;
        if (pending === null) return;
        draftRef.current = null;
        setDraft(null);
        entry.onCommit(pending);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const deltas: Record<string, number> = {
            ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 2, PageDown: -step * 2,
        };
        let next: number | null = null;
        if (event.key in deltas) next = clamp01(roundPercent(shown + deltas[event.key]));
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 1;
        if (next === null) return;
        // 自己按步长走（原生 range 一步是 step=0.01，太细）；这一下不再交给浏览器，墙的按键监听也认 defaultPrevented。
        event.preventDefault();
        draftRef.current = null;
        setDraft(null);
        entry.onCommit(next);
    };

    return (
        <div role="group" aria-label={entry.label} className="lattice-tools-slider" data-wall-tools-slider={entry.id}>
            {entry.iconAction ? (
                <button
                    type="button"
                    className="lattice-tools-slider-icon"
                    aria-label={entry.iconAction.label}
                    title={entry.iconAction.label}
                    aria-pressed={entry.iconAction.pressed}
                    onClick={entry.iconAction.onPress}
                >
                    <Icon aria-hidden="true" />
                </button>
            ) : (
                <span className="lattice-tools-slider-icon" aria-hidden="true"><Icon /></span>
            )}
            <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={shown}
                aria-label={entry.label}
                aria-valuetext={entry.formatValue(shown)}
                style={{ '--wall-tools-slider-fill': `${Math.round(shown * 100)}%` } as CSSProperties}
                onChange={event => {
                    const next = clamp01(Number(event.currentTarget.value));
                    draftRef.current = next;
                    setDraft(next);
                    entry.onPreview?.(next);
                }}
                onKeyDown={handleKeyDown}
                onPointerUp={commitDraft}
                onPointerCancel={commitDraft}
                onKeyUp={commitDraft}
                onBlur={commitDraft}
            />
            <span className="lattice-tools-slider-value" aria-hidden="true">{entry.formatValue(shown)}</span>
        </div>
    );
}

/** 顶部一排快捷动作（menu 里的一个 group，按钮仍是 menuitem）。 */
function WallToolsQuickRow({ actions, onDone }: { actions: readonly WallToolsQuickAction[]; onDone: () => void }) {
    return (
        <div role="group" className="lattice-tools-quick" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
            {actions.map(action => {
                const Icon = action.icon;
                const tooltip = [action.label, action.status, action.kbd].filter(Boolean).join(' · ');
                return (
                    <button
                        key={action.id}
                        type="button"
                        role="menuitem"
                        className={action.busy ? 'lattice-tools-quick-action is-busy' : 'lattice-tools-quick-action'}
                        data-wall-tools-quick={action.id}
                        aria-label={action.label}
                        aria-description={action.status}
                        aria-busy={action.busy || undefined}
                        title={tooltip}
                        disabled={action.disabled}
                        onClick={() => {
                            action.onSelect();
                            if (!action.keepOpen) onDone();
                        }}
                    >
                        <Icon aria-hidden="true" />
                        <span aria-hidden="true">{action.busy && action.statusShort ? action.statusShort : action.shortLabel}</span>
                    </button>
                );
            })}
        </div>
    );
}

/** 一行条目。 */
function WallToolsRow({ entry, onDone }: { entry: WallToolsEntry; onDone: () => void }) {
    if (entry.kind === 'slider') return <WallToolsSliderRow entry={entry} />;
    if (entry.kind === 'heading') {
        return (
            <div role="separator" aria-label={entry.label} className="lattice-tools-heading" data-wall-tools-heading={entry.id}>
                <span aria-hidden="true">{entry.label}</span>
            </div>
        );
    }
    const Icon = entry.icon;
    if (entry.kind === 'toggle') {
        return (
            <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={entry.checked}
                className="lattice-tools-action"
                onClick={() => entry.onToggle(!entry.checked)}
            >
                <Icon aria-hidden="true" />
                <span>{entry.label}</span>
                <span className={`lattice-tools-toggle ${entry.checked ? 'is-on' : ''}`} aria-hidden="true">
                    <span />
                </span>
            </button>
        );
    }
    return (
        <button
            type="button"
            role="menuitem"
            className="lattice-tools-action"
            onClick={() => {
                entry.onSelect();
                if (!entry.keepOpen) onDone();
            }}
            disabled={entry.disabled}
        >
            <Icon aria-hidden="true" />
            <span>{entry.label}</span>
            {entry.value !== undefined && <span className="lattice-tools-value">{entry.value}</span>}
            {entry.kbd !== undefined && (entry.kbdHidden ? <kbd aria-hidden="true">{entry.kbd}</kbd> : <kbd>{entry.kbd}</kbd>)}
        </button>
    );
}

/** 按钮与面板本身（dock 里与就地渲染都画这一份）。 */
export function WallToolsSurface({ idPrefix, label, isDaylight, entries, help, quickActions, companion }: WallToolsButtonProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const handleToggleLatticeLights = useLatticeSettingsStore(state => state.handleToggleLatticeLights);
    const tintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const handleToggleLatticePosterTint = useLatticeSettingsStore(state => state.handleToggleLatticePosterTint);
    const isWideLayout = useMediaQuery('(min-width: 640px)');
    const bottomPx = usePlayerBottomBarBottomPx(isWideLayout ? 24 : 16);

    const close = () => {
        setIsOpen(false);
        setShowHelp(false);
    };

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setIsOpen(false);
                setShowHelp(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // 这次 Esc 只用来收起面板：墙自己的 Esc 阶梯（bravais 在 window 上听、认 defaultPrevented）不再处理它。
                event.preventDefault();
                setIsOpen(false);
                setShowHelp(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleOpenCommandPalette = () => {
        close();
        openCommandPalette();
    };

    // @fork 本地魔改版：面板底部那颗齿轮做的事。设置入口原本只在主页窄缝的工具格里，站在这面墙上要改设置得先跑回主页。
    // 走的是应用自己的 openSettings（命令面板与各处直达入口同一条路）：只给 tab='options'，不给子页与锚点，
    // 于是落在设置记住的那一组（没有记录时是它的缺省组）。先收面板，免得设置窗盖在半开的面板上。
    const handleOpenSettings = () => {
        close();
        openSettings('options');
    };

    const panelId = `${idPrefix}-panel`;
    const helpId = `${idPrefix}-help`;
    // @fork 本地魔改版：常驻那颗的图标（没有 companion 时是 undefined，下面那一格整块不画）。
    const CompanionIcon = companion?.icon;
    const rows = isOpen ? (typeof entries === 'function' ? entries() : entries) : [];
    const quick = isOpen && quickActions ? (typeof quickActions === 'function' ? quickActions() : quickActions) : [];
    // 叠色开关两边都有（颜色与强度的细调仍在设置页与命令面板）。
    const tintRow: WallToolsEntry = {
        kind: 'toggle',
        id: 'poster-tint',
        icon: Layers3,
        label: t('options.latticePosterTint'),
        checked: tintEnabled,
        onToggle: handleToggleLatticePosterTint,
    };

    return (
        <motion.div ref={rootRef} style={{ bottom: bottomPx }} className={`lattice-tools group ${isDaylight ? 'is-daylight' : ''}${companion ? ' has-companion' : ''}`}>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        id={panelId}
                        role="menu"
                        aria-label={label}
                        initial={{ opacity: 0, scale: 0.9, originX: 1, originY: 1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className={quick.length > 0 ? 'lattice-tools-panel has-quick-actions' : 'lattice-tools-panel'}
                    >
                        {quick.length > 0 && <WallToolsQuickRow actions={quick} onDone={close} />}
                        {rows.map(entry => <WallToolsRow key={entry.id} entry={entry} onDone={close} />)}
                        <WallToolsRow entry={tintRow} onDone={close} />
                        <div className="lattice-tools-help-section" role="none">
                            <button
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={lightsOn}
                                aria-label={t('home.latticeLights')}
                                className="lattice-tools-lights-toggle"
                                onClick={() => handleToggleLatticeLights(!lightsOn)}
                            >
                                <span className={lightsOn ? 'is-active' : ''}>{t('home.latticeLightsOn')}</span>
                                <span className={lightsOn ? '' : 'is-active'}>{t('home.latticeLightsOff')}</span>
                            </button>
                            {/* @fork 本地魔改版：两颗图标按钮（设置、操作提示）包在同一层里，灯光那一颗仍占行首。 */}
                            <div className="lattice-tools-triggers">
                                <button
                                    type="button"
                                    role="menuitem"
                                    data-wall-tools-settings
                                    className="lattice-tools-action lattice-tools-settings-trigger"
                                    aria-label={t('home.wallToolsSettings')}
                                    title={t('home.wallToolsSettings')}
                                    onClick={handleOpenSettings}
                                >
                                    <Settings aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="lattice-tools-action lattice-tools-help-trigger"
                                    aria-label={t('home.latticeHelp')}
                                    title={t('home.latticeHelp')}
                                    aria-expanded={showHelp}
                                    aria-controls={helpId}
                                    onClick={() => setShowHelp(visible => !visible)}
                                >
                                    <CircleHelp aria-hidden="true" />
                                </button>
                            </div>
                            <AnimatePresence initial={false}>
                                {showHelp && (
                                    <motion.div
                                        id={helpId}
                                        role="note"
                                        className="lattice-tools-help"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                    >
                                        <ul>{help}</ul>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* @fork 本地魔改版：常驻那颗排在工具按钮的正上方，且不进文档流（CSS 里绝对定位）。两个理由：
                左边放不下——SlideActionButton 悬停 / 拖动时向左展开的那条 96px 轨道会压住它；
                进文档流会让 .lattice-tools 这只盒子从 48×48 长高，而 test/ui/wallHandoff.spec.ts 全程断言它的
                矩形不动（翻牌交接两面墙共用这一颗）。没有 companion 时下面这一格整块不画，DOM 与原来等价。 */}
            {companion && CompanionIcon && (
                <button
                    type="button"
                    className="lattice-tools-companion"
                    data-wall-tools-companion={companion.id}
                    aria-label={companion.label}
                    title={[companion.label, companion.kbd].filter(Boolean).join(' · ')}
                    onClick={companion.onSelect}
                >
                    <CompanionIcon aria-hidden="true" />
                </button>
            )}
            <SlideActionButton
                icon={isOpen ? X : Settings2}
                title={label}
                onActivate={() => setIsOpen(open => {
                    if (open) setShowHelp(false);
                    return !open;
                })}
                slideIcon={Command}
                slideTitle={t('options.gridSlideTargetCommandPalette')}
                onSlide={handleOpenCommandPalette}
                isDaylight={isDaylight}
                accentColor="var(--text-accent)"
            />
        </motion.div>
    );
}

/**
 * 墙用的入口：外面有 dock 时把 props 认领进去、自己不画（dock 画唯一的一颗）；没有 dock 时就地渲染。
 * 在 AnimatePresence 里退场途中（Lattice 整层淡出）就撤回认领，免得按钮在已经离开的墙上多停一会儿。
 */
export default function WallToolsButton(props: WallToolsButtonProps) {
    const dock = useContext(WallToolsDockContext);
    const id = useId();
    const present = useIsPresent();
    const claimed = (props.claimed ?? true) && present;
    // 每次提交都把最新的 props 交给 dock（条目、帮助随墙的状态变）；不认领时撤回。
    useLayoutEffect(() => {
        if (!dock) return;
        if (claimed) dock.claim(id, props);
        else dock.release(id);
    });
    useLayoutEffect(() => (dock ? () => dock.release(id) : undefined), [dock, id]);
    return dock ? null : <WallToolsSurface {...props} />;
}
