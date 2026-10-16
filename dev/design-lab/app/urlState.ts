import type { Catalog, LabState } from '../types';
import { getVariants } from '../runtime/catalogModel';

// dev/design-lab/app/urlState.ts：分享链接只携带试验参数，不保存账号或方案中的表单内容。
const oneOf = <T extends string>(v: string | null, values: readonly T[], fallback: T): T => values.includes(v as T) ? v as T : fallback;
export function parseState(search: string, catalog: Catalog): { state: LabState; issues: string[] } {
    const query = new URLSearchParams(search);
    const issues: string[] = [];
    const requestedPage = query.get('page') ?? 'settings';
    const template = catalog.templates.find(t => t.id === requestedPage) ?? catalog.templates[0];
    const page = template?.id ?? '';
    if (requestedPage !== page) issues.push(`找不到页面“${requestedPage}”，已返回可用模板。`);
    const requestedExperiment = query.get('experiment') ?? (search === '' && page === 'settings' ? 'layout-study' : '');
    const experiment = catalog.experiments.find(e => e.templateId === page && e.id === requestedExperiment);
    if (requestedExperiment && !experiment) issues.push(`找不到试验“${requestedExperiment}”，已显示基准模板。`);
    const scenes = catalog.templates.find(t => t.id === page && (!experiment || t.version === experiment.templateVersion))?.scenes ?? [];
    const scene = scenes.find(s => s.id === query.get('scene'))?.id ?? scenes[0]?.id ?? 'default';
    if (query.has('scene') && query.get('scene') !== scene) issues.push('链接中的场景不可用，已切换为默认场景。');
    const variants = getVariants(catalog, page, experiment?.id ?? '');
    const left = variants.find(v => v.id === query.get('left'))?.id ?? 'baseline';
    const right = variants.find(v => v.id === query.get('right'))?.id ?? variants[1]?.id ?? 'baseline';
    for (const side of ['left', 'right']) {
        if (query.has(side) && !variants.some(v => v.id === query.get(side))) issues.push(`找不到指定的${side === 'left' ? '左侧' : '右侧'}方案，已使用可用版本。`);
    }
    for (const [key, values] of Object.entries({ mode: ['single', 'split', 'grid'], device: ['desktop', 'tablet', 'phone'], theme: ['light', 'dark'] })) {
        if (query.has(key) && !values.includes(query.get(key)!)) issues.push(`链接参数 ${key} 无效，已使用默认值。`);
    }
    return { issues, state: {
        page, experiment: experiment?.id ?? '', left, right, scene,
        mode: oneOf(query.get('mode'), ['single', 'split', 'grid'], variants.length > 1 ? 'split' : 'single'),
        device: oneOf(query.get('device'), ['desktop', 'tablet', 'phone'], 'desktop'),
        theme: oneOf(query.get('theme'), ['light', 'dark'], 'light'),
    } };
}
export function serializeState(state: LabState): string {
    return `?${new URLSearchParams(state).toString()}`;
}
