import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCatalog, getVariants, isTemplate } from '../runtime/catalogModel';
import { parseState, serializeState } from '../app/urlState';
import { buildPrompt } from '../app/prompt';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const metadata = json('templates/settings/v1/template.json');
const experiment = json('experiments/settings/layout-study/experiment.json');
const templatePath = '/templates/settings/v1/template.json';
const experimentPath = '/experiments/settings/layout-study/experiment.json';
const entries = ['/templates/settings/v1/View.tsx', ...['baseline', 'a', 'b', 'c'].map(id => `/experiments/settings/layout-study/${id}/View.tsx`)];
const catalog = buildCatalog({ [templatePath]: metadata }, { [experimentPath]: experiment }, entries);

describe('目录与冻结基准', () => {
    it('十类基准都有视图、样式、有效来源和场景', () => {
        const pages = readdirSync(path.join(root, 'templates'));
        expect(pages).toHaveLength(10);
        for (const page of pages) {
            const meta = json(`templates/${page}/v1/template.json`);
            expect(isTemplate(meta)).toBe(true);
            expect(meta.id).toBe(page);
            for (const file of ['View.tsx', 'style.module.css']) expect(existsSync(path.join(root, 'templates', page, 'v1', file))).toBe(true);
            for (const source of meta.sourcePaths) expect(existsSync(path.resolve(root, '../..', source))).toBe(true);
        }
    });
    it('发现基准和三案，路径互不重叠', () => {
        expect(catalog.issues).toEqual([]);
        expect(getVariants(catalog, 'settings', 'layout-study').map(v => v.id)).toEqual(['baseline', 'a', 'b', 'c']);
        expect(new Set(getVariants(catalog, 'settings', 'layout-study').map(v => v.directory)).size).toBe(4);
    });
    it('坏元数据、缺失视图与孤立文件都有提示，其他模板可用', () => {
        const broken = buildCatalog({ [templatePath]: metadata, '/templates/bad/v1/template.json': null }, { [experimentPath]: experiment }, [entries[0], '/templates/orphan/v1/View.tsx']);
        expect(broken.templates).toHaveLength(1);
        expect(broken.experiments).toHaveLength(1);
        expect(broken.issues.join('\n')).toContain('信息不完整');
        expect(broken.issues.join('\n')).toContain('方案缺少');
        expect(broken.issues.join('\n')).toContain('缺少 template.json');
    });
    it('拒绝路径不匹配、重复方案和未知模板版本', () => {
        expect(buildCatalog({ '/templates/wrong/v1/template.json': metadata }, {}, entries).templates).toHaveLength(0);
        expect(buildCatalog({ [templatePath]: metadata }, { [experimentPath]: { ...experiment, variants: [experiment.variants[0], experiment.variants[0]] } }, entries).experiments).toHaveLength(0);
        expect(buildCatalog({ [templatePath]: metadata }, { [experimentPath]: { ...experiment, templateVersion: 'v99' } }, entries).issues.join()).toContain('找不到试验的基准版本');
    });
    it('共享版本与模板哈希未变，冻结基准只修正相对导入', () => {
        for (const [directory, snapshot] of [['shared/v1', experiment.sharedSnapshot], ['templates/settings/v1', experiment.templateSnapshot]] as const) {
            for (const [file, hash] of Object.entries(snapshot)) {
                const content = readFileSync(path.join(root, directory, file));
                expect(createHash('sha256').update(content).digest('hex')).toBe(hash);
            }
        }
        for (const file of Object.keys(experiment.templateSnapshot)) {
            const template = readFileSync(path.join(root, 'templates/settings/v1', file), 'utf8');
            const baseline = readFileSync(path.join(root, 'experiments/settings/layout-study/baseline', file), 'utf8');
            expect(baseline).toBe(template.replace(/(['"])((?:\.\.\/)+(?:shared\/|runtime\/|types)[^'"\r\n]*)\1/g, (_m, q, s) => `${q}../${s}${q}`));
        }
    });
});

describe('URL 和 AI 工作流', () => {
    it('默认进入设置双栏演示', () => {
        expect(parseState('', catalog).state).toMatchObject({ page: 'settings', experiment: 'layout-study', mode: 'split', left: 'baseline', right: 'a' });
    });
    it('完整参数可往返恢复', () => {
        const state = parseState('?page=settings&experiment=layout-study&mode=grid&left=b&right=c&device=phone&theme=dark&scene=lyrics', catalog).state;
        expect(parseState(serializeState(state), catalog)).toEqual({ state, issues: [] });
    });
    it('错误页面、试验、方案、场景、尺寸均安全回退并给出说明', () => {
        const result = parseState('?page=missing&experiment=oops&left=z&scene=oops&device=giant&theme=red&mode=none', catalog);
        expect(result.issues).toHaveLength(7);
        expect(result.state).toMatchObject({ page: 'settings', experiment: '', device: 'desktop', theme: 'light', mode: 'single' });
    });
    it('迭代需求限于指定方案，不授权合并正式应用', () => {
        const state = parseState('', catalog).state;
        const text = buildPrompt(state, catalog.templates[0], getVariants(catalog, 'settings', 'layout-study')[2]);
        expect(text).toContain('layout-study/b/');
        expect(text).toContain('不修改其他方案');
        expect(text).toContain('没有明确落地指令');
        expect(buildPrompt({ ...state, experiment: '' }, catalog.templates[0])).toContain('npm run design:new');
    });
});
