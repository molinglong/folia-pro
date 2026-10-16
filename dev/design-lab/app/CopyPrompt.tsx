import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

// dev/design-lab/app/CopyPrompt.tsx：剪贴板不可用时仍可手动选择，避免静默失败。
export function CopyPrompt({ text, label = '复制给 AI' }: { text: string; label?: string }) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setStatus('copied');
        } catch { setStatus('manual'); }
    };
    return <div className="copy-prompt">
        <button className="lab-button" onClick={copy} aria-label={label}>
            {status === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            <span>{status === 'copied' ? '已复制' : label}</span>
        </button>
        {status === 'manual' && <div className="manual-copy" role="group" aria-label="手动复制需求" onKeyDown={e => { if (e.key === 'Escape') setStatus('idle'); }}>
            <div>请选中并复制下方内容 <button aria-label="关闭复制文本" onClick={() => setStatus('idle')}><X size={14} /></button></div>
            <textarea aria-label="AI 需求文本" readOnly value={text} onFocus={e => e.currentTarget.select()} autoFocus />
        </div>}
        <span role="status" className="sr-only">{status === 'copied' ? '需求已复制到剪贴板' : ''}</span>
    </div>;
}
