#!/usr/bin/env node
// dev/fork/refresh-map.mjs —— 本地版 codemap-sync：重新生成 docs/CODEMAP.md，必要时暂存。
// 上游靠 .github/workflows/codemap-sync.yml 在 main push 后自动重生成并提交；本 fork 不推 GitHub，
// 所以那条通道失效，由这个脚本 + .git/hooks/pre-commit 顶上。生成器只要 0.8s，不装依赖也能跑。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const generator = path.join(repoRoot, 'dev', 'mcp', 'ts-code-map', 'codemap.mjs');
const mapFile = 'docs/CODEMAP.md';

const argv = process.argv.slice(2);
const stage = argv.includes('--stage');
const quiet = argv.includes('--quiet');

/** 跑一条命令并返回 stdout（trim 过）；失败返回 null，不抛异常。 */
function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return (res.stdout || '').trim();
}

const gen = run(process.execPath, [generator]);
if (gen === null) {
  // 生成器失败（比如 dev/ 目录被移动）时如实报错，但把决定权留给调用方：
  // 提交钩子里我们宁可放行也不让人被工具卡住。
  console.error('[refresh-map] 代码地图生成失败，跳过。');
  process.exit(1);
}

const dirty = run('git', ['status', '--porcelain', '--', mapFile]);
if (dirty === null) {
  console.error('[refresh-map] git 不可用，跳过。');
  process.exit(1);
}

if (!dirty) {
  if (!quiet) console.log(`[refresh-map] ${mapFile} 已是最新。`);
  process.exit(0);
}

const noisy = !quiet;
if (stage) {
  if (run('git', ['add', '--', mapFile]) === null) {
    console.error('[refresh-map] git add 失败，地图已更新但未暂存。');
    process.exit(1);
  }
  if (noisy) console.log(`[refresh-map] 结构变了，${mapFile} 已重新生成并暂存（随本次提交进去）。`);
} else if (noisy) {
  console.log(`[refresh-map] 结构变了，${mapFile} 已重新生成（未暂存，加 --stage 可自动 git add）。`);
}
