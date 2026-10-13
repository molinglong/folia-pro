---
name: fork-official-disconnect
description: Use when verifying or undoing this fork's separation from official Folia channels - asked "有没有真的断开", checking whether auto-update fired, restoring official update behaviour, or touching the installed production app's update config. Lists the four gates with exact locations and the evidence-based verification method.
---

# Fork Official Disconnect

2026-10-11 用户指令："先断开和官方的连接，音频这些不动。" 现状是**四条通道全关**，动这个仓库前
先假设官方通道是关的。

## 四个门禁（证据位置）

| 层 | 位置 | 现状 |
| --- | --- | --- |
| git | `git remote -v` | `origin` 已改名 `upstream`；push URL = `no-push-to-official.invalid`；`main` 无 tracking，`git pull` 直接报无 tracking 而不触网 |
| 源码（自打包版） | `electron/main.cjs:3167` | `isUpdateCheckSupported()` 硬返回 `false`，自动检查/手动检查/下载/安装四条路径都过这个闸 |
| 打包配置 | `package.json:76` | `build.publish` → `null`，自打包不再产出 `app-update.yml` |
| 装机正式版 | `%APPDATA%\Folia\config.json` | `ENABLE_UPDATE_CHECK:false`、`ENABLE_AUTO_UPDATE:false`、`UPDATE_CHANNEL:"internal"`；`%LOCALAPPDATA%\Programs\Folia\resources\app-update.yml` → `.disabled` |

**故意没动**：`electron/updateChannels.cjs`。它的 `internal` 通道已带 `updateEnabled:false`，够用；
改它会和 `test/unit/electron/updateChannels.test.ts` 打架。别"顺手统一"。

## 怎么校验"真的断开了"

**不要用 netstat。** 本机流量走本地代理（7897 / TUN 假 IP 198.18.0.x），从连接看不出目标域名，
判出来的都是噪音。可靠证据三条：

1. 代码门禁还在：`rg -n "@fork" electron/main.cjs` + `sed -n '3167,3169p' electron/main.cjs` 返回 `false`。
2. 状态键还在：读 `%APPDATA%\Folia\config.json` 那三个键；或看应用内更新状态里 `updateCheckSupported:false`。
3. 落盘证据：`%APPDATA%\Folia\folia-major-updater` 目录没有新文件。

## 备份与回滚

- 原件：`C:\项目\folia\backup\disconnect-official-20261011\`，下面 `installed/` 与 `repo/` 各放对应 `.orig`。
- 恢复官方更新 = 还原 `electron/main.cjs` 与 `package.json` 两处 → 重新打包；装机版再把三个 config 键
  和 `app-update.yml` 名字改回来。`git remote rename upstream origin` + 重设 push URL 可恢复 git 通道
  （平时保留 `git fetch upstream` 作为逃生口，见 `skills/fork-upstream-sync/SKILL.md`）。

## 明确没碰的东西

音频侧（omni provider、酷狗/QQ 会话键、`electron/main.cjs` 的 `transcodeService` 与 `transcode/protocol`、
打包进 `ffmpeg-audio` 的转码运行时（源在 `build/ffmpeg/`）、`Cache`、IndexedDB 歌词）、`models:fetch`、
设置里指向仓库文档的超链接。这些不属于"官方连接"，别在断连任务里动。
