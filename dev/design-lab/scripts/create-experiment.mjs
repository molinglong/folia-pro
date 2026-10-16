import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// dev/design-lab/scripts/create-experiment.mjs
// 从指定模板生成独立的基准与方案副本；拒绝覆盖、路径穿越和符号链接。
const LAB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

function checkedPath(root, ...parts) {
    const target = path.resolve(root, ...parts);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('路径必须位于设计试验台内。');
    let cursor = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`不能使用符号链接：${cursor}`);
    }
    return target;
}

function readTree(root, directory, prefix = '') {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        const file = checkedPath(root, directory, entry.name);
        if (entry.isDirectory()) files.push(...readTree(root, file, name));
        else if (entry.isFile()) files.push({ name, content: readFileSync(file) });
        else throw new Error(`模板含不支持的文件：${file}`);
    }
    return files;
}

export function parseArguments(args) {
    const options = {};
    const allowed = new Set(['template', 'version', 'id', 'count', 'title']);
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index]?.replace(/^--/, '');
        if (!args[index]?.startsWith('--') || !allowed.has(key) || args[index + 1] === undefined || args[index + 1].startsWith('--') || key in options) {
            throw new Error('参数无效。用法：npm run design:new -- --template settings --id my-study [--version v1] [--count 3] [--title "试验标题"]');
        }
        options[key] = args[index + 1];
    }
    return options;
}

export function createExperiment(options, labRoot = LAB_ROOT) {
    const root = realpathSync(labRoot);
    if (!safeId(options.template) || !safeId(options.id)) throw new Error('模板和试验标识必须使用小写字母开头的英文、数字或短横线；不能使用系统保留名称。');
    const count = options.count === undefined ? 3 : Number(options.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 8) throw new Error('方案数量必须是 1 到 8 的整数。');
    const templateRoot = checkedPath(root, 'templates', options.template);
    if (!existsSync(templateRoot)) throw new Error(`找不到模板：${options.template}`);
    const versions = readdirSync(templateRoot).filter(v => /^v[1-9]\d*$/.test(v)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    const version = options.version ?? versions[0];
    if (!/^v[1-9]\d*$/.test(version ?? '')) throw new Error('模板版本无效。');
    const source = checkedPath(root, templateRoot, version);
    const metadataPath = checkedPath(root, source, 'template.json');
    const meta = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (meta.id !== options.template || meta.version !== version || !/^v[1-9]\d*$/.test(meta.sharedVersion) || typeof meta.title !== 'string') throw new Error('模板元数据与目录不匹配。');
    const destination = checkedPath(root, 'experiments', options.template, options.id);
    if (existsSync(destination)) throw new Error(`试验已存在，拒绝覆盖：${destination}`);
    const files = readTree(root, source);
    if (!files.some(f => f.name === 'View.tsx')) throw new Error('模板缺少 View.tsx。');
    const shared = readTree(root, checkedPath(root, 'shared', meta.sharedVersion));
    const variants = Array.from({ length: count }, (_, index) => ({ id: String.fromCharCode(97 + index), title: `方案 ${String.fromCharCode(65 + index)}`, description: '从同一基准创建，等待 AI 填写设计差异。' }));
    // 先完成全部校验，再排他创建目标；已有文件永不被覆盖。
    mkdirSync(path.dirname(destination), { recursive: true });
    mkdirSync(destination);
    for (const id of ['baseline', ...variants.map(v => v.id)]) {
        const directory = path.join(destination, id);
        mkdirSync(directory);
        for (const file of files) {
            const output = path.join(directory, file.name);
            mkdirSync(path.dirname(output), { recursive: true });
            const isText = /\.(tsx?|jsx?|css|json)$/.test(file.name);
            // 试验比模板深一层，只修正指向冻结公共资源／预览运行时的相对导入。
            const content = isText ? file.content.toString('utf8').replace(/(['"])((?:\.\.\/)+(?:shared\/|runtime\/|types)[^'"\r\n]*)\1/g, (_match, quote, specifier) => `${quote}../${specifier}${quote}`) : file.content;
            writeFileSync(output, content, { flag: 'wx' });
        }
    }
    const manifest = {
        id: options.id, templateId: options.template, templateVersion: version,
        title: options.title?.trim() || `${meta.title} · ${options.id}`,
        createdAt: new Date().toISOString().slice(0, 10), variants,
        sourcePaths: meta.sourcePaths,
        templateSnapshot: Object.fromEntries(files.map(f => [f.name, hash(f.content)])),
        sharedSnapshot: Object.fromEntries(shared.map(f => [f.name, hash(f.content)])),
    };
    writeFileSync(path.join(destination, 'experiment.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return { directory: destination, manifest, url: `http://127.0.0.1:5210/?page=${options.template}&experiment=${options.id}&mode=grid` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.includes('--help')) {
            console.log('npm run design:new -- --template settings --id my-study [--version v1] [--count 3] [--title "试验标题"]');
        } else {
            const result = createExperiment(parseArguments(process.argv.slice(2)));
            console.log(`已创建独立试验：${result.directory}\n预览：${result.url}\n仅修改方案子目录；保留 baseline 和 shared 版本。`);
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
