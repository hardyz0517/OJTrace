# OJ 数据源支持矩阵（Gate 0 初稿）

> 本表不是最终支持承诺。只有完成真实浏览器验证并有对应 fixture 后，才能将等级改为 `stable`。

| source | availability | authMode | 当前证据 | 下一步 |
|---|---|---|---|---|
| codeforces | stable | public | 官方 `user.status`，本地直连 HTTP 200 JSON，字段和 URL 已有 fixture | 发布前真实 Chrome/Edge 加载验证 |
| luogu | experimental | browser_session | 当前未登录直连 HTTP 401；成功字段、CSRF、单条 URL 尚未实测 | 使用测试账号做脱敏 Network 验证 |
| qoj | unsupported | browser_session | `/submissions` 当前重定向/阻断到登录；没有可复现用户历史接口 | 服务恢复后重新取样，不申请 Cookie |
| loj | unsupported | browser_session | 当前主站错误页，API 仅有第三方线索，无官方可复现响应 | 服务恢复后重新取样，不依赖第三方脚本 |

每次更新必须填写验证日期、浏览器版本、请求 URL、状态码、响应样本和结论。
