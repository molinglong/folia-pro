# Folia 账号入口改造方案（登录不再藏在设置深处）

状态：设计评审中
日期：2026-10-14
前置：M1–M4 账号与收藏云同步已落地（docs/account-sync-design.md）

## 1. 痛点

现状的登录路径是三连击：

1. **入口深**：设置 → 存储区 → 滚到“同步服务”→ 先填 Sync Server 地址 → 登录框才出现；
2. **登录无感**：登录成功后界面没有任何地方显示“已登录”，不回设置深处就是隐身状态；
3. **找错门**：侧栏有个现成的“账号页”（管 QQ/网易云登录态），用户想找账号设置天然去那里——但 Folia 账号不在那。

另有一个隐性硬伤：`useAccountSessionStore.initialize()` 写在存储设置组件里，**不打开设置页，登录态水合都不会发生**——账号状态在架构上被绑死在页面深处。

## 2. 目标体验

一句话：**想同步 → 侧栏账号页 → 点登录 → 输邮箱密码 → 完成**。服务器地址降级为“缺了才提示”的前置条件，不再拦在门口。

| | 未登录 | 已登录 |
| --- | --- | --- |
| 侧栏 → 账号页顶部 | “登录 Folia 账号，收藏同步到云端” + 登录按钮，点开设内联表单（邮箱/密码，登录⇄注册） | 邮箱 + 同步状态（上次同步时间）+ 立即同步 + 登出 |

## 3. 方案设计

### 3.1 账号卡（AccountTab 顶部新增）

位置：`src/components/panelTab/AccountTab.tsx` 返回内容的**最上方**（平台用户卡之上——Folia 账号是“总账号”，层级在上）。

状态机（消费 `useAccountSessionStore`，四态两维度）：

- `hydrating`：显示占位骨架（一行微光条），不闪烁不报错；
- `signed-out` + 服务器地址**已配**：文案 + 「登录」按钮 → 卡内展开 `AccountAuthForm`（不弹窗，折叠回原位）；
- `signed-out` + 地址**未配**：表单照常可展开，但顶部黄条提示“需要先设置同步服务地址”，附「去设置」按钮（经 `SettingsAnchorContext` 跳到存储区锚点，一步到位不拦路）；
- `signed-in`：邮箱（本地自用不脱敏）+ `syncStatus.lastSyncAt` 的“上次同步 xx”+「立即同步」（调 `syncNow({ syncCollections: true })`，注意与卡上已有的平台 `onSyncData` 是两回事）+「登出」（沿用现有确认语义，清 watermark 逻辑在 store 里已备好）。

样式配方沿用账号页现有卡片：`bg-white/5 p-3 rounded-xl`（与平台用户卡同款），**不做成 CollapsibleCard**——账号卡默认展开，藏功能不如摊开。

### 3.2 AccountAuthForm 抽取（两处渲染同一份）

把 `StorageSettingsSection.tsx` 中的账号表单区整体搬进新组件 `src/components/modal/settings/AccountAuthForm.tsx`：

- 搬：`authMode/authEmail/authPassword` state、提交 handler（调 `useAccountSessionStore` 的 signIn/signUp）、错误码 → i18n 映射渲染、登录⇄注册切换按钮、`accountNeedsServerUrl` 提示；
- 存储区原位置改为渲染 `<AccountAuthForm />`——入口迁移但不拆旧家，两处行为严格一致；
- 校验规则、按钮禁用条件（busy / 空邮箱 / 无地址）照搬不改。

### 3.3 store 初始化上移

`useAccountSessionStore.getState().initialize()` 从 StorageSettingsSection 移到 App 启动链路（与 `initializeSyncCoordinator` 同一处，水合本就异步等待，不增加启动负担）。上移后任何 UI 容器（账号卡、设置页、未来的 TUI）读到的登录态都是真实的。

### 3.4 i18n

新增键（zh-CN / en / in ×3）：账号卡标题与未登录/已登录文案、立即同步、去设置跳转；错误码映射与登录⇄注册切换复用现有 `ui.storage.account*` 键。

## 4. 明确不做

- **首次启动引导弹窗**：自己的播放器自己用，弹引导纯属添乱；
- **主界面常驻头像入口**：账号页已经是固定位置，再加一层入口是重复；未来真要全局头像再单独议；
- **TUI 形态的账号卡**：`LibraryTuiAccountList` 是终端形态，V1 不动；
- **登录墙/强制登录**：账号永远是可选功能，不登录一切照旧。

## 5. 实施顺序（一个下午，两个 checkpoint）

| # | 内容 | 验证 |
| --- | --- | --- |
| C1 | 抽 AccountAuthForm + store initialize 上移 + 存储区改渲染 | `npx tsc --noEmit` + `vitest run test/unit/sync`（账号相关用例回归） |
| C2 | AccountTab 账号卡（四态 + 跳转 + 同步按钮）+ i18n ×3 | tsc + vitest 全量；手测：未登录→登录→卡变已登录→登出 |

## 6. 验收清单

- [ ] 打开侧栏账号页即可看到 Folia 账号卡（未登录态文案正确）；
- [ ] 卡内完成注册/登录，无需离开侧栏；错误提示可见可重试；
- [ ] 登录后卡显示邮箱与上次同步时间；「立即同步」触发 syncNow 并刷新时间；
- [ ] 未配服务器地址时不报错拦截，提示条 + 「去设置」一步跳到存储区锚点；
- [ ] 登出后卡回未登录态，收藏 watermark 清空（现有 store 行为）；
- [ ] 设置页存储区账号区块行为与卡内完全一致（同一组件）；
- [ ] 三语言文案齐全；不登录时应用一切功能照旧。

## 7. 已否决的备选

- **只在设置首页加账号卡**：解决"深"但解决不了"无感"——平时用播放器根本不进设置；
- **全局弹窗登录（任意界面点头像弹出）**：与现有 UnifiedPanel 生态不搭，且要新增常驻头像位，改动半径大得多；
- **把存储区账号区块整体删掉只留侧栏**：设置页是重配置场所，保留同一组件的渲染点成本为零、收益是习惯路径不断。

## 8. 备注

- 网易云/酷狗的共享会话接入（同款 token 云同步扩展到其他平台）与本方案无关，是 qq-shared-session-design 的后续议题；
- `syncNow` 的 `collectionSyncSummary` 返回值已带推送/领养计数，账号卡"立即同步"完成后的短文案可直接播报（如"已同步 1 项收藏"），属锦上添花，C2 有余量再做。
