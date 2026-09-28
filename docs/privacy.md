# OJTrace 隐私说明（MVP）

- OJTrace 没有服务端，不上传账号标识、提交记录、Cookie、密码或 token。
- 提交记录、账号配置、同步状态和筛选偏好只写入浏览器 `chrome.storage.local`。
- Codeforces 使用公开 API，不需要登录态。
- Luogu 仅在用户明确添加来源并授权后，尝试使用扩展请求上下文已有的浏览器会话；扩展不调用 `chrome.cookies`，不复制、不读取、不持久化完整 Cookie。
- QOJ 和 LibreOJ 当前不申请 host permission，也不执行猜测接口或页面抓取。
- 网络请求只能由已注册 Adapter 发起，并经过 HTTPS source allowlist、超时和响应大小限制。
- 用户可以在设置中删除账号；删除操作同时删除该账号的本地提交和同步状态。

这份说明描述当前 MVP 实现。后续增加站点、权限或远程服务时，必须更新说明和隐私审计。
