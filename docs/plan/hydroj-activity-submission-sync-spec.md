# HydroOJ 主域提交与站点品牌同步 Spec

> 状态：提案（架构审查修订版），基于 Hydro 源码和测试实例页面结构整理，尚未实现。
>
> 目标：在现有 HydroOJ 用户提交同步之外，补充用户参加过的比赛、作业等活动中的提交记录，并从当前 HydroOJ 实例主域读取站点名称和图标。
>
> 当前范围：只处理账号配置中的当前实例主域（`AccountConfig.origin`）。不扫描 Hydro 的其他内部域、不使用 `allDomain=1`，也不把 Hydro 的 `domainId` 当作可以直接拼接到 URL 的参数。
>
> 参考源码：Hydro `7c960fad63a6d19169a9cc8a525732b2b9bf9464`。

## 1. 背景

Hydro 的普通测评记录页 `/record?uidOrName=<uid>` 默认查询的是不属于比赛或作业的记录。比赛和作业提交仍然使用同一个 `Record` 模型，但记录通过 `contest` 字段关联活动文档，因此不会自动出现在普通用户记录列表中。

用户页的“最近活动”已经列出用户参加过的活动。Hydro 默认 UI 使用这些活动作为入口，比赛和作业分别链接到：

```text
/contest/<tid>
/homework/<tid>
```

活动页面的“我的提交”链接统一指向：

```text
/record?tid=<tid>&uidOrName=<uid>
```

因此同步流程应当先发现活动，再按活动逐个查询提交。

## 2. 已确认的源码合同

### 2.1 活动发现

Hydro 用户详情 handler 会按用户在当前域中的参加状态查询活动：

```ts
const tsdocs = await ContestModel.getMultiStatus(
  domainId,
  { uid, attend: { $exists: true } },
).project({ docId: 1 }).toArray();

const tdocs = await ContestModel.getMulti(
  domainId,
  { docId: { $in: tsdocs.map((i) => i.docId) } },
).project({ docId: 1, title: 1, rule: 1 }).toArray();
```

用户页模板随后渲染 `tdocs`：

```html
<a href="/contest/<tid>">比赛标题</a>
<a href="/homework/<tid>">作业标题</a>
```

当前实例的“最近活动”页面已经可以看到用户参加过的 OI 比赛和作业，说明这条发现链路适用于目标部署。

### 2.2 活动提交查询

`RecordListHandler` 接受以下参数：

```text
page
pid
tid
uidOrName
lang
status
fullStatus
all
allDomain
stat
```

当 `tid` 存在时，handler 构造的查询条件为：

```ts
const q = { contest: tid };
q.uid = resolvedUserId;
const cursor = record.getMulti(domainId, q).sort('_id', -1);
```

所以用户自己的活动提交请求为：

```text
GET /record?tid=<活动 ObjectId>&uidOrName=<用户 UID>&page=1
```

网页版本返回 `record_main.html`，其中每条记录仍然是 `tr[data-rid]`。Hydro 也支持按请求头 `Accept: application/json` 或查询参数 `noTemplate=1` 返回序列化的 response body；扩展应优先探测 JSON，失败后使用已实现的 HTML 解析器。

### 2.3 活动页中的同一入口

Hydro 默认活动侧栏会根据权限显示：

```text
/record?tid=<tid>
/record?tid=<tid>&uidOrName=<当前用户 UID>
```

这说明 `tid` 是公开的活动查询参数，`domainId` 则是 Hydro 内部的站点域参数。两者不能混用：

- `tid`：某场比赛或作业的 ObjectId；
- `domainId`：Hydro 多域部署中的题库/用户/记录所属域，通常由当前站点路由上下文决定。

### 2.4 权限和可见性

查询活动提交前，Hydro 会检查：

1. 活动是否存在；
2. 用户是否参加或领取该活动；
3. 活动是否允许查看自己的提交；
4. 比赛或作业是否已经允许公开提交记录；
5. 当前用户是否拥有查看隐藏排行榜或记录的权限。

源码中的判断包括：

```ts
contest.canShowScoreboard(tdoc, true)
contest.canShowSelfRecord(tdoc, true)
contest.canShowRecord(tdoc, true)
contest.getStatus(domainId, tid, userId)
```

请求返回 403、Hydro 错误页或空列表时，扩展不能直接认为“没有提交”。应将活动标记为 `permission-denied`、`hidden` 或 `unavailable`，继续同步其他活动。

## 3. 目标行为

一次 HydroOJ 同步应执行以下步骤：

```text
登录态确认
  -> 获取当前用户 UID / 用户名
  -> 请求 /user/<uid>
  -> 解析参加过的活动 tdocs
  -> 对每个 tdoc 请求 /record?tid=<tid>&uidOrName=<uid>
  -> 解析活动记录
  -> 附加活动元数据
  -> 与普通题库记录合并去重
```

站点品牌不是提交同步的隐式副作用。Adapter 应通过显式的实例元数据结果返回它，应用层负责缓存和持久化。在账号验证或同步中，流程可以并行执行以下独立步骤：

```text
请求当前 origin 的 /
  -> 解析站点名称
  -> 发现 favicon
  -> 下载并缓存小尺寸图标（失败则使用内置 HydroOJ 图标）
  -> 时间线按 accountId 使用该实例品牌
```

活动发现失败时，可以继续保留普通题库记录，并在同步诊断中报告活动发现失败。单个活动失败不能使整个 Hydro 账号同步失败。

## 4. 数据模型扩展

现有 `Submission` 保留原字段，并增加可选活动元数据：

```ts
activityId?: string;
activityName?: string;
activityType?: "contest" | "homework" | "other";
activityUrl?: string;
```

字段含义：

- `activityId`：Hydro 活动的 `tdoc.docId`，通常是 24 位 Mongo ObjectId 字符串；
- `activityName`：`tdoc.title`；
- `activityType`：由活动链接路径和 `tdoc.rule` 共同映射；`homework` 映射为 `homework`，其他已确认的竞赛规则映射为 `contest`；未确认的规则映射为 `other`，不能猜测为 training；
- `activityUrl`：规范化后的 `/contest/<tid>` 或 `/homework/<tid>` 地址。

现有提交去重键仍然使用：

```text
source + accountId + submissionId
```

同一条记录从普通列表和活动列表重复返回时，应合并为一条，并优先保留活动元数据。

合并规则必须在 `mergeSubmission` 中集中实现，而不是由 Hydro Adapter 自行去重：

- `activityId`、`activityName`、`activityType`、`activityUrl` 以非空值优先；
- 新值为空时保留旧值；两个非空活动 ID 不一致时保留与 `submissionId` 首次确认的值，并产生诊断，不静默改写；
- `submissionId` 仍以 `source + accountId + submissionId` 去重，不能把 `activityId` 拼入去重键。

## 5. Adapter 设计

Hydro Adapter 增加纯解析函数和请求编排函数，不把 Hydro 活动查询细节放入 Settings UI。实例品牌通过通用的实例元数据结果返回，不允许 Adapter 直接写 storage：

```ts
interface HydroActivity {
  id: string;
  title: string;
  type: "contest" | "homework" | "other";
  url?: string;
}

async function fetchHydroActivities(input: FetchInput, uid: string): Promise<HydroActivity[]>;

async function fetchHydroActivityRecords(
  input: FetchInput,
  activity: HydroActivity,
  uid: string,
): Promise<Submission[]>;

interface InstanceMetadataResult {
  branding?: InstanceBranding;
}

interface InstanceMetadataInput {
  account: AccountConfig;
  signal: AbortSignal;
  now: number;
  requestId: string;
  http: HttpClient;
}
```

`fetchRecent` 的结果仍然返回一个 `FetchResult`，但 `records` 由两部分组成，且可附带实例元数据和非致命诊断：

1. 普通 `/record?uidOrName=<uid>` 记录；
2. 每个参加活动的 `/record?tid=<tid>&uidOrName=<uid>` 记录。

`FetchResult` 需要扩展为：

```ts
interface FetchResult {
  account: CanonicalAccount;
  records: Submission[];
  diagnostics: Diagnostic[];
  instanceMetadata?: InstanceMetadataResult;
  hasMore: boolean;
}
```

同步服务负责把 `instanceMetadata` 和 `diagnostics` 写入/返回；Adapter 不得调用 storage、React 状态或 runtime message。

活动请求应使用当前账号的同一认证方式：

- `browser-session`：`credentials: "include"`；
- `manual-cookie`：发送 `sid` 和 `sid.sig`；
- `password`：复用当前登录会话，失效时先重新登录。

每个活动至少抓取第一页；HTML 页面有明确的下一页链接时继续抓取。JSON 响应若没有明确的 `hasMore`，记录第一页的 `rdocs.length` 作为观测页面大小：后续页长度小于该值时停止；长度相等时继续请求，直到出现空页或达到最大页数。不能因为 JSON parser 默认 `hasMore: false` 就把它当成“确定没有下一页”，也不能无限请求。

## 6. 活动页面解析

### 6.1 用户活动页

HTML fallback 解析目标：

```html
<a class="contest-type--<rule>" href="/contest/<tid>">
  <span>活动标题</span>
</a>
```

解析器需要：

- 从 href 提取 `tid`，并以响应最终 URL 解析相对链接；
- 识别 `/contest/` 和 `/homework/`；
- 解码 HTML 实体；
- 读取链接文本并去除活动标签文本；
- 去重相同 `tid`；
- 只接受当前 Hydro origin 下、路径段为合法 ObjectId 的链接，忽略外部链接和无效 ObjectId；
- 当前版本不把未验证的 `/training/` 或自定义规则强行映射成活动类型，留给后续能力探测。

JSON 优先路径使用 `/user/<uid>` 的 `response.body`，如果部署返回 `tdocs`，直接读取：

```ts
{
  tdocs: [
    { docId: string, title: string, rule: string }
  ]
}
```

JSON 的 `tdocs`、`docId`、`rule` 和 `title` 都必须运行时校验；字段缺失时跳过该活动并产生解析诊断，不能让一个坏活动使整个用户页解析失败。

### 6.2 活动记录页

活动记录页复用现有 Hydro `record_main` 解析器。请求参数只增加 `tid`，不复制另一套状态、时间、语言和题目解析逻辑。

解析时需要额外注意：

- 活动题目链接可能包含 `tid` 查询参数；
- 活动题目可能使用字母题号而非题库 PID；
- 活动页可能根据权限隐藏题目或代码，但提交记录的基本字段仍可返回；
- Hydro 状态链接中的分数和状态文本必须拆成 `score` 与 `verdict`。
- JSON 和 HTML 两条路径必须归一化到同一 `HydroOJRawRecord`，不能维护两套 normalize 逻辑。

## 7. 请求与错误处理

推荐请求顺序（JSON 是优化路径，不是最低兼容合同）：

```http
GET /...
Accept: application/json
```

如果响应的 `Content-Type`、JSON 结构或部署行为不符合已验证合同，再按同样 URL 请求 HTML。自部署版本只要 HTML `record_main` 合同可用，就不应因为 JSON 形状不同而判定实例不兼容：

```http
GET /...
Accept: text/html
```

不能只依赖 `Accept: application/json, text/html` 来判断响应格式；Hydro 的框架会根据 `Accept` 选择 JSON，而不同反向代理可能改写或忽略该头。所有请求都必须设置 `hydroOrigin`，活动页和根页在需要时允许同源重定向，并重新校验最终 URL。

HTML 响应必须识别以下情况：

- `data-page="user_login"`：会话失效；
- Hydro 错误页：活动不存在、未参加或无权限；
- `data-page="record_main"`：正常记录页；
- 没有 `record_main` 且不是登录页：不兼容或挑战页。

根页面的登录页仍可能包含公开的 `og:site_name` 和 favicon。品牌解析可以从登录页提取公开字段，但不能把“品牌解析成功”当作账号认证成功；认证状态由身份/记录请求单独判断。

错误应按活动粒度记录：

```ts
type HydroActivitySyncStatus =
  | "synced"
  | "empty"
  | "permission-denied"
  | "hidden"
  | "unavailable"
  | "auth-required";
```

一个活动的 403、404、权限错误或解析失败，不得丢弃已经成功获得的普通记录和其他活动记录。

`Diagnostic` 需要允许可选的结构化上下文（至少包含 `activityId`、`activityName`、`status` 之一），`SyncSourceResult` 需要原样携带 Adapter diagnostics。第一阶段不把每场活动状态永久写入 `SyncState`；它们作为本次同步结果返回，避免把临时活动列表塞进账号级错误字段。

建议的最小 DTO 扩展：

```ts
interface DiagnosticContext {
  activityId?: string;
  activityName?: string;
  status?: HydroActivitySyncStatus | HydroBrandingStatus;
}

interface Diagnostic {
  // 现有字段...
  context?: DiagnosticContext;
}

interface SyncSourceResult {
  // 现有字段...
  diagnostics: Diagnostic[];
}
```

活动失败是部分成功，不应让 `SyncState.lastError` 覆盖整个账号的成功同步状态；只有普通记录/身份主流程失败时才设置账号级 error。若 UI 需要在下次打开仍看到活动失败，再单独增加有生命周期的诊断缓存，不要把任意活动错误塞进 `AdapterError`。

## 8. 时间线展示

活动元数据可用于题目标题旁的来源标签：

```text
HydroOJ · 比赛 · 2026 年 NOIP 模拟赛
HydroOJ · 作业 · 专题二：贪心与证明
```

第一阶段只要求活动提交进入统一时间线，并保留 `activityUrl` 作为可点击入口。活动筛选、按比赛折叠和活动统计属于后续 UI 工作。

## 9. 同步限制

活动数量和每场活动记录数量可能很大，因此需要：

- 每个账号设置活动数量上限；
- 每个活动设置页数和记录数量上限；
- 使用请求队列，避免同时请求所有活动；
- 复用现有来源冷却和取消机制；
- 发现活动元数据没有变化时，可以缓存活动列表；
- 普通记录和活动记录共享 Adapter 的 `FetchInput.limit` 输出上限；不能悄悄返回 `limit` 倍的记录。若产品需要更多记录，应提升同步服务传入的统一上限，而不是再引入一个 Hydro 专属 retention 语义。

建议第一版默认值：

```text
最多活动数：50
每活动最多页数：5
每活动候选记录数：min(100, FetchInput.limit)
账号最终返回记录数：FetchInput.limit
```

这些是客户端保护上限，不代表 Hydro 服务端分页上限。

预算消耗和排序规则必须固定：先发现活动并按 Hydro 返回顺序处理，再收集普通记录和活动记录，按 `submittedAt` 降序、`submissionId` 稳定排序，最后截取 `FetchInput.limit`。同一记录在普通列表和活动列表重复出现时只消耗一个名额。这样不会因为 Adapter 内部请求了多页而突破通用 `FetchResult.records` 合同。

## 10. 测试计划

新增脱敏 fixture：

```text
docs/fixtures/hydroj/user-activities.html
docs/fixtures/hydroj/user-activities.json
docs/fixtures/hydroj/activity-record-page.html
docs/fixtures/hydroj/activity-record-page.json
docs/fixtures/hydroj/activity-permission-error.html
```

测试覆盖：

1. 用户页可以解析比赛和作业活动；
2. `/contest/<tid>` 和 `/homework/<tid>` 能正确映射活动类型；
3. 活动记录请求包含 `tid`、`uidOrName` 和 `page`；
4. 活动记录复用现有 HTML/JSON 解析器；
5. 普通记录与活动记录按 submission ID 去重；
6. 一场活动权限失败不会阻止其他活动同步；
7. 登录页会触发账号密码重新登录；
8. 活动分页会在上限和下一页条件下停止；
9. JSON 无 `hasMore` 时按观测页面大小继续到空页/上限，不会漏掉整页记录或无限请求；
10. 活动元数据进入时间线数据并生成正确链接；
11. Adapter diagnostics 能从本次同步结果传到 UI，且部分失败不覆盖账号级成功状态。

## 11. 验收标准

在测试实例中，使用一个确实参加过比赛和作业的账号完成以下检查：

- 用户页解析出最近活动列表；
- 至少一场比赛和一份作业各请求一次 `tid` 记录页；
- 活动记录数量大于零时，时间线出现对应提交；
- 活动提交显示活动名称和类型；
- 普通题库提交仍然存在；
- 重复记录只显示一次；
- Adapter 返回记录数不超过统一 `FetchInput.limit`，但不会因 JSON 分页误判而漏掉活动页；
- 活动隐藏或无权限时显示可理解的同步诊断；
- 活动诊断能在本次同步结果中定位到具体活动；
- 账号会话过期后，密码登录模式能够重新登录并继续获取活动记录。

## 12. 主域站点品牌（名称与图标）

### 12.1 范围和定义

这里的“主域”指账号绑定并通过权限校验的规范化实例根地址，例如：

```text
https://oj.example.com
```

它不是 Hydro 数据模型中的 `domainId`。Hydro 的 `domainId` 是同一部署内的题库/用户/记录上下文，当前版本不枚举它，也不请求跨域汇总接口。若用户添加另一个自部署实例，应作为另一个 `origin` 账号范围处理。

### 12.2 站点名称发现

名称请求应复用当前账号的认证方式和当前精确 origin：

```text
GET /
Accept: text/html
```

根路径可能重定向到登录页或带尾斜杠路径；请求可允许重定向，但必须校验最终 `response.url` 仍属于规范化 origin，并用最终 `response.url` 解析相对 favicon。不能为了采集品牌放宽到任意第三方最终地址。

解析优先级：

1. `meta[property="og:site_name"]` 的 `content`；
2. `meta[name="application-name"]` 的 `content`；
3. 规范化 origin 的 hostname，作为始终可用的最终回退。

Hydro 默认模板的 `og:site_name` 表达式是：

```text
handler.domain.ui.name || model.system.get('server.name')
```

因此它比读取导航栏上的 `handler.domain.name` 更适合表示实例品牌。导航栏中的后者可能只是某个内部 Hydro 域名称，不能作为本需求的主域品牌名。

第一版不从 `<title>` 猜测站点名：Hydro 的标题包含当前页面名称，题目、用户和比赛标题中的连字符会造成误截取。解析结果需要 HTML 实体解码、去除首尾空白、限制最大长度（建议 80 个 Unicode 字符），并拒绝空字符串、控制字符和明显的登录页占位文本。名称发现失败不应阻止提交同步，回退显示 `HydroOJ` 或 hostname。

### 12.3 图标发现

从同一个根页面解析标准图标链接，优先级如下：

1. `link[rel~="icon"]`，按 `sizes` 选择不小于 16px 且最接近 32px 的图标；
2. `link[rel="shortcut icon"]`；
3. `link[rel="apple-touch-icon"]`；
4. 同源的 `meta[property="og:image"]`；
5. 当前 origin 的 `/favicon.ico`；
6. Hydro 默认模板中的 `/favicon-32x32.png`、`/favicon-96x96.png`。

相对 URL 必须以响应最终 URL 解析；`rel`、`type` 和 `sizes` 属性解析必须不区分大小写，且不依赖属性顺序。只接受当前 Hydro origin 下的图标地址。若页面通过 `UiContext.cdn_prefix` 指向第三方 CDN，不应在没有该 CDN 独立验证和权限的情况下隐式请求第三方地址；此时使用当前 origin 的 favicon 回退路径。

扩展页面不应依赖远程 `<img>` 永久加载图标。Adapter/网络层应提供受大小限制的二进制读取（建议上限 64 KiB），验证 `Content-Type` 和图片签名后转为 data URL 缓存。第一版只接受 PNG、JPEG、GIF、WebP、ICO 等栅格格式；SVG 需要单独清洗策略，未实现前直接回退内置图标。`HttpClient` 的二进制响应接口应与文本响应分开，不能把图片当 UTF-8 文本读取后再尝试恢复。

建议的网络接口扩展：

```ts
interface HttpRequestOptions {
  responseType?: "text" | "bytes";
}

interface HttpResponse {
  // 现有字段...
  bytes?: Uint8Array;
}
```

当 `responseType: "bytes"` 时，仍然执行当前 source/origin/最终重定向校验和 `maxBytes` 限制。

### 12.4 缓存模型和所有权

品牌是实例级数据，不应复制到每一条提交，也不应塞进 `providerDisplayName`。建议使用可供其他 OJ 复用的实例品牌记录；当前只有 HydroOJ 产生这种记录：

```ts
interface InstanceBranding {
  source: SourceId;
  origin: string;
  name: string;
  iconDataUrl?: string;
  fetchedAt: number;
  iconFetchedAt?: number;
}

interface StoredData {
  // 现有字段...
  instanceBranding?: Record<string, InstanceBranding>;
}
```

缓存键使用无歧义的稳定 tuple 序列化，例如 `source + normalizedOrigin` 的长度前缀编码；不能使用用户输入的原始字符串，也不能只使用 hostname。多个 Hydro 账号共享同一实例时复用同一份品牌缓存；不同实例即使用户名相同也不能共享。这个字段的 schema、迁移和原子写入由 Account/Storage Service 负责，Adapter 只能返回 `InstanceMetadataResult`。

推荐的键函数合同为：

```ts
function instanceBrandingKey(source: SourceId, origin: string): string;
```

它必须先调用同一套 `normalizeOrigin`，并拒绝非 Hydro 账号传入 origin；不要在 UI、Timeline 和 Adapter 各自实现一份 origin 规范化。

刷新策略：

- 首次添加账号或验证成功后立即尝试采集；
- 缓存超过 7 天时，在下一次同步中后台刷新；
- 同一 origin 的并发刷新必须合并为一个请求；内存中的 in-flight map 只能是优化，不能作为正确性或持久化缓存；
- 刷新失败保留上一次成功的名称和图标，并记录可重试诊断；
- 从未成功采集图标时使用内置 `/oj-logos/hydroj.png`；
- 图标下载失败不清除已经成功的站点名称。

为避免 `chrome.storage.local` 被图标挤满，建议限制单图标解码后大小 64 KiB、总品牌缓存 2 MiB、最多 32 个实例，超限按最旧 `fetchedAt` 淘汰。缓存写入失败时只降级到内置图标，不能使账号或提交保存失败。

如果最终采用 schema 版本迁移，新增字段应以空缓存兼容旧数据；不能因为品牌缓存损坏而使账号或提交数据无法加载。服务 worker 终止后必须能从持久化缓存恢复，不得依赖全局变量保存品牌。

### 12.5 时间线和设置页展示

时间线的来源单元格按 `submission.accountId` 查找账号的 `source + origin`，再查找 `instanceBranding[brandingKey]`：

```text
[站点图标] 站点名称
```

有缓存名称时用该名称替换固定的 `HydroOJ`；没有缓存时继续显示 `HydroOJ`。有缓存 data URL 时用站点图标替换默认 HydroOJ logo，否则回退默认 logo。来源筛选器仍显示固定的 `HydroOJ`，因为它按 source 筛选；只有来源行和账号列表使用实例品牌。站点名和图标都不能改变 `source === "hydroj"` 的过滤、权限或导航判断。

设置页账号列表也使用同一品牌缓存，但账号的 `providerDisplayName` 仍表示 Hydro 用户名，不能拿站点名称覆盖用户名。多个实例同时存在时，每个账号/提交按自己的 origin 显示，不能全局取最后一次采集到的名称。

`OJLogo` 建议增加可选的 `iconDataUrl` 和 `fallbackSource` 参数，并在 `onError` 时切换到内置 HydroOJ 图标；图片应设置固定尺寸、`object-fit: contain` 和可访问的 `alt/title`。

### 12.6 Adapter/应用层合同

品牌获取应是独立、可测试的 Adapter 能力：

```ts
interface OJAdapter {
  fetchInstanceBranding?(
    input: InstanceMetadataInput,
  ): Promise<InstanceMetadataResult>;
}
```

`fetchRecent` 可以复用该函数，但不能把站点品牌写入 `CanonicalAccount`，也不能让 Settings UI 再发一套重复的根页面请求。应用层决定刷新时机、缓存 key、淘汰和持久化；Adapter 只负责请求、解析和返回结果。

品牌请求成功不等于账号授权成功。对于根页面返回登录页的情况，若其中有合法公开元数据，可以返回 `name-only` 或 `fallback`；记录同步仍按认证合同独立失败或触发重登录。
品牌请求的网络错误、图标错误和不兼容 HTML 默认都应转为非致命 diagnostic；只有调用方明确要求“验证账号身份”时，认证错误才可以作为 `AdapterFailure` 抛出。

### 12.7 品牌采集错误处理

品牌采集使用独立的诊断，不应把“图标不存在”误报为账号认证失败：

```ts
type HydroBrandingStatus =
  | "synced"
  | "name-only"
  | "fallback"
  | "auth-required"
  | "unavailable";
```

根页面 401 或登录页时，账号密码模式可沿用现有自动重新登录流程后重试一次；浏览器会话/手动 Cookie 模式沿用现有认证错误。图标 404、MIME 不支持或超过大小上限只影响图标，不影响普通记录和活动记录同步。

### 12.8 测试和验收

新增脱敏 fixture：

```text
docs/fixtures/hydroj/site-branding.html
docs/fixtures/hydroj/site-branding-no-icon.html
```

至少覆盖：

1. 从 `og:site_name` 读取实例名称并正确解码 HTML 实体；
2. 解析相对 favicon、不同 `sizes`，并选择合适尺寸；
3. 绝对第三方图标被拒绝或按策略回退，不产生越权请求；
4. 非图片 MIME、超大响应和 SVG 按回退策略处理；
5. 根页面名称失败时回退 hostname/HydroOJ；
6. 品牌缓存按 origin 隔离、过期刷新和失败保留旧值；
7. 时间线显示实例名称/图标，缺失时显示默认 HydroOJ；
8. 两个不同 Hydro origin 的同名账号不会互相覆盖品牌；
9. 登录页也能提取公开品牌，但不会伪装成认证成功；
10. 同源重定向后的相对图标解析正确，第三方最终重定向被拒绝；
11. 二进制图标使用大小、MIME 和签名限制；
12. 品牌采集失败不会丢弃已经成功的提交记录。

验收标准：在测试实例和一个自部署/自定义实例上，登录并同步后，时间线来源标签显示各自站点名称；站点提供 favicon 时显示其图标，favicon 不可用时仍显示稳定的内置 HydroOJ 图标；切换实例后不会沿用上一实例的名称或图标。

## 13. 参考资料

- [Hydro `user.ts`：用户活动 `tdocs` 查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/user.ts)
- [Hydro `record.ts`：`tid`、`uidOrName` 和 `contest` 查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/record.ts)
- [Hydro `contest.ts`：活动详情和活动记录查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/contest.ts)
- [Hydro 用户活动模板](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/partials/user_detail/activity.html)
- [Hydro 活动侧栏中的“我的提交”链接](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/partials/contest_sidebar.html)
- [Hydro `html5.html`：`og:site_name` 和 favicon 声明](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/layout/html5.html)
- [Hydro `base.ts`：`UiContext.cdn_prefix` 和当前域上下文](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/service/layers/base.ts)
- [Hydro `framework/base.ts`：Accept/noTemplate JSON 响应分支](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/framework/framework/base.ts)
- [Chrome 扩展 service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome `storage` API](https://developer.chrome.com/docs/extensions/reference/api/storage)
