# QQ 音乐共享会话方案（扫一次码，处处可用）

状态：已定稿（路线 B'：token 经 Folia 云同步分发）
日期：2026-10-13（2026-10-14 修订：确认上游包不可修改，路线 A 作废，翻转至 B'）
前置：M1–M4 账号与收藏云同步已落地（docs/account-sync-design.md）

## 1. 背景与目标

用户以 QQ 音乐为主力平台。M4 之后"收藏/歌单/喜欢"已能跟随 Folia 账号跨设备，但**平台登录态**仍是每台设备各自扫码。本方案解决：**在自己部署的 qq-api 后端上扫一次码，所有设备（桌面、手机、浏览器）立即共享同一登录态**，无需各自扫码。

明确的非目标：

- 不把 QQ 凭证（musickey/ptkey/cookie 本体）同步进 sync-server 的账号库；
- 不承诺"永不重扫"——上游风控导致会话失效时仍需任意设备重扫一次；
- 不做多租户：共享会话模式面向个人自部署（单用户语义）。

## 2. 现状盘点

### 2.1 后端（@yakult-green-tea/qq-music-api 3.1.4，自有 fork）

- 常驻形态（Docker / 裸 Node / Electron 内嵌）：**登录态在服务端持有，客户端 token 只是查找键**。musickey/refresh key/装置上下文加密存于服务端仓库，renderer 只拿不透明 `qqmusic_session` token。
- 会话仓库可注入：`{ kind, load(): sessions[], save(sessions[]) }`。Docker/裸 Node 用 `QQ_AUTH_SESSION_PATH` + `QQ_SESSION_SECRET` 的加密文件仓库（HKDF-SHA256 + AES-256-GCM，原子写）；Electron 用 safe-storage 仓库（electron/qqAuthSessionRepository.cjs）。
- 装置身份（QIMEI）持久化于 `QQ_AUTH_STATE_PATH`，扫码协议要求装置身份跨重启稳定。
- `GET /login/channels` 如实声明 runtime 支持的登录通道；`/login/status` 按请求携带的 token 查询会话。
- 部署资产齐全：`deploy/docker/compose.yaml` 已含 qq-api 服务（read_only + 具名卷 + 健康检查），gateway 经 `/qq/` 前缀暴露；`deploy/docker/qq-api/README.md` 有完整环境变量文档。

### 2.2 客户端

- `qqTransport.resolveApiBase()`：Electron 强制走内嵌后端（`window.electron.getQqPort()`）；web 走构建期 `VITE_QQ_API_BASE`。**没有运行时覆盖手段**——Electron 无法指向远程后端。
- `hasQqSession()`：本地无 token 直接判未登录，`getLoginStatus` 连请求都不发（qqProvider L356 短路）。
- 扫码确认（`login_qr_check` code 803）后 `persistConfirmedSession` 把 `qqmusic_session=<token>` 写入 providerStorage（web 为 localStorage，Electron 为 renderer 可读存储）。

### 2.3 缺口（本方案要补的）

1. 设备 B 指向同一 backend 后，本地没有 token → `hasQqSession()` 短路 → 永远判未登录；
2. Electron 版无法在运行时改用远程后端；
3. 公网暴露的 qq-api 没有访问鉴权（任何人可借道用你的账号调 API）。

## 3. 方案选型

前提确认（2026-10-14）：folia 是用户从 GitHub 获取的下游项目，`@yakult-green-tea/qq-music-api` 为社区维护的 npm 包，**用户无修改权与发版权**。

| 路线 | 思路 | 结论 |
| --- | --- | --- |
| A. 后端共享会话模式 | fork 加 `QQ_SHARED_SESSION` 开关，未带 token 请求回退共享会话 | **作废**。上游包不可修改；vendor 进仓库则要永久承担 rebase 义务，维护成本与用户维护能力不匹配 |
| **B'. token 走 Folia 云同步** | 把 `qqmusic_session` token（后端会话查找键，非凭证本体）作为新同步域存 sync-server；设备 B pull 后写入 providerStorage，登录态判定链路完全复用现有代码 | **采用**。全部代码在用户自己的仓库（客户端 + sync-server），零上游依赖；token 是低敏引用，泄露只能借道用户自己的 backend 调 API，解不出凭证本体 |
| C. 设备配对码领取 | 扫码设备显示配对码，其他设备输入领取 token | 否决。交互复杂；且 B' 天然免交互 |

翻转说明：昨天否决 B 的理由是"既然能改后端就没必要"——前提消失后，B' 成为改动最小、退化无损的唯一全自主路线。

## 4. 总体架构

```
设备 A（Electron）──┐                        ┌── qq-api 后端（VPS，3.1.4 原版，不改）
设备 B（浏览器）  ──┼── Folia 客户端们        │    ├─ 会话仓库：加密文件（AES-256-GCM，挂卷跨重启）
设备 C（手机/TV）──┘        │                 ├─ 装置身份：单 QIMEI（上游视角=一台稳定设备）
                            │                 └─ 出口 IP：VPS 固定 IP（所有设备流量同源）
                            ▼
                    sync-server（用户自己的）
                    ├─ collections：收藏/歌单/喜欢（M4 已有）
                    └─ platform-sessions：qqmusic_session token（钥匙牌，新增）
```

## 5. 详细设计

### 5.1 后端（零改动）

qq-api 保持 3.1.4 原版，只需启用既有的持久化配置（见 5.3）。token 语义回顾：

- 扫码确认后 backend 签发不透明 `qqmusic_session` token，客户端本地存整串 `qqmusic_session=<token>`（providerStorage，键 `('qq','cookie')`）；
- 后续请求经 `?cookie=` 或 `X-QQ-Session` 携带，backend 按查找键定位服务端会话执行；
- token 对**签发它的 backend 实例**有效——因此本方案的前提是所有设备指向同一个 qq-api 部署（由 5.2 的设置项保证）；
- musickey 续期只改服务端会话内容，token 本身稳定；backend 重装/换 secret/会话过期 → token 失效 → 任意设备重扫恢复。

### 5.2 客户端

**a. QQ API 后端地址（B' 的前提：多设备同 backend）**

新增运行时配置 `qqApiBaseUrl`（优先级：设置项 > `VITE_QQ_API_BASE` > 内嵌后端）：

- 在线音乐高级区新增"QQ API 后端地址"输入框，留空 = 维持现状；持久化 localStorage。
- `qqTransport.resolveApiBase()`：配置项非空时 Electron 也走远程（跳过内嵌）。
- 未配置远程地址时，token 云同步自动停用（token 到了别的设备也没用，推了反而制造困惑）。

**b. token 云同步（新文件 src/services/sync/platformSessionSync.ts）**

- 云端模型：sync-server 新表 `platform_sessions(user_id, provider, token, updated_at)`，端点 `GET/PUT/DELETE /platform-sessions/:provider`，鉴权与 collections 相同；单值 LWW（最新扫码者胜，与"一个活跃会话"的共享语义一致）。
- **push 时机**：`persistConfirmedSession('qq', ...)` 成功后（含 token 整串解析出的裸 token）；登出时 DELETE。
- **pull 时机**：collectionSync 的 pull 周期捎带（同一 watermark 节奏，独立于 collections 的 LWW）。
- **pull 落地**：裸 token 包成 `qqmusic_session=<token>` 写入 providerStorage（`writeProviderSessionValue('qq','cookie',...)`），随后触发一次 QQ provider 的登录态重查——设备 B 的 QQ tab 从 guest 无感翻成 authenticated，全程无交互。
- `hasQqSession()` 与 getLoginStatus 短路逻辑**零改动**：设备 B 有 token 后走的就是标准链路。
- 本机已登录时 pull 不覆盖本地 token（本机 token 优先；LWW 只决定无本地值时的初值与清理）。

**c. 登出语义**

- 登出 = 本地清 token + 云端 DELETE + backend `logout`（删服务端会话）→ 全员下线；登出弹窗提示"将退出所有设备上的 QQ 音乐登录"（i18n ×3）。
- 设备 B 因云端 DELETE 而失效的处理：checkLoginStatus 判定未登录 → 现有清理链路自然生效（cloudOrigin 投影兜底展示）。

### 5.3 部署（deploy/docker）

`.env` 启用既有的会话持久化（原版即支持）：

```env
QQ_AUTH_SESSION_PATH=/app/.auth-state/qq-session.enc
QQ_SESSION_SECRET=<openssl rand -base64 32>
```

- sync-server 与 qq-api 部署在同一 VPS（B' 要求多设备共享同一 qq-api 实例，token 只对签发它的实例有效）。
- 公网必须 HTTPS 反代（token 与歌单数据走明文会被中间人读取；sync-server 本身同理）。
- `qq-api-state` 卷同时承载装置身份与会话密文，备份 = 备份登录态；backend 重装后 token 全失效属预期（全员重扫一次）。

### 5.4 安全分析（对"凭证不上云"承诺的修订）

- **QQ 凭证本体（musickey/ptkey/refresh key）自始至终不上云**：只存在于 qq-api 后端的加密会话仓库（AES-256-GCM，密钥在用户 `.env`）。原承诺的核心不变。
- **唯一例外：`qqmusic_session` token（后端会话查找键）进入 sync-server**。它是低敏引用：泄露者只能借道用户自己的 backend 以用户身份调用 QQ 音乐 API（等价于借用播放器），解不出凭证本体；止损手段 = 登出（删云端 token + backend 会话）。
- 安全断言调整：`toCloudSnapshot()` 的"输出不含 cookie/ptkey/token"约束**不适用于 platform-sessions 域**（该域的唯一载荷就是 token）；collections 域的既有断言不动。新增断言：platform-sessions 的载荷**只含 token**，不得夹带任何其他字段。
- 传输全程 HTTPS（sync-server 与 qq-api 同需）。

### 5.5 风控现实（必须向用户交代的边界）

- 上游视角：单 QIMEI 装置 + 固定 VPS 出口 IP + 单账号 = "一台很稳定的设备"，比多台设备各自换 IP 直连**更不易触发风控**；但高频并发写（多设备同时点赞）仍可能吃 429（已有退避）。
- musickey 有生命周期：后端续期机制尽力延长；一旦失效，token 失去指向的会话，**任意一台设备重扫一次**即可恢复全员登录。
- 若上游策略变化（如绑定 IP 强校验），本方案的退化路径是回到"各设备各扫各码"——功能无损，只是回到 M4 状态。
- 旧 sync-server（schema ≤ 2）对新端点回 404：客户端 pull 遇 404/401 静默跳过 token 同步，不影响收藏同步。

## 6. 里程碑

| 里程碑 | 内容 | 验证 |
| --- | --- | --- |
| M1 服务端 | sync-server 新增 `platform_sessions` 表（schema 3）+ `GET/PUT/DELETE /platform-sessions/:provider` 端点 | 探针：PUT/GET/DELETE 回环 + 旧 schema 库升级迁移 + 鉴权 401 |
| M2 客户端 | `qqApiBaseUrl` 设置项（i18n ×3）+ `resolveApiBase` 远程覆盖 + `platformSessionSync.ts`（push/pull/落地触发重查）+ 登出全局文案 | tsc + vitest；两实例（Electron + 3001）互推 token 实测 |
| M3 部署 | compose `.env` 启用会话持久化、README 增补共享章节、sync-server schema 升级说明 | `docker compose up -d --wait` + 外部 curl 全链路 |
| M4 验收 | 三场景真机：① Electron 扫码 → 浏览器登录态自动出现；② 浏览器点赞 → Electron 收藏 60s 收敛；③ 后端重启会话恢复 | 手测清单 |

## 7. 已否决的备选

- **平台凭证上云（sync-server 存 musickey/ptkey）**：泄露即账号接管——承诺核心，维持不变。
- **路线 A（改上游 fork 发共享会话模式）**：上游包（`@yakult-green-tea/qq-music-api`）用户无修改权；vendor 进仓库则永久承担 rebase 义务。
- **设备配对码领取**：交互复杂，B' 天然免交互。
- **塞进 sync-server 做媒体代理**：职责混乱、故障域变大。

## 8. 待定问题

1. 设置项放"在线音乐高级区"还是 Storage 设置页？（倾向前者——它属于平台后端配置，不属于同步配置）
2. 手机端（vivo）Folia 的分发形态决定设备 C 的接入方式，待移动端计划明确后补充。
3. pull 落地后触发 QQ 重查的具体接口（`omni.refreshProvider('qq')` 或 store 订阅），实施时按代码实况定。
