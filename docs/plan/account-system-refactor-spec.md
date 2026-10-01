# OJTrace 账号系统局部重构升级 Spec

> 状态：提案，按架构审查修订
>
> 范围：账号添加、授权、身份去重、凭证、权限、首次同步和并发存储。
>
> 前提：项目处于绿地开发阶段，不考虑旧数据、旧消息和旧字段兼容。

## 1. 重构目标

本次重构只覆盖账号相关子系统，不重写 Timeline 展示模型，也不改变 Adapter 的提交记录解析职责。

目标：

1. 由明确的应用服务统一编排账号添加流程。
2. UI 不直接拼装认证协议细节。
3. 后台入口不再承载账号业务规则。
4. 账号身份具备稳定且可计算的唯一键。
5. 重复添加变成幂等 upsert，而不是新增账号。
6. 删除、清空和并发写入不会复活旧账号。
7. 凭证只存在于明确的凭证边界。
8. 每种认证模式拥有可测试的独立状态机。
9. 新增 OJ 或认证模式时，只需局部扩展。
10. 新代码不兼容旧数据格式，不保留 legacy 字段。

本 Spec 定义目标边界和行为，不要求按目录清单机械拆出大量文件。只有职责或依赖方向确实独立时才新建模块，避免为了“架构感”引入空壳服务、事件总线或通用框架。

## 2. 非目标

- 不重写 Timeline UI。
- 不重构 Submission 字段。
- 不抽象 parser/normalizer。
- 不实现云同步。
- 不实现本地加密系统。
- 不改变 Cookie 权限的产品策略。
- 不承诺多个浏览器 Profile 之间的账号同步。
- 不替所有 OJ 做真实登录态验收。

## 3. 核心原则

### 3.1 账号身份与本地记录 ID 分离

`accountId` 是本地稳定 ID。账号是否相同，不由 `accountId` 判断，而由 `identityKey` 判断。

```ts
type AccountIdentityKey = string;
```

身份键规则：

```text
source + identityScope + providerAccountKey
```

示例：

```text
codeforces::tourist
luogu::123456
atcoder::tourist
hydroj::https://oj.example.com::alice
```

每个 Adapter 必须声明稳定身份键的规范化规则。不能假定所有 provider key 都可小写化：Handle 的大小写等价性必须基于站点合同明确声明。身份键编码必须无歧义，建议使用结构化 tuple 的稳定序列化或长度前缀编码，不能直接依赖可能含分隔符的裸字符串拼接。

### 3.2 添加账号必须先得到 Canonical Identity

任何账号都必须经过 Adapter 的身份确认后才能落库。

禁止：

- 先创建随机账号，再异步补身份。
- 仅凭用户输入认定 browser-session 身份。
- 仅凭手动 Cookie 保存未验证账号。
- 使用原始输入字符串作为最终身份。

### 3.3 添加账号必须幂等

同一 `identityKey` 再次授权时：

- 更新认证信息和验证时间。
- 保留原有 `accountId`。
- 保留已有提交记录。
- 不创建第二个账号。
- 不创建第二份同步状态。

不同 origin 的 HydroOJ 账号必须视为不同账号。

### 3.4 删除必须是显式集合变更

存储层不再通过合并数组推断删除。应用层生成明确的事务操作：

```ts
type AccountMutation =
  | { type: "upsert"; account: AccountRecord }
  | { type: "remove"; accountId: string }
  | { type: "clear-all" };
```

## 4. 目标模块边界

```text
src/application/accounts/
  account-service.ts       # 授权、去重、删除、清空等用例编排
  account-identity.ts      # 稳定身份 key 的计算与校验
  account-errors.ts        # 领域/应用错误和安全映射
  account-repository.ts    # 账号与相关数据的原子持久化操作
  account-queries.ts       # UI 所需的脱敏账号摘要

src/platform/storage/
  extension-storage.ts     # chrome.storage.local 的具体适配

entrypoints/settings/
  account-form.tsx         # 添加流程 UI；需要时再拆认证模式面板
```

按当前项目规模，先实现一个 `AccountService` 和少量纯函数/存储适配，不预先创建 `account-events`、独立 `account-state-machine` 或 credential repository 等空模块。后台入口只保留 runtime message 注册、依赖装配和错误转换。

## 5. 领域模型

### 5.1 认证模式

```ts
type AccountAuthMode =
  | "public-handle"
  | "browser-session"
  | "manual-cookie";
```

不保留 `public`、`browser_session` 或任意未声明模式。

### 5.2 AccountRecord

```ts
interface AccountRecord {
  accountId: string;
  identityKey: AccountIdentityKey;

  source: SourceId;
  origin?: string;

  providerAccountKey: string;
  providerDisplayName?: string;

  authMode: AccountAuthMode;
  enabled: boolean;

  verifiedAt: number;
  createdAt: number;
  updatedAt: number;
}
```

约束：

- `providerAccountKey` 必须由 Adapter 返回。
- 不再以 `identifier` 作为最终身份字段。
- HydroOJ 的 `origin` 必须参与 `identityKey`。
- `enabled` 只表示是否允许同步。

### 5.3 CredentialRecord

凭证与账号记录分离：

```ts
interface CredentialRecord {
  accountId: string;
  credentials: Record<string, string>;
  updatedAt: number;
}
```

目标存储结构：

```ts
interface StoredData {
  schemaVersion: 2;
  revision: number;
  accounts: AccountRecord[];
  credentials: CredentialRecord[];
  /** Optional provider-instance presentation metadata; never credentials. */
  instanceBranding?: Record<string, InstanceBrandingRecord>;
  submissions: Submission[];
  syncStates: Record<string, SyncState>;
  preferences: Preferences;
}
```

`instanceBranding` 是按 `source + normalizedOrigin` 索引的可丢弃缓存，不属于账号身份，也不属于 `providerDisplayName`。它由应用/存储层原子更新，Adapter 只返回候选元数据；删除账号不应删除仍被其他账号使用的同实例缓存，清理由缓存淘汰策略负责。

```ts
interface InstanceBrandingRecord {
  source: SourceId;
  origin: string;
  name: string;
  iconDataUrl?: string;
  fetchedAt: number;
  iconFetchedAt?: number;
}
```

账号列表和 Timeline 查询不得返回 `credentials`。凭证与账号可以位于同一个 `chrome.storage.local` 记录中，以便单 key 原子更新；但必须有独立类型和读写 API。类型分离不等于加密或更强的安全隔离。Chrome Storage 没有跨 key 原子事务，因此本方案不拆成多个 key 再引入两阶段提交。

## 6. 身份规范化

新增统一的身份规范化模块：

```ts
function normalizeOrigin(origin?: string): string {
  if (!origin) return "";
  const url = new URL(origin);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AccountIdentityError("invalid-origin");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AccountIdentityError("invalid-origin");
  }

  return url.origin;
}
```

```ts
function normalizeProviderAccountKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new AccountIdentityError("invalid-provider-key");
  }
  return normalized;
}
```

```ts
function buildIdentityKey(input: {
  source: SourceId;
  origin?: string;
  providerAccountKey: string;
}): AccountIdentityKey {
  const scope = input.source === "hydroj" ? normalizeOrigin(input.origin) : "";
  if (input.source === "hydroj" && !scope) {
    throw new AccountIdentityError("origin-required");
  }
  if (input.source !== "hydroj" && input.origin !== undefined) {
    throw new AccountIdentityError("unexpected-origin");
  }
  return stableTupleKey([
    input.source,
    scope,
    normalizeProviderAccountKey(input.providerAccountKey),
  ]);
}
```

规则：

- Codeforces、Luogu、AtCoder 不需要 origin。
- HydroOJ 必须有 origin。
- origin 统一使用 `URL.origin`。
- origin 不允许 path（根 `/` 除外）、query、fragment、用户名或密码。
- 通用层不臆測账号大小写规则，使用 Adapter 规范化后的 provider key。

## 7. Adapter 合同

### 7.1 授权输入和输出

```ts
interface AdapterAuthorizationInput {
  authMode: AccountAuthMode;
  identifier?: string;
  origin?: string;
  credentials?: Record<string, string>;
  signal: AbortSignal;
  requestId: string;
  http: HttpClient;
}
```

```ts
interface AuthorizationResult {
  identity: {
    origin?: string;
    providerAccountKey: string;
    providerDisplayName?: string;
  };
}
```

### 7.2 Adapter 接口

```ts
interface OJAdapter {
  readonly metadata: AdapterMetadata;

  authorize(
    input: AdapterAuthorizationInput,
  ): Promise<AuthorizationResult>;

  detectBrowserSession?(
    input: BrowserSessionInput,
  ): Promise<BrowserSessionAccount>;

  fetchRecent(input: FetchInput): Promise<FetchResult>;
}
```

Adapter 负责验证某个认证输入并返回该 OJ 的规范身份，不负责保存凭证、生成 `accountId`、写 storage、判断重复账号、删除账号、申请扩展权限、更新 sync state 或生成 UI 文案。`source` 从 Adapter 注册表取得，不需要在调用参数中重复传入。

授权结果禁止回传凭证，避免秘密在不必要的结果对象中扩散。凭证由应用服务接收，并在同步时经窄的 credential provider 按需提供给 Adapter。公开 Handle 若无法被站点验证，必须在产品合同中明确标记为未验证，不能伪称已验证。

## 8. Account Service

```ts
interface AccountService {
  authorize(command: AuthorizeAccountCommand): Promise<AuthorizeAccountResult>;
  remove(accountId: string): Promise<AccountMutationResult>;
  clearAll(): Promise<void>;
  list(): Promise<AccountSummary[]>;
}
```

### 8.1 授权流程

```text
接收 command
  -> 校验 source/authMode
  -> 规范化 origin
  -> 检查并申请权限
  -> 调用 Adapter.authorize
  -> 计算 identityKey
  -> 原子 upsert account 和 credential
  -> 新账号生成 accountId，已有身份复用 accountId
  -> 事务提交
  -> 执行首次同步
  -> 写入 sync state
  -> 返回最终状态
```

网络请求必须在存储事务之外执行。事务 callback 只能做纯内存状态变换，不得 await 网络或其他副作用，因为 MV3 worker 可能终止，存储操作也可能重试。

### 8.2 已有身份的更新策略

同一 `identityKey` 已存在时：

- 复用 `accountId`。
- 更新 `authMode`、凭证、`verifiedAt` 和 `updatedAt`。
- 保留 `createdAt`、提交记录和账号展示信息。
- 清理旧同步错误。

从 `browser-session` 切换到 `manual-cookie` 或反向切换时，必须替换凭证，不能叠加凭证。

## 9. 权限边界

新增：

```ts
interface AccountPermissionService {
  ensureForAuthorization(
    source: SourceId,
    origin?: string,
    authMode?: AccountAuthMode,
  ): Promise<void>;
}
```

要求：

- 权限请求不放在 Adapter 中。
- 权限请求不放在 React 组件中。
- 所需权限由 Adapter metadata 声明的固定数据 origin，加上受校验的 HydroOJ 精确 origin 计算，不在 service 中硬编码每个 OJ 的分支。
- 账号启用前必须确认首次同步所需权限；公开账号也不能因权限缺失而被标记成可同步。
- HydroOJ 只请求规范化 origin。
- 权限失败时不写入半成品账号。
- 权限失败结果必须是结构化错误。

## 10. 凭证边界

删除通用消息字段：

```ts
cookie?: string;
```

统一使用：

```ts
credentials?: Record<string, string>;
```

规则：

- UI 只在输入期间持有凭证。
- 成功后立即清空 UI state。
- 凭证不进入日志、错误、诊断和 Submission。
- 凭证不通过 `GET_STATE` 返回。
- 同步时凭证通过窄接口按需读取，禁止把完整 storage state 传给 Adapter。
- 账号列表只返回 `credentialConfigured: boolean`。
- 删除账号时原子删除对应凭证。
- 替换认证方式时清除旧凭证。

```ts
interface AccountSummary {
  accountId: string;
  source: SourceId;
  origin?: string;
  providerAccountKey: string;
  authMode: AccountAuthMode;
  enabled: boolean;
  verifiedAt: number;
  credentialConfigured: boolean;
}
```

## 11. 存储一致性模型

### 11.1 删除数组合并策略

Chrome Storage 不提供 compare-and-swap 或多 writer 原子事务。单纯“读 revision、再读一次、写入”的 compare-and-retry 不能阻止两个独立执行上下文在最终检查后同时写入。因此：

1. 所有业务写入必须只由 extension service worker 执行；UI 页面不得直接写 `chrome.storage.local`。
2. service worker 进程内用单一串行命令队列执行完整读-改-写事务；事务 callback 必须同步且纯。
3. `chrome.storage.local` 中的数据作为一个整体 key 写入，保持账号、凭证、提交和 sync state 的单 key 原子替换语义。
4. revision 仅用于诊断和本进程内一致性检查，不宣称是跨上下文 CAS 锁。
5. 未来若引入第二个 writer、offscreen writer 或 cloud sync，必须改用具备真实条件写入的存储方案，不能复用伪 CAS。

存储接口：

```ts
interface StoragePort {
  transact<T>(
    operation: (tx: MutableStorageTransaction) => T,
  ): Promise<T>;
}
```

内部算法：

```text
进入进程内单 writer 队列
读取当前完整 snapshot
在内存副本上执行纯同步 operation
增加 revision
将完整 snapshot 写回单一 storage key
释放队列
```

禁止用 stale snapshot 合并来补偿删除。所有写入入口必须经过该队列；业务模块不得直接调用 `browser.storage.local.set`。

### 11.2 删除账号事务

一个删除操作在同一个单 key storage write 中同时：

```text
删除 account
删除 credentials
删除 syncStates[accountId]
删除 submissions[accountId]
```

### 11.3 清空账号事务

```text
accounts = []
credentials = []
syncStates = {}
submissions = []
instanceBranding = {}
```

删除单个账号时可以保留仍被其他账号引用的同实例品牌缓存；清空全部账号则同时清空该可丢弃缓存，避免用户明确清空数据后仍留下站点图标和名称。

## 12. 首次同步和并发删除

授权验证和持久化分为两个阶段。

### 阶段 A：授权验证

Adapter 返回 canonical identity 和经过验证的凭证。

### 阶段 B：持久化与同步

1. 在事务中 upsert 账号和凭证，设置 `enabled: false`、`syncStatus: "pending"`。
2. 事务提交后执行首次同步。
3. 同步成功时再次事务读取当前账号；若账号仍存在且认证版本未变化，则合并记录、写成功状态并设 `enabled: true`。
4. 同步失败时若账号仍存在且版本匹配，则保留账号并设 `enabled: false`，记录结构化错误。
5. 若同步期间账号已删除或认证版本已替换，丢弃该同步结果，不得重建账号或覆盖新状态。

同步失败不能丢失已验证账号，也不能创建未验证的 enabled 账号。每次认证材料变化时递增 `credentialRevision`；同步任务携带该版本，提交结果时校验 `accountId + credentialRevision`。

如果产品决定允许“授权已验证但首次同步失败”的账号保留为可重试状态，应新增明确的 `authorizationStatus`，不要复用 `enabled` 表达两个含义。

## 13. 添加流程状态

```ts
type AddAccountStatus =
  | "idle"
  | "validating-input"
  | "requesting-permission"
  | "detecting-session"
  | "authorizing"
  | "upserting"
  | "syncing"
  | "completed"
  | "failed";
```

正常转换：

```text
idle
 -> validating-input
 -> requesting-permission
 -> detecting-session / authorizing
 -> upserting
 -> syncing
 -> completed
```

失败可从任意阶段进入 `failed`。

```ts
interface AddAccountError {
  code:
    | "invalid-input"
    | "invalid-origin"
    | "permission-denied"
    | "unauthenticated"
    | "credential-invalid"
    | "identity-unavailable"
    | "sync-failed"
    | "storage-conflict"
    | "unsupported";
  retryable: boolean;
  messageKey: string;
}
```

## 14. Runtime Message

消息按 command/query 分组。它们是 UI 与 service worker 间的传输 DTO，不再把完整 `AccountConfig` 作为可写入对象发送给后台。不要额外引入第二套领域命令框架；DTO 由 messaging 模块定义，handler 映射到应用服务方法。

```ts
interface AuthorizeAccountCommand {
  schemaVersion: 2;
  type: "ACCOUNT_AUTHORIZE";
  requestId: string;
  payload: {
    source: SourceId;
    authMode: AccountAuthMode;
    identifier?: string;
    origin?: string;
    credentials?: Record<string, string>;
  };
}
```

删除 `UPDATE_ACCOUNT`。账号只能通过领域命令修改。

建议的消息类型：

```text
ACCOUNT_AUTHORIZE
ACCOUNT_DELETE
ACCOUNT_CLEAR_ALL
ACCOUNTS_LIST
SESSION_DETECT
SYNC_REQUEST
TIMELINE_STATE
```

所有消息必须严格校验 payload，不允许只检查公共字段。

## 15. Settings UI

`settings/main.tsx` 负责页面布局和页面级查询。账号表单先保持一个 feature component，只有认证面板的复杂度或复用足够时再拆子组件：

```text
AccountSettings
  ├── AccountForm
  └── AccountList
```

表单模型：

```ts
interface AddAccountForm {
  source: SourceId;
  authMode: AccountAuthMode;
  identifier: string;
  origin: string;
  credentials: Record<string, string>;
}
```

UI 不负责计算 identity key、生成 accountId、判断重复账号、调用 Adapter 或写 storage。扩展 API 的权限请求需要浏览器用户手势：点击提交时由 UI 发起明确的 permission-request 消息/用户手势流程，service worker 负责校验目标和执行请求；不能假设普通异步 command 一定保留用户激活状态。

## 16. 去重规则

| OJ | identityKey 示例 |
| --- | --- |
| Codeforces | `codeforces::tourist` |
| Luogu | `luogu::123456` |
| AtCoder | `atcoder::tourist` |
| HydroOJ | `hydroj::https://oj.example.com::alice` |

HydroOJ 不同 origin 的同名账号必须保留为两个独立账号。

## 17. 测试要求

### 17.1 Identity

- origin 大小写、trailing slash 规范化。
- path/query/fragment 拒绝。
- HydroOJ origin 隔离。
- provider key 空值和换行拒绝。
- 同一身份生成相同 identityKey。

### 17.2 Account Service

- 新账号授权。
- 重复授权幂等。
- 认证方式替换。
- 验证失败不落库。
- 首次同步失败仍保留账号。
- 首次同步成功写入 sync state。
- 凭证替换清理旧凭证。
- 删除账号清除全部关联数据。
- 清空账号不保留凭证。
- 实例品牌缓存不进入凭证或账号身份；删除单账号不会误删其他账号仍使用的缓存。
- 清空全部账号同时清除可丢弃的实例品牌缓存。

### 17.3 并发

- 两个不同账号并发添加。
- 同一账号并发添加。
- 添加与删除并发。
- 删除与同步并发。
- 清空与添加并发。
- revision 冲突重试。
- 删除不会被旧 snapshot 复活。

### 17.4 消息合同

- 缺少 payload 拒绝。
- 未知 source/authMode 拒绝。
- 非法凭证字段拒绝。
- `UPDATE_ACCOUNT` 不再接受。
- 账号查询响应不包含凭证。
- 错误响应不包含凭证内容。

### 17.5 UI

- 切换 OJ 重置表单。
- HydroOJ origin 变化重新检测 session。
- 检测中不能提交。
- 权限请求从用户明确操作发起且使用最小权限。
- 删除与正在运行的首次同步竞态不会复活账号。
- 重复点击不会产生多个授权 command。
- 授权成功后密码字段清空。
- 重复授权显示更新结果，不显示两个账号。

## 18. 错误处理

后台禁止直接返回任意 `Error.message`。统一通过错误映射：

```ts
catch (error) {
  return toRuntimeErrorResponse(requestId, error);
}
```

错误响应必须稳定、可测试，且不得包含 URL 响应正文、Cookie、token、请求头或内部堆栈。

## 19. 绿地数据策略

由于不需要旧数据兼容：

- 将 `STORAGE_SCHEMA_VERSION` 直接设为 `2`。
- 删除 legacy auth mode。
- 删除 `AccountConfig.cookie`。
- 删除 `identifier` 作为主账号字段的语义。
- 删除 `UPDATE_ACCOUNT` 消息。
- 删除旧 `mergeConcurrent`。
- 旧 schema 可直接初始化为空默认状态。

## 20. 实施顺序

### Phase 1：领域模型

- 新建 `AccountRecord`、`CredentialRecord`。
- 增加可丢弃的 `InstanceBrandingRecord`，并明确它不参与 identity key。
- 新建 identity 规范化函数和领域错误。
- 更新存储 schema。

验收：identity 和类型测试通过。

### Phase 2：存储事务

- 实现 service worker 单 writer 队列和纯同步事务变换。
- 实现账号 upsert、删除和清空事务。
- 删除旧并发合并逻辑；保证所有扩展 storage 写入入口都走该 port。

验收：并发和删除竞态测试通过。

### Phase 3：Adapter 授权合同

- 增加 `authorize` 方法。
- 将身份确认从 background 移到 Adapter。
- 删除 Adapter 对存储和权限的依赖。

验收：各 OJ 授权契约测试通过。

### Phase 4：Account Service

- 实现权限服务。
- 实现授权服务、identity 去重和凭证替换。
- 接入事务外首次同步和版本校验，确保删除/替换期间的旧同步结果被丢弃。

验收：账号服务测试通过。

### Phase 5：Runtime Message

- 引入 command/query。
- 删除 `UPDATE_ACCOUNT` 和通用 cookie 字段。
- 严格校验 payload。
- 统一错误映射。

验收：消息合同测试通过。

### Phase 6：Settings UI

- 拆分添加账号组件。
- 引入授权 Hook 和显式状态机。
- 删除 UI 中的业务逻辑。

验收：UI 测试和浏览器手工验收通过。

### Phase 7：清理

- 删除旧类型和 helper。
- 更新 README、隐私文档和 QA checklist。
- 运行完整质量门禁。

## 21. 完成标准

```text
[ ] 同一身份重复添加不会生成第二个账号
[ ] HydroOJ 不同 origin 的同名账号互不冲突
[ ] 授权失败不会落库半成品账号
[ ] 首次同步失败不会丢失已验证账号
[ ] 删除或更换凭证后，旧的在途同步不能写回数据
[ ] 删除账号不会复活
[ ] 清空账号会同时清除凭证、提交和同步状态
[ ] 账号列表响应不包含凭证
[ ] 错误和日志不包含凭证
[ ] UI 不生成 accountId 或 identityKey
[ ] background.ts 不包含账号业务规则
[ ] 所有 storage 写入经过单一 service worker StoragePort
[ ] UPDATE_ACCOUNT 消息已删除
[ ] 旧 auth mode 和 cookie 字段已删除
[ ] typecheck 通过
[ ] 全部测试通过
[ ] build 通过
[ ] manifest audit 通过
```

本次重构必须建立三个不可绕过的边界：

```text
Adapter 负责确认 OJ 身份
Account Service 负责账号生命周期
Storage Transaction 负责一致性
```

