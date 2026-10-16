import type { Catalog, ExperimentMeta, PreviewVariant, TemplateMeta } from '../types';
import { isRecord, validId } from './protocol';

// dev/design-lab/runtime/catalogModel.ts：逐项校验目录，坏元数据只产生提示，不中断其余模板。
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const version = (v: unknown): v is string => typeof v === 'string' && /^v[1-9]\d*$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const unique = (ids: string[]) => new Set(ids).size === ids.length;
export function isTemplate(value: unknown): value is TemplateMeta {
    if (!isRecord(value)) return false;
    return validId(value.id) && text(value.title) && text(value.description)
        && version(value.version) && version(value.sharedVersion) && date(value.createdAt)
        && Number.isSafeInteger(value.order)
        && Array.isArray(value.sourcePaths) && value.sourcePaths.length > 0
        && value.sourcePaths.every(p => text(p) && p.startsWith('src/') && !p.includes('..'))
        && Array.isArray(value.scenes) && value.scenes.length > 0
        && value.scenes.every(s => isRecord(s) && validId(s.id) && text(s.label))
        && unique(value.scenes.map(s => s.id));
}
export function isExperiment(value: unknown): value is ExperimentMeta {
    if (!isRecord(value)) return false;
    return validId(value.id) && validId(value.templateId) && version(value.templateVersion)
        && text(value.title) && date(value.createdAt)
        && Array.isArray(value.variants) && value.variants.length >= 1 && value.variants.length <= 8
        && value.variants.every(v => isRecord(v) && validId(v.id) && v.id !== 'baseline' && text(v.title) && text(v.description))
        && unique(value.variants.map(v => v.id));
}

export function buildCatalog(templates: Record<string, unknown>, experiments: Record<string, unknown>, entries: string[]): Catalog {
    const result: Catalog = { templates: [], experiments: [], issues: [] };
    const knownEntries = new Set(entries);
    for (const [path, meta] of Object.entries(templates)) {
        if (!isTemplate(meta) || path !== `/templates/${meta.id}/${meta.version}/template.json`) {
            result.issues.push(`模板信息不完整或路径不匹配：${path}`);
            continue;
        }
        const directory = path.slice(0, path.lastIndexOf('/'));
        if (!knownEntries.has(`${directory}/View.tsx`)) {
            result.issues.push(`模板缺少 View.tsx：${directory}`);
            continue;
        }
        result.templates.push({ ...meta, directory });
    }
    for (const [path, meta] of Object.entries(experiments)) {
        if (!isExperiment(meta) || path !== `/experiments/${meta.templateId}/${meta.id}/experiment.json`) {
            result.issues.push(`试验信息不完整或路径不匹配：${path}`);
            continue;
        }
        const directory = path.slice(0, path.lastIndexOf('/'));
        if (!result.templates.some(t => t.id === meta.templateId && t.version === meta.templateVersion)) {
            result.issues.push(`找不到试验的基准版本：${path}`);
            continue;
        }
        // 缺失的单案仍登记，由对应预览格展示错误，保留其他可用方案。
        for (const id of ['baseline', ...meta.variants.map(v => v.id)]) {
            if (!knownEntries.has(`${directory}/${id}/View.tsx`)) result.issues.push(`方案缺少 View.tsx：${directory}/${id}`);
        }
        result.experiments.push({ ...meta, directory });
    }
    for (const path of entries) {
        if (path.startsWith('/templates/') && !Object.keys(templates).includes(path.replace('/View.tsx', '/template.json'))) {
            result.issues.push(`模板缺少 template.json：${path}`);
        }
        if (path.startsWith('/experiments/')) {
            const parts = path.split('/');
            if (!experiments[`/experiments/${parts[2]}/${parts[3]}/experiment.json`]) result.issues.push(`方案缺少 experiment.json：${path}`);
        }
    }
    result.templates.sort((a, b) => a.order - b.order || Number(b.version.slice(1)) - Number(a.version.slice(1)));
    result.experiments.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return result;
}

export function getVariants(catalog: Catalog, page: string, experimentId: string): PreviewVariant[] {
    const experiment = catalog.experiments.find(e => e.templateId === page && e.id === experimentId);
    const template = catalog.templates.find(t => t.id === page && (!experiment || t.version === experiment.templateVersion));
    if (!template) return [];
    const directory = experiment ? `${experiment.directory}/baseline` : template.directory;
    return [
        { id: 'baseline', title: '基准稿', description: `当前界面参考 · ${template.version} · ${template.createdAt}`, directory, entryPath: `${directory}/View.tsx` },
        ...(experiment?.variants.map(v => ({ ...v, directory: `${experiment.directory}/${v.id}`, entryPath: `${experiment.directory}/${v.id}/View.tsx` })) ?? []),
    ];
}
