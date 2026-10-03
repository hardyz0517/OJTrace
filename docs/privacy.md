# OJTrace 隐私说明（MVP）

- OJTrace 没有服务端，不上传账号标识、提交记录、Cookie、密码或 token。
- 提交记录、账号配置、同步状态、站点品牌和筛选偏好只写入浏览器 `chrome.storage.local`。用户明确填写的手动 Cookie 和 HydroOJ 密码会作为本地凭证保存；`GET_STATE` 等公开查询不会返回凭证。
- Codeforces 使用公开 API，不需要登录态。
- AtCoder 浏览器登录态只从当前 AtCoder 页面读取账号标识；提交记录通过只读的 AtCoder Problems 公共 API 获取，不会向该服务发送 AtCoder Cookie。手动模式只在用户主动提供 `REVEL_SESSION` 时，临时写入 AtCoder 官方域名的同名 Cookie 以识别账号，请求完成后立即恢复原值或删除，不发送到第三方服务。
- Luogu 浏览器会话模式使用已有登录态，不持久化浏览器 Cookie；手动模式仅保存用户主动输入的 `__client_id`/`_uid`，请求期间临时注入并恢复。扩展不向第三方发送这些凭证。
- QOJ 仅在用户明确授权后读取 qoj.ac 的认证 Cookie（兼容旧版 `UOJSESSIONID`/`UOJSESSID`、记住登录 Cookie 和新版 `__Host-UOJSESSID`），并在首个后台请求前临时复用同域已有的 `cf_clearance`/`__cf_bm` Cookie；请求后恢复原 Cookie，值不会保存或上传。手动 Cookie 模式会把用户主动输入的配置保存在本地 `chrome.storage.local`，请求期间临时注入并在完成后恢复原 Cookie。匿名登录页会被识别为授权失效，不会当作空记录；检测诊断只显示 Cookie 名称和失败阶段。
- HydroOJ 支持当前实例精确 origin 的浏览器会话、`sid`/`sid.sig` 手动 Cookie 和账号密码模式。密码保存在本地凭证记录，会话失效时仅向该 HydroOJ 实例重新登录；不同实例不会共享凭证。
- 网络请求由已注册 Adapter 发起，经过固定 source/实例 origin 校验、超时、取消和响应流大小限制；Hydro 自部署实例也支持明确配置的 HTTP origin。
- 用户可以在设置中分别清除账号配置或提交记录。删除账号时会同时删除该账号的本地提交和同步状态；清除提交记录会保留账号配置。

这份说明描述当前 MVP 实现。后续增加站点、权限或远程服务时，必须更新说明和隐私审计。
