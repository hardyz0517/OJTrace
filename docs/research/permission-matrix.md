# OJ 数据源支持矩阵（Gate 0 初稿）

> 本表不是最终支持承诺。只有完成真实浏览器验证并有对应 fixture 后，才能将等级改为 `stable`。

| source | availability | authMode | 当前证据 | 下一步 |
|---|---|---|---|---|
| codeforces | stable | public | 官方 `user.status`，本地直连 HTTP 200 JSON，字段和 URL 已有 fixture | 发布前真实 Chrome/Edge 加载验证 |
| luogu | stable 目标（已实现授权链路） | browser_session | 当前未登录直连 HTTP 401；Adapter 只使用 Service Worker 直连并保留旧缓存，仍需真实账号验收 | 使用测试账号完成 Chrome/Edge 脱敏 Network 验证 |
| qoj | experimental | browser-session | QOJ 4.5.46 页面标注基于 UOJ；上游 UOJ 的 `/submissions?submitter=&page=` 服务端 HTML 表格、10 条/页和 `/submission/{id}` 详情路由已由源码确认，并在 2026-10-01 的已登录 QOJ 浏览器会话（Hardy）中实测字段、分页和链接；匿名入口重定向到 `/login` | 在 Chrome/Edge 最小扩展中验证 service worker 是否能复用登录会话；页面改版时更新 fixture |

每次更新必须填写验证日期、浏览器版本、请求 URL、状态码、响应样本和结论。
