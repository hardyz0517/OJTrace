# OJTrace 隐私说明（MVP）

- OJTrace 没有服务端，不向开发者服务器上传账号标识、提交记录、Cookie、密码或 token。获取记录时会向对应 OJ 或 AtCoder Problems 公共 API 发送账号查询；登录凭证仅用于对应 OJ 的认证。
- 提交记录、账号配置、同步状态、站点品牌和筛选偏好只写入浏览器 `chrome.storage.local`。用户明确填写的手动 Cookie 和 HydroOJ 密码会作为本地凭证保存；`GET_STATE` 等公开查询不会返回凭证。
- 跨 OJ 提交代码只在 `chrome.storage.session` 短暂暂存。用户在洛谷点击“提交到 Codeforces”或“提交到 AtCoder”后，扩展会在目标 OJ 当前登录态的原生表单中写入代码并由站点表单发起一次提交；代码按该提交发送给目标 OJ，不会上传到 OJTrace 服务器、永久写入 `storage.local` 或放入 URL。AtCoder 提交前，扩展会在当前 AtCoder 登录会话中向 AtCoder 本站只读请求提交 ID 基线，用于区分本次提交与旧记录。遇到 Cloudflare/Turnstile 时，扩展等待并使用站点页面自己的验证流程，不生成或伪造验证令牌。提交记录列表中的详情链接直接打开对应 OJ 官方页面。扩展升级后会删除旧版详情快照缓存。跨 OJ 提交历史最多保留 50 条本地元数据（站点、题号、Submission ID、官方详情链接和已识别的评测状态），不包含源码或测试数据。
- Codeforces 的公开用户名模式使用公开 API，不需要登录态；浏览器会话或手动 Cookie 模式通过站点首页识别账号。浏览器登录检测会只读检查相关 Cookie 的作用域、SameSite 和分区元数据，失败诊断显示 Cookie 数量、作用域及通行 Cookie 是否存在，不包含 Cookie 值。手动配置的 Cookie 保存在本地，请求期间临时注入对应站点，完成后恢复或删除。
- 打开洛谷中可映射到 Codeforces 的题目时，扩展会用本地已启用的 Codeforces 用户名请求 Codeforces 官方 `contest.status` API，显示该账号是否有通过或未通过的提交；每次打开题目都会重新查询，不保存查询结果，也不发送 Cookie 或其他凭证。没有记录时显示“暂无”，查询不可用时会单独显示并附上原因。
- AtCoder 浏览器登录态只从当前 AtCoder 页面读取账号标识；提交记录通过只读的 AtCoder Problems 公共 API 获取，不会向该服务发送 AtCoder Cookie。手动模式只在用户主动提供 `REVEL_SESSION` 时，临时写入 AtCoder 官方域名的同名 Cookie 以识别账号，请求完成后立即恢复原值或删除，不发送到第三方服务。
- Luogu 浏览器会话模式使用已有登录态，不持久化浏览器 Cookie；手动模式仅保存用户主动输入的 `__client_id`/`_uid`，请求期间临时注入并恢复。扩展不向第三方发送这些凭证。
- QOJ 仅在用户明确授权后读取 qoj.ac 的认证 Cookie（兼容旧版 `UOJSESSIONID`/`UOJSESSID`、记住登录 Cookie 和新版 `__Host-UOJSESSID`），并在首个后台请求前临时复用同域已有的 `cf_clearance`/`__cf_bm` Cookie；请求后恢复原 Cookie，值不会保存或上传。手动 Cookie 模式会把用户主动输入的配置保存在本地 `chrome.storage.local`，请求期间临时注入并在完成后恢复原 Cookie。匿名登录页会被识别为授权失效，不会当作空记录；检测诊断只显示 Cookie 名称和失败阶段。
- HydroOJ 支持当前实例精确 origin 的浏览器会话、`sid`/`sid.sig` 手动 Cookie 和账号密码模式。密码保存在本地凭证记录，会话失效时仅向该 HydroOJ 实例重新登录；不同实例不会共享凭证。
- 网络请求由已注册 Adapter 发起，经过固定 source/实例 origin 校验、超时、取消和响应流大小限制；Hydro 自部署实例也支持明确配置的 HTTP origin。
- 用户可以在设置中分别清除账号配置或提交记录。删除账号时会同时删除该账号的本地提交和同步状态；清除提交记录会保留账号配置。

## 权限与站点访问

- `storage`：使用 `chrome.storage.local` 保存账号、凭证、提交和偏好，不使用浏览器同步存储。
- `tabs`：打开或聚焦 OJTrace 的 Timeline 页面。
- `activeTab` / `scripting`：用户主动点击题面工具后，在当前题目页按需采集题面和图片；采集时校验原标签页 URL，不长期注入题面脚本。
- `clipboardWrite`：用户点击复制时，将题目 Markdown 写入剪贴板。
- `offscreen`：直接导出时创建不可见的本地执行环境，在独立 Worker 中使用扩展自带的字体、WASM 和模板生成 PDF，结束或失败后关闭。
- `downloads`：下载本地生成的题面 PDF，并确认下载完成后释放临时文件；不上传题面内容。
- `cookies`：读取 QOJ 来源限定的认证与通行 Cookie、Codeforces 登录检测所需的 Cookie 元数据，并在手动配置或会话兼容路径中临时注入对应站点的 Cookie。请求完成后恢复原值或删除临时值；同一 origin 的请求串行处理，避免临时 Cookie 相互干扰。
- host permissions：QOJ 的 `https://qoj.ac/*` 是固定权限；Codeforces、洛谷、AtCoder、AtCoder Problems（`https://kenkoooo.com/*`）和 Cloudflare 验证页（`https://challenges.cloudflare.com/*`）通过可选权限按需申请。Cloudflare 权限可在“设置 → 跨 OJ 提交”中启用或撤销，仅用于验证页的请求等待优化。

HydroOJ 按用户填写并通过校验的精确 origin 授权和访问，不同实例不共享凭证。为允许 Chrome 运行时申请自部署实例权限，manifest 声明了可选的 `https://*/*` 和 `http://*/*`；运行时请求具体实例的权限，不请求整个通配模式。

当前不声明 `<all_urls>` 或 `webRequest`。题面与 PDF 只在本地内存中处理，不持久化题面或 PDF；编辑页交付使用的短期 token 和原标签页元信息会在交付、失败或过期后清理。相关声明见 [wxt.config.ts](../wxt.config.ts)。

这份说明描述当前实现。后续增加站点、权限或远程服务时，必须更新说明和隐私审计。
