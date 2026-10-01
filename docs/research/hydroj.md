# HydroOJ 调研记录

状态：**已实现实验性 HTML Adapter；尚未完成 Chrome/Edge 扩展内登录态验收。** 本文区分官方项目源码证据与对线上部署的 HTTP 实测。

## 自部署实例实测（2026-09-29）

- 实例：`http://106.55.100.251`，页面资源显示 Hydro 4.58.5；仅使用专用测试账号做只读登录和记录列表读取。
- 登录：`POST /login`，字段为 `uname`、`password`、`rememberme`、`tfa`、`authnChallenge`；服务端会话 Cookie 为 `sid` 和 `sid.sig`。
- 提交列表：`GET /record?uidOrName=1100&page=1`，登录后返回 `text/html` 的 `record_main` 页面；第 1 页 100 条，分页链接为 `page=2`。
- 行字段：`tr[data-rid]`、`/record/{rid}`、`/p/{pid}`、`record-status--text`、`.col--time`、`.col--memory`、`.col--lang`、`data-timestamp`。
- 未登录同 URL 返回 HTTP 200 的 `user_login` HTML，不能只按状态码或空行判断成功。
- 页面 `window.UserContext` 提供当前用户 `_id` 和 `uname`，可用于浏览器 session 检测。
- 当前实例使用 HTTP，因此扩展只对用户明确输入的精确 HydroOJ origin 放行；不申请泛域名权限。生产部署仍建议 HTTPS。

## 官方站点

- 候选官方站点：`https://hydro.ac`。官方 Hydro 项目仓库为 [hydro-dev/Hydro](https://github.com/hydro-dev/Hydro)，其 README/项目资料链接该站点。通过仓库链接确认这是官方站点候选；本次没有获得线上部署对其 canonical hostname 的确认，因此代码只将其作为研究阶段默认候选，不把它视为已验证请求 origin，也不注册产品 Adapter。
- 调研日期：2026-09-29；请求环境：PowerShell 7.6.5，未携带任何用户凭证。
- 对 `https://hydro.ac/`、`/api`、`/p/` 发起匿名 GET 均得到 HTTP 200，但响应是 Cerberus anti-bot challenge HTML，包含 `X-Cerberus-Status: CHALLENGE`，不是 Hydro 页面/API。响应设置清除 challenge cookie，不代表 Hydro 用户登录状态。
- 没有尝试绕过 challenge，也没有可用的 Hydro 登录账号；因此不能证明 service worker `credentials: include` 可检测登录态、请求是否受 CORS/CSP 限制、匿名记录可读性、具体线上接口响应或分页字段。

## Hydro 项目源码证据

参考 [Hydro `record.ts`](https://github.com/hydro-dev/Hydro/blob/master/packages/hydrooj/src/handler/record.ts) 与 [Hydro `user.ts`](https://github.com/hydro-dev/Hydro/blob/master/packages/hydrooj/src/handler/user.ts)，访问日期 2026-09-29。检查时仓库 HEAD 为 `7c960fad63a6d19169a9cc8a525732b2b9bf9464`。

- Hydro 的提交列表路由是 `GET /record`，参数包括 `page` 和 `uidOrName`。`uidOrName` 同时按数值 UID、用户名、邮箱查找；无法找到用户时列表为空。
- handler 把结果放到 `response.body` 的 `page`、`rdocs`、`pdict`、`udict` 等字段。实际浏览器可能收到模板 HTML，而非 JSON；仅凭源码不能确定所有实例都提供 JSON endpoint。
- 记录模型字段包含 `_id`、`uid`、`pid`、`lang`、`status`、`score`、`time`、`memory`、`judgeAt` 等。`_id` 是 Mongo ObjectId，线上公开表示、时间字段序列化格式、status 枚举语义及是否总被投影返回仍未由部署响应确认。
- 登录页是 `GET /login`；成功认证将当前用户 UID 放入服务端 session。该源码证据表明浏览器 session 是 Hydro 的常规登录基础，但没有证明扩展后台请求可读取它。
- `/user/:uid` 页面源码不是认证探针，且 UI 模板可能没有稳定结构化返回。不要将其用作会话识别接口。

## Auth Mode 决策

| 模式 | 当前决定 | 原因 |
| --- | --- | --- |
| `browser-session` | 实验性支持 | 已确认 `sid` session、登录页标记和 `UserContext`；扩展内复用浏览器 session 仍需人工验收。 |
| `manual-cookie` | 实验性支持 | 已确认 `sid`/`sid.sig` Cookie 可用于测试实例请求；Cookie 只存本地账号凭证。 |
| `public-handle` | 暂不声明 | 没有匿名 JSON API 实测；`/record` 默认页面结果和跨用户权限取决于权限设置。 |

HydroOJ 部署差异较大；每个实例需要单独能力探测。项目版本源码只能用来形成候选请求合同，不可直接把自定义实例标为兼容。

## 最小复现和升级门槛

1. 对官方默认站点和至少一个管理员确认的自定义 Hydro 实例记录重定向链、最终 origin、Hydro 版本及匿名首页响应类型。
2. 使用专用测试账号，在开发者工具 Network 记录登录后 `/record?uidOrName=<脱敏账号>&page=1` 的真实请求/响应类型。脱敏 `Cookie`、Authorization、CSRF、邮箱、用户名、题目/提交 ID 和代码。
3. 对同一站点比较匿名与登录态、空列表、多页结果、无效 UID、权限不足、限流、challenge 页与网络失败。
4. 确认浏览器扩展 service worker 从精确 origin 发起请求时是否带目标站点会话，检测响应是否含稳定 UID/用户名。探测请求必须最小化且不得带凭证。
5. 确认公开列表 JSON 的 ID、字段投影、时间单位、status 映射、题目域/contest URL 和分页上限，再添加脱敏 fixtures 和 Adapter 支持模式。

## 当前实现边界

- `src/adapters/hydroj/instance.ts` 提供精确 HTTPS origin 规范化调用、官方候选 origin、URL 生成；URL 生成不是已验证 API 承诺，也不会独立启用产品能力。
- parser 现在支持 Hydro `record_main` HTML，并保留 JSON 兼容解析；登录页会被识别为 `auth_required`，不会当作空列表。
- 已注册实验性 HydroOJ Adapter，支持精确实例 origin、HTML 记录解析、分页提示、状态/时间/题目/提交链接映射。
- 仍未宣称稳定支持：官方站点 challenge、自定义实例版本差异、Chrome/Edge service worker session 和 HTTP 实例安全边界仍需人工验收。

## 风险

- Hydro handler 的 HTML/template 请求不保证会返回 JSON；扩展后台可能无法直接解析页面模板。
- 匿名查询别人的提交可能受实例权限控制，列表空不等于没有提交。
- challenge / WAF 会让 HTTP 200 看起来成功，但 body 并非业务数据；必须按 content type 和结构检测，不能归为空列表。
- Mongo ObjectId 是实例内记录 ID；不同 origin 的提交身份必须包含规范化 origin，避免冲突。
- 浏览器不能在普通 HTTP 请求层保证 DNS 解析地址安全；精确 HTTPS origin 及重定向检查不能宣称彻底阻止 DNS rebinding/SSRF。
