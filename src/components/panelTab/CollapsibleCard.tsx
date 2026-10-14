import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface CollapsibleCardProps {
    /** 折叠标题左侧内容（图标 + 文字等）。 */
    title: React.ReactNode;
    /** 标题右侧内容（状态摘要、操作按钮等），始终可见，不参与折叠。 */
    right?: React.ReactNode;
    /** 折叠起来后被收起的内容。 */
    children: React.ReactNode;
    /** 外层卡片容器样式。 */
    className?: string;
    /** 展开区内容样式（用来补标题与正文之间的间距）。 */
    bodyClassName?: string;
    /** 默认是否展开，默认折叠。 */
    defaultOpen?: boolean;
}

/**
 * 通用的可折叠设置卡片：标题行常驻，右侧只有一颗展开/收起箭头，
 * 标题里的按钮（如导入 / 匹配）不会触发折叠，避免误触。折叠状态只在组件内部保存，不做持久化。
 */
const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
    title,
    right,
    children,
    className = '',
    bodyClassName = '',
    defaultOpen = false,
}) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={className}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">{title}</div>
                <div className="flex shrink-0 items-center gap-1">
                    {right}
                    <button
                        type="button"
                        onClick={() => setOpen(v => !v)}
                        aria-expanded={open}
                        className="p-1 rounded-md transition-all opacity-50 hover:opacity-100 hover:bg-white/10"
                    >
                        <ChevronDown
                            size={14}
                            className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
                        />
                    </button>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div className={bodyClassName}>{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default CollapsibleCard;
