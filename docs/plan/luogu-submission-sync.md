# Luogu 提交记录扫描实现计划

> 状态：MVP 主线功能计划。
>
> 目标：把 Luogu 从当前的实验性占位适配器升级为 MVP 必须支持的正式数据源。

## 1. 目标和完成定义

### 1.1 用户目标

用户在设置中点击“添加洛谷账号并授权”，完成洛谷登录态授权后，OJTrace 能够：

1. 自动识别当前洛谷登录账号；
2. 获取该账号最近的提交记录；
3. 转换为统一 `Submission` 模型；
4. 与其他 OJ 一起显示在 Timeline 中；
5. 点击记录跳转到洛谷对应提交页；
6. 登录态失效时保留旧缓存，并给出重新授权提示。

### 1.2 完成定义

Luogu 才能从“待验证”升级为 MVP 正式支持，必须同时满足：

- Chrome 和 Edge 都能完成授权和同步；
- 不要求用户手动粘贴 Cookie；
- 至少一个真实测试账号可以成功获取最近记录；
- 账号身份、提交 ID、题号、提交时间、verdict 和 URL 均有实测证据；
- 分页或“最近 N 条”的边界行为已验证；
- 登录失效、无权限、限流、空列表、字段变化都有结构化错误处理；
- 单元测试、适配器集成测试和浏览器人工验收全部通过；
- 不上传、不持久化、不打印完整 Cookie、密码或 token。

任何一项不满足，都不能对外宣称“已支持洛谷”。

## 2. 用户流程

### 2.1 正常流程

1. 用户打开“设置”。
2. 选择“洛谷”。
3. 点击“授权并添加洛谷账号”。
4. 扩展申请洛谷站点权限。
5. 若运行时验证证明必须读取站点 Cookie，再申请仅针对洛谷的 `cookies` 可选权限。
6. 扩展打开或聚焦洛谷登录页；用户正常登录。
7. 用户回到 OJTrace，点击“检查登录并添加”。
8. 扩展验证登录态并取得当前洛谷账号身份。
9. 账号保存为启用状态，立即执行一次同步。
10. Timeline 展示洛谷记录。

### 2.2 明确不做

- 不让用户复制和粘贴 Cookie 字符串；
- 不把 Cookie 写入 `chrome.storage`、IndexedDB 或日志；
- 不把 Cookie 发送到任何服务端；
- 不通过验证码、Cloudflare 或限流机制；
- 不默认读取所有网站的 Cookie；
- 不在用户没有主动添加洛谷账号时访问洛谷。

### 2.3 Cookie 方案的技术边界

`chrome.cookies` 可以用于检查洛谷登录态，但读取到的值不能可靠地直接写入浏览器 `fetch` 的 `Cookie` 请求头。正式实现按以下优先级执行：

1. 扩展请求使用 `credentials: "include"`，验证浏览器是否自动带上当前会话；
2. 如果 Service Worker 请求无法使用会话，则让已打开的洛谷页面上下文发起同源请求；
3. `chrome.cookies` 只用于授权检查或读取必要的非敏感状态，不保存原始值；
4. 如果上述方式都失败，显示“无法读取当前洛谷登录态”，不要求用户手动粘贴 Cookie。

产品体验可以是一键授权，但请求通道必须以真实浏览器验证结果为准。

## 3. 关键技术决策

### 3.1 账号模型

洛谷浏览器登录态代表当前浏览器配置中的一个登录账号。首版规则：

- 每个浏览器配置文件最多启用一个 Luogu `browser_session` 账号；
- 添加新账号前检查当前登录身份；
- 若发现与已有账号不同，要求用户确认切换并删除旧账号的同步状态；
- 不承诺在同一个浏览器配置文件中同时同步多个洛谷账号；
- Codeforces 等公开 API 账号仍可按现有模型支持多个。

这样可以避免同一份浏览器 Cookie 被错误关联到多个本地账号。

### 3.2 权限模型

初始安装只保留现有基础权限。用户点击授权时再申请：

- `https://www.luogu.com.cn/*` host permission；
- 只有实际验证证明必要时才申请 `cookies` optional permission；
- 不申请 `webRequest`、`scripting`、`<all_urls>`；
- 如果必须使用页面上下文，优先使用针对洛谷域名的声明式 content script，避免动态注入扩大权限。

权限申请失败时，账号不得被标记为启用，Timeline 继续显示其他 OJ 和已有缓存。

### 3.3 请求通道

所有请求仍经过 `HttpClient` 和 source allowlist。Luogu 适配器不得直接调用 `fetch`。

请求通道必须支持：

- 超时和 AbortSignal；
- `credentials` 策略；
- 受限重定向；
- JSON 和登录 HTML 识别；
- 401、403、429、5xx 的结构化错误；
- 响应大小限制；
- 日志脱敏。

### 3.4 数据获取边界

首版只获取最近一页或最近固定数量记录，例如 100 条。首版不做无限历史扫描。

如果洛谷接口需要分页：

- 只请求已验证的分页参数；
- 设置最大页数和最大记录数；
- 记录 `hasMore`，但不在 MVP 自动无限翻页；
- 每页请求遵守已实测的最小间隔。

## 4. 任务分解

### LUOGU-01：真实登录态和接口取样

**目标**：取得一份可复现、脱敏的登录成功网络证据。

**步骤**：

1. 使用专门测试账号登录洛谷。
2. 打开洛谷提交记录页，记录页面初始请求和翻页请求。
3. 确认请求方法、完整路径、query、请求头、credentials 行为。
4. 记录成功响应的 JSON/HTML 结构。
5. 确认当前用户身份字段。
6. 记录提交 ID、题号、题名、时间、语言和 verdict 字段。
7. 确认单条提交 URL 和题目 URL。
8. 注销或清除会话，记录 401/403/登录页响应。
9. 记录空列表、缺字段和异常响应。
10. 记录分页上限和保守请求间隔。

**禁止**：把真实 Cookie、token、密码、完整私密账号信息或提交代码写入仓库。

**产出**：

- 更新 `docs/research/luogu.md`；
- 增加脱敏 fixture；
- 明确正式实现所需的请求合同；
- 如果扩展跨域请求不稳定，明确页面上下文方案。

**验收**：另一名开发者只看文档和脱敏 fixture，就能写出同样的 parser。

### LUOGU-02：授权和登录态服务

**目标**：实现“一键授权”，不让用户填写 Cookie。

**建议路径**：

- `src/application/auth/luogu-session.ts`；
- `src/platform/permissions/`；
- `src/platform/cookies/`（只有确实需要时新增）；
- `src/application/messaging/`。

**职责**：

- 请求洛谷 host permission；
- 按需请求 `cookies` optional permission；
- 打开或聚焦洛谷登录页；
- 检测当前登录身份；
- 返回 `authorized`、`loginRequired`、`permissionDenied`、`unavailable` 等结构化状态；
- 不保存原始 Cookie。

**验收**：

- 首次点击只申请洛谷相关权限；
- 拒绝权限后可以重新尝试；
- 已授权用户再次打开设置不会重复弹窗；
- 未登录时提示登录，不创建启用账号；
- 当前会话身份不匹配时阻止误绑定。

### LUOGU-03：Luogu Adapter 正式化

**目标**：把当前 Adapter 从实验性探针升级为正式 Adapter。

**职责拆分**：

- `client.ts`：构造已验证的请求；
- `parser/index.ts`：只解析响应，不做 UI 逻辑；
- `normalizer/index.ts`：转换为统一 `Submission`；
- `urls.ts`：集中生成提交和题目 URL；
- `index.ts`：实现 `OJAdapter` 入口和错误映射。

**必须处理**：

- 200 JSON；
- 200 HTML 内嵌数据；
- 401 未登录；
- 403 无权限或风控；
- 429 限流；
- 5xx；
- 登录 HTML 被误当作空列表；
- 空记录；
- 缺少 ID、时间或题号；
- 秒和毫秒时间单位；
- 重复记录；
- 单条 URL 不可用时回退到记录列表页。

**验收**：

- `availability` 改为 `stable` 前，所有 live 字段都有实测依据；
- parser 对所有脱敏 fixture 有测试；
- 任意未知响应不会静默产生 0 条记录；
- 不把原始响应保存到生产存储。

### LUOGU-04：同步服务集成

**目标**：让 Luogu 进入现有同步管线。

**要求**：

- 只有授权成功且账号 `enabled=true` 才同步；
- 单账号请求去重；
- 同步失败保留旧缓存；
- 不因 Luogu 失败阻塞 Codeforces；
- 401 映射为 `auth_required`，而不是普通网络错误；
- 保持 freshness cooldown 和来源冷却；
- 账号切换时清理旧账号同步状态和记录，避免串号。

**验收**：

- Luogu 成功、Codeforces 失败时，Luogu 仍能显示；
- Luogu 失败、Codeforces 成功时，Codeforces 仍能显示；
- 连续点击同步不会产生并发请求或重复记录；
- 旧缓存和最后成功时间可见。

### LUOGU-05：设置页和状态文案

**目标**：把实验性占位 UI 改成正式授权 UI。

**需要的状态**：

- 未添加；
- 等待授权；
- 需要登录；
- 权限被拒绝；
- 已授权、待同步；
- 同步成功；
- 会话过期；
- 来源暂时不可用；
- 切换账号确认。

**文案要求**：

- 明确“只使用当前浏览器中的洛谷登录态”；
- 明确“不上传 Cookie”；
- 不显示 Cookie 内容；
- 不把技术异常直接展示给用户；
- 不把“实验性”作为正常使用入口文案。

### LUOGU-06：测试和发布门禁

**目标**：证明 Luogu 是可支持的主线功能，而不是只通过 mock。

**测试范围**：

- parser 单元测试；
- normalizer 单元测试；
- HttpClient 错误映射测试；
- session 授权流程测试；
- sync/cache 集成测试；
- Chrome 手动测试；
- Edge 手动测试；
- 登录、注销、会话过期测试；
- 权限审计和隐私审计。

## 5. 并行开发安排

| 任务       | 负责范围                | 依赖                |
| ---------- | ----------------------- | ------------------- |
| LUOGU-01   | 登录态、接口、fixture   | 测试账号            |
| LUOGU-02   | 权限和授权状态机        | 当前消息协议        |
| LUOGU-03   | parser、normalizer、URL | LUOGU-01 的字段合同 |
| LUOGU-05   | 设置页状态和文案        | LUOGU-02 的消息合同 |
| LUOGU-06-A | 单元和集成测试          | LUOGU-01、03        |

集成必须按以下顺序进行：

1. LUOGU-01 冻结成功响应合同；
2. LUOGU-02 冻结授权消息和状态；
3. LUOGU-03 实现正式 Adapter；
4. LUOGU-04 接入同步；
5. LUOGU-05 接入最终 UI；
6. LUOGU-06 完成 Chrome/Edge 真实验收。

## 6. 建议的授权消息

具体字段以现有消息 schema 为准，新增 Luogu 授权消息时保持版本化：

```ts
type AuthorizeLuoguMessage = {
  schemaVersion: 1;
  type: "AUTHORIZE_LUOGU";
  requestId: string;
  /** Empty string means detect the current browser-session account. */
  identifier: string;
};

type LuoguAuthorizationResult =
  | {
      ok: true;
      accountId: string;
      providerAccountKey: string;
      displayName?: string;
    }
  | {
      ok: false;
      reason:
        | "permission_denied"
        | "login_required"
        | "session_unavailable"
        | "identity_unreadable"
        | "unsupported_response";
    };
```

UI 不直接读取 Cookie，Cookie 也不能放入消息 payload。

## 7. 数据转换要求

统一提交记录至少需要：

```ts
{
  source: "luogu",
  accountId,
  providerAccountKey,
  submissionId,
  problemId,
  problemName?,
  submittedAt,
  verdict,
  language?,
  submissionUrl?,
  problemUrl?
}
```

### 去重

优先使用以下键：

```text
source + accountId + submissionId
```

如果响应没有 submission ID，不得使用时间加题号硬凑稳定 ID；应记录解析失败并保留旧缓存。

### Verdict

不要把洛谷原始字符串直接当作跨 OJ 统一枚举。保留：

- `verdictCode`：内部标准值；
- `verdictLabel`：洛谷原始或展示文字。

至少覆盖 AC、WA、TLE、MLE、RE、CE、pending/unknown，并为未知值保留 `unknown`。

## 8. 风险和应对

| 风险                                | 应对                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| 接口是页面内部接口                  | 固定真实 Network 证据和脱敏 fixture，不凭猜测写 parser |
| Cookie 不随 Service Worker 请求发送 | 明确返回认证错误并保留旧缓存；不创建或复用站点标签页   |
| 需要 CSRF                           | 从已登录页面获取合法 token，禁止伪造或绕过机制         |
| 登录态过期                          | 映射为 `auth_required`，保留旧缓存并提供重新授权按钮   |
| 一个浏览器有多个洛谷账号            | 首版限制一个 active Luogu session，切换时显式确认      |
| 站点字段变更                        | parser 严格校验，失败时可诊断，不静默清空              |
| 频繁请求被限流                      | freshness cooldown、来源冷却、无自动重试风暴           |
| Cookie 权限引起用户疑虑             | 只在点击授权时申请，权限说明明确，不保存不上传         |
| 单条提交 URL 变化                   | URL 构造集中管理，不能跳单条时回退记录列表             |

## 9. 浏览器人工验收

Chrome 和 Edge 各执行一遍：

- [ ] 加载最新 `.output/chrome-mv3`；
- [ ] 点击“授权并添加洛谷账号”；
- [ ] 只出现洛谷相关权限；
- [ ] 已登录时识别正确账号；
- [ ] 未登录时提示登录，不创建启用账号；
- [ ] 成功获取最近提交；
- [ ] 时间线按提交时间倒序；
- [ ] Luogu 筛选可用；
- [ ] 点击记录跳转到洛谷；
- [ ] 重新同步不重复；
- [ ] 注销后显示重新授权；
- [ ] 旧缓存仍保留；
- [ ] 删除账号后记录和同步状态删除；
- [ ] 扩展详情没有不必要的全站权限。

## 10. 交付物和状态变更

完成后应包含：

- 正式 Luogu Adapter；
- Luogu 授权状态机；
- 脱敏成功和失败 fixture；
- parser、normalizer、sync 测试；
- Chrome/Edge 人工验收记录；
- 更新后的 `docs/privacy.md`、`docs/qa/release-checklist.md` 和 `PLAN.md`；
- 不含真实 Cookie、token、密码和账号隐私数据的提交记录。

只有全部门禁通过后，才执行以下状态变更：

```text
Luogu availability: experimental -> stable
Settings label: Luogu（实验性，需登录） -> Luogu
account.enabled: 授权成功后允许 true
release checklist: Luogu 登录态探针 -> Luogu 正式同步
```

## 12. 当前执行进度

- [x] 正式 Luogu Adapter、DataResponse/Lentille 响应解析和字段校验；
- [x] 数值和字符串 verdict 映射、秒/毫秒时间转换、提交/题目 URL；
- [x] 洛谷 URL 集中管理、429 限流错误映射和请求 AbortSignal 传递；
- [x] Service Worker 直连失败时保留缓存并返回可解释错误；
- [x] 设置页“一键授权并添加”，支持留空 UID 自动识别当前登录账号；
- [x] 单账号切换、旧记录清理、同步状态和缓存保留；
- [x] parser、normalizer、Adapter 后台直连、消息协议测试；
- [x] `pnpm test`、`pnpm typecheck`、`pnpm format:check`、`pnpm build`、manifest audit；
- [ ] 使用真实登录态在 Chrome 完成授权、同步、注销和缓存验收；
- [ ] 使用真实登录态在 Edge 完成同一套验收；
- [ ] 将脱敏成功响应写入 fixture，并把人工验收记录填入 `docs/qa/browser-matrix.md`。
