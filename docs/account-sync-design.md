# 账号系统与在线音乐同步 · 技术设计文档

> 状态：**M1–M4 已实施**（2026-10-13，偏差见各节 "实施偏差" 补记）。目标读者：本项目开发者自己。
> 选型前提：部署形态为 **Docker / 自有 VPS**；范围为"登录即同步设置 + 主题 + 在线音乐收藏元数据"，**不同步平台登录凭证**。
>
> 落地文件：服务端 `sync-server/src/{auth,identity,rateLimit}.ts` + `app.ts`（schema 2）；客户端 `src/services/sync/{authClient,collectionSync}.ts`、`src/stores/useAccountSessionStore.ts`、存储设置 UI。服务端验证：`npm run test:node`（8 组探针）+ 真实服务冒烟；客户端验证：tsc + `test/unit/sync/`（含白名单投影安全测试）。

---

## 1. 背景与目标

### 1.1 用户诉求

> "登录即可同步已经绑定的 QQ 音乐、网易云以及喜欢啥的。"

拆解成可交付的能力：

1. **账号体系**：邮箱 + 密码注册/登录，一个账号对应一个云端数据空间，多端（PC / Web / 未来手机）用同一账号。
2. **数据同步**：登录后自动同步——
   - 视觉设置快照（已有能力，加用户隔离）
   - AI 主题库（已有能力，加用户隔离）
   - **新增**：在线音乐平台的收藏/歌单/喜欢记录（QQ 音乐、网易云、酷狗）
3. **不承诺**：在 B 设备自动登录 QQ 音乐/网易云。平台 token（QQ 的 ptkey、网易云的 cookie）是**短效且设备/IP 绑定**的，搬到另一台设备基本要重新扫码，同步它们没有收益只有安全风险。每台设备各自扫码绑定一次是前提，同步的是"绑定之后产生的数据"。

### 1.2 现状盘点（改动前必须知道的家底）

| 模块 | 位置 | 现状 |
| --- | --- | --- |
| 同步服务端 | `sync-server/src/app.ts` | Hono + D1/SQLite，**单用户全局 `SYNC_TOKEN`**，表：`settings` / `themes` / `theme_buckets`，schema version = 1 |
| 部署 | `deploy/docker/compose.sync.yaml` | Docker 已有，容器只读、healthcheck 齐，端口 13000 |
| 同步客户端 | `src/services/sync/` | `syncConfig`（localStorage `folia_sync_config_v1` 存 baseUrl + token）、`syncClient`（Bearer 鉴权）、`syncCoordinator`（启动主题同步）、`syncRepository`（Merkle bucket 增量）、`settingsSnapshot` |
| 同步 UI | `src/components/modal/settings/StorageSettingsSection.tsx` | "存储设置"里填服务地址 + Token，手动推拉 |
| 平台账号数据 | `src/services/onlineMusic/providerAccountCache.ts` | IndexedDB `user_home_snapshot`：`ProviderAccountSnapshot = { user, collections[], likedSongIds[], savedAt }`；`likedSongFileIds`（酷狗行号）是会话级的，**已被刻意排除持久化** |
| 账号状态 | `src/stores/useOnlineProviderAccountStore.ts` | zustand，`accounts[providerId]`，含 `status: 'authenticated'` 等 |
| 登录态判定 | `providerAccountController`、各 backend（`electron/qqBackend.cjs` 等） | 平台凭证存本机（electron 侧有 `qqAuthSessionRepository`），不上云 |

关键约束：现有 `themes` 表是**全局共享池**（fingerprint 主键，无 owner），升级为多用户时必须处理存量数据的迁移或并存策略。

---

## 2. 总体架构

```
┌─ Folia 客户端（每台设备）────────────────────────┐
│ 平台扫码登录（本地，凭证不出设备）                │
│   └─ 产生数据：收藏 / 歌单 / 喜欢                 │
│ 账号登录（邮箱+密码）→ session token              │
│   └─ syncCoordinator 增加命名空间: collections    │
└──────────────┬───────────────────────────────────┘
               │ HTTPS (VPS 上 Nginx/Caddy 反代)
┌──────────────▼───────────────────────────────────┐
│ sync-server (Hono, Docker)                        │
│  auth: users / sessions （scrypt 哈希）            │
│  data: settings / themes / collections            │
│        全部按 user_id 隔离；全局主题池保留为只读    │
└───────────────────────────────────────────────────┘
```

设计原则（与现有代码风格一致）：

- **本地优先**：所有数据先落本地（IndexedDB / localStorage），云端是镜像；断网不影响使用。
- **时间戳 LWW**：沿用现有"旧时间戳不覆盖新记录"的冲突策略，不引入 CRDT。
- **schema 版本化**：`SCHEMA_VERSION` 升到 `2`，`/health` 暴露版本，旧客户端 + 旧服务端组合必须能明确报"版本不匹配"而不是静默错乱。

---

## 3. 账号体系设计

### 3.1 认证方式决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 凭证形式 | **不引入 OAuth/JWT**，自签发 session token | 自托管场景没有第三方登录可用；JWT 无状态但登出/吊销麻烦，随机 token + sessions 表最直接 |
| 密码哈希 | Node 内置 `crypto.scrypt`（N=2^15, r=8, p=1）+ per-user 16B salt | **避免新增原生依赖**：现有 Docker 镜像跑 Node 24，scrypt 零依赖；bcrypt/argon2 都要 native 或 wasm 包 |
| 邮箱验证 | **Phase 1 不做**（自托管信任环境），密码找回 = 仅在 `users` 表预留 `email_verified` 字段，接口后续加 | 做验证要接 SMTP，是独立的一大块；自托管 VPS 用户量少，先不上 |
| 注册开放度 | 服务端环境变量 `ALLOW_REGISTER=true/false`，默认 `true`；提供 `POST /admin/users` （用 DASHBOARD_TOKEN 鉴权）供私有部署关闭注册后手动建号 | 防止公网 VPS 被扫注册垃圾账号 |
| 全局 `SYNC_TOKEN` | **保留为兼容模式**：不带用户 session、只带全局 token 的请求仍走"单用户旧协议"（数据落在 `user_id = NULL` 的保留行） | 不破坏已有部署的用户；新客户端登录前也可先用兼容模式 |

### 3.2 会话与设备

- `POST /auth/login` 成功 → 返回 `{ userId, email, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }`
- `accessToken`：随机 32B hex，有效期 **24h**
- `refreshToken`：随机 64B hex，有效期 **180 天**，每次使用后**旋转**（旧的作废、发新的）——被盗刷新令牌窗口只有一次；客户端刷新**单飞**（并发 401 共享同一次刷新，`authClient.refreshSession`）
- 每个 `sessions` 行带 `device_label` 与 `last_seen_at`，为未来"设备管理/踢下线"留口
- 登出 = 删 sessions 行；改密码 = 删除该用户所有非当前 session

> **实施偏差（客户端存储）**：token 本体存 **IndexedDB**（`folia_sync_session_v1`，`syncConfig.storeSession`），不是 sessionStorage；localStorage 只存非敏感的 `userId/email`（`SyncProviderConfig.account`）。刷新触发点在 `syncClient.resolveBearerToken`（请求前检查 60s 提前量）+ 401 自动重试，而非启动时静默 refresh。

### 3.3 防爆破（公网 VPS 必备）

- 登录/注册接口按 `IP + email` 双维度限速：内存滑动窗口，5 次失败锁 15 分钟（Hono 中间件手写 ~40 行，不引依赖）
- 沿用现有 `SYNC_TOKEN ≥ 8 位` 的强校验思路：密码最低 8 位
- README 中明确建议反代层（Caddy/Nginx）再加一层 rate limit —— 内存限速重启即失效，这是已知局限，写进文档

---

## 4. 数据模型（服务端）

新增表（`ensureSchema` 中追加，`SCHEMA_VERSION = 2`）：

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,            -- crypto.randomUUID()
  email TEXT NOT NULL UNIQUE,          -- 存前统一 trim + lowercase
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,         -- scrypt$N$r$p$salt_b64$hash_b64
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  refresh_hash TEXT PRIMARY KEY,       -- sha256(refreshToken) hex，不存明文
  user_id TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,    -- sha256(accessToken) hex
  device_label TEXT,
  created_at TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS collections (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,           -- 'netease' | 'qq' | 'kugou'
  data_json TEXT NOT NULL,             -- 快照主体（见 §5.1）
  delta_since_json TEXT,               -- 保留：Phase 2 增量事件用，Phase 1 为 NULL
  updated_at TEXT NOT NULL,            -- 客户端 savedAt 的 ISO 形式
  PRIMARY KEY (user_id, provider_id)
);
```

既有表的用户维度（迁移见 §8）：

> **实施偏差（v2 新表而非加列）**：实际实现是新建 `settings_v2` / `themes_v2` / `theme_buckets_v2`，每张带 `scope TEXT NOT NULL` 列（`''` = 兼容模式全局域哨兵），v1 表保留不动。原因：① SQLite 无法改主键，且 `NULL` 在唯一索引里互不相等，会破坏 `INSERT OR IGNORE` 的幂等迁移；② v1 表原样保留让回滚零风险（换回旧镜像即可）。迁移用 `meta` 表的 `migration_v2_done` 行做幂等防重放——否则每次冷启动都会把旧表数据复活（用户删过的数据被 `INSERT OR IGNORE` 重新插回）。`collections` 的 `delta_since_json` 列 Phase 1 未建，Phase 2 需要时 `ADD COLUMN` 即可。

---

## 5. 同步协议设计

### 5.1 收藏/歌单快照（Phase 1，LWW 整包）

同步单元 = `(user_id, provider_id)` 一份 `ProviderAccountCloudSnapshot`：

```ts
// 与客户端 providerAccountCache.ProviderAccountSnapshot 对齐，去掉敏感/会话字段
type ProviderAccountCloudSnapshot = {
  version: 1;
  providerId: 'netease' | 'qq' | 'kugou';
  updatedAt: string;              // ISO，来自本地 savedAt
  user: { uid: string; name: string; avatarUrl?: string };  // 不含 cookie/token！
  collections: Array<{            // = ProviderCollection 白名单投影
    id: string; name: string; coverUrl?: string; trackCount?: number;
    tracks?: Array<{ mediaId: MediaId; title?: string; artist?: string }>; // 上限 2000/歌单
  }>;
  likedSongIds: MediaId[];        // 上限 20000，超出截断并置 truncated 标记
};
```

> **实施偏差（快照结构收敛）**：实际记录为 `{ schemaVersion: 1, updatedAt, data: { user: { id, nickname, avatarUrl? }, collections: SyncedCloudCollection[], likedSongIds: string[] } }`（`syncTypes.ts`）。Phase 1 **不含 `tracks` 数组**——所有歌单只同步元数据，展开走平台实时接口（§5.3 的"超限只同步元数据"成了全集）；`likedSongIds` 投影为 string 并去重；单条记录上限 4MB（服务端 413 拒绝），无逐字段截断。

**字段白名单是硬约束**：落云前必须经过一层显式投影（`toCloudSnapshot()`），杜绝把 `ProviderUser` 里可能混入的认证相关字段整体 `JSON.stringify` 上传。这是本设计最容易出安全事故的点，代码评审时重点看。

API（全部要求 user session，下同）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/collections/:providerId` | 拉取快照（无则 404→null） |
| `PUT` | `/collections/:providerId` | 推送快照，body 带 `updatedAt`；**服务端 LWW**：旧时间戳拒绝覆盖（返回 409 + 当前远端 updatedAt） |

客户端策略（实施版）：

- 对账状态机（`collectionSync.syncProviderCollection`）由三个时间量驱动：**watermark**（本地与云端最后一次一致的时刻，pull/push 成功后写入 localStorage）、**dirtyAt**（本地最后一次用户产生的变更时刻，`queueCollectionPush` 写入）、**remote.updatedAt**。刻意不用快照 `savedAt` 做脏标记——pull 写缓存会刷新 savedAt，会把回声当成变更造成两台设备互相打乒乓。
- 首次对账（无 watermark）：两边都有数据时按快照时间 newer 赢；本地无数据 → 拉远端；远端无数据 → 推本地。
- 常规对账：dirty 且不早于远端 → push（409 则拉回合并）；远端 timestamp ≠ watermark（别的设备写过）→ pull 合并；否则 idle。
- pull 应用（`applyRemoteCollection`）**只填 user/collections/likedSongIds，不伪造登录态**（`status` 不动，首页显示"数据已同步，扫码即可接管"）；本地平台登录中（`status === 'authenticated'`）则保留本地 user、歌单按 key 去重合并（本地优先）、**点赞集合以云端为准**——只有 replace 能让"取消喜欢"跨设备传播（§5.3 的并发窗口不变）。netease 整体例外：点赞/歌单由 `useNeteaseLibrary` 本地 state 当家，云端数据只写快照缓存，等下次 hydration 生效。
- 登出时清 watermark/dirty（`clearCollectionSyncState`）：watermark 属于上一个账号的数据域，带进新账号会把旧位置误当成"远端没变"。
- 触发点：启动（`initializeSyncCoordinator` 等会话从 IndexedDB 水合后 `syncNow`）、like/unlike 与歌单变更后 debounce 60s（挂在 `omni.ts` 的 `persistProviderLikedSongIds` / `refreshProviderPlaylists` 之后）、手动"立即同步"。

### 5.2 设置与主题的用户隔离

- `settings`：带 session 时读写 `(scope = userId)` 行；只有全局 token 时保持旧行为（`scope = ''` 行）
- `themes`：按 scope 完全隔离，manifest/bucket 均为 per-scope 计算
- `/state` 返回值加 `scoped: true` 字段，客户端据此判断请求落在账号数据域

> **实施偏差（放弃公共池合并读取）**：设计原案是"读取时合并自己的 + `owner IS NULL` 公共池"，实施时放弃——同一主题会同时存在于公共池和用户池，合并读取使 bucket 的 count/hash 双重计入，客户端 Merkle watermark 的 diff 永远无法收敛（算出的桶摘要与服务端不一致，每次都当"远端有变化"拉全量）。改为完全按 scope 隔离：兼容域的存量数据不进入用户域，用户首次登录后客户端会把本地主题自然重传上去（本地优先上传），旧数据不丢只是不自动继承。

### 5.3 已知的协议局限（刻意留到 Phase 2，先写清楚）

- **两端并发修改收藏**：LWW 整包意味着 A 设备的"取消喜欢"和 B 设备的"新增喜欢"会互相覆盖。Phase 1 接受（单人使用冲突概率低），Phase 2 用 `delta_since_json` 存事件流（`{op, provider, mediaId, ts}`）做增量合并
- `likedSongFileIds`（酷狗行号）永远不同步——本地代码已把它排除在持久化外，云端同样排除
- 歌单 `tracks` 上限 2000：超限大歌单只同步元数据（id/name/count），展开时走平台实时接口

---

## 6. 客户端改动清单

| 文件 | 改动 |
| --- | --- |
| `src/services/sync/syncTypes.ts` | `SyncProviderConfig` 增加 `account?: { userId, email }`、`accessToken/refreshToken/expiresAt`（**token 不进这个 localStorage 对象**，见下） |
| `src/services/sync/syncConfig.ts` | 非敏感配置（baseUrl、userId、email）留 localStorage；**session token 改存 IndexedDB**（复用 `src/services/db.ts` 的 `saveToCache`），避免 XSS 直接可读 localStorage；加 `clearSession()` |
| `src/services/sync/authClient.ts`（新增） | `register / login / refresh / logout / getMe`，风格照抄 `syncClient.ts` 的 `requestJson` |
| `src/services/sync/syncClient.ts` | `requestJson` 鉴权头改为：有 session → `Bearer <accessToken>`；无 session 且配了全局 token → 保持现状；401 时先尝试一次 refresh 重试 |
| `src/services/sync/collectionSync.ts`（新增） | `toCloudSnapshot()` 白名单投影、拉/推对账、debounce 触发；从 `providerAccountCache` 读、向其写 |
| `src/services/sync/syncCoordinator.ts` | `initializeSyncCoordinator` 增加：已登录 session 时启动做 collections 对账；`syncNow` 结果加 `collectionSyncSummary` |
| `src/services/onlineMusic/omni.ts` | like mutation 的 `persistLikedSongs` 后追加 `queueCollectionPush(providerId)`（60s debounce） |
| `src/components/modal/settings/StorageSettingsSection.tsx` | 新增"账号"区块：未登录→登录/注册表单；已登录→显示邮箱、最近同步时间、登出、（管理员模式下）跳转说明。原"服务地址 + Token"两栏折叠为"高级/兼容模式" |
| `src/stores/useAccountSessionStore.ts`（新增） | zustand 持有登录态，UI 订阅；启动时静默 refresh |
| 登录拉取后 | 参考 `App.tsx` 中现有 accounts 刷新逻辑（L777 附近），把云端快照灌入 store 但**不置 authenticated** |

Electron 侧**零改动**——所有账号交互走 renderer → sync-server HTTPS，主进程不感知。

---

## 7. 服务端改动清单

| 文件 | 改动 |
| --- | --- |
| `sync-server/src/app.ts` | 新增 `auth.ts` 路由挂载；`ensureSchema` 加 3 张新表 + 2 列；所有数据路由前插 `resolveIdentity` 中间件（session → user_id，或全局 token → 兼容模式）；collections 两条路由；登录限速中间件 |
| `sync-server/src/auth.ts`（新增） | scrypt 哈希/校验、session 签发/旋转/校验（`timingSafeEqual` 比对 hash）、注册开关。纯 Node API，无新依赖 |
| `sync-server/src/rateLimit.ts`(新增) | 内存滑动窗口，~40 行 |
| `sync-server/src/d1-emulator.ts` | 验证 `ALTER TABLE ADD COLUMN` 与 `UPPERCASE 列` 在兼容层的行为 |
| `deploy/docker/compose.sync.yaml` | 环境变量透传 `ALLOW_REGISTER`；README 补 HTTPS 反代样例（Certbot 或 Caddy） |
| `sync-server/README.md` | Token 指南重写：session token 与全局 `SYNC_TOKEN` 的关系、部署后第一个账号怎么注册、"凭证不同步"的明确声明 |
| `wrangler.toml` / `cloudflare.ts` | D1 无 native scrypt → **Workers 形态暂缓账号功能**（见 §9），README 注明 |

---

## 8. 迁移与兼容

1. 服务端启动时 `ensureSchema` 幂等建表（WeakSet 按 DB 实例去重）；首次启动把 v1 全局表数据 `INSERT OR IGNORE` 搬进兼容域（`scope = ''`），`meta.migration_v2_done` 幂等防重放
2. 旧客户端（schema 1 客户端 ↔ schema 2 服务端）：不带 session 的请求行为与今天完全一致（服务端按身份回 schema 1）→ **不破坏任何现有部署**；`isSchemaCompatible` 同时接受 1 和 2
3. 新客户端 ↔ 旧服务端：`/auth/*` 404 → 登录表单报通用失败文案，同步功能整体降级为兼容模式现状，不报错刷屏
4. 回滚：v2 表独立、v1 表原样保留，回滚镜像即可，无破坏性 DDL；已注册用户的 v2 数据留在原地不丢

---

## 9. 安全清单（公网 VPS 上线前逐条打钩）

- [ ] 全站 HTTPS（账号密码永不走明文 HTTP —— 这是自托管最容易翻车的点，README 首页加粗写）※部署侧动作
- [x] 密码 scrypt 哈希（N=2^15, r=8, p=1 + per-user salt），永不明文/日志落盘
- [x] access/refresh token 只存 sha256 hash 于 sessions 表（`identity.sha256Hex` + 常量时间 `digestEquals` 比对）
- [x] `toCloudSnapshot()` 投影字段有单元测试（`test/unit/sync/collectionSync.test.ts`），断言输出不含 cookie/ptkey/token 子样
- [x] 登录/注册限速（内存滑动窗口：登录 5 次/15min 按 IP+email，注册 5 次/1h 按 IP）；反代层 rate limit 说明待部署时补
- [x] `ALLOW_REGISTER=false` 时注册口关闭 + `POST /admin/users`（DASHBOARD_TOKEN）手动建号（探针覆盖）
- [x] dashboard 统计改读 v2 表按 scope 分组，不泄露 user 行内容

**Cloudflare Workers 形态的限制**：Worker 运行时没有 `crypto.scrypt`（WebCrypto PBKDF2 可用但弱于 scrypt 且需改哈希格式）。本期明确：**账号功能仅 Node/Docker 形态支持**，CF 形态继续只提供兼容模式；若未来要上 CF，方案是 PBKDF2-SHA256 100k 迭代 + 强制邮箱验证的组合，另行设计。

---

## 10. 实施里程碑

| 里程碑 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| M1 服务端账号 | auth.ts + schema 2 + 限速 | `sync-server/test/auth.probe.ts` 8 组探针全绿 + 真实服务冒烟（health/register/me/state） | **完成 2026-10-13** |
| M2 数据隔离 | settings/themes 按 scope 隔离 + collections API | 双账号互不可见；旧全局 token 客户端回归通过（探针含兼容模式回归组） | **完成 2026-10-13** |
| M3 客户端账号 | authClient + session 存取 + 存储设置 UI + i18n×3 | tsc 0 错误；登录/登出/断网降级三态待真机手测 | **完成 2026-10-13** |
| M4 收藏同步 | collectionSync + omni 挂钩 + 白名单投影测试 | 投影安全测试 5 组全过；双设备 60s 内可见待真机验收 | **完成 2026-10-13** |
| （Phase 2） | likes 增量事件流、并发合并、设备管理页 | — | 以后再说 |

M1+M2 纯服务端、不动客户端一行代码，可以先做完部署好，M3+M4 再跟进 —— 符合"课余时间可持续推进"的节奏。

---

## 11. 已否决的备选

- **同步平台 cookie/ptkey 上云**：设备绑定 + 短效 + 泄露即账号被接管，收益≈0，否决
- **JWT**：自托管单服务场景没有无状态收益，反而失去即时吊销能力，否决
- **整库 zip 实时同步**（把本地 `syncArchive` 的库直接推云）：收藏数据量小、结构清晰，按 `(user, provider)` 粒度同步足够；整库推送涉及本地音频缓存路径等设备强相关数据，否决
- **接入现成身份服务（Auth.js/Clerk/Keycloak）**：违背本项目"用户自托管、零外部依赖"的现有气质，否决
- **本机 `sync-server` 直接加邮箱验证**：需要用户自备 SMTP，自托管门槛过高，推迟
