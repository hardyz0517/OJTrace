# Codeforces 提交历史数据源验证（P0-A）

验证日期：2026-09-28（UTC）  
浏览器/版本：Codex In-app Browser（IAB；直接打开 API URL 被 `net::ERR_BLOCKED_BY_CLIENT` 拦截，未把该拦截当作站点响应）；HTTP 证据使用同机 PowerShell 7.6.5 的 `Invoke-WebRequest`，请求头 User-Agent 为 `Mozilla/5.0 OJTrace research`。  
操作系统：Windows（本任务工作区）。  
账号状态：匿名；测试公开 handle `tourist`，fixture 已将 handle 脱敏为 `REDACTED`。未使用 API key、Cookie 或 token。

## 请求与响应

- 请求 URL 和方法：`GET https://codeforces.com/api/user.status?handle=tourist&from=1&count=3`。
- 官方说明：[Codeforces API](https://codeforces.com/apiHelp/?locale=en)；`user.status` 对象字段说明见 [Submission 对象](https://codeforces.com/apiHelp/objects?locale=en)。
- host permission：若由扩展 service worker 请求，需要 `https://codeforces.com/*`（实际产品应按 allowlist 申请）；API 响应本身返回 `Access-Control-Allow-Origin: *`。
- HTTP 状态：200；响应类型：`application/json; charset=UTF-8`。
- 顶层字段：`status`、`result[]`；失败时为 `status: "FAILED"` 和 `comment`，不返回 `result`。
- 实测匿名结果：公开 handle 可返回提交记录，无登录重定向。

## 字段路径和统一模型映射

| 统一字段 | Codeforces 路径 | 实测说明 |
|---|---|---|
| Submission ID | `result[].id` | 整数，稳定且可组成提交 URL |
| Problem ID | `result[].problem.contestId` + `result[].problem.index` | 例如 `2268:D`；不要只用题名 |
| Problem name | `result[].problem.name` | 可选文本 |
| submittedAt | `result[].creationTimeSeconds` | Unix 秒；normalizer 乘 1000 得 epoch ms，勿使用 `relativeTimeSeconds` |
| verdict.raw | `result[].verdict` | 例如 `OK`、`WRONG_ANSWER`；未知值保留 raw 并映射 `other` |
| language | `result[].programmingLanguage` | 可选文本 |
| submission URL | 常规赛：`https://codeforces.com/contest/{contestId}/submission/{id}`；Gym：`https://codeforces.com/gym/{contestId}/submission/{id}` | URL 规则由 `contestId` 上下文决定 |
| problem URL | 常规赛：`/problemset/problem/{contestId}/{index}`；Gym：`/gym/{contestId}/problem/{index}` | 页面请求受 Cloudflare 影响时仍可作为导航 URL |

`result[]` 当前按提交 ID 降序返回；API 文档规定 `from` 从 1 开始，`count` 最大 1000。MVP 可固定 `from=1,count=N`，没有 server cursor；后续增量应以最大 `id` 去重。

## 实测场景

1. **正常（ok）**：公开 `tourist` 返回多条 200 JSON；脱敏样本见 [`ok.json`](../fixtures/codeforces/ok.json)。
2. **Gym**：`GET https://codeforces.com/api/contest.status?contestId=104976&from=1&count=1` 返回 200 JSON；样本见 [`gym-ok.json`](../fixtures/codeforces/gym-ok.json)。该 contest 的页面路径是 `/gym/104976/...`，不能套用 `/contest/...`。
3. **无效 handle**：`GET ...user.status?handle=NoSuchHandleXYZ123...` 返回 HTTP 400，body 为 `{"status":"FAILED","comment":"handle: User with handle ... not found"}`；见 [`invalid-handle.json`](../fixtures/codeforces/invalid-handle.json)。短于 3 或长于 24 字符的 handle 也会 400 参数错误。
4. **空结果**：顶层 `status=OK,result=[]` 是合法响应；见 [`empty.json`](../fixtures/codeforces/empty.json)。本次未找到适合公开验证的零提交账号，因此该文件是 parser 合同样本。
5. **限流**：官方文档明确“最多每两秒一次”，超过时返回 `status=FAILED`、`comment="Call limit exceeded"`；见 [`rate-limited.json`](../fixtures/codeforces/rate-limited.json)。并发探针在本次网络路径未稳定复现该响应，故不要依赖 HTTP 429。
6. **Malformed / unknown verdict**：见 [`malformed.json`](../fixtures/codeforces/malformed.json) 和 [`unknown-verdict.json`](../fixtures/codeforces/unknown-verdict.json)；均为脱敏 parser 合同样本。

直接打开提交/题目页面的脚本请求收到 HTTP 403 Cloudflare HTML（API 仍为 200），因此 Adapter 只依赖 API 元数据，点击链接交给浏览器，不把页面抓取当作同步数据源。

## 失败样例\n\n无效 handle、限流、malformed 和未知 verdict 的失败/异常样例分别见 `invalid-handle.json`、`rate-limited.json`、`malformed.json`、`unknown-verdict.json`；API `FAILED` 绝不能被解释为空提交列表。\n\n## 频率、跨域和失败策略

- 频率限制：官方 API 规则为每 2 秒最多 1 次；客户端应按 source 做 cooldown，遇到 `FAILED/Call limit exceeded` 映射 `rate_limited`，不自动重试。
- CORS / Cloudflare：API 200 响应含 `Access-Control-Allow-Origin: *`；错误响应未承诺该头。页面端可能被 Cloudflare 403，service worker 的 API 请求应限制 allowlist 和响应大小。
- API 失败时保留旧缓存，不把 `FAILED` 当作空列表；登录 HTML/Cloudflare HTML 不能被 parser 当作成功空结果。

## 可复现步骤

```powershell
$h = @{ 'User-Agent'='Mozilla/5.0 OJTrace research'; Accept='application/json' }
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
  -Uri 'https://codeforces.com/api/user.status?handle=tourist&from=1&count=3' `
  -Headers $h
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
  -Uri 'https://codeforces.com/api/user.status?handle=NoSuchHandleXYZ123&from=1&count=3' `
  -Headers $h
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
  -Uri 'https://codeforces.com/api/contest.status?contestId=104976&from=1&count=1' `
  -Headers $h
```

浏览器验证限制：Codex IAB 对 `codeforces.com/api/...` 报 `ERR_BLOCKED_BY_CLIENT`，因此本记录将 PowerShell 的真实 HTTPS 响应作为网络证据，并明确该浏览器限制；不能声称已在页面上下文完成同源 fetch。

## 结论

**stable**（匿名 API 同步）。Codeforces `user.status` 提供稳定的公开 JSON、稳定 submission ID、秒级时间戳和 verdict/language 字段；常规 contest 与 Gym 的 URL 规则已分别验证。实现仍需遵守官方 2 秒频率限制、保留未知 verdict、对 API `FAILED`/Cloudflare HTML 做结构化错误处理。API 不能提供私有提交数据，MVP 不申请 API key，也不读取 Cookie。

最后验证证据：上述官方 API 文档、2026-09-28 的真实 200/400 响应及脱敏 fixtures。

## 2026-10-07 浏览器登录检测排查

- 用户在 Edge 中能打开首页并确认已登录，但 OJTrace 显示 `site-error`，没有诊断文字。当前实现通过扩展后台 `fetch` 请求首页（`credentials: include`）识别账号，不读取已打开网页的 DOM。浏览器会话请求不手动注入或选择 `JSESSIONID`。
- 同机匿名 PowerShell 探针：`GET https://codeforces.com/` 返回 HTTP 403、`server: cloudflare`、`cf-mitigated: challenge`，HTML 标题为 `Just a moment...`；`GET /api/user.info?handles=tourist` 返回 HTTP 200 JSON、`status: OK`。这是匿名 HTTP 证据，不能冒充用户已登录 Edge 的实际后台响应。
- 用户 Cookie 截图显示两个 `JSESSIONID`，分别在 `codeforces.com` 和 `.codeforces.com`，路径均为 `/`；不同作用域可共存。截图无法证明两个 Cookie 分别由谁设置，也无法确定服务端接受哪一个。
- 截图中的 `cf_clearance` 有分区键。Cloudflare 的 [CHIPS 说明](https://developers.cloudflare.com/waf/troubleshooting/samesite-cookie-interaction/#partitioned-cookies-chips-and-cf_clearance)指出，通行状态按顶层上下文分区。用户重新检测后的真实 Edge 诊断为 `http=403; codeforces-cloudflare-challenge; clearance-unpartitioned=false; clearance-first-party-partitioned=true`：已经确认后台请求被验证页拦截，网页分区里有通行 Cookie。分区状态未复用是现有实现的主要兼容缺口；仍不能排除 Cloudflare 的其他请求环境检查。
- 同次诊断的 `jsessionid-count=0` 不表示网页登录 Cookie 消失。截图中两份 `JSESSIONID` 均未设置 `Secure`，而扩展仅申请 HTTPS host permission。[Chromium Cookie 查询实现](https://github.com/chromium/chromium/blob/main/extensions/browser/api/cookies/cookies_helpers.cc)根据 Cookie 的 Secure 属性构造 HTTP/HTTPS URL，再检查该 URL 的 host permission；非 Secure Cookie 因缺少 HTTP 权限被过滤。诊断字段已改为 `jsessionid-visible-count`。未扩大权限去读取这些 Cookie，浏览器 `fetch` 是否发送它们与 Cookie API 的可见性是不同问题。
- Chrome 的 [Cookie 行为说明](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies#partitioning-and-samesite-behavior)指出，具有 host permission 的扩展请求存在 SameSite 特例，因此不能仅凭 `JSESSIONID` 的 `SameSite=Lax` 就判断它无法发送。
- 已修复错误详情被吞掉的问题：失败诊断保留 HTTP 状态、拦截/限流/未登录原因和 requestId；可选的只读 Cookie 元数据探针保留同名 Cookie 的 domain/path/hostOnly/SameSite，以及非分区、Codeforces 顶层分区的 clearance 是否存在。诊断不包含 Cookie 值，不修改 Cookie，也不新增权限。
- 本次只补充检测和诊断，没有把第一方分区的通行 Cookie 复制到其他分区。真实 Edge 复测仍需重新加载构建产物，查看检测诊断；公开用户名模式可以避开首页身份识别，继续使用公开 API。


## 固定验证字段（P0-A）

- 请求 URL 和方法：`GET /api/user.status?handle=tourist&from=1&count=3`；Gym 对比 `GET /api/contest.status?contestId=104976&from=1&count=1`。
- host permission：`https://codeforces.com/*`（实现时进一步限制 API path）。
- HTTP 状态：正常 200；无效 handle 400；超频文档规定 `FAILED/Call limit exceeded`。
- 响应类型：成功/失败均 JSON；提交页面 HTML 可能 Cloudflare 403。
- 时间单位和时区：`creationTimeSeconds` 为 Unix UTC 秒，转换为 epoch ms。
- 分页方式：`from`（1-based）+ `count`（最多 1000），无 cursor。
- limit：`count <= 1000`；另受 2 秒频率限制。
- Submission ID：`result[].id`。
- Submission URL：contest `/contest/{contestId}/submission/{id}`；Gym `/gym/{contestId}/submission/{id}`。
- Problem URL：contest `/problemset/problem/{contestId}/{index}`；Gym `/gym/{contestId}/problem/{index}`。
- verdict 映射：`OK→accepted`、`WRONG_ANSWER→wrong_answer`、`COMPILATION_ERROR→compilation_error`、`RUNTIME_ERROR→runtime_error`、`TIME_LIMIT_EXCEEDED→time_limit`、`MEMORY_LIMIT_EXCEEDED→memory_limit`；未知值保留 raw 并映射 `other`。
- 频率限制：官方规定每两秒最多一次，不自动重试。
- CORS / CSRF / Cloudflare：API 200 含 `Access-Control-Allow-Origin: *`；无 CSRF；页面路径有 Cloudflare 403 风险。
- service worker fetch 结果：PowerShell 真实 HTTPS API 请求成功；IAB 直接打开被客户端拦截，未验证扩展 service worker 的浏览器实现。
- 页面内 fetch 结果：未执行；API CORS 头允许公开跨域，但页面 HTML 可能被 Cloudflare 拦截。
- content script 是否必要：不必要；API 已提供匿名 JSON，MVP 不注入页面。

