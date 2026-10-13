#!/usr/bin/env node
// dev/fork/install-map-hook.mjs —— 安装/卸载 .git/hooks/pre-commit（自动刷新代码地图）。
// 钩子只调用 refresh-map.mjs，自身失败绝不阻塞提交。要撤销：node dev/fork/install-map-hook.mjs --remove

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MARKER = 'folia-fork:refresh-map';
const HOOK = `#!/bin/sh
# ${MARKER}
# Regenerate docs/CODEMAP.md on every commit (local stand-in for the upstream
# codemap-sync workflow, which never runs because this fork does not push).
# Never block a commit over tooling: failures print a warning and exit 0.
node "$(git rev-parse --show-toplevel)/dev/fork/refresh-map.mjs" --stage --quiet \\
  || echo "[pre-commit] code map refresh skipped (node or generator unavailable)"
exit 0
`;

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: path.resolve(here, '..', '..'),
  encoding: 'utf8',
}).stdout?.trim();

if (!root) {
  console.error('[install-map-hook] 找不到 git 仓库根目录。');
  process.exit(1);
}

const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
const argv = process.argv.slice(2);

if (argv.includes('--status')) {
  if (!fs.existsSync(hookPath)) console.log(`未安装：${hookPath}`);
  else if (fs.readFileSync(hookPath, 'utf8').includes(MARKER)) console.log(`已安装：${hookPath}`);
  else console.log(`存在别人的 pre-commit（本脚本不会覆盖）：${hookPath}`);
  process.exit(0);
}

if (argv.includes('--remove')) {
  if (fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf8').includes(MARKER)) {
    fs.rmSync(hookPath);
    console.log(`已删除 ${hookPath}`);
  } else {
    console.log('没有本脚本装的钩子，无需删除。');
  }
  process.exit(0);
}

if (fs.existsSync(hookPath)) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  if (existing.includes(MARKER)) {
    console.log(`已是最新：${hookPath}`);
    process.exit(0);
  }
  console.error(`[install-map-hook] 已有非本脚本的 pre-commit，拒绝覆盖：${hookPath}`);
  process.exit(1);
}

fs.writeFileSync(hookPath, HOOK.replace(/\r?\n/g, '\n'), { mode: 0o755 });
console.log(`已安装 ${hookPath}`);
console.log('撤销：node dev/fork/install-map-hook.mjs --remove');
