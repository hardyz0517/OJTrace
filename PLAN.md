# OJTrace（题迹）MVP 总体执行计划

> 文档版本：0.3
>
> 适用范围：从空目录开始，完成可运行、可验证、可维护的第一版 Chrome/Edge Manifest V3 扩展。
>
> 当前状态：已完成工具链初始化和第一轮 Gate 0 研究；已实现 Codeforces stable adapter、Luogu experimental adapter、QOJ/LibreOJ unsupported fallback、MV3 骨架、Timeline、Settings、本地存储和基础测试。MVP 默认只启用 Codeforces；Luogu 实验性账号默认停用，QOJ/LibreOJ 不申请权限且只作占位。自动质量门禁、平台测试和权限审计已通过；真实 Chrome/Edge 加载、action 行为和登录态仍需人工验收。
>
> 执行规则：本文件是唯一总计划。所有 Agent、所有实现任务和所有集成决策都必须能在本文件中找到对应任务 ID、输入、输出和验收条件。

---

## 0. 先读这一节：执行约束

### 0.1 MVP 的一句话定义

用户点击扩展图标后，进入一个完整标签页，看到多个 OJ 的最近提交时间线；记录只保存在浏览器本地；点击记录可以回到原 OJ；一个 OJ 失败不能拖垮其他 OJ。

### 0.2 硬性边界

第一版必须：

- 使用 Manifest V3；
- 同时兼容 Chrome 和 Edge；
- 使用完整标签页，而不是 popup；
- 支持 Codeforces，并对 Luogu、QOJ、LibreOJ 做真实验证；
- 将每个 OJ 的结果转换为统一模型；
- 使用本地存储；
- 支持手动刷新；
- 显示单 OJ 错误和旧缓存；
- 不读取或保存完整 Cookie；
- 不使用服务端；
- 不上传账号、提交、Cookie 或代码内容。

第一版明确不做：

- 自动提交代码；
- 统计大盘、图表、排行榜；
- 社交、AI、题单、笔记；
- 定时同步和浏览器关闭后的后台同步；
- 无限历史归档；
- 提交源代码；
- 手动粘贴 Cookie；
- 通过反爬、验证码或限流机制的绕过逻辑；
- 复杂的同题 session 聚合。

### 0.3 不能被后续任务破坏的架构不变量

1. OJ Adapter 不依赖 React、页面组件或 `chrome.storage`。
2. 页面不直接请求 OJ；请求由 application/service worker 统一调度。
3. 页面不直接写存储；所有写入由 service worker 串行完成。
4. Adapter 的网络访问必须经过受限 `HttpClient`，不能接受任意 URL。
5. UI 只处理领域模型和结构化错误，不解析异常字符串。
6. 任何账号都必须有不可变的本地 `accountId` 和 Adapter 返回的远端身份。
7. `submittedAt` 永远是 Unix epoch milliseconds；展示时才转本地时区。
8. 外部响应必须经过 parser 和字段校验，登录 HTML 不能被当作空提交列表。
9. 站点支持状态必须有验证证据，不允许“猜测支持”。
10. 每个任务只能修改自己负责的路径；共享契约必须由集成负责人冻结。

---

## 1. 对现有计划的审计结论和已修正问题

上一版计划的方向正确，但不能直接支持多人并行，也存在会诱发重构的缺口。本版已做以下修正：

| 原缺口 | 本版修正 |
|---|---|
| 只有 Phase，没有可分配任务包 | 增加 P0/P1/P2 任务卡、owner、路径、依赖、产出和 DoD |
| `accountKey` 同时承担本地配置和远端身份 | 拆成 `accountId`、`identifier`、`providerAccountKey` |
| `discoverAccount` 被误设为每次同步必经 | 改成 `validateAccount` 可选；`fetchRecent` 可直接返回 identity |
| Adapter 直接承担所有职责 | 拆成 client、parser、normalizer、urls |
| 错误只有字符串 | 统一 `AdapterError` / `Diagnostic` 枚举 |
| 页面和 service worker 消息没有版本 | 使用带 `schemaVersion`、`requestId` 的 discriminated union |
| 没有并发和竞态规则 | service worker 单写、请求级去重、同账号同步锁、revision |
| `nextCursor` 语义不清 | MVP 只取最近 N 条；cursor 只能作为后续扩展字段 |
| 提到 content script 但未决定权限 | Phase 0 先验证；未证实前不注入、不申请 `scripting` |
| WXT 目录与计划目录不一致 | 使用 WXT 原生 `entrypoints/`；领域代码放 `src/` |
| 没有集成门禁 | 增加 Gate 0～5，门禁不通过不能进入下一波 |
| 没有统一测试矩阵 | 增加 adapter/core/message/storage/UI/E2E 测试矩阵 |
| 没有明确限流和刷新策略 | 增加 freshness cooldown、per-source 间隔、一次重试规则 |
| 没有多账号 UI 闭环 | MVP 支持多账号存储，Timeline 至少显示账号标签并可筛选 |

### 1.1 本版的维护性结论

本版架构足以支持后续新增 AtCoder、CodeChef 等 Adapter，原因是：

- OJ 相关代码隔离在 `src/adapters/<oj>/`；
- UI 只依赖 `Submission` 和 `SyncState`；
- 网络、权限和扩展 API 有 platform 抽象；
- storage schema 有版本和迁移入口；
- 消息协议和错误模型固定；
- 单站点可被标记为 unsupported，而不需要删除其他代码。

---

## 2. 目录结构和唯一职责

```text
OJTrace/
├── PLAN.md
├── package.json                       # 仅由集成负责人维护
├── pnpm-lock.yaml                     # 仅由集成负责人维护
├── wxt.config.ts                     # 仅由集成负责人维护
├── tsconfig.json
├── eslint.config.*
├── prettier.config.*
├── entrypoints/                      # WXT 入口，页面壳和扩展生命周期
│   ├── background.ts                 # MV3 service worker 入口
│   ├── timeline/                     # 完整标签页入口
│   └── settings/                     # 设置页入口
├── public/
│   └── icons/
├── src/
│   ├── domain/                       # 纯领域类型、错误、策略、排序和去重
│   ├── application/
│   │   ├── sync/                     # 同步用例和 per-source 结果
│   │   ├── storage/                  # storage port、schema、迁移
│   │   └── messaging/                # 页面↔service worker 消息协议
│   ├── platform/
│   │   ├── extension/                # tabs、runtime、browser API 适配
│   │   ├── network/                  # HttpClient、超时、响应限制、allowlist
│   │   └── permissions/              # host permission 检查和申请
│   ├── adapters/
│   │   ├── codeforces/
│   │   │   ├── client/
│   │   │   ├── parser/
│   │   │   ├── normalizer/
│   │   │   └── urls/
│   │   ├── luogu/                    # 同样的四层结构
│   │   ├── qoj/
│   │   └── loj/
│   └── content/                     # 仅在 Phase 0 证明需要页面上下文后使用
│       ├── luogu/
│       ├── qoj/
│       └── loj/
├── tests/
│   ├── adapters/<oj>/
│   ├── core/                         # 兼容旧目录名，后续测试按 domain/application 拆分
│   ├── domain/
│   ├── application/
│   ├── platform/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── research/                     # 站点验证记录
│   ├── decisions/                    # ADR 和 scope freeze
│   └── fixtures/                    # 脱敏的真实响应
└── tools/
    └── phase0/                      # 一次性探针，不能进入产品 bundle
```

### 2.1 目录冲突处理

当前目录骨架中仍有早期的 `src/core`、`src/storage`、`src/background`、`src/pages`、`src/manifest`。后续实现不得继续向这些旧目录添加文件。

正式初始化 WXT 时：

- 入口放入 `entrypoints/`；
- 领域代码放入 `src/domain/`；
- application 代码放入 `src/application/`；
- 平台能力放入 `src/platform/`；
- 空的旧目录可以删除；
- 若目录已有文件，必须由集成负责人迁移并在 ADR 中记录。

---

## 3. 技术栈和工程约束

### 3.1 选择

- TypeScript；
- WXT 作为扩展构建层；
- React 作为 Timeline 和 Settings UI；
- Vite 由 WXT 使用；
- 原生 CSS 或 CSS Modules；
- Vitest 负责纯函数和应用层测试；
- Playwright 或明确的 Chrome/Edge 手测矩阵负责后置 E2E；
- `chrome.storage.local` 负责第一版持久化；
- 原生 Fetch API，通过 `HttpClient` 封装。

### 3.2 版本策略

Phase 0 的工具链任务必须记录当时可用的：

- Node.js LTS 版本；
- pnpm 版本；
- WXT 版本；
- React 版本；
- Chrome 和 Edge 最低测试版本。

然后固定：

- `package.json` 的 `packageManager`；
- `.nvmrc` 或等效 Node 版本文件；
- lockfile；
- 构建和测试命令。

不能让不同 Agent 使用不同包管理器或自动升级依赖。

### 3.3 不引入

第一版不引入 Redux、React Query、Tailwind、IndexedDB 封装库、cookies、webRequest、服务端和定时任务。

---

## 4. 稳定领域契约

以下契约在 Gate 1 后冻结。之后修改必须新增 ADR 并由集成负责人批准。

### 4.1 来源和账号

```ts
type SourceId = "codeforces" | "luogu" | "qoj" | "loj";
type Availability = "stable" | "experimental" | "unsupported";
type AuthMode = "public" | "browser_session";

interface AccountConfig {
  accountId: string;              // 本地不可变 UUID
  source: SourceId;
  identifier: string;              // 用户输入，例如 handle、UID 或用户名
  label?: string;                  // 用户可读名称
  enabled: boolean;
  authMode: AuthMode;
  providerAccountKey?: string;     // validate/fetch 后得到的稳定远端身份
  providerDisplayName?: string;
  verifiedAt?: number;
}
```

`accountId` 不因用户名改名而变化。`providerAccountKey` 由 Adapter 发现并用于确认远端身份。不同账号不能共用同一个 `accountId`。

### 4.2 Submission

```ts
type VerdictCode =
  | "accepted"
  | "wrong_answer"
  | "compilation_error"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  | "pending"
  | "partial"
  | "rejected"
  | "skipped"
  | "other";

type IdentityQuality = "stable" | "composite";

interface Submission {
  source: SourceId;
  accountId: string;
  providerAccountKey?: string;
  submissionId: string;
  identityQuality: IdentityQuality;

  problemId: string;
  problemName?: string;
  submittedAt: number;             // Unix epoch milliseconds，UTC

  verdict: {
    code: VerdictCode;
    raw: string;
  };
  language?: string;

  submissionUrl?: string;
  problemUrl?: string;
  fallbackListUrl?: string;

  fetchedAt: number;
}
```

UI 显示文案由 `verdict.code` 映射，不把 `label` 固化到存储记录中，避免多语言和文案变更导致迁移。

### 4.3 去重和合并

稳定 ID 的去重 key：

```text
source + accountId + submissionId
```

没有稳定 ID 时：

```text
source + accountId + problemId + submittedAt + verdict.raw + language
```

合并规则：

1. 新数据优先更新 `verdict`；
2. 非空 `problemName`、URL、language 优先；
3. `fetchedAt` 使用最新时间；
4. `submittedAt` 不得被无依据地改写；
5. 无效或未来时间按 Adapter 错误处理，不静默写入；
6. 排序先按 `submittedAt` 降序，再按 `source`、`accountId`、`submissionId` 稳定排序。

### 4.4 Storage schema

```ts
interface StoredData {
  schemaVersion: 1;
  revision: number;
  accounts: AccountConfig[];
  submissions: Submission[];
  syncStates: Record<string, SyncState>; // key = accountId
  preferences: Preferences;
}

interface SyncState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  stale: boolean;
  lastError?: Diagnostic;
}

interface Preferences {
  enabledSources: SourceId[];
  retentionPerAccount: number; // 默认 2000
  freshnessCooldownMs: number;  // 默认 2 分钟
}
```

MVP 不持久化 `rawData`，不持久化 Cookie、token、密码和提交代码。

---

## 5. Adapter 契约和职责拆分

### 5.1 Adapter 元数据

```ts
interface AdapterCapabilities {
  accountLookup: boolean;
  stableSubmissionId: boolean;
  directSubmissionUrl: boolean;
  requiresBrowserSession: boolean;
  supportsAnonymous: boolean;
  supportsContentScriptFallback: boolean;
}

interface AdapterMetadata {
  id: SourceId;
  displayName: string;
  availability: Availability;
  authModes: AuthMode[];
  capabilities: AdapterCapabilities;
}
```

### 5.2 统一错误

```ts
type AdapterErrorKind =
  | "permission_required"
  | "auth_required"
  | "rate_limited"
  | "blocked"
  | "timeout"
  | "network"
  | "invalid_response"
  | "parse_failed"
  | "unsupported"
  | "unknown";

interface AdapterError {
  kind: AdapterErrorKind;
  source: SourceId;
  stage: "identity" | "request" | "parse" | "normalize" | "url";
  messageKey: string;
  retryable: boolean;
  userAction?: "grant_permission" | "open_site_login" | "retry_later" | "edit_account";
  httpStatus?: number;
  requestId: string;
}

interface Diagnostic {
  source: SourceId;
  code: string;
  severity: "info" | "warning" | "error";
  messageKey: string;
  retryable: boolean;
}
```

UI 只根据 `kind`、`messageKey` 和 `userAction` 显示文案，不通过 `message` 字符串判断错误类别。

### 5.3 Fetch 输入输出

```ts
interface FetchInput {
  account: AccountConfig;
  limit: number;
  signal: AbortSignal;
  now: number;
  requestId: string;
  http: HttpClient;
}

interface CanonicalAccount {
  accountId: string;
  source: SourceId;
  providerAccountKey: string;
  displayName?: string;
}

interface FetchResult {
  account: CanonicalAccount;
  records: Submission[];
  diagnostics: Diagnostic[];
  hasMore: boolean;
}

interface OJAdapter {
  readonly metadata: AdapterMetadata;

  validateAccount?(input: FetchInput): Promise<CanonicalAccount>;
  fetchRecent(input: FetchInput): Promise<FetchResult>;
}
```

Codeforces 不需要每次额外调用身份接口；`fetchRecent` 可以同时返回账号身份。需要登录的站点才使用 `validateAccount`。

### 5.4 Adapter 内部四层

每个 Adapter 固定拆成：

```text
client      构造站点请求，不负责领域转换
parser      纯函数，将 JSON/HTML 转成站点 RawRecord
normalizer  将 RawRecord 转成 Submission
urls        构造并校验 submission/problem/list URL
```

`parser` 不得调用网络。它必须可以直接使用 fixture 测试。

---

## 6. HttpClient、限流和请求安全

### 6.1 HttpClient 规则

所有 OJ 请求都必须经过 `HttpClient`：

- URL 必须匹配 Adapter 自己的 allowlist；
- 默认超时 15 秒；
- 响应体大小有限制；
- 识别 JSON、HTML 登录页和 Cloudflare 页面；
- 记录 HTTP status，但日志不得包含 Cookie、token 和敏感 query；
- 默认 `credentials: omit`；只有 Adapter 元数据明确需要浏览器登录态时才使用 `include`；
- 不接受来自页面的任意 URL；
- 不跟随到非 allowlist host 的重定向；
- 外部数据进入 UI 前全部作为文本处理。

### 6.2 重试策略

- 网络错误和 5xx：最多一次延迟重试；
- 401/403：不自动重试；
- 429：不自动重试，读取 `Retry-After` 并提示稍后再试；
- 登录 HTML：不重试，返回 `auth_required`；
- 解析失败：不重试，保存脱敏诊断；
- 单 source 并发数为 1；
- 同一账号同时只能有一个 sync request。

### 6.3 刷新策略

- 页面打开时先展示缓存；
- 成功同步后 2 分钟内再次打开只使用缓存；
- 手动刷新可以强制请求，但仍受每个 source 的最小间隔限制；
- 刷新期间不清空旧数据；
- 页面显示 stale 和最后成功时间。

---

## 7. 消息协议

页面和 service worker 之间只传经过校验的消息：

```ts
type RuntimeMessage =
  | {
      schemaVersion: 1;
      type: "SYNC_REQUEST";
      requestId: string;
      accountIds?: string[];
      force: boolean;
    }
  | {
      schemaVersion: 1;
      type: "GET_STATE";
      requestId: string;
    }
  | {
      schemaVersion: 1;
      type: "UPDATE_ACCOUNT";
      requestId: string;
      account: AccountConfig;
    }
  | {
      schemaVersion: 1;
      type: "DELETE_ACCOUNT";
      requestId: string;
      accountId: string;
    }
  | {
      schemaVersion: 1;
      type: "REQUEST_HOST_PERMISSION";
      requestId: string;
      source: SourceId;
    };
```

返回消息必须带：

- `schemaVersion`；
- `requestId`；
- `source`；
- `status`；
- 结构化的 `Diagnostic` 或 `AdapterError`。

service worker 必须验证 `sender.id`，不得把任意网页消息当作可信请求。

---

## 8. OJ 支持决策矩阵

此表由 Phase 0 更新为 machine-readable JSON 和 Markdown 两份。没有证据的列不能填“稳定”。

| OJ | 初始等级 | 首选数据源 | 登录 | submission URL | 主要风险 | fallback |
|---|---|---|---|---|---|---|
| Codeforces | stable 候选 | 官方 `user.status` | 通常不需要 | `/contest/{contestId}/submission/{id}` | 2 秒限流、特殊题库 URL | 用户列表页 |
| Luogu | experimental | `/record/list` 页面数据 | 需登录态实测 | 未确认，默认只跳列表 | 非稳定内部数据、反爬、401/HTML | 记录列表页 |
| QOJ | unsupported | 无可复现用户历史接口 | 当前通常需要 | 未确认 | 提交列表可能临时关闭、接口未公开 | 保留旧缓存，不申请权限 |
| LibreOJ | unsupported | 无可复现当前接口 | 需实测 | 未确认 | API/站点迁移、旧文档 | 保留旧缓存，不申请权限 |

只有 `stable` 才能默认启用。`experimental` 默认关闭并显示说明。`unsupported` 不注册到同步列表，但保留代码目录以便以后重新验证。

---

## 9. 多 Agent 并行执行总图

```text
Wave 0：研究和契约（可并行）
P0-A CF ─┐
P0-B Luogu│
P0-C QOJ  ├──> G0 Scope Freeze
P0-D LOJ  │
P0-E 浏览器权限 ┘
P0-F 领域契约 RFC ───────────────┐
P0-G 工具链/测试 RFC ────────────┘

Wave 1：实现（Gate 1 后并行）
P1-A domain/message/storage schema
P1-B HttpClient/platform
P1-C CF Adapter
P1-D Luogu Adapter
P1-E QOJ Adapter
P1-F LOJ Adapter
P1-G service worker shell
P1-H fake adapter integration
             └──> G2 Parser/Contract Gate

Wave 2：应用和 UI（Gate 2 后并行）
P2-A sync application
P2-B storage implementation
P2-C Timeline
P2-D Settings/permissions
P2-E navigation/open-tab
             └──> G3 Application Integration

Wave 3：验证和发布（Gate 3 后）
P3-A unit/contract matrix
P3-B Chrome/Edge E2E
P3-C privacy/permission audit
P3-D build/release docs
             └──> G4 MVP Release Gate
```

### 9.1 可以提前并行的工作

- 各 OJ research 文档；
- 脱敏 fixture；
- 领域模型 RFC；
- 工具链 RFC；
- UI mock 数据和静态布局；
- parser 纯函数设计。

### 9.2 必须等待的工作

- 正式 Adapter 请求代码必须等待对应站点 Phase 0 结论；
- application 和 UI 依赖 Gate 1 冻结的模型和消息；
- 权限申请 UI 依赖权限矩阵；
- 发布审计必须等待所有权限和入口稳定；
- 不能在 live API 未验证时把 OJ 标为 stable。

---

## 10. Agent 任务卡规范

每个任务都必须使用以下格式交付：

```text
Task ID:
Owner:
可编辑路径:
只读依赖:
前置任务:
并行任务:
输入证据:
具体步骤:
产出文件:
验收命令:
验收结果:
已知限制:
阻塞条件:
Handoff 给:
```

### 10.1 路径所有权

| 任务角色 | 允许修改 |
|---|---|
| Research Agent | `docs/research/<oj>.md`、`docs/fixtures/<oj>/` |
| Contract Agent | `src/domain/`、`src/application/messaging/`、`docs/decisions/` |
| Adapter Agent | `src/adapters/<oj>/`、`tests/adapters/<oj>/` |
| Network Agent | `src/platform/network/`、`tests/platform/network/` |
| Storage Agent | `src/application/storage/`、对应测试 |
| Sync Agent | `src/application/sync/`、对应测试 |
| Background Agent | `entrypoints/background.ts`、`src/platform/extension/` |
| Timeline Agent | `entrypoints/timeline/`、Timeline 样式和测试 |
| Settings Agent | `entrypoints/settings/`、`src/platform/permissions/` |
| QA Agent | `tests/e2e/`、`docs/qa/` |
| Integration Lead | `package.json`、lockfile、WXT 配置、共享导出、PLAN、最终集成 |

禁止多个 Agent 同时改 `src/domain`、消息协议、storage schema、`package.json` 或 WXT 配置。

---

## 11. Wave 0 任务卡：研究和冻结

### P0-A：Codeforces 数据源验证

**Owner**：Research Agent CF

**路径**：`docs/research/codeforces.md`、`docs/fixtures/codeforces/`

**步骤**：

1. 使用真实公开 handle 调用 `user.status`；
2. 验证匿名、无效 handle、空结果、限流；
3. 记录字段路径、时间单位、verdict、语言；
4. 验证普通 contest、Gym 和特殊题库 URL；
5. 保存脱敏 fixture。

**必须覆盖 fixture**：`ok`、`empty`、`invalid-handle`、`rate-limited`、`malformed`、`unknown-verdict`。

**DoD**：

- 文档有验证日期、浏览器/OS、URL、HTTP 状态、响应类型、字段路径、限制和结论；
- 无账号密码、Cookie、token、代码；
- 明确 `stable/experimental/not-supported`；
- 有复现步骤。

### P0-B：Luogu 数据源验证

**Owner**：Research Agent Luogu

**路径**：`docs/research/luogu.md`、`docs/fixtures/luogu/`

**步骤**：

1. 测试普通 `/record/list` 和 `_contentOnly=1`；
2. 分别测试未登录、已登录、service worker、页面内请求；
3. 记录 JSON/HTML、登录页、401/403、字段路径；
4. 验证 ID、提交时间、verdict、题号、题名和 URL；
5. 验证分页和最小请求间隔。

**必须覆盖 fixture**：`ok-json`、`ok-html`、`login-html`、`401`、`403`、`empty`、`missing-field`、`seconds-or-ms`。

### P0-C：QOJ 数据源验证

**Owner**：Research Agent QOJ

**路径**：`docs/research/qoj.md`、`docs/fixtures/qoj/`

**步骤**：

1. 在真实浏览器登录；
2. 记录 submissions 页面和 Network 请求；
3. 对比未登录和已登录；
4. 确认是否仍关闭完整提交列表；
5. 验证 ID、时间、verdict、题目、分页和 `/submission/{id}`；
6. 验证 service worker credentials 和页面内请求。

若站点仍关闭提交列表，结论必须写为 `not-supported` 或 `experimental`，不得实现绕过。

### P0-D：LibreOJ 数据源验证

**Owner**：Research Agent LOJ

**路径**：`docs/research/loj.md`、`docs/fixtures/loj/`

**步骤**：

1. 验证 `api.loj.ac` 当前可用性；
2. 查找当前 API 方法和真实请求；
3. 测试匿名和已登录；
4. 验证分页、ID、时间、verdict、题目和 URL；
5. 记录 API/页面迁移风险。

不能根据旧仓库或旧博客直接判定支持。

### P0-E：浏览器登录态和权限验证

**Owner**：Platform Agent

**路径**：`docs/research/browser-session.md`、`docs/research/permission-matrix.md`

**步骤**：

1. 用最小 MV3 实验扩展测试 service worker fetch；
2. 测试 `credentials: omit/include`；
3. 测试 Chrome 和 Edge；
4. 测试 optional host permission 的申请、拒绝和撤销；
5. 测试是否必须使用 content script；
6. 记录是否需要 `scripting` 权限。

**结论必须回答**：

- 不申请 `cookies` 是否可用；
- 哪些 OJ 需要 browser session；
- 哪些 OJ 需要页面上下文；
- content script 是否进入 MVP；
- 每个权限的用户可见原因。

### P0-F：领域和消息契约 RFC

**Owner**：Contract Agent

**路径**：`docs/decisions/ADR-002-contracts.md`、`docs/decisions/ADR-004-messaging.md`

**步骤**：

1. 固定 `AccountConfig`、`Submission`、`StoredData`；
2. 固定 verdict、错误和诊断枚举；
3. 固定 runtime message union；
4. 固定迁移策略和版本号；
5. 写出示例 JSON；
6. 由 Integration Lead 审核后进入 Gate 1。

### P0-G：工具链和测试 RFC

**Owner**：Tooling Agent

**路径**：`docs/decisions/ADR-003-toolchain.md`

**步骤**：

1. 验证 WXT、React、TypeScript、Vitest 的最小组合；
2. 固定 Node LTS 和 pnpm；
3. 记录 build、dev、typecheck、lint、format、test 命令；
4. 验证 Chrome 和 Edge 能加载最小包；
5. 不在本任务中实现业务代码。

### Gate 0：Scope Freeze

由 Integration Lead 完成：

- [x] P0-A～P0-E 都有研究文档；
- [x] 四个 OJ 有支持矩阵和脱敏 fixtures；
- [x] 每站都写明验证日期和证据 URL；
- [x] 账号和登录态策略已确定；
- [x] `stable/experimental/unsupported` 已冻结；
- [x] P0-F 契约 RFC 已落实到 domain/message；
- [x] P0-G 工具链 RFC 已落实到 package/lockfile。

Gate 0 不通过时，只修研究和风险，不开始正式 Adapter。

---

## 12. Wave 1 任务卡：契约、平台和 Adapter

### P1-A：domain 和消息实现

**前置**：Gate 0、P0-F

**路径**：`src/domain/`、`src/application/messaging/`

**验收**：

- [x] TypeScript 类型检查通过；
- [x] runtime message payload 有运行时校验；
- [x] schemaVersion 不匹配会返回明确错误；
- [x] 错误枚举集中在 domain 类型；
- [x] 无 UI 和 Chrome API 依赖。

### P1-B：HttpClient 和 platform

**前置**：Gate 0、P0-E

**路径**：`src/platform/network/`、`src/platform/extension/`、`src/platform/permissions/`

**实现**：

- allowlist；
- timeout；
- response size limit；
- retry policy；
- JSON/HTML/login detection；
- tabs open/activate；
- permission check/request；
- 日志脱敏。

**验收**：

- [x] 任意 URL 无法绕过 allowlist；
- [x] 401/403/429/5xx 有结构化错误路径；
- [x] 默认不自动重试，遵守来源 cooldown；
- [x] 不输出 Cookie、token、代码；
- [x] Chrome 和 Edge API 适配集中在 platform 层（WXT `browser` API）。

### P1-C～P1-F：四个 Adapter

每个 OJ 一个独立 Agent，可并行。

**前置**：Gate 0、P0 对应研究、P1-A、P1-B

**允许路径**：只修改自己的 `src/adapters/<oj>/` 和 `tests/adapters/<oj>/`

**固定实现顺序**：

1. `parser` 纯函数；
2. `normalizer`；
3. `urls`；
4. `client`；
5. Adapter index；
6. fixture contract tests。

**每个 Adapter 必须覆盖**：

- 正常多条记录；
- 空列表；
- 登录 HTML；
- 401；
- 403；
- 429；
- 5xx；
- 缺字段；
- 未知 verdict；
- 秒/毫秒/带时区时间；
- 重复 ID 和 verdict 更新；
- 错误题目 URL；
- submission URL 缺失时的 list URL fallback。

**DoD**：

- parser 无网络依赖；
- parser fixture 测试全绿；
- live API 测试不进入 CI；
- Adapter metadata 填写 availability 和 authModes；
- 未支持的 OJ 返回 `unsupported`，不假装成功；
- 交付变更摘要、测试命令、已知限制和证据链接。

### P1-G：service worker shell

**前置**：Gate 0、P1-A、P1-B

**路径**：`entrypoints/background.ts`、`src/platform/extension/`

**实现**：

- action click；
- 唯一 Timeline URL；
- 查找已有标签页；
- 创建/激活标签页；
- 消息校验；
- adapter registry；
- 不让页面传任意 URL。

**验收**：

- [ ] 连续点击只有一个 Timeline；
- [ ] 标签页标题变化不影响识别；
- [ ] service worker 休眠后可重新处理请求；
- [ ] Chrome/Edge 均可用。

### P1-H：fake adapter 集成

**前置**：P1-A、P1-B、P1-G

**路径**：`tests/application/`、`tests/platform/`

**实现**：

- fake adapter；
- fake chrome API；
- fake network response；
- 全成功、部分失败、超时、重复请求场景。

### Gate 1：契约和平台冻结

- [x] domain、message、storage schema 已冻结；
- [x] platform 约束由 HttpClient 和权限模块覆盖；
- [x] stable/experimental Adapter 有 fixture contract tests；
- [x] unsupported Adapter 不会被默认同步。

### Gate 2：Parser/Contract Gate

- [x] `typecheck` 通过；
- [x] parser fixture 通过；
- [x] login HTML 不会产生 0 条正常记录；
- [x] 时间和 ID 规则通过；
- [x] 错误枚举和 message schema 测试通过。

---

## 13. Wave 2 任务卡：同步、存储和 UI

### P2-A：sync application

**前置**：Gate 2

**路径**：`src/application/sync/`

**实现**：

- 读取已启用账号；
- freshness cooldown；
- 同账号单请求锁；
- per-source 并发限制；
- AbortController 取消旧请求；
- 并行 OJ 请求；
- partial success；
- merge/dedupe/sort；
- stale 状态；
- 结构化结果。

**验收**：

- [x] 重复点击只产生一个有效请求；
- [x] 新请求能取消旧请求或复用旧 Promise；
- [x] 一个 OJ 失败不影响其他 OJ；
- [x] 旧缓存始终保留；
- [x] 同 ID verdict 更新正确；
- [x] 排序稳定。

### P2-B：storage application

**前置**：Gate 1

**路径**：`src/application/storage/`

**实现**：

- `load → validate → migrate → default`；
- 单写队列；
- revision 检查；
- 配额错误；
- 每账号保留上限；
- 清理最旧记录；
- 导出/导入 schema 校验；
- 坏数据恢复到安全默认值并保留诊断。

**验收**：

- [x] 两个页面同时写入不会覆盖对方；
- [x] revision 冲突会重读合并；
- [x] schemaVersion 迁移有测试；
- [x] 超过限制会清理旧数据；
- [ ] 导入不能写入未知 URL、未知 source 或超大 payload（导入功能尚未进入 MVP）。
- [x] storage 中没有 rawData、Cookie、token。

### P2-C：Timeline

**前置**：P2-A、P2-B、P1-G

**路径**：`entrypoints/timeline/`

**实现**：

- 先缓存后同步；
- 日期分组；
- OJ filter；
- account filter 或同源账号标签；
- 时间筛选；
- verdict 样式；
- 手动刷新；
- stale、loading、empty、partial-error 状态；
- 链接跳转。

**约束**：

- React 只显示文本；
- 禁止 `dangerouslySetInnerHTML`；
- 不直接调用 OJ；
- 不直接写 storage；
- 不实现统计图和复杂卡片。

### P2-D：Settings 和 permissions

**前置**：P1-B、P2-B

**路径**：`entrypoints/settings/`、`src/platform/permissions/`

**实现**：

- 添加/编辑/删除账号；
- 申请 OJ host permission；
- 允许/拒绝反馈；
- 显示 auth mode；
- OJ availability 文案；
- 清除单账号和全部数据；
- 隐私说明；
- JSON 导入导出。

**多账号规则**：

- 本地 `accountId` 不可变；
- 同一 source 可以有多个账号；
- Timeline 至少显示账号标签；
- 删除账号默认同时删除该账号的 submissions 和 sync state；
- 用户名改动创建新 provider identity，不静默覆盖旧账号。

### P2-E：导航和链接

**前置**：P1-B、P2-C

**实现**：

- 只打开固定 allowlist host；
- 只接受绝对 `http`/`https` URL；
- URL host 必须匹配 source；
- 没有单条 submission URL 时打开 `fallbackListUrl`；
- 不把 Adapter 返回的未校验 raw URL 直接传给 tabs。

### Gate 3：Application Integration

- [x] fake adapter 集成通过；
- [x] storage 并发和迁移通过；
- [x] Timeline 能先显示缓存再同步；
- [x] Settings 能管理多账号；
- [x] 权限拒绝和 OJ unsupported 状态可见；
- [x] 所有外链通过 allowlist。

---

## 14. Wave 3：质量、E2E 和发布

### P3-A：测试矩阵

#### Adapter

每个稳定或实验 Adapter 都必须有：

- 正常多条；
- 空列表；
- 分页/limit；
- 200 登录 HTML；
- 401/403/429/5xx；
- 缺字段；
- 秒/毫秒/带时区；
- 重复 ID 和 verdict 更新；
- 未知 verdict；
- URL 错误。

#### Domain/application

- 跨 OJ 相同 submission ID；
- 多账号；
- 稳定排序；
- 保留上限；
- 坏 schema；
- schema migration；
- freshness cooldown；
- 取消旧请求；
- 单源失败；
- 全部失败但缓存仍显示。

#### UI/E2E

- 首次空状态；
- 缓存先渲染；
- 单源失败；
- 无权限；
- 重复点击同步；
- 没有 submissionUrl 的 fallback；
- Chrome action 激活已有标签页；
- Edge action 激活已有标签页；
- 浏览器重启后数据保留。

### P3-B：Chrome/Edge 验证

建立 `docs/qa/browser-matrix.md`，记录：

- 浏览器版本；
- 操作系统；
- 扩展构建版本；
- 权限状态；
- OJ 登录状态；
- 结果；
- 截图或日志路径；
- 已知差异。

### P3-C：隐私和权限审计

自动和人工检查：

- [x] manifest 不包含 `cookies`；
- [x] manifest 不包含 `webRequest`；
- [x] manifest 不包含 `<all_urls>`；
- [x] 生产 bundle 不包含 Cookie/token/密码字样；
- [x] 当前实现没有生产日志输出完整 URL query；
- [x] 不使用 `innerHTML` 或 `dangerouslySetInnerHTML`；
- [x] 不允许任意 URL fetch 或任意 URL tabs.create；
- [x] 构建产物不含 Phase 0 探针；
- [x] live OJ 账号数据不进入仓库。

### P3-D：发布资料

- README；
- 隐私说明；
- Chrome/Edge 安装说明；
- OJ 支持矩阵；
- 已知限制；
- 数据清除说明；
- 版本迁移说明；
- 故障排查说明。

### Gate 4：MVP Release Gate

只有以下全部通过才能称为 MVP：

- [x] Chrome 和 Edge 共用的 MV3 构建成功；
- [x] typecheck、unit、contract、format 检查通过；lint 暂未加入依赖，避免引入未缓存工具链；
- [ ] E2E 或完整手测矩阵通过（需在真实 Chrome/Edge 中执行 `docs/qa/browser-matrix.md`，当前环境无法替代执行）。
- [x] manifest 权限审计通过；
- [x] 隐私审计通过；
- [x] stable OJ 具备证据；
- [x] experimental/unsupported OJ 有显式说明；
- [x] 没有未处理的高风险阻塞项；
- [x] 发布包不包含测试账号或敏感数据。

当前自动门禁证据：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`（14 tests）、`pnpm format:check`、`pnpm build` 和 `pnpm audit:manifest` 已通过。Chrome/Edge 人工验收仍以 `docs/qa/browser-matrix.md` 为准，未完成前不得宣称浏览器发布门禁全部通过。

---

## 15. 明确的同步行为

### 15.1 打开 Timeline

1. action handler 查找唯一的 Timeline URL；
2. 找到则激活；
3. 找不到则创建；
4. Timeline 请求 `GET_STATE`；
5. service worker 返回本地缓存；
6. Timeline 先渲染缓存；
7. 根据 cooldown 决定是否自动同步；
8. 同步消息带 `requestId`；
9. service worker 为每个账号执行一次 fetch；
10. 各账号结果独立返回；
11. 合并后一次写入；
12. Timeline 更新记录、stale 和诊断。

### 15.2 手动刷新

- 强制发起请求；
- 不能绕过 per-source 最小间隔；
- 不能清空旧数据；
- 同一账号已有请求时复用或取消旧请求；
- 429、403 不自动重试；
- 页面显示最后成功时间和失败原因。

### 15.3 关闭浏览器

第一版不继续同步。浏览器关闭后保留本地数据，下一次打开再同步。

---

## 16. Phase 0 站点研究文档固定格式

每份 `docs/research/<oj>.md` 必须包含：

```text
验证日期：
浏览器/版本：
操作系统：
账号状态：匿名 / 已登录
请求 URL 和方法：
host permission：
HTTP 状态：
响应类型：JSON / HTML / redirect / blocked
字段路径：
时间单位和时区：
分页方式：
limit：
Submission ID：
Submission URL：
Problem URL：
verdict 映射：
频率限制：
CORS / CSRF / Cloudflare：
service worker fetch 结果：
页面内 fetch 结果：
content script 是否必要：
失败样例：
可复现步骤：
结论：stable / experimental / unsupported / needs-more-evidence
最后验证证据：
```

Fixture 文件名必须带场景：

```text
ok.json
empty.json
login-html.html
unauthorized.json
forbidden.json
rate-limited.json
malformed.json
missing-field.json
```

所有 UID、用户名、Cookie、token、代码和私密题目内容必须脱敏。

---

## 17. 开发命令和质量门禁

具体命令由 P0-G 根据最终工具链写入 `ADR-003-toolchain.md`，至少必须存在：

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:contract
pnpm test:e2e
```

live OJ 请求不得成为默认 CI 测试。live 测试只能显式 opt-in，并且不能把真实账号数据写入仓库。

每个 Agent 交付必须附：

- 修改文件清单；
- 使用的命令；
- 命令输出摘要；
- fixture 或测试证据；
- 已知限制；
- 未完成项；
- 交接对象。

---

## 18. 集成冲突和代码审查规则

1. Agent 先读对应 ADR 和任务卡，再写代码。
2. Agent 只能修改自己的允许路径。
3. 不要顺手重排或格式化别人的文件。
4. 共享类型变化必须先更新 ADR，再修改实现。
5. 不允许各 Agent 自行发明字段名、错误码或消息类型。
6. 不允许在 Adapter 中直接导入 React 或 storage。
7. 不允许把 live API 探针复制进产品代码。
8. 集成顺序固定为：契约 → platform → parser/Adapter → core/storage → service worker → UI → E2E。
9. 同一文件发生冲突时，由 Integration Lead 处理，不由两个 Agent 互相覆盖。
10. 每个合并点都要重新运行 typecheck 和受影响的测试。

---

## 19. 事故和降级策略

### 站点接口失效

- 保留已有缓存；
- 标记 source stale；
- 显示结构化错误；
- 不删除历史数据；
- 不无限重试；
- 记录最后成功时间；
- 在支持矩阵中更新状态。

### 站点变更

1. 在 `docs/research` 记录新响应；
2. 更新 fixture；
3. 先修 parser/normalizer；
4. 运行 contract tests；
5. 再更新 availability；
6. 如果无法恢复，暂时降级为 experimental/unsupported。

### 存储损坏

- 备份无法使用的版本信息到诊断；
- 迁移失败时加载安全默认值；
- 不覆盖有效数据，除非用户确认清空；
- 允许导入此前导出的 JSON。

---

## 20. 最终执行顺序

### 第一步：只做 Wave 0

并行完成 P0-A～P0-G，先完成数据源和权限验证，再进入正式实现。

### 第二步：执行 Gate 0

冻结四站支持范围、登录态策略、权限策略和工具链。

### 第三步：初始化项目和冻结契约

由 Integration Lead 执行 P1-A、P1-B 的基础工作，固定 package manager、Node、WXT、消息和存储 schema。

### 第四步：并行实现 Adapter 和平台

P1-C～P1-H 按路径隔离执行，任何 Adapter 都必须有 fixture 和结构化错误。

### 第五步：执行 Gate 2

Parser、契约、错误、时间、URL 和权限测试全部通过后，才开始 UI。

### 第六步：并行实现 application 和 UI

P2-A～P2-E 并行，但 UI 只能依赖已冻结的应用接口和 fake adapter。

### 第七步：执行 Gate 3

验证缓存、同步、存储并发、权限拒绝、单源失败和多账号。

### 第八步：执行 Wave 3 和 Gate 4

完成 Chrome/Edge、隐私、权限、构建、测试和发布文档。

---

## 21. 下一次实际工作

下一次只执行以下任务，不跳步：

1. 为 P0-A～P0-G 建立任务卡；
2. 由各 Agent 领取独立任务；
3. 完成四份站点研究文档和权限研究文档；
4. 生成支持矩阵；
5. 由 Integration Lead 执行 Gate 0；
6. Gate 0 通过后，才初始化 TypeScript/WXT 项目。

Gate 0 的研究结论已经形成，项目已按冻结后的契约完成第一轮 MV3 实现。后续工作以真实浏览器加载、登录态验证、适配器补强和发布审计为主；任何接口结论发生变化，都必须同步更新 `docs/research/`、适配器测试和本计划中的风险记录。

---

## 22. 参考资料

- [Codeforces API 文档](https://codeforces.com/apiHelp/?locale=en)
- [Codeforces Submission 对象](https://codeforces.com/apiHelp/objects?locale=en)
- [洛谷开发组 API 文档仓库](https://github.com/luogu-dev/lgapi-docs)
- [洛谷页面记录接口社区示例](https://www.luogu.com/article/170jpurl)
- [QOJ submissions 页面](https://qoj.ac/submissions)
- [QOJ 用户页面提示](https://qoj.ac/user/profile/yzj123)
- [LibreOJ GitHub 组织](https://github.com/libreoj)
- [LibreOJ 主仓库](https://github.com/LibreOJ/LibreOJ)
- [资料中引用的 LibreOJ API](https://openreview.net/pdf/21683569a378fc87a0c16fcc4d6352f2a1143803.pdf)
- [Chrome 跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Storage and Cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Chrome 安全建议](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
