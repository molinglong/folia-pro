import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExperiment, parseArguments } from '../scripts/create-experiment.mjs';

let root: string;
beforeEach(() => {
    const temporary = fileURLToPath(new URL('../../../test-results/design-fixtures/', import.meta.url));
    mkdirSync(temporary, { recursive: true });
    root = mkdtempSync(path.join(temporary, 'new-'));
    const template = path.join(root, 'templates/settings/v1');
    mkdirSync(template, { recursive: true });
    mkdirSync(path.join(root, 'shared/v1'), { recursive: true });
    writeFileSync(path.join(template, 'template.json'), JSON.stringify({ id: 'settings', version: 'v1', sharedVersion: 'v1', title: '设置', sourcePaths: ['src/reference.tsx'] }));
    writeFileSync(path.join(template, 'View.tsx'), "import '../../../shared/v1/base.css';\nexport default function View() { return null; }\n");
    writeFileSync(path.join(template, 'style.module.css'), '.page { color: black; }');
    writeFileSync(path.join(root, 'shared/v1/base.css'), 'body { margin: 0; }');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('创建试验脚本', () => {
    it('解析显式参数并拒绝未知、重复、缺值参数', () => {
        expect(parseArguments(['--template', 'settings', '--id', 'new-layout'])).toEqual({ template: 'settings', id: 'new-layout' });
        for (const args of [['--unknown', 'x'], ['--id'], ['--id', 'a', '--id', 'b']]) expect(() => parseArguments(args)).toThrow();
    });
    it('默认三案，修正共享导入，改 B 不改变其他文件，拒绝再次覆盖', () => {
        const result = createExperiment({ template: 'settings', id: 'study' }, root);
        expect(result.manifest.variants).toHaveLength(3);
        const read = (id: string) => readFileSync(path.join(result.directory, id, 'View.tsx'), 'utf8');
        const baseline = read('baseline');
        expect(baseline).toContain("'../../../../shared/v1/base.css'");
        writeFileSync(path.join(result.directory, 'b/View.tsx'), 'export default function B() { return null; }');
        for (const id of ['baseline', 'a', 'c']) expect(read(id)).toBe(baseline);
        expect(() => createExperiment({ template: 'settings', id: 'study' }, root)).toThrow('拒绝覆盖');
        expect(read('b')).toContain('function B');
    });
    it('支持指定方案数量与冻结摘要', () => {
        const result = createExperiment({ template: 'settings', id: 'pair', count: '2' }, root);
        expect(result.manifest.variants).toHaveLength(2);
        expect(result.manifest.sharedSnapshot['base.css']).toMatch(/^[a-f0-9]{64}$/);
    });
    it.each(['../escape', 'UPPER', 'a/b', 'a\\b', 'con', 'nul', 'a'.repeat(65)])('拒绝非法试验标识 %s', id => {
        expect(() => createExperiment({ template: 'settings', id }, root)).toThrow();
    });
    it.each(['0', '9', '1.5', 'no'])('拒绝非法方案数 %s', count => {
        expect(() => createExperiment({ template: 'settings', id: 'bad-count', count }, root)).toThrow();
    });
    it('拒绝通过目录链接导出模板', () => {
        const external = path.join(root, 'outside');
        mkdirSync(external);
        symlinkSync(external, path.join(root, 'templates/settings/v1/linked'), 'junction');
        expect(() => createExperiment({ template: 'settings', id: 'linked' }, root)).toThrow('符号链接');
    });
});
