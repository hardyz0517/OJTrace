# QOJ 提交历史研究与适配结论

## 结论摘要

| 能力 | 结论 | 依据 |
|---|---|---|
| 匿名读取用户提交历史 | **auth_required** | `GET https://qoj.ac/submissions` 当前重定向到 `/login`；不能把登录页当作空列表。 |
| 已登录读取用户提交历史 | **experimental** | 2026-10-01 在已登录的 QOJ 浏览器会话（账号 `Hardy`）中实测 `/submissions?submitter=Hardy&page=1` 成功返回服务端 HTML 表格；上游 UOJ 源码确认默认 10 条/页、`id desc` 排序和 `/submission/{id}` 详情路由。 |
| QOJ 的公开 Hack 列表 | **experimental（仅限 Hack 记录）** | `/hacks?page=N` 返回表格，包含 Submission ID、题目、结果、提交时间；这不是某个用户的完整提交历史。 |
| 单条提交 URL `/submission/{id}` | **experimental** | 已登录会话实测 `/submission/3068669` 可打开详情页，显示题目、结果、耗时、内存和逐测试点分数；代码受提交者隐私设置保护，不读取代码。 |
| 可注册给 Adapter 的接口 | **HTML 页面** | 不假定 `/api/...`；Adapter 使用浏览器登录态请求 HTML，并严格校验登录页、表格和稳定提交 ID。 |

QOJ 注册为 `experimental`，不默认启用。支持 `browser-session` 和 `manual-cookie`：用户在 QOJ 登录后，扩展读取 QOJ 当前使用的 `UOJSESSIONID` 会话 Cookie 并请求同源页面；不自动登录、不上传 Cookie。

## 验证环境与范围

- 验证日期：2026-10-01（UTC+8）；匿名登录页夹具沿用 2026-09-28 的脱敏观察。
- 公开页面证据：通过当前网页抓取读取；抓取结果显示服务器时间为 UTC+8。
- 登录页面证据：使用用户主动登录的 Codex 浏览器会话读取，页面导航显示账号 `Hardy`；没有输入、读取或保存密码、Cookie、token。
- 本地探针：Windows PowerShell `Invoke-WebRequest`，对 `https://qoj.ac/`、`/submissions`、`/user/profile/yzj123`、`/hacks?page=1` 均收到 HTTP 403；没有重试、代理或反爬绕过。
- 本地 403 与浏览器已登录页面并不矛盾：前者是无浏览器会话的直连探针，后者是用户已登录的浏览器上下文。
- 本次只验证了浏览器页面可读性；扩展 service worker 是否能在 Chrome/Edge 中复用该会话，仍需单独做最小权限回归。

## 真实页面证据

### `/submissions`

当前公开抓取结果为 `https://qoj.ac/submissions` → `https://qoj.ac/login`，登录页显示 Username、Password 和 Submit。没有返回空列表，也没有可解析的提交记录。证据：

- <https://qoj.ac/submissions>
- <https://qoj.ac/login>

这证明匿名请求不能作为“空提交列表”处理；Adapter 必须识别登录 HTML/重定向并返回 `auth_required`。

在已登录的浏览器会话中，`GET /submissions?submitter=Hardy&page=1` 返回 5 条 Hardy 提交记录。实测表头为 `ID`、`Problem`、`Submitter`、`Result`、`Time`、`Memory`、`Language`、`File size`、`Submit time`；结果同时出现 `AC ✓`、`100 ✓`、`0` 和 `Judging`，题目链接同时出现 `/problem/{id}` 与 `/contest/{contest_id}/problem/{id}`，时间节点包含 `datetime="...+08:00"`。页面导航显示 `Hardy` 和 `Logout`，当前 QOJ 主题使用 `<a class="uoj-username">`，而不是上游旧主题的 `data-link="0"` span。

### UOJ 源码合同

上游 [UniversalOJ/UOJ-System](https://github.com/UniversalOJ/UOJ-System) 的 `web/app/route.php` 注册了 `/submissions`、`/submission/{id}`；`submissions_list.php` 接收 `submitter`、`page`、`problem_id`、分数和语言筛选；`Paginator.php` 默认 `page_len = 10`，并以 `limit offset,10` 读取；HTML helper 按 `id desc` 输出列：ID、题目、提交者、结果、耗时、内存、语言、文件大小、提交时间。登录使用同源会话和 `uoj_username`/`uoj_remember_token` Cookie。QOJ 线上页明确显示 “Based on UOJ”，本次已用真实登录页面验证这些路由、字段、分页入口和单条提交链接。

实现对应文件：`src/adapters/qoj/parser.ts`、`normalizer.ts`、`urls.ts` 和 `index.ts`；测试夹具为 `docs/fixtures/qoj/submissions-page.html`。

### 用户页的关闭提示

抓取 <https://qoj.ac/user/profile/yzj123>（页面随后重定向登录）时，页面正文曾显示：由于获取用户提交的请求量过大，完整提交列表暂时关闭，必须登录后查看。该提示仍是站点公开索引中的当前行为证据，但该索引页面本身抓取时间较早，因此登录后页面形态需要重新实测。

### `/hacks?page=N`（非用户历史）

公开页面 <https://qoj.ac/hacks?page=3> 和 <https://qoj.ac/hacks?page=11> 能看到表格列：`ID`、`Submission ID`、`Problem`、`Hacker`、`Owner`、`Result`、`Submit time`。示例结果文本为 `Success!`、`Failed.`，提交时间显示为 `YYYY-MM-DD HH:mm:ss`（站点页脚标注 UTC+8）。该表是 Hack 记录，不能用于按用户同步全部提交。

`page` 查询参数可翻页 Hack 表；登录后的用户提交列表也实测显示 `?page=N` 分页链接，公开列表页每页 10 条并按提交 ID 倒序排列。

### 单条提交链接

公开 QOJ 题面和讨论中可见链接形如 <https://qoj.ac/submission/40652>、<https://qoj.ac/submission/2649369>。在已登录会话中打开 <https://qoj.ac/submission/3068669> 成功，详情页复用同一提交表头，并增加逐测试点分数、状态、耗时和内存；代码区显示提交者隐私限制。Adapter 只生成详情 URL，不抓取代码。

## 请求、字段和登录态矩阵

| 项目 | 已观察 | 未确认/禁止猜测 |
|---|---|---|
| 历史入口 | `GET /submissions?submitter=<用户名>&page=N`（上游 UOJ 路由/分页） | 不得改写成未观测的 `/api/...` 或 XHR URL |
| 匿名响应 | 重定向到 `/login` | 不能把登录 HTML 当成空列表 |
| 登录方式 | QOJ 当前页面显示同源 `UOJSESSIONID` 会话 Cookie | Cookie 有效期和服务端会话由 QOJ 管理；不得在扩展中上传凭据 |
| 记录 ID | 上游用户历史表和详情链接使用数字 Submission ID | QOJ 线上改版可能增加字段，解析器遇到缺 ID 时必须报错 |
| 题目/结果/时间 | QOJ 登录页实测包含题目、结果/分数、耗时、内存、语言、文件大小、提交时间；时间节点带 `+08:00`；结果有 AC/数字分数/Judging/WA/TL | 页面改版时仍需重新核对结果文本和单位 |
| 分页 | QOJ 登录页实测以 `/submissions?page=N` 翻页，公开列表显示 10 条/页；用户 Hardy 当前只有 5 条，无分页 | 解析器以页链接和实际行数决定是否继续 |
| service worker | Adapter 使用同源 `credentials: include`，请求前申请 `qoj.ac` host permission | 仍需真实浏览器确认扩展上下文可见登录会话、CORS 和限流 |
| 页面上下文 | 已登录普通浏览器页面可直接读取 HTML | 扩展 service worker 是否能复用同一会话、是否必须 content script，仍未在 Chrome/Edge 最小扩展中确认 |

## 可复现步骤（不绕过限制）

1. 在无登录态的普通浏览器标签页打开 `https://qoj.ac/submissions`；记录最终 URL 和页面是否为登录表单。
2. 在用户主动登录的同一浏览器会话中打开 `https://qoj.ac/submissions?submitter=<用户名>&page=1`；记录导航用户名、表头、结果文本、时间节点和题目链接。
3. 翻到 `?page=2`，确认分页链接、每页大小和 ID 顺序；打开任一 `/submission/{id}` 确认详情链接形状。
4. 打开 `https://qoj.ac/hacks?page=3`；确认 Hack 表字段与用户提交历史分开。
5. 仅在用户自己提供并主动登录的测试账号下，使用浏览器 DevTools Network 记录 `/submissions` 加载期间的请求方法、URL、状态、响应类型和分页。不要导出 Cookie 或请求头，不要尝试绕过验证码、限流或关闭提示。

## Adapter 实施边界

- 当前允许返回结构化 `auth_required`/`blocked`/`rate_limited`/`parse_failed`，并保留旧缓存。
- 不抓取 Hack 列表来冒充用户提交历史。
- 不实现猜测的 API、反爬绕过、自动登录或 Cookie 复制。
- QOJ 页面改版时必须重新核对表格列、分页、时间（站点 UTC+8）、结果/分数和单条链接。

## 脱敏 fixture

- `docs/fixtures/qoj/login.html`：登录页最小脱敏片段。
- `docs/fixtures/qoj/submissions-redirect.txt`：匿名入口和最终登录 URL。
- `docs/fixtures/qoj/public-hack-list.json`：公开 Hack 表的字段形状，用户名/题名/ID 已替换为占位符。
- `docs/fixtures/qoj/submission-url.txt`：公开内容中出现的单条提交 URL 形状。

