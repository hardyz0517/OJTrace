# AtCoder 认证与提交接口证据

调研日期：2026-09-29。请求使用 PowerShell `Invoke-WebRequest`，无登录 Cookie。

## 观测结果

- `GET https://atcoder.jp/users/tourist/history/json` 返回 `200 application/json`，响应为评级历史数组；这不是提交记录接口。
- `GET https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=Hardy_Zheng&from_second=0` 返回 `200 application/json`，字段包含提交 ID、时间、题目、语言、分数和结果，可用于最近提交记录。
- `GET https://atcoder.jp/contests/abc001/submissions?f.User=tourist` 在未登录状态返回 `200 text/html`，页面标题为 `Sign In - AtCoder`，并通过 `login?continue=...` 引导登录。
- `GET https://atcoder.jp/contests/abc001/submissions/me` 同样重定向到登录页。
- 因此本项目不把 AtCoder 声明为 `public-handle`：账号识别需要当前浏览器登录态；提交列表通过只读的 AtCoder Problems 公共 API 获取。Adapter 不复制 AtCoder Cookie 到第三方服务。

## 待验证请求候选（不可视为已验证合同）

AtCoder 官方没有可直接按用户返回提交列表的公开 JSON 接口；用户提交列表采用只读的 AtCoder Problems API：`GET https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user={handle}&from_second=0`。它不接收 AtCoder Cookie，也不上传 OJTrace 的账号凭证。该 API 是第三方公共服务，若服务不可用，Adapter 应报告网络/站点错误而不是伪造空列表。

若后续证实未登录页面由 `Sign In`、`ログイン` 或 `login?continue` 标识，可映射为 `auth_required`。未知 JSON、字段缺失和 HTML 误响应应映射为 `parse_failed`，不当作空列表。

## 隐私

调研未保存 Cookie、Authorization、CSRF token 或提交代码。AtCoder Adapter 仅向 `https://atcoder.jp/` 读取登录身份，并向 `https://kenkoooo.com/` 请求公开提交数据。
