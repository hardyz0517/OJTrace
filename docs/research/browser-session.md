# P0-E 浏览器权限和登录态探针记录

验证日期：2026-09-28
验证环境：Windows PowerShell；真实浏览器登录态尚未配置。

## 当前结论

本次已确认：

- 扩展 service worker/extension page 的跨域请求需要对应 host permission；
- host permission 不能绕过站点返回的 401、403、验证码、Cloudflare 或限流；
- 第一版不申请 `cookies`；
- 第一版不保存 Cookie、token、密码和代码；
- `credentials: include` 是否能在每个 OJ 复用现有登录态，必须在真实 Chrome/Edge 中逐站验证；
- 如果必须读取 OJ 页面上下文，才考虑可选 content script 和 `scripting` 权限；未验证前不申请。

## 站点直连结果

| 站点 | 请求 | 结果 | 说明 |
|---|---|---|---|
| Codeforces | `/api/user.status?handle=tourist&from=1&count=2` | HTTP 200 JSON | 匿名公开 API 可用 |
| Luogu | `/record/list?user=1&page=1&_contentOnly=1` | HTTP 401 | 当前环境未登录，不能证明所有公开记录都不可用 |
| QOJ | `/submissions` | HTTP 403 | 需要真实浏览器登录态进一步验证 |
| LOJ | `/` | TLS 连接失败 | 当前网络探针不能证明站点永久不可用 |
| api.loj.ac | `/` | TLS 连接失败 | API 当前状态需要其他网络/浏览器环境验证 |

## 真实浏览器待验证

- Chrome service worker `fetch(..., { credentials: "include" })`；
- Edge service worker 同样行为；
- 已登录 QOJ/LOJ 页面中的同源请求；
- permission request / deny / revoke；
- content script 是否必要；
- login HTML 是否会以 HTTP 200 返回。

## 权限最小集合候选

```text
permissions:
- storage
- tabs

optional_host_permissions:
- https://codeforces.com/*
- https://www.luogu.com.cn/*
- https://qoj.ac/*
- https://loj.ac/*
```

LOJ API host 只有在真实验证成功后才添加。
