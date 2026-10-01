# OJTrace 隐私说明（MVP）

- OJTrace 没有服务端，不上传账号标识、提交记录、Cookie、密码或 token。
- 提交记录、账号配置、同步状态和筛选偏好只写入浏览器 `chrome.storage.local`。
- Codeforces 使用公开 API，不需要登录态。
- AtCoder 浏览器登录态只从当前 AtCoder 页面读取账号标识；提交记录通过只读的 AtCoder Problems 公共 API 获取，不会向该服务发送 AtCoder Cookie。手动模式只在用户主动提供 `REVEL_SESSION` 时，临时写入 AtCoder 官方域名的同名 Cookie 以识别账号，请求完成后立即恢复原值或删除，不发送到第三方服务。
- Luogu 仅在用户明确点击授权后使用当前浏览器登录态；如真实浏览器验证证明必须读取登录状态，扩展只申请洛谷域名范围的可选 `cookies` 权限，不复制、不持久化、不上传完整 Cookie。
- QOJ 仅在用户明确授权后读取 qoj.ac 的 `UOJSESSIONID` 会话 Cookie，并用它请求同源 HTML 提交列表；不读取其他 Cookie，不上传 Cookie，也不执行自动登录。匿名登录页会被识别为授权失效，不会当作空记录。手动 Cookie 模式会把用户主动输入的配置保存在本地 `chrome.storage.local`。
- 网络请求只能由已注册 Adapter 发起，并经过 HTTPS source allowlist、超时和响应大小限制。
- 用户可以在设置中分别清除账号配置或提交记录。删除账号时会同时删除该账号的本地提交和同步状态；清除提交记录会保留账号配置。

这份说明描述当前 MVP 实现。后续增加站点、权限或远程服务时，必须更新说明和隐私审计。
