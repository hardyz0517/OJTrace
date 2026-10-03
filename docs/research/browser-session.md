# P0-E 浏览器权限和登录态探针记录

验证日期：2026-10-01
验证环境：Windows PowerShell + Codex 内置浏览器；QOJ 使用用户主动登录的真实浏览器会话。

## 当前结论

本次已确认：

- 扩展 service worker/extension page 的跨域请求需要对应 host permission；
- host permission 不能绕过站点返回的 401、403、验证码、Cloudflare 或限流；
- QOJ 使用 `cookies` 权限在后台请求前读取 UOJ 会话 Cookie 和浏览器已有的 `cf_clearance`/`__cf_bm` 通行 Cookie，不依赖已打开的标签页，不保存也不上传这些值。
- 第一版不保存 Cookie、token、密码和代码；
- `credentials: include` 是否能在每个 OJ 复用现有登录态，必须在真实 Chrome/Edge 中逐站验证；
- 如果必须读取 OJ 页面上下文，才考虑可选 content script 和 `scripting` 权限；未验证前不申请。

## 站点直连结果

| 站点 | 请求 | 结果 | 说明 |
|---|---|---|---|
| Codeforces | `/api/user.status?handle=tourist&from=1&count=2` | HTTP 200 JSON | 匿名公开 API 可用 |
| Luogu | `/record/list?user=1&page=1&_contentOnly=1` | HTTP 401 | 当前环境未登录，不能证明所有公开记录都不可用 |
| QOJ | `/submissions?submitter=Hardy&page=1` | 已登录浏览器页面成功返回 HTML 表格（5 条记录） | 直连 PowerShell 仍为 403；service worker 复用浏览器会话尚未在 Chrome/Edge 最小扩展中验证 |

## 仍待验证

- Chrome service worker `fetch(..., { credentials: "include" })`；
- Edge service worker 同样行为；
- Chrome/Edge service worker 在已登录 QOJ 页面中的同源请求；
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
```

