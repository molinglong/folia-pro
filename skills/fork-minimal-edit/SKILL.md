---
name: fork-minimal-edit
description: Use when editing this fork's copy of Folia source - removing a UI entry, muting a network or update path, or any change the user may later want to roll back. Defines the @fork marker, the remove-by-reference-not-by-file rule, the dirty-worktree discipline, and the regression-assertion plus mutation-check that must pass before a removal is called done.
---

# Fork Minimal Edit

这个仓库是 Folia 上游的本地魔改分叉，改动**长期不提交**、随时可能回滚。目标是让每一刀都能被
一条 grep 找全、被一条断言守住。

## 触发条件

- 用户要求删掉/隐藏/断开某个入口、外链、更新检查、社区按钮。
- 任何会动 `src/`、`electron/`、`test/` 且可能和上游冲突的改动。
- 用户问"我改过的地方有哪些 / 能不能退回去"。

## 五条硬规则

**1. 动手前先看工作区。** `git status --short`。这里长期有未提交改动（2026-10-11 有 7 个文件），
禁止 `reset`、`checkout --`、`stash drop`、全仓库格式化，禁止顺手"优化"无关文件。基线 tag 是
`mine-base`（= `f358c44d`，version 0.7.17）。

**2. 每处改动留 `@fork` 锚点。** 这就是回滚地图：

```ts
// @fork 本地魔改版：<做了什么、为什么>
```

JSX 里用 `{/* @fork 本地魔改版：... */}`。`rg -n "@fork"` 应当能列出全部刀口，列不全就是漏标了。

**3. 删入口不删源文件。** 只去掉 import 和使用点，未被引用的组件/工具文件保留（Vite 会 tree-shake，
不影响产物）。先例：`JoinCommunityButton.tsx`、`qqCommunity.ts`、`discordCommunity.ts` 都还在。
真要删文件，先 `rg -n "<符号名>"` 证明零引用，并征得用户同意。

**4. 同一文件串行改。** 一次编辑 → grep 锚点确认落盘 → 再改下一处。同一条消息里对同一文件发
两个编辑调用会互相覆盖丢改动。

**5. 移除类改动必须配断言并做致死校验。** 把测试从"这个入口存在且行为正确"改写成"这个入口不存在"
（先例 `test/ui/helpCommunity.spec.ts`，含"QQ 群号不得出现在 DOM"这类反向断言）。然后验证判据本身有效：
临时把被删的引用改回去 → 用例**必须变红** → 恢复改动 → 全绿。没做过这一步不许报"完成"。

## 默认不动的区域

音频侧（omni provider、酷狗/QQ 会话键、`electron/main.cjs` 的 `transcodeService`、打包进
`ffmpeg-audio` 的转码运行时、`Cache`、IndexedDB 歌词）、登录态、`%APPDATA%\Folia` 下的用户数据。
要动先问。

## 下一步

改完怎么验证见 `skills/testing-strategy/SKILL.md`（上游）；要出安装包见 `skills/fork-build-package/SKILL.md`。
