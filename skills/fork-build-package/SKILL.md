---
name: fork-build-package
description: Use when building, running, or packaging this fork as a Windows Electron app - producing win-unpacked, refreshing build prerequisites, choosing dev vs packaged mode, or installing dependencies. Fixes the output directory to C:/folia-build and states the post-build smoke checks.
---

# Fork Build & Package

## 先选形态（成本从低到高）

| 目的 | 命令 |
| --- | --- |
| 只看 UI/逻辑改动 | `npm run dev`（vite 网页版，最轻，别顺手起构建） |
| 要窗口层/壁纸/原生路径 | `npm run dev:electron` |
| 要可双击的自打包版 | 见下面两条 |

已有 dev server 在跑时先看它的报错，不要再起一个构建。

## 自打包（Windows）

```
npx cross-env ELECTRON_DEV=false ELECTRON=true vite build
npx electron-builder --win --dir -c.directories.output=C:/folia-build
```

产物：`C:\folia-build\win-unpacked\Folia.exe`。

**输出目录写死在 `C:/folia-build`。** 仓库路径含中文（`C:\项目\folia`），往仓库内 `release/`
打包会 EPERM。`package.json` 的 `build.directories.output` 是 `release`，所以必须用 `-c.` 覆盖。

`electron-builder` 偶发在 `unpacking default Electron distribution` 这步报
`Client network socket disconnected before secure TLS connection was established`（本机走 7897 代理，TLS 会被掐）。
**先原样重试一次**，实测即过；真断网时加 `-c.electronDist=node_modules/electron/dist` 走离线兜底
（`%LOCALAPPDATA%\electron\Cache` 里已有 43.7.5 的 zip）。这类失败不会毁掉已存在的 `win-unpacked`，
但也没写进新包——报"打包完成"前必须看 `app.asar` 的时间戳和本次改动在不在里面（`grep -c <新字符串> app.asar`）。

前置文件仓库里已就位，**不需要 cargo、不需要 GitHub 下载**：

- `build/folia-wallpaper-helper.exe` ✓（缺了才跑 `npm run build:wallpaper-helper`，走 `cargo build --release`）
- `build/ffmpeg/win-x64/{ffmpeg.exe, share, BUNDLE-INFO.txt}` ✓（缺了才跑 `npm run build:ffmpeg`）
- `build/windowtolayer` 是 Linux 路径用的，Windows 打包不参与

两者最初都是从装机正式版 `resources/` 复制进来的，必要时可再从
`C:\Programs\Folia\resources\` 补。

## 装依赖

直接 `npm install`（走仓库自带 `.npmrc`）。**不要加 `--registry=https://registry.npmmirror.com`**：
`package.json` 里 `kugoumusicapi` 是 GitHub 远程 tarball，和 `.npmrc` 的 `allow-remote=root` 冲突，
覆盖 registry 会报 `EALLOWREMOTE`。默认配置实测 1148 包 / 51s。

electron 二进制被 allow-scripts 拦掉时单独补一次：

```
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

Node 要求 >= 24（本机 v24.18.0 ✓），包管理 npm（有 package-lock，无 pnpm 符号链接坑）。

## 构建后 smoke test（三条，必做）

1. `C:\folia-build\win-unpacked\Folia.exe` 起得来，界面渲染正常。
2. 本次改动在 UI 上可观测地生效（改了帮助页就去帮助页看，别只看代码）。
3. 断连没退化：`%APPDATA%\Folia\folia-major-updater` 没有新文件。见 `skills/fork-official-disconnect/SKILL.md`。

### 第 2 条怎么做：用 CDP，不要按截图估坐标点鼠标

`SetCursorPos` + `mouse_event` 那套实测会点偏（Read 出来的图坐标 ≠ 屏幕坐标），点错还会把歌放出来。
可靠做法是连进渲染进程按 DOM 点：

```
taskkill /F /IM Folia.exe
start "" "C:\folia-build\win-unpacked\Folia.exe" --remote-debugging-port=9222
node dev/fork/cdp-help-shot.mjs dump   # 列可见按钮（aria-label + 矩形）
node dev/fork/cdp-help-shot.mjs help   # 静音 → 设置 → 帮助 → 断言计数 + 截图
```

脚本用 `playwright-core` 的 `chromium.connectOverCDP('http://127.0.0.1:9222')`，进去第一件事把
`audio/video` 全部 `muted + pause()`（这是用户真实的听歌环境，别让它出声）。
用完 `taskkill /F /IM Folia.exe`，再**不带端口**重启给用户继续用，并 `curl http://127.0.0.1:9222/json/version`
确认端口已关（连不上才算干净）。

### 起不来又零报错 = 单实例锁被遗留的 dev 壳占了（2026-10-13 踩实）

`start Folia.exe --remote-debugging-port=9222` 后进程秒退、`taskkill /IM Folia.exe` 说没有进程，
但 9222 照常应答 —— 那是以前留下的 `node_modules/electron/dist/electron.exe . --remote-debugging-port=9222`
（映像名是 `electron.exe`，`/IM Folia.exe` 抓不到它），它占着单实例锁，**你连上的是 dev 壳不是包**，
而 dev 壳跑的是当前源码，改动必然都在，PASS 全是假的。

所以验打包版必须两件事：

1. 换独立档案 + 换端口，别去杀那个壳（可能是用户还在用的）：
   ```
   Start-Process 'C:\folia-build\win-unpacked\Folia.exe' -ArgumentList '--user-data-dir=C:\folia-dev-profile','--remote-debugging-port=9223'
   node dev/fork/cdp-packaged-smoke.mjs 'C:\folia-dev-profile' 9223
   ```
   `cdp-packaged-smoke.mjs` 自带静音 + 关首启引导（独立档案是空档案，首启会连挡多层，不关掉只拍得到弹窗）。
2. 脚本里断言 `page.url()` 含 `app.asar`（dev 壳是 `/dist/index.html`）；`netstat` 看该端口的 PID
   映像名是不是真 `Folia.exe`。收尾 `taskkill /F /PID <那个> /T`（只杀自己起的树）+ `curl` 确认端口已关。

独立档案没有登录态与队列，点「前往 Lattice」会落到空态「队列是空的」—— 这仍算进得去，不是失败。

## 注意：这跑的是用户真实的听歌环境

自打包版与装机正式版**共用 `%APPDATA%\Folia`**，登录态、歌单、配置直接继承。所以：
不清配置、不写 store、不点"退出登录"这类不可逆按钮来验证。

判断用户当前用的是哪个版本：看帮助页有没有「加入社区」胶囊 —— 有就是装机正式版
（桌面快捷方式目前仍指向它），没有才是本 fork 的 win-unpacked。
