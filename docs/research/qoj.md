# QOJ 提交历史研究（P0-C）

## 结论摘要

| 能力 | 结论 | 依据 |
|---|---|---|
| 匿名读取用户提交历史 | **unsupported** | `GET https://qoj.ac/submissions` 当前重定向到 `/login`；用户页也要求登录。 |
| 已登录读取用户提交历史 | **needs-more-evidence** | 站点公开页面只确认“登录后可见”，本次没有可用账号，无法验证登录后的 HTML、XHR、分页或字段。 |
| QOJ 的公开 Hack 列表 | **experimental（仅限 Hack 记录）** | `/hacks?page=N` 返回表格，包含 Submission ID、题目、结果、提交时间；这不是某个用户的完整提交历史。 |
| 单条提交 URL `/submission/{id}` | **experimental** | 公开题解/题面链接使用该形式；本次匿名抓取单条页面被工具判为不可访问，未验证状态码和页面字段。 |
| 可注册给 Adapter 的“提交历史 API” | **unsupported** | 没有找到官方公开 API 文档或可复现的登录态 Network 请求；不猜测 UOJ 内部接口。 |

MVP 不应把 QOJ 注册为 `stable` 或默认同步源。若以后取得测试账号，应在真实浏览器 Network 中确认请求 URL、方法、响应类型、分页和 `credentials` 行为后，最多先标记为 `experimental`。

## 验证环境与范围

- 验证日期：2026-09-28（UTC+8）。
- 公开页面证据：通过当前网页抓取读取；抓取结果显示服务器时间为 UTC+8。
- 本地探针：Windows PowerShell `Invoke-WebRequest`，对 `https://qoj.ac/`、`/submissions`、`/user/profile/yzj123`、`/hacks?page=1` 均收到 HTTP 403；没有重试、代理或反爬绕过。
- 账号状态：匿名；没有输入或保存 QOJ 账号、密码、Cookie、token。
- 因此“登录后是否能由扩展 service worker 读取”不能从本次结果推断。

## 真实页面证据

### `/submissions`

当前公开抓取结果为 `https://qoj.ac/submissions` → `https://qoj.ac/login`，登录页显示 Username、Password 和 Submit。没有返回空列表，也没有可解析的提交记录。证据：

- <https://qoj.ac/submissions>
- <https://qoj.ac/login>

这证明匿名请求不能作为“空提交列表”处理；Adapter 必须识别登录 HTML/重定向并返回 `auth_required`。

### 用户页的关闭提示

抓取 <https://qoj.ac/user/profile/yzj123>（页面随后重定向登录）时，页面正文曾显示：由于获取用户提交的请求量过大，完整提交列表暂时关闭，必须登录后查看。该提示仍是站点公开索引中的当前行为证据，但该索引页面本身抓取时间较早，因此登录后页面形态需要重新实测。

### `/hacks?page=N`（非用户历史）

公开页面 <https://qoj.ac/hacks?page=3> 和 <https://qoj.ac/hacks?page=11> 能看到表格列：`ID`、`Submission ID`、`Problem`、`Hacker`、`Owner`、`Result`、`Submit time`。示例结果文本为 `Success!`、`Failed.`，提交时间显示为 `YYYY-MM-DD HH:mm:ss`（站点页脚标注 UTC+8）。该表是 Hack 记录，不能用于按用户同步全部提交。

`page` 查询参数确实可翻页 Hack 表；用户提交列表是否同样分页、每页大小和排序均未证实。

### 单条提交链接

公开 QOJ 题面和讨论中可见链接形如 <https://qoj.ac/submission/40652>、<https://qoj.ac/submission/2649369>。这只能证明 URL 形状被站点内容使用；本次抓取直接打开这些 URL 返回工具级不可访问，未能确认匿名/登录权限、响应类型或字段。因此 URL 形状标为 experimental，不能在 Adapter 中假定一定可打开。

## 请求、字段和登录态矩阵

| 项目 | 已观察 | 未确认/禁止猜测 |
|---|---|---|
| 历史入口 | `GET /submissions` | 不得改写成未观测的 `/api/...` 或 XHR URL |
| 匿名响应 | 重定向到 `/login` | 不能把登录 HTML 当成空列表 |
| 登录方式 | 表单有用户名和密码输入 | 表单 action、CSRF 字段、Cookie 名称未记录；不得在扩展中保存凭据 |
| 记录 ID | Hack 表和链接中为数字 Submission ID | 用户历史记录是否同样有稳定 ID、是否有复审后变化未确认 |
| 题目/结果/时间 | Hack 表展示题目、`Success!`/`Failed.`、UTC+8 秒级时间 | 用户历史 JSON/HTML 字段路径、语言、分数、时间单位未确认 |
| 分页 | Hack 表支持 `?page=N` | 用户历史分页参数、limit、最大页数未确认 |
| service worker | 未取得登录态 Network 结果 | `credentials: include`、跨域 CORS、host permission 是否足够均未确认 |
| 页面上下文 | 登录页可由普通页面访问 | 是否必须 content script、是否有页面内 fetch 未确认 |

## 可复现步骤（不绕过限制）

1. 在无登录态的普通浏览器标签页打开 `https://qoj.ac/submissions`；记录最终 URL 和页面是否为登录表单。
2. 打开 `https://qoj.ac/user/profile/yzj123`；记录是否出现“完整提交列表暂时关闭/必须登录”提示。
3. 打开 `https://qoj.ac/hacks?page=3`；确认表格列和 `page` 翻页。
4. 仅在用户自己提供并主动登录的测试账号下，使用浏览器 DevTools Network 记录 `/submissions` 加载期间的请求方法、URL、状态、响应类型和分页。不要导出 Cookie 或请求头，不要尝试绕过验证码、限流或关闭提示。

## Adapter 实施边界

- 目前只允许返回结构化 `auth_required`/`unsupported`，并保留旧缓存。
- 不实现抓取 Hack 列表来冒充用户提交历史。
- 不实现猜测的 API、反爬绕过、自动登录或 Cookie 复制。
- 只有补齐登录态 Network、正常多条记录、空列表、分页、时间/结果字段和单条链接证据后，才可重新评估为 `experimental`。

## 脱敏 fixture

- `docs/fixtures/qoj/login.html`：登录页最小脱敏片段。
- `docs/fixtures/qoj/submissions-redirect.txt`：匿名入口和最终登录 URL。
- `docs/fixtures/qoj/public-hack-list.json`：公开 Hack 表的字段形状，用户名/题名/ID 已替换为占位符。
- `docs/fixtures/qoj/submission-url.txt`：公开内容中出现的单条提交 URL 形状。

