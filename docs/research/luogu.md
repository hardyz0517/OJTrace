# Luogu 提交历史数据源验证（P0-B）

验证日期：2026-09-28（UTC）  
浏览器/版本：Codex In-app Browser（IAB）；本子任务未拥有可登录的 Luogu 浏览器会话，未输入或读取任何凭据。直接浏览器页面验证因此只记录为“需要登录态证据”，不伪造已登录结果。HTTP 证据使用同机 PowerShell 7.6.5 的 `Invoke-WebRequest`，User-Agent 为 `Mozilla/5.0 OJTrace research`。  
操作系统：Windows（本任务工作区）。  
账号状态：匿名；请求均未附 Cookie、Authorization 或 CSRF token。

## 已验证请求

| 请求 URL 和方法 | Accept / 头 | HTTP 状态 | 响应类型 | 结果 |
|---|---|---:|---|---|
| `GET https://www.luogu.com.cn/record/list?user=1` | `Accept: text/html` | 401 | HTML | 登录错误页，`lentille-context` 的 `status=401`、`needLogin=1` |
| `GET https://www.luogu.com.cn/record/list?user=1&_contentOnly=1` | `Accept: application/json`, `X-Requested-With: XMLHttpRequest` | 401 | JSON | `UserUnloginException`，`errorData.needLogin=1`；见 [`401.json`](../fixtures/luogu/401.json) |
| 同上 | `Accept: text/html` | 401 | HTML | 登录 HTML；见 [`login-html.html`](../fixtures/luogu/login-html.html) |
| `POST https://www.luogu.com.cn/record/list?user=1` | `Accept: application/json` | 405 | JSON | 仅允许 GET，不是提交列表 API |
| `OPTIONS https://www.luogu.com.cn/record/list?...` | 带 Origin 预检 | 405 | HTML | 当前路由不接受 OPTIONS；未返回 CORS allow header |

host permission：若扩展只调用该站点，应限制为 `https://www.luogu.com.cn/*`；当前匿名响应未返回 `Access-Control-Allow-Origin`，不能假设 service worker 跨域调用可用。页面上下文请求仍需要真实登录 session 和 CSRF 策略。

## 响应/字段路径

匿名请求只能确认错误字段：

- JSON：`errorCode`、`errorType`、`errorMessage`、`errorData.needLogin`。
- HTML：`script#lentille-context` 的 JSON，包含 `template="error"`、`status=401`、`data.errorCode=401`。
- 登录 HTML 的 `<meta name="csrf-token">` 是短时页面 token；fixture 已替换为 `REDACTED`，产品不得保存或上传该值。

成功记录字段、时间单位、分页参数、提交 ID、题号/题名、verdict 和 `/record/{id}` URL **尚未能在无凭据环境实测**。[`ok-json.json`](../fixtures/luogu/ok-json.json)、[`ok-html.html`](../fixtures/luogu/ok-html.html)、[`empty.json`](../fixtures/luogu/empty.json)、[`missing-field.json`](../fixtures/luogu/missing-field.json)、[`seconds-or-ms.json`](../fixtures/luogu/seconds-or-ms.json) 是明确标注为“合同/解析器样本”的脱敏 fixture，不是成功登录响应；不得据此把字段或时间单位写死。

建议待有测试账号后，在 Luogu 自己的“提交记录”页面打开 DevTools Network，逐项记录：

1. 页面初始 `GET /record/list` 的完整 query（`user`、`page`、`_contentOnly` 等）和响应类型；
2. 是否必须带浏览器 Cookie、`X-CSRF-Token`、`Referer` 或 `X-Requested-With`；
3. 成功 JSON 的记录数组路径、ID、`submitTime`（秒/毫秒）、题目对象和 verdict 字段；
4. 翻页是否使用 `page`/`perPage`，以及最小请求间隔；
5. `/record/{id}` 对匿名和已登录请求的状态。

## 失败样例与风险

- **未登录**：401 JSON/HTML 已验证。Adapter 必须把 401/login HTML 映射为 `auth_required`，不能当作 0 条记录；保留旧缓存。
- **403**：本次匿名路径未产生真实 403；[`403.json`](../fixtures/luogu/403.json) 是 Symfony 风格的脱敏合同样本，明确标注“未实测”。不能据此承诺 403 的具体字段。
- **空列表 / 缺字段 / 秒或毫秒**：仅有合同样本，等待已登录抓包确认；未知字段应触发 `invalid_response`/`parse_failed`，而不是静默写空。
- **CORS / service worker**：匿名响应未返回 CORS allow header，OPTIONS 为 405；service worker `credentials: include` 的行为、Cookie 是否足够以及 CSRF 要求均未验证。不要在 MVP 中通过 `cookies` 权限或绕过验证码/反爬。
- **频率限制/反爬**：未登录请求即 401；没有足够证据确定分页上限、Retry-After 或最小间隔。应使用保守 cooldown，一次失败后停止重试。
- **页面内 fetch 与 service worker fetch**：当前没有已登录浏览器会话，二者均为 needs-more-evidence；不能把页面内可见接口直接视为扩展跨域接口。

## 可复现步骤

```powershell
$hJson = @{
  'User-Agent'='Mozilla/5.0 OJTrace research'
  Accept='application/json'
  'X-Requested-With'='XMLHttpRequest'
}
$hHtml = @{
  'User-Agent'='Mozilla/5.0 OJTrace research'
  Accept='text/html,application/xhtml+xml'
}
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
  -Uri 'https://www.luogu.com.cn/record/list?user=1' -Headers $hHtml
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
  -Uri 'https://www.luogu.com.cn/record/list?user=1&_contentOnly=1' -Headers $hJson
Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Method Post `
  -Uri 'https://www.luogu.com.cn/record/list?user=1' -Headers $hJson
```

不要把真实 Cookie、CSRF token、账号名或提交代码写入 fixture；本目录中的 token、用户和题目字段均已替换或使用合同样本。

## 结论

**needs-more-evidence**。当前 Luogu `/record/list`（包括 `_contentOnly=1`）对匿名请求稳定返回 401，HTML/JSON 登录错误可可靠识别；但成功提交列表的字段路径、时间单位、分页、submission URL、浏览器 session/CSRF 要求和 service worker 可用性都没有已登录实测证据。MVP 应暂不注册为 stable：可保留实验性 Adapter 探针，收到 401 时显示 `auth_required` 并保留旧缓存；禁止猜测接口、申请 `cookies` 权限或绕过反爬。升级为 `experimental`/`stable` 前必须补充一次真实登录浏览器 Network 记录及对应脱敏 fixture。

最后验证证据：2026-09-28 对 `www.luogu.com.cn` 的真实 401/405 响应、官方开放平台文档入口（[lgapi-docs](https://github.com/luogu-dev/lgapi-docs)），以及本目录脱敏 fixtures。


## 固定验证字段（P0-B）

- 请求 URL 和方法：`GET /record/list?user=1` 与 `GET /record/list?user=1&_contentOnly=1`；匿名均 401。
- host permission：`https://www.luogu.com.cn/*`；是否还需 CDN/API host 尚未验证。
- HTTP 状态：匿名 401；POST/OPTIONS 405；真实 403 未在本次会话观察到。
- 响应类型：Accept JSON 时 401 JSON；Accept HTML 时 401 登录 HTML。
- 字段路径：仅确认错误字段 `errorCode/errorType/errorMessage/errorData.needLogin`；成功记录路径未确认。
- 时间单位和时区：未确认，见 `seconds-or-ms.json` 合同样本。
- 分页方式：未确认；需登录抓包记录 `page`/`perPage` 或其他参数。
- limit：未确认。
- Submission ID：未确认；成功样本缺失。
- Submission URL：计划验证 `/record/{id}`，未确认。
- Problem URL：未确认。
- verdict 映射：未确认；不得把合同样本中的 `AC` 当作稳定枚举。
- 频率限制：未确认；401 阶段没有可用的分页/限流证据。
- CORS / CSRF / Cloudflare：匿名响应无 `Access-Control-Allow-Origin`；HTML 含短时 `csrf-token`；OPTIONS 为 405。
- service worker fetch 结果：未登录环境只确认普通 HTTPS 可返回 401；`credentials: include`/Cookie/CSRF 行为未验证。
- 页面内 fetch 结果：无已登录浏览器会话，未验证。
- content script 是否必要：未决定；先做最小实验再决定，不得直接申请 `scripting`。
