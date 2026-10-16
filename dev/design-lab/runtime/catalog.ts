import { buildCatalog } from './catalogModel';

// dev/design-lab/runtime/catalog.ts：只预读轻量 JSON；组件在各自 iframe 内按需加载。
const templates = import.meta.glob<string>('/templates/*/*/template.json', { eager: true, query: '?raw', import: 'default' });
const experiments = import.meta.glob<string>('/experiments/*/*/experiment.json', { eager: true, query: '?raw', import: 'default' });
const parseFiles = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, text]) => {
    try { return [path, JSON.parse(text) as unknown]; } catch { return [path, null]; }
}));
const entryFiles = import.meta.glob(['/templates/*/*/View.tsx', '/experiments/*/*/*/View.tsx']);
export const catalog = buildCatalog(parseFiles(templates), parseFiles(experiments), Object.keys(entryFiles));

// 元数据新增或变更后刷新索引；URL 保留当前试验，不修改方案内容。
if (import.meta.hot) {
    import.meta.hot.accept(() => window.location.reload());
}
