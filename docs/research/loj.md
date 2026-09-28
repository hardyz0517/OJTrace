# LibreOJ 提交历史研究（P0-D）

## 结论摘要

| 能力 | 结论 | 依据 |
|---|---|---|
| 当前 `loj.ac` 用户提交历史 | **unsupported** | 当前抓取的 `https://loj.ac/submissions` 和 `/problem/1` 返回 LibreOJ Error 页面（版本 `05df9a8705`），没有提交列表。 |
| `api.loj.ac` 官方提交历史接口 | **needs-more-evidence** | API 主机和端点在本地/网页抓取环境不可访问；没有官方当前 API 文档或可验证响应。 |
| 归档比赛提交页 | **experimental（只读归档）** | `contest-archive.loj.ac/contest/12/` 有“提交记录”链接到 `/submissions?contest=12`，但直接抓取该列表无正文，不能当作当前用户历史。 |
| `POST /api/submission/querySubmission` | **experimental/needs-more-evidence** | 2026 年仍可访问的第三方用户脚本展示了该 URL、JSON 请求和 `submissions[0].id` 读取；来源不是 LibreOJ 官方文档，且只查询题目+状态，未证明支持按用户分页历史。 |
| 单条提交 URL `/s/{id}` | **experimental** | 第三方脚本在获得 ID 后跳转 `https://loj.ac/s/{id}`；主站当前不可验证状态码和权限。 |

MVP 不应把 LibreOJ 注册为 `stable`。在当前网络条件下应标记为 `unsupported`；若恢复服务并取得官方 API/登录态证据，可重新评估为 `experimental`。

## 验证环境与范围

- 验证日期：2026-09-28（UTC+8）。
- 当前站点抓取：<https://loj.ac/>、<https://loj.ac/submissions>、<https://loj.ac/problem/1> 返回正文 `Error` 与 `LibreOJ Open Source Project (version 05df9a8705)`。
- API 抓取：<https://api.loj.ac/> 及 `/api/submission/querySubmission` 在网页工具中不可访问；本地 PowerShell 对 `loj.ac`、`api.loj.ac` 报 TLS 连接失败。没有重试、代理或证书绕过。
- 账号状态：匿名；没有输入或保存 LibreOJ 账号、密码、Cookie、token。

## 真实页面与当前迁移信号

### 当前主站

当前 <https://loj.ac/submissions> 不是可解析的空列表，而是错误页；因此 Adapter 必须把它判定为 `invalid_response`/`unsupported`，不得写入零条记录。主站错误页版本号是可用于后续复测的诊断信号，但不等于 API 版本。

### 归档站

<https://contest-archive.loj.ac/contest/12/> 是可读的历史比赛页，页面导航包含登录/注册，且“提交记录”链接为 <https://contest-archive.loj.ac/submissions?contest=12>。后者当前抓取状态为 200 但正文为空，可能依赖客户端脚本或归档数据未开放；没有足够证据解析字段、分页和登录态。它只覆盖某场归档比赛，不是按用户的全站历史。

## API 线索（非官方，必须复核）

JSR 的 `@un-oj/core` 文档将 Lyrio 描述为“LibreOJ 在底层使用的平台”，并把默认 API 基址列为 `https://api.loj.ac`，但该包只公开 `getProblem` 等问题接口，没有提交历史方法：<https://jsr.io/@un-oj/core/doc/all_symbols>。

一个公开的第三方用户脚本（抓取时间为上月）展示了如下请求：

```http
POST https://api.loj.ac/api/submission/querySubmission
Content-Type: application/json
```

示例 JSON（脚本原样字段，值已在 fixture 中脱敏）：

```json
{"problemDisplayId":"<problem>","locale":"zh_CN","takeCount":1,"status":"Accepted"}
```

脚本随后读取 `response.submissions[0].id`，并跳转到 `https://loj.ac/s/<id>`。证据：<https://greasyfork.org/en/scripts/500805-luogu-%E6%8F%92%E4%BB%B6%E9%9B%86%E5%90%88/code>（约第 720 行）。

这条线索只能证明“某个客户端曾按题目和状态查询一条提交”，不能证明：

- 接口现在仍在线或返回相同 schema；
- `problemDisplayId` 是否必须、是否接受用户名/UID过滤；
- `takeCount`/`skipCount` 的分页语义和最大值；
- 是否需要登录 Cookie、CSRF 或特定 Origin；
- `submittedAt`、题目标题、语言、分数和 verdict 字段路径。

脚本中该 `querySubmission` 请求没有显式 `credentials: include`，但这不是匿名可用性的证明；浏览器默认凭据策略、跨源请求和 API 服务端策略仍需真实 Network/响应验证。

## 请求、字段和登录态矩阵

| 项目 | 已观察 | 未确认/禁止猜测 |
|---|---|---|
| 主站历史入口 | `/submissions`（当前错误页） | 不得把错误页当成空列表 |
| API 基址 | `https://api.loj.ac`（JSR 与第三方脚本线索） | 当前可达性、版本、官方维护状态 |
| API 方法 | `POST /api/submission/querySubmission`（第三方脚本） | 不能据此假定可按用户拉全量历史 |
| 请求字段 | `problemDisplayId`、`locale`、`takeCount`、`status` | `skipCount`、用户字段、时间范围、排序未证实 |
| 响应字段 | `submissions[0].id` 被脚本读取 | 其他字段、时间单位、verdict 枚举未证实 |
| 单条 URL | `/s/{id}` | 当前站点状态、匿名/登录权限未证实 |
| 登录态 | 归档页面显示登录/注册；主站/API 当前不可用 | Cookie 名称、CSRF、service worker `credentials` 和 CORS 均未知 |
| 分页/限流 | 无当前响应证据 | 不得猜测 limit、速率、Retry-After |

## 可复现步骤（不绕过限制）

1. 匿名打开 `https://loj.ac/submissions` 和 `https://api.loj.ac/`，记录 HTTP 状态、错误页/响应类型。
2. 打开 `https://contest-archive.loj.ac/contest/12/`，点击“提交记录”，记录最终 URL 和正文是否为空。
3. 仅在服务恢复后，使用 DevTools Network 观察官方页面发出的请求；保存脱敏的请求 JSON 与响应字段，不保存 Cookie、token 或源代码。
4. 只有在能复现分页、按账号过滤、时间/verdict 字段和单条 URL 后，才实现 Adapter。

## Adapter 实施边界

- 当前返回 `unsupported`/`invalid_response` 并保留缓存。
- 不直接依赖第三方脚本，不复制其 Cookie，也不通过 Luogu 页面代理请求。
- 不实现猜测的用户历史参数、分页、登录或反爬绕过。
- 恢复服务后，先用官方文档或站点自身 Network 重新取样，再决定 `experimental`/`stable`。

## 脱敏 fixture

- `docs/fixtures/loj/current-error.html`：主站当前错误页最小正文。
- `docs/fixtures/loj/archive-submissions-route.txt`：归档比赛“提交记录”链接。
- `docs/fixtures/loj/query-submission-request.json`：第三方脚本观察到的请求字段，值已脱敏。
- `docs/fixtures/loj/query-submission-response-shape.json`：仅记录脚本读取到的响应形状，不声称为当前 live 响应。
- `docs/fixtures/loj/submission-url.txt`：`/s/{id}` URL 形状。

