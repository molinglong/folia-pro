import { type Texture } from 'three';

// src/components/visualizer/diorama/dioramaTexturePrewarm.ts
// @fork 性能刀A：把「纹理首次上传 GPU」从切换帧里挪走。
//
// 为什么是上传，不是栅格化：diorama 的 canvas 栅格本来就在主页就做完了（`layoutDioramaActiveUnits`
// 的 useMemo 不看 showLyrics，邻行缓存的 effect 也不看），但 `THREE.CanvasTexture` 要等到**第一次被
// 渲染用到**才真正上传。主页上歌词层被 `showLyrics` 挡着不挂载，于是进播放页那一帧，当前行的逐单元
// 平面（每单元 base+glow）和十几条邻行整行平面（每条一张最宽 4096 的画布）在同一帧里全部首传 ——
// CDP trace 里那 45.5ms `FunctionCall @VisualizerDiorama` 之后紧跟着 `GetShaderiv →
// CommandBufferHelper::Finish` 28.5ms、每批约 29ms 的 `CommandBuffer::Flush`，就是主线程在等 GL 把
// 这些提交咽下去。
//
// 解法：`WebGLRenderer.initTexture()` 的官方用途就是「预加载纹理，别等到首帧渲染才付解码+上传的代价」
// （three 源码注释原话）。这里按帧预算把待上传纹理排队上传，每帧只吃几张，把一次尖峰摊平成主页上
// 看不见的几帧小活。**不改任何挂载条件、不碰任何透明度**，所以观感零变化。

export interface DioramaPrewarmBudgets {
    /** 当前行逐单元纹理：张数多但每张小（一个字约 308×369），单帧可以多传几张。 */
    unit: number;
    /** 邻行整行纹理：条数少但每张很大（长句可到 4096 宽），单帧只传一两张。 */
    neighbor: number;
}

/** 高优先（当前行）与低优先（邻行）两条队列；调用方按纹理归属分别 sync。 */
export type DioramaPrewarmPriority = keyof DioramaPrewarmBudgets;

// @fork 性能刀A 的实测开关：`localStorage.diorama_prewarm`
//   缺省           = DEFAULT（当前行 2 张/帧、邻行 1 张/帧）
//   off / 0        = 完全不预热（等价改动前，用来做同包 A/B 对照）
//   aggro          = 6/2（第一版实现的激进档，实测会把主页帧率打下去，留档对比用）
// 只读一次，改档要刷新页面。这是本地魔改版用来做单变量对照的手柄，不是给用户的功能开关。
const PREWARM_FLAG_KEY = 'diorama_prewarm';
export const DIORAMA_PREWARM_DEFAULT: DioramaPrewarmBudgets = { unit: 2, neighbor: 1 };
export const DIORAMA_PREWARM_AGGRO: DioramaPrewarmBudgets = { unit: 6, neighbor: 2 };
export const DIORAMA_PREWARM_OFF: DioramaPrewarmBudgets = { unit: 0, neighbor: 0 };

export const resolveDioramaPrewarmBudgets = (): DioramaPrewarmBudgets => {
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(PREWARM_FLAG_KEY);
    } catch {
        return DIORAMA_PREWARM_DEFAULT;
    }
    const flag = (raw ?? '').trim().toLowerCase();
    if (flag === 'off' || flag === '0') return DIORAMA_PREWARM_OFF;
    if (flag === 'aggro') return DIORAMA_PREWARM_AGGRO;
    if (flag.includes('=') || /^\d+$/.test(flag)) {
        // 直接给数字档：`unit=3,neighbor=1` 或 `4`（两档同值），方便一条命令里试档。
        const parse = (name: string, fallback: number): number => {
            const m = new RegExp(`${name}=(\\d+)`).exec(flag);
            return m ? Number(m[1]) : fallback;
        };
        const flat = /^\d+$/.test(flag) ? Number(flag) : null;
        return {
            unit: parse('unit', flat ?? DIORAMA_PREWARM_DEFAULT.unit),
            neighbor: parse('neighbor', flat ?? DIORAMA_PREWARM_DEFAULT.neighbor),
        };
    }
    return DIORAMA_PREWARM_DEFAULT;
};

export class DioramaTexturePrewarm {
    private readonly queues: Record<DioramaPrewarmPriority, Texture[]> = { unit: [], neighbor: [] };
    /** 已经上传过的纹理永不再传第二次（重复 initTexture 只是白花的状态切换）。 */
    private readonly uploaded = new WeakSet<Texture>();
    private rafId = 0;
    private running = false;
    private disposed = false;

    constructor(
        private readonly renderer: { initTexture: (texture: Texture) => void },
        private readonly budgets: DioramaPrewarmBudgets,
    ) {}

    /**
     * 声明「这些纹理现在需要，尽快在后台帧里传好」。队列里不属于本次集合的待传项会被丢掉 —— 调用方
     * 已经把它从缓存 dispose 了，再上传就是往 GPU 里塞没人引用的纹理。
     */
    sync(textures: readonly Texture[], priority: DioramaPrewarmPriority) {
        if (this.disposed) return;
        // 预算为 0（`diorama_prewarm=off`）时整个特性惰性：不排队也不起 rAF，等价于改动前。
        if (this.budgets.unit + this.budgets.neighbor <= 0) return;
        const wanted = new Set<Texture>(textures);
        const queue = this.queues[priority];
        for (let i = queue.length - 1; i >= 0; i -= 1) {
            if (!wanted.has(queue[i])) queue.splice(i, 1);
        }
        const other = priority === 'unit' ? this.queues.neighbor : this.queues.unit;
        textures.forEach((texture) => {
            if (this.uploaded.has(texture) || queue.includes(texture) || other.includes(texture)) return;
            queue.push(texture);
        });
        if (queue.length > 0) this.start();
    }

    private start() {
        if (this.running || this.disposed) return;
        this.running = true;
        this.rafId = requestAnimationFrame(this.tick);
    }

    /**
     * 每帧各队列只吃预算内的张数（先当前行后邻行）。预算按「张」计：单次上传耗时随尺寸波动，但同类
     * 画布上足够接近，按帧限速比按毫秒限速更简单，也不会像定时器那样被后台节流放大。
     */
    private tick = () => {
        this.rafId = 0;
        if (this.disposed) {
            this.running = false;
            return;
        }
        this.drain(this.queues.unit, this.budgets.unit);
        this.drain(this.queues.neighbor, this.budgets.neighbor);
        // 只在「还有活且这条队列本帧确实有预算」时续帧：某条队列预算为 0 时它传不动，
        // 无条件续帧就变成空转 rAF。
        const hasWork = (this.budgets.unit > 0 && this.queues.unit.length > 0)
            || (this.budgets.neighbor > 0 && this.queues.neighbor.length > 0);
        if (hasWork) {
            this.rafId = requestAnimationFrame(this.tick);
        } else {
            this.running = false;
        }
    };

    private drain(queue: Texture[], budget: number) {
        for (let n = 0; n < budget && queue.length > 0; n += 1) {
            const texture = queue.shift();
            if (!texture || this.uploaded.has(texture)) continue;
            this.uploaded.add(texture);
            try {
                this.renderer.initTexture(texture);
            } catch {
                // 上下文丢失 / 纹理已 dispose 等：跳过这一张，队列继续。预热失败不影响正确性 ——
                // 首帧渲染时 three 仍会自己上传，只是没省到时间。
            }
        }
    }

    /** 场景卸载：取消待传并丢弃队列。纹理本体由各自的缓存负责 dispose，这里只管调度。 */
    dispose() {
        this.disposed = true;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.queues.unit.length = 0;
        this.queues.neighbor.length = 0;
        this.running = false;
    }
}
