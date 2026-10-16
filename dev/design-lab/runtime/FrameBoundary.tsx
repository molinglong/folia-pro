import { Component, type ReactNode } from 'react';

// dev/design-lab/runtime/FrameBoundary.tsx：单案错误只影响当前 iframe。
export function FrameError({ path, error }: { path: string; error: string }) {
    return <section className="frame-error" role="alert">
        <span className="eyebrow">预览暂时不可用</span>
        <h1>这个方案需要修正</h1>
        <p>其他方案不受影响。请把下面的文件和错误交给 AI 修复。</p>
        <code>{path}</code><pre>{error}</pre>
        <button onClick={() => window.location.reload()}>重新加载此方案</button>
    </section>;
}
export class FrameBoundary extends Component<{ path: string; children: ReactNode }, { error: string | null }> {
    state: { error: string | null } = { error: null };
    static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
    render() {
        return this.state.error
            ? <FrameError path={this.props.path} error={this.state.error} />
            : this.props.children;
    }
}
