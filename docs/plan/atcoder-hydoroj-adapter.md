# AtCoder 与 HydroOJ 接入研究计划（历史记录）

> 状态：已被当前实现和专项 Spec 取代，不作为当前开发合同。
>
> 用途：保留早期取样、风险和证据门槛，方便追溯当时为什么选择这些边界。

> **阅读须知**：本文后续内容可能包含“HydroOJ unsupported”“不保存密码”“UID 与 Cookie 必须分开”等历史决策，均不再代表当前实现。当前开发只遵循：
>
> - [账号系统重构 Spec](./account-system-refactor-spec.md)：认证模式、凭证边界、权限、存储与迁移；
> - [HydroOJ 活动与品牌 Spec](./hydroj-activity-submission-sync-spec.md)：Hydro 普通/活动提交、主域品牌和诊断；
> - 当前代码中的 `AdapterMetadata.authModes`、`credentials` 和精确 origin 权限合同。
>
> 若历史研究与上述合同冲突，以专项 Spec 和已通过测试的代码为准；新的研究结果应更新专项 Spec，不要直接恢复本文中的旧实现建议。

## 1. 目标与边界

### 1.1 目标

- 用户选择 OJ 后，界面根据对应 Adapter 声明的认证能力呈现接入方式。
- 支持浏览器登录态的 OJ 默认检测当前选中站点的会话，显示检测账号，再由用户点击“授权并添加”。
- `manual-cookie` 仅作为 Adapter 明确声明的备用模式，表单分别收集 UID / 用户名和 Cookie。
- 支持公开账号查询的 OJ 只要求公开 Handle，不显示授权、Cookie 或 UID 字段。
- 已有 Codeforces、洛谷账号和同步链路继续工作；不更改 `Submission`、Timeline 或引入服务端。
- 权限严格限制在用户当前添加的站点或 HydroOJ 实例，不申请 `<all_urls>`、全站 Cookie 权限或无关域名。

### 1.2 不在本计划范围

- 不猜测 AtCoder 或 HydroOJ 未验证的 API、请求参数和响应字段。
- 不通过验证码、反爬、Cloudflare、访问控制或站点限流。
- 不自动登录、不保存密码、不伪造 OAuth。
- 不把 Cookie 放入 Submission、日志、错误文案或网络服务端。
- 不为了统一 UI 强行让两个 OJ 使用相同 Auth Mode。
- 不做跨设备账号云同步或复杂客户端加密系统。

## 2. 当前架构基线

实现前复核以下现状，避免与工作区后续变动冲突：

- Auth Mode 定义在 `src/domain/types.ts`，Adapter 能力定义在 `src/domain/adapter.ts`。
- Adapter 集合由 `src/adapters/index.ts` 注册。
- Settings 根据 `adapter.metadata.authModes` 动态展示模式。
- 后台消息由 `entrypoints/background.ts` 处理，设置 UI 不直接请求 OJ 接口。
- 洛谷已有 `credentials: include` 登录态检测与同步路径，可作为结构参考，但需要重新验证目标 OJ，不直接复制其接口假设。
- Host 权限由 `src/platform/permissions/hosts.ts` 和 manifest optional host permissions 管理。
- 当前 QOJ Adapter 的接口状态不能据此推断 HydroOJ 也可通过同一接口工作。

## 3. 前置调研与能力判定

AtCoder 和 HydroOJ 分别完成取样。未完成取样的站点保持无可用模式或 unsupported，不在 UI 中承诺授权可用。

### 3.1 AtCoder 取样

需要核实：

1. 用户提交历史的正式页面或站点实际发出的请求 URL、方法和 query。
2. 匿名访客是否可按公开用户名获取完整或最近提交列表。
3. 登录态是否改变可见范围，还是只用于当前用户身份识别。
4. 浏览器 extension service worker 使用 `credentials: include` 能否可靠使用已登录态。
5. 是否需要同源页面请求、CSRF token、特殊 Header 或 content script。
6. 用户身份字段、submission ID、题目 ID、题名、提交时间、语言、结果、耗时/内存等字段路径。
7. 排序、分页、单页上限、速率限制、空列表和登录失效响应。
8. AtCoder 与 AtCoder Problems 等第三方服务的边界。首版不依赖第三方服务作为隐含服务器。

能力决策：

- 若匿名公开 Handle 已能满足目标：只声明 `public-handle`，不出现授权和 Cookie UI。
- 若必须登录才能获取目标数据，并且扩展请求可复用现有浏览器会话：声明 `browser-session` 为推荐模式。
- 只有确实有可复现、允许正常访问的请求路径，且用户主动提供 Cookie 后能正常工作，才声明 `manual-cookie`。
- 不因用户提交列表是公开页面就假设 API 跨域请求、分页或响应字段稳定。

### 3.2 HydroOJ 取样

HydroOJ 通常由多个独立部署实例构成；登录、域名、版本、接口和配置可由实例管理员改变。本计划定义两个入口：**官方 HydroOJ 作为默认实例**，同时支持用户输入自定义 HydroOJ 域名。官方实例走固定的 Adapter 能力和权限配置；自定义实例只有在通过 URL 校验和能力探测后才允许请求。官方实例的 canonical origin 是 PHASE-0 的待确认项，不能从产品名称推断或硬编码猜测。

每个目标实例核实：

1. 官方 HydroOJ 的实例基准 URL、最终 canonical origin，以及自定义实例的 URL 规范化规则、TLS 和重定向行为。
2. 登录状态检测的站点自有请求和当前用户 identity 字段。
3. 用户提交历史的站点页面或已观察的请求；方法、URL、参数及分页。
4. service worker `credentials: include` 是否使用该实例浏览器会话。
5. 是否依赖同源页面上下文、CSRF 或实例自定义认证。
6. 版本差异、响应字段差异，以及如何识别不兼容实例。
7. UID、用户名、提交 ID、题目、结果、时间、语言及提交链接字段。

能力决策：

- 官方 HydroOJ 是默认选项，使用固定官方 origin、固定 Adapter 合同和固定显示名称。
- 自定义实例使用用户输入的 HTTPS origin；不能把官方实例的成功响应直接视为所有自定义实例均兼容。
- Adapter 的能力基于当前实例验证结果；不能把一个实例的结果外推到所有 HydroOJ 部署。
- 若不同实例协议不兼容，首版只支持经过验证的实例/版本；不兼容自定义实例显示“暂不支持此实例”，不创建账号。
- 将自定义输入规范化为 `origin`（scheme + host + 非默认 port）。首版只允许输入根路径 origin，不支持子路径部署；拒绝 URL 中的 username/password、query、fragment 和非 HTTPS。
- 自定义实例必须先通过 URL parser 检查 HTTPS、合法 origin、无用户名密码、合法端口、禁止的重定向，并拒绝 loopback、link-local、私网 IPv4/IPv6 目标，再申请该 origin 的 host permission；禁止宽泛匹配。
- 首次添加自定义实例时先执行轻量且不带 Cookie 的能力探测；探测只判断协议兼容性，不创建或授权账号。取得该 origin 权限后，再单独检测 browser session。
- 不自动向用户填写的任意 URL 发送 Cookie。每次请求都要验证其 origin 与该账号绑定的 origin 一致。

### 3.3 脱敏证据

每个站点或 HydroOJ 实例至少保存：

- 调研日期、浏览器/版本和实例版本（HydroOJ）；
- 请求方法、URL 模板、状态码、响应类型和分页行为；
- 未登录、成功、空列表、字段缺失、限流/错误响应的脱敏 fixture；
- 明确指出哪些证据来自真实登录浏览器，哪些仅为 parser 合同样本。

严禁保存 Cookie、Authorization、CSRF token、密码、完整私有用户名或提交代码。fixture 中的用户、题目和记录标识必须替换或合成。

## 4. Auth Mode 与 Adapter 设计

### 4.1 Auth Mode 定义

沿用现有抽象：

```ts
type AccountAuthMode = "public-handle" | "browser-session" | "manual-cookie";

interface AuthModeDefinition {
  type: AccountAuthMode;
  recommended?: boolean;
  label?: string;
  description?: string;
}
```

Adapter 的 `metadata.authModes` 是 Settings 唯一的模式能力来源。推荐顺序由 Adapter 明确标注，不在 React 组件里按 OJ ID 分支。

### 4.2 Browser Session 检测

能力接口沿用当前 Adapter 风格：

```ts
interface BrowserSessionAccount {
  authenticated: boolean;
  status:
    | "authenticated"
    | "unauthenticated"
    | "network-error"
    | "permission-denied"
    | "site-error"
    | "unsupported";
  username?: string;
  uid?: string;
}

interface OJAdapter {
  metadata: AdapterMetadata;
  detectBrowserSession?(
    input: BrowserSessionInput,
  ): Promise<BrowserSessionAccount>;
}
```

检测应只访问当前选中 OJ / 已配置实例的最小身份端点；返回账号标识，不返回 Cookie、响应正文或敏感请求头。错误按状态类型映射成简短 UI 文案，不向用户暴露堆栈或响应内容。

### 4.3 认证数据边界

browser-session 账号仅保存：

```text
source、instance origin（HydroOJ 需要时）、accountId、公开/提供方账号标识、authMode、enabled
```

不读取或复制完整浏览器 Cookie 到 `chrome.storage.local`。

manual-cookie 账号仅在确实有用且 Adapter 支持时保存 Cookie；存储集中在 AccountConfig 的凭证字段或集中凭证边界中，不混入 Submission、SyncState 或日志。UI 只显示遮罩输入，不读取已保存 Cookie 回填到页面。删除账号、清除账号和清除全部数据必须同时删除相应 Cookie。

浏览器本地扩展存储并非加密保险库，不能把明文本地保存描述成绝对安全。UI 简洁说明凭证只保存在本地浏览器、不上传；代码注释说明 `chrome.storage.local` 中的手动 Cookie 属敏感明文数据。

## 5. 权限与请求安全

### 5.1 Host 权限

- AtCoder 使用精确站点 host pattern，只有完成调研并确认请求主机后才登记。
- HydroOJ 不用 `*.hydro.ac` 或 `<all_urls>` 覆盖任意实例。
- 若用户输入实例，权限请求必须由用户明确添加该实例触发，按 HTTPS origin 最小范围申请。
- 不申请 `cookies` 权限：优先由浏览器请求凭 `credentials: include` 使用会话。
- 不申请 `scripting` 或 content script，除非实测证明 service worker 请求不能满足，并另行审查最小页面权限。
- 保持 http client 的 source/origin allowlist；HydroOJ 动态实例必须用显式的账号绑定 origin 校验，不接受任意 URL 或重定向到第三方 origin。

### 5.2 错误分类

检测和同步至少区分：

- 未登录 / 会话过期；
- host permission 未授予或已撤销；
- 网络错误 / 超时；
- 站点拒绝、限流或风控；
- 站点响应格式变化或实例版本不兼容；
- Adapter 不支持。

失败不清空已同步提交记录。检测失败时，可提示重试或使用已声明的 manual-cookie fallback。

## 6. 用户流程与 Settings UI

### 6.1 选择 OJ / 实例

- 顶部先显示“添加账号”和 OJ 选择器。
- AtCoder 以及 HydroOJ 仅在 Adapter 有能力时出现认证表单。
- 选择 HydroOJ 后默认选中“官方 HydroOJ”。同时提供“自定义实例”选项和域名输入框，实例地址与 UID / Cookie 分开填写。
- 自定义实例地址提交前显示规范化 origin；只接受 HTTPS 根路径 origin，不接受路径代理、用户名密码、query、fragment、loopback 或私网目标。
- HydroOJ 实例地址变更时清空 UID、Cookie、authMode 临时状态和 session 检测结果，并重新请求新 origin 权限。
- OJ 下拉变化时清除旧 Auth Mode 临时状态、输入和错误，选中新 OJ 推荐模式并重新检测其登录态。

### 6.2 `public-handle`

- 只显示 Handle 输入框。
- 显示简短说明：使用公开账号信息获取提交，不需要登录授权或 Cookie。
- 按钮为“添加账号”。

### 6.3 `browser-session`

- 默认展开推荐模式“使用当前浏览器登录状态”。
- 状态显示“正在检测登录状态… / 已检测到登录账号 / 当前浏览器未检测到登录账号 / 暂时无法检测”。
- 未登录时提供“重新检测”；需要时可提供打开目标 OJ 登录页的简单链接。
- 只有检测确认 authenticated 后，“授权并添加”才可提交。
- UI 不出现“扫描浏览器”“读取所有 Cookie”等措辞。

### 6.4 `manual-cookie`

- 在 browser-session 下方显示低权重 fallback 入口。
- 点击后再展开独立表单，字段明确分开为 UID / 用户名和 Cookie。
- Cookie 使用 `type=password`，不在账号列表、状态文本、错误或日志中回显。
- 手动模式按钮为“添加账号”。
- 若 Cookie 已持久化，页面不回填值；可通过更新凭证的单独流程重新输入。

### 6.5 已连接账号

显示 OJ、账号标识、认证方式和同步状态，例如：

```text
AtCoder  tourist
          公开 Handle · 最近同步成功

HydroOJ  alice
         浏览器授权 · 最近同步成功
```

不显示完整 Cookie。HydroOJ 同名账号需显示实例短域名，避免把不同实例身份混淆。

## 7. 数据和旧账号兼容

- 不改 `Submission` 结构。
- 继续读取 `public` 和 `browser_session` 旧值，并归一化到 `public-handle`、`browser-session`。
- 新账号只写新 Auth Mode 值。
- 若 HydroOJ 需要实例 URL，只给 HydroOJ AccountConfig 增加可选且经过校验的 origin 字段；不改通用 Submission。
- 旧账号迁移不得猜测实例、拼接 URL 或自动生成凭证。
- HydroOJ 身份唯一键按 `source + normalizedOrigin + providerAccountKey` 区分；自定义实例变更 origin 必须创建独立身份，不能静默改绑旧账号。
- 写入前按 source + account identity + instance origin 做去重/替换策略评审，避免重复添加和串账号。
- 只有账号授权/验证完成后才启用同步；public-handle 账号允许按当前 Codeforces 流程添加，并在权限拒绝时保存为 disabled。

## 8. 实现任务与顺序

### PHASE-0：能力研究和产品决策

1. 调研 AtCoder 数据接口、登录态及匿名读取能力。
2. 确认官方 HydroOJ 的 canonical origin、登录身份和提交历史接口。
3. 至少验证一个官方实例和一个自定义实例/版本；整理版本与部署差异。
4. 记录每个实例的 host、重定向、登录身份字段、提交字段、分页、限制和脱敏响应。
5. 明确官方实例与自定义实例的能力探测、兼容判断和失败文案。
6. 形成每个 OJ 与每类 HydroOJ 实例的 Auth Mode 决策表；无证据时声明 unsupported。

**验收**：有足够证据写出 Adapter 的请求合同和错误识别测试；不能把推测写成可用能力。

### PHASE-1：公共数据模型与协议

1. 复核现有 `AccountAuthMode` 和 Adapter `authModes` 实现。
2. 为 HydroOJ 账号增加规范化实例 origin；“官方 / 自定义”优先根据 origin 与已确认的官方 origin 派生，避免冗余字段互相矛盾。只有 UI 确实需要时才保存实例 label。
3. 增加或复核 `BrowserSessionAccount` 和 `detectBrowserSession` 契约。
4. 增加通用检测和授权消息，不增加 OJ 专用 Settings 消息。
5. 校验消息中 source、origin、authMode 与 Adapter 声明一致。
6. 对手动 Cookie 消息和错误路径做脱敏，禁止打印消息对象。

### PHASE-2：平台权限和网络边界

1. 先核对 WXT 与 Chrome MV3 对运行时申请任意 exact-origin optional host permission 的支持和浏览器差异。
2. 保留官方 HydroOJ 固定权限；如果平台支持，则在用户明确添加自定义实例时申请单一精确 origin 权限。
3. 如果平台不允许任意 origin 运行时授权，暂停自定义实例 browser-session 实现并评估受限方案，禁止退化成 `<all_urls>`。
4. 请求 allowlist 在应用层绑定账号 origin，校验 URL 和最终 response origin，阻断跨站重定向；禁止向账号 origin 之外发送 Cookie。
5. 默认不新增 `cookies`、`scripting`、`webRequest`、`<all_urls>`。
6. 更新 manifest audit 和权限测试，分别验证安装期权限与运行时动态权限边界。

### PHASE-3：AtCoder Adapter

1. 根据 PHASE-0 结果声明准确 authModes。
2. 独立实现 URL 构造、解析、normalizer 和 Adapter 请求处理。
3. 严格区分登录页、空提交、限流、网络错误和格式变化。
4. 校验提交 ID、时间单位、结果、题目和分页边界。
5. 授权成功后映射 canonical identity，接入既有 `syncEnabledAccounts`。
6. 同步失败保留旧缓存。

### PHASE-4：HydroOJ Adapter

1. 先完成官方 HydroOJ 固定 origin 的纵向流程：能力声明、授权检测、最近提交、存储和同步。
2. 请求执行器的 origin 必须来自受验证的 Adapter 输入；不得直接信任 runtime message 中传来的任意 URL。
3. 官方链路通过测试后，再实现自定义 origin 校验、无凭据探测、动态权限和兼容性判断。
4. 对未验证版本/实例返回 unsupported 或 invalid response，不静默视为空记录。
5. 确认账号 key 包含实例身份，避免不同 origin 的 UID 冲突。
6. 限制请求体、响应体、分页上限、超时、重定向及 host allowlist。
7. 同步仍复用现有 pipeline 和缓存策略。

### PHASE-5：Settings 接入

1. 从 Adapter 列表动态生成 OJ 选择器和认证表单。
2. 按推荐模式默认展开 browser-session；manual-cookie 仅显示 fallback 链接。
3. 将检测状态映射成简短中文文案，不将站点专有请求写进 React。
4. AtCoder 若是 public-handle，只显示 Handle 与添加按钮。
5. HydroOJ 默认实例使用明确标注的官方选项；自定义实例走独立 origin 输入和“检测实例”操作。
6. 新实例探测成功后才显示该实例可用的认证方式；检测中、网络失败和不兼容状态分别呈现。
7. HydroOJ 实例输入或选择切换时清除前一实例临时状态。
8. 已连接账号显示“公开 Handle / 浏览器授权 / 手动凭证”和最近同步状态，并显示官方或自定义实例域名。
9. Cookie 输入遮罩、不回填、不记录、不显示在错误文案中。

### PHASE-6：迁移、隐私与测试

1. 测试旧 Auth Mode 迁移和原有 Codeforces / Luogu 同步行为。
2. 测试 manual-cookie 不进入 Submission、错误信息和 UI 明文回显。
3. 测试删除账号与清空数据会删除该账号的 Cookie。
4. 测试权限拒绝、权限撤销、origin 重定向和请求越界。
5. 测试 URL 拒绝策略：HTTP、userinfo、query、fragment、子路径、loopback/private/link-local IPv4/IPv6 和 IPv4-mapped IPv6。
6. 测试 AtCoder 成功、空列表、无效 Handle、未登录（若适用）、限流、超时、格式错误。
7. 测试 HydroOJ 官方和自定义实例已登录、未登录、实例不兼容、空列表、分页及错误实例 origin。
8. 执行 `pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build`、`pnpm audit:manifest`。
9. 在 Chrome 和 Edge 真实登录态手动验收；记录浏览器版本和脱敏请求证据。

## 9. 关键测试合同

### Adapter 单元测试

- Adapter metadata 只列出真实支持的模式，推荐模式唯一且可选。
- 后台对 source、authMode、规范化实例 origin 和 host permission 重新校验，不信任 UI 校验结果。
- `detectBrowserSession()` 只返回 authenticated、status 和公开身份标识。
- 未登录、网络失败、权限失败和站点响应错误分别得到不同状态。
- 手动 Cookie 请求只发往绑定的 OJ origin，不出现在输出对象、日志或错误文本。
- 未知响应不会被解析成合法空列表。
- 时间转换、分页截断、稳定 ID 和 URL 构造有真实脱敏 fixture 支持。

### 应用 / 存储测试

- 通用消息只接受 Adapter 所声明的 source + authMode 组合。
- 更换 OJ 或 HydroOJ origin 后，不复用之前的 identity 或 cookie 临时状态。
- manual-cookie 只存在于账号凭证字段，绝不进入 Submission。
- 删除账号、清理账号、清理全部时凭证同步删除。
- 旧账号迁移保持 accountId、提交记录和 syncState 关联不变。
- 授权失败不创建 enabled 账号；已有缓存不丢失。
- HydroOJ 使用 `source + normalizedOrigin + providerAccountKey` 隔离身份；修改自定义 origin 不静默改绑账号。

### UI 验收

- AtCoder public 模式只显示 Handle、说明和“添加账号”。
- browser-session 模式先显示检测状态和“授权并添加”。
- 未登录有“重新检测”和可选登录页入口。
- manual-cookie 初始折叠，展开后 UID 与 Cookie 是两个独立字段，Cookie 遮罩。
- 切换 OJ/实例清除 UID、Cookie、检测结果和上一来源错误。
- 已连接账号显示认证方式，不显示凭证。

## 10. 权限与隐私验收

- 初始 manifest 不包含 `cookies`、`scripting`、`webRequest` 或 `<all_urls>`。
- AtCoder host pattern 只包含其真实请求域名。
- HydroOJ 不申请泛域名权限；用户实例权限按 HTTPS 精确 origin 申请。
- 自定义实例的兼容探测不带 Cookie；取得 origin 权限前不发起 session 检测或认证请求。
- 自定义 origin 校验需考虑 DNS rebinding 和解析变化；在请求及重定向后校验目标。若浏览器平台无法约束 DNS 层目的地址，明确记录限制，不宣称可完全阻止 SSRF。
- service worker 认证请求只访问当前 OJ / 当前 HydroOJ 实例。
- browser-session 不复制 Cookie 到任何持久化存储。
- manual-cookie 若保存，只保存在本地账号配置并明确说明本地存储边界。
- 日志和用户错误不含 Cookie、CSRF、Authorization 或原始响应正文。
- 无任何服务端上传或远程账号同步路径。

## 11. 交付物

- `docs/research/atcoder.md`：接口和认证证据。
- `docs/research/hydroj.md`：HydroOJ 实例模型、版本和认证证据。
- `docs/fixtures/atcoder/` 和 `docs/fixtures/hydroj/`：完全脱敏的成功与错误响应。
- AtCoder Adapter 与 HydroOJ Adapter，只有通过证据门槛的功能才注册。
- 更新后的领域类型、权限边界、消息协议、Settings UI 和存储兼容。
- 测试、manifest audit 结果及 Chrome/Edge 人工验收记录。
- 更新 `docs/privacy.md`、`docs/research/permission-matrix.md`、QA 检查清单和 `PLAN.md`。

## 12. 风险评审与实施决策

以下是实现前必须关闭的工程风险，不应留给编码阶段临时猜测：

| 风险                              | 原计划中的缺口                                     | 本计划采用的控制                                                                                                     |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| HydroOJ 官方地址不明确            | “官方 HydroOJ”容易被误当成已知固定域名             | PHASE-0 核实 canonical origin；确认前不硬编码，不声明支持                                                            |
| 任意域名权限是否可动态授予        | 计划假定 runtime 可对任意实例请求精确权限          | PHASE-2 验证 Chrome / Edge 与 WXT 能力；不支持则暂停该功能，禁止扩大权限                                             |
| 自定义域名指向内网服务            | HTTPS 本身不能阻止 localhost、私网或 DNS rebinding | 拒绝本地/私网地址，限制 origin 和重定向；记录浏览器 DNS 防护边界                                                     |
| 官方实例代码和自定义实例耦合      | 单一固定 Adapter 容易散落 `if (official)` 判断     | 官方与自定义共用协议实现，通过受验证的 instance config / capabilities 输入差异；Settings 按 Adapter 元数据渲染       |
| 探测请求携带用户凭证              | 能力探测可能误复用 browser credentials             | 探测明确无 Cookie、无副作用；授权检测是另一个需要权限的显式步骤                                                      |
| Adapter metadata 不能描述实例能力 | 静态 `authModes` 无法表达某个实例未兼容            | 将静态 Adapter 能力与 runtime instance capability 分开；探测通过后返回该实例可用模式，不在 Settings 按实例类型硬编码 |
| Cookie 更新和删除边界不清         | 账号更新、重复添加和删除可能遗留旧秘密             | 实例身份唯一键明确；替换凭证需显式操作；账号删除/清除完整删除凭证；不回显已存 Cookie                                 |
| HydroOJ 部署差异过大              | 只验证一个实例不足以支持广泛声明                   | 最小验证官方 + 一个自定义实例；支持范围按协议/版本收敛，其他实例默认 unsupported                                     |

以下结论是本研究计划创建时的历史快照，不应覆盖当前实现：AtCoder 的匿名登录页已验证，但登录态请求与用户提交历史 JSON 合同尚无真实登录样本；当时 HydroOJ 官方域名首页返回 Cerberus challenge，因此曾暂时保持 unsupported。当前 HydroOJ 已有独立 Adapter、账号密码/手动 Cookie/浏览器会话路径和精确 origin 权限；后续活动提交与品牌工作以专项 Spec 为准。

## 13. 完成门槛

- [x] AtCoder 匿名请求证据表明提交页需要登录；[ ] 登录浏览器的会话检测和提交响应合同仍待验证。
- [ ] HydroOJ 官方默认实例已验证并有实例证据。
- [ ] HydroOJ 自定义实例的 URL 校验、精确权限申请和不兼容实例处理已验证。
- [ ] Chrome / Edge 动态 exact-origin optional host permission 限制已验证；若平台能力不足，已暂停该路径且未增加宽泛权限。
- [ ] browser-session 检测和授权在 Chrome 与 Edge 的真实登录状态下成功。
- [ ] manual-cookie 仅在确有需要并可端到端验证时启用。
- [ ] Codeforces 与洛谷现有同步和旧账号迁移测试通过。
- [ ] 权限审计通过，未新增宽泛权限。
- [ ] Cookie 不进入日志、Submission、远端请求服务或 UI 明文。
- [x] typecheck、tests、format、build 和 manifest audit 全部通过。
- [ ] 文档和 fixture 足以让开发者复现接口判断与认证限制。

只有完成这些门槛后，才在 Settings 中将新 OJ 显示为可添加状态，并在发布文档中声明支持。
