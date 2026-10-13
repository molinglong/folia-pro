---
name: fork-upstream-sync
description: Use when pulling upstream Folia commits into this fork, resolving sync conflicts, or when mods or source edits appear to have no effect. Covers the pre-sync contract check, the @fork rollback map, the mod scan order that silently shadows files, and the locally generated code map.
---

# Fork Upstream Sync

上游节奏极快：10 个月 155 个 release，单周 281 提交。fork 落后是常态，不是事故。
关键是**同步时不丢自己的刀口**。

## 同步前（必做）

```
git fetch upstream
git log --oneline mine-base..HEAD -- src/ electron/          # 我自己动过的
rg -n "@fork" --glob '!node_modules' .                        # 全部刀口清单（回滚地图）
git diff --stat mine-base..HEAD                               # 改动规模
```

先看 `src/mods/folium/contract.ts` 在上游有没有动 —— 它是 Folium 模组接口规范的唯一来源，
动了就意味着已有模组的兼容假设可能失效。用 `git diff mine-base..upstream/main -- src/mods/folium/contract.ts` 查。

上游还动过 `AGENTS.md` / `skills/` 时：本仓库 `AGENTS.md` 末尾有一段用
`<!-- @fork:start -->` / `<!-- @fork:end -->` 包起来的 fork 专属 skill 清单，是同步时**唯一预期冲突点**，
保留整段即可，不要整文件覆盖。

## 冲突处理顺序

1. 保住未提交的工作区改动（先 `git stash` 也要留记录，别直接丢弃）。
2. 上游结构性改动优先接受，再把 `@fork` 处逐个重放。
3. 重放后必须重跑断言类测试，并按 `skills/fork-minimal-edit/SKILL.md` 做致死校验。

## "改了但没生效"的两个静默坑

**模组（Folium）**：开发版扫描顺序是 仓库 `mods/` → `userData/mods` → `resources/mods`，
**同 id 只认先扫到的那个**。改文件不生效先查 `%APPDATA%\Folia\mods\` 里有没有旧副本。
开发版对仓库 `mods/` 有内容指纹豁免，安装版没有。

**代码地图**：`docs/CODEMAP.md` 是生成物，不要手改。上游靠 `codemap-sync` workflow 在 main push 后
自动重生成并提交，本 fork 不推 GitHub，所以那一层已经失效 —— 由 `dev/fork/refresh-map.mjs` 顶上
（已装成 `.git/hooks/pre-commit`，提交时自动刷新并 `git add`）。手动核对跑 `npm run codemap:check`。

## 魔改的两条路（决定要不要碰源码）

- **A｜Folium 模组平台**：不用重打包。正式版「设置 → 实验室 → 模组系统」打开，模组丢
  `%APPDATA%\Folia\mods\`。稳定接口目前只有 UI 相关（visualizers / tunings / registries / stageLayers /
  settingsSections / commands / styles）+ 1.4 起的 `folium.lyrics.parse`；`omni.providers`、`omni.hooks`、
  `ponder.targets` 仍是实验接口。上游 README 明确警告：v2 前别做完整音源模组；导出 provider 原始音频流
  或解密音频的模组法律风险极高且不上架。
- **B｜改源码重打包**：见 `skills/fork-build-package/SKILL.md`。

授权：AGPL-3.0 + README 自声明仅供个人学习/非营利。自用随便改，对外分发要同授权开源、不能去版权头。
