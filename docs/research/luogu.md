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

## 题目难度上下文（跨 OJ 记录页）

2026-11-09 通过公开题面 `https://www.luogu.com.cn/problem/CF1616D` 的
`script#lentille-context` 确认题目元数据包含 `data.problem.pid` 和数值
`data.problem.difficulty`；CF1616D 的当前值为 `5`，对应洛谷“提高”档。脱敏的
上下文形状见 [`problem-context-cf1616d.html`](../fixtures/luogu/problem-context-cf1616d.html)。

记录列表上下文中的题目对象使用同一个 `problem.difficulty` 字段。当前页上下文可提供初始难度。
独立的 `GET_CROSS_OJ_PROBLEM_DIFFICULTY` 请求从已授权记录页取实际洛谷题号，由后台读取公开题面，
使用 `credentials: omit`、8 秒超时和 5,000,000 字符响应上限。记录查询不等待这次难度请求。
有效难度按题号缓存 30 分钟，最多 128 项，写入 `storage.session` 以支持后台重启。
失败冷却 60 秒，并返回可重试时间；HTTP 429 使用同源冷却登记并遵守 `Retry-After`。
显示难度时，首次失败最多自动补取一次；隐藏期间暂停补取，重新显示或搜索可重新发起，均遵守冷却。
缓存过期后的刷新失败、后续记录响应缺少难度，均保留该题目已知的有效难度。

显示状态只从原生按钮当前文案读取。原生控件重建后重新读取，缺失时保持未知，不预测点击结果。
难度返回、原生文案更新和新记录行插入分别同步题号颜色；切换难度不会重建整个列表。

2026-11-17 再次匿名读取公开题面，确认 CF1A 为 `1`（`pink-3`），CF1616D 为 `5`
（`cyan-3`）。新增的脱敏形状见
[`problem-context-cf1a.html`](../fixtures/luogu/problem-context-cf1a.html)。
显示难度时只给题号应用对应洛谷颜色变量；隐藏时移除题号的独立颜色并继承题名链接色。

当前洛谷难度到颜色的映射来自站点配置：`0 grey-3`、`1 pink-3`、`2 orange-3`、
`3 gold-3`、`4 green-3`、`5 cyan-3`、`6 blue-3`、`7 purple-3`、`8 lapis-4`。

## 2026-11-17 记录列表搜索刷新

当前 loader `loader.20261113-2335.js` 对应的
[记录列表模块](https://fecdn.luogu.com.cn/columba/columba~9cace7345a63ff49.js)
中，搜索按钮和三个搜索输入框的 Enter 均调用前端路由 `push({ query, force: true })`。
按钮位于 `.result` 内的操作容器中。搜索会刷新洛谷的列表数据，筛选条件相同仍可保留同一 URL。
OJTrace 在同 URL 搜索时重新查询外部记录；URL 变化时由新路由挂载后的自动刷新处理。

## 2026-11-17 原生记录列表指标排版

从用户提供的《评测记录 - 洛谷.mhtml》提取指标与语言区块，保留原始空白、
两个 `span` 分组和图标，脱敏样本见
[`record-list-metrics.html`](../fixtures/luogu/record-list-metrics.html)。
公开前端 `RecordListBlock` 的渲染逻辑与该样本一致，第一组包含时间、内存及其后方的
两个分隔符，第二组包含代码长度。每个 `/` 两侧各有一个普通空格和一个不换行空格，
对应文本 `" \u00a0/\u00a0 "`。分隔符由 DOM 文本提供。
前端代码来源见[记录列表模块](https://fecdn.luogu.com.cn/columba/columba~31497e8033eb9960.js)。

原生格式化函数按 1024 进制选择 B / KB / MB / GB，B 保留原数值，其余保留两位小数。
时间小于 1000 时使用 ms，达到对应阈值后依次使用 s / min / h / d，并保留两位小数。
格式化函数来源见[站点加载模块](https://fecdn.luogu.com.cn/columba/loader.20261018-2305.js)。

扩展使用同样的文本分隔、分组和格式化规则，时间、内存及代码长度缺失时仍保留图标及 `—`。
零值按数值格式化为 `0ms` 或 `0B`。
回归测试直接对比上述原生样本的指标文本。另在本地浏览器将原生样本和扩展行使用
相同字体及图标样式并排渲染，确认三个图标的相对位置、宽度和基线一致。

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

**实现状态：stable 目标，发布门禁仍待真实登录浏览器验收**。当前 Luogu `/record/list`（包括 `_contentOnly=1`）对匿名请求稳定返回 401，HTML/JSON 登录错误可可靠识别；代码已实现正式 Adapter、数值/字符串 verdict 映射、`/record/{id}` URL、Service Worker 直连、旧缓存保留和授权入口。同步不会创建或复用洛谷标签页；如果扩展上下文没有可用登录态，会明确返回认证错误并保留缓存。仍必须用真实测试账号确认成功响应字段、时间单位、分页、登录态和 Chrome/Edge 行为，并补充脱敏成功 fixture 后才能完成发布门禁。

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
- service worker fetch 结果：记录同步仍遵守上面的登录态证据；跨 OJ 题目难度只读公开题面使用 `credentials: omit`，失败时保留无颜色题号。
- 页面内 fetch 结果：跨 OJ 记录页优先读取已嵌入的 `lentille-context`，不在页面上下文直接请求 OJ。
- content script 是否必要：跨 OJ 记录页需要读取当前洛谷页面上下文并同步原生难度按钮；题目难度缺失时由 Service Worker 读取公开题面补齐。
