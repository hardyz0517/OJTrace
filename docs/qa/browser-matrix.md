# 浏览器验收矩阵

本文件记录发布前必须完成的真实浏览器操作。命令行构建和单元测试不能替代这些验收。

| 浏览器 | 版本 | OS | 构建 | 权限 | OJ 登录态 | 结果 | 证据 |
|---|---|---|---|---|---|---|---|
| Chrome | 待本机填写 | Windows | `.output/chrome-mv3` | 待验证 | Codeforces 匿名 | 待验证 | 待补截图/日志 |
| Chrome | 待本机填写 | Windows | `.output/chrome-mv3` | 待验证 | Luogu 登录 | 待验证 | 待补脱敏 Network |
| Edge | 待本机填写 | Windows | `.output/chrome-mv3` | 待验证 | Codeforces 匿名 | 待验证 | 待补截图/日志 |
| Edge | 待本机填写 | Windows | `.output/chrome-mv3` | 待验证 | Luogu 登录 | 待验证 | 待补脱敏 Network |

## 手测步骤

1. 运行 `pnpm build`，在浏览器加载 `.output/chrome-mv3`。
2. 点击扩展图标两次，确认只存在一个 `timeline.html` 标签页，第二次点击会激活已有标签页。
3. 打开设置，添加 Codeforces handle，确认只弹出 Codeforces 的可选站点权限。
4. 返回 Timeline，确认先显示缓存，再执行同步；重复点击手动同步不会并发产生多次请求。
5. 断开或模拟单个来源失败，确认其他来源记录仍显示、旧缓存保留、页面出现可理解的失败提示。
6. 关闭并重启浏览器，确认本地记录仍在；删除账号后确认该账号的提交和同步状态被删除。
7. 在设置中选择 Luogu，输入测试账号 UID/用户名或留空自动识别，点击“授权并添加”。
8. 确认授权后打开或复用洛谷标签页，能够读取最近提交并写入 Timeline。
9. 注销洛谷后再次同步，确认提示重新登录且旧缓存仍保留。
10. 检查扩展详情页权限，确认没有 `cookies`、`webRequest`、`scripting` 或全站访问权限。

## 当前阻塞

本轮命令行验证已通过 `pnpm test`、`pnpm typecheck`、`pnpm format:check` 和 `pnpm build`。当前 Codex 浏览器控制面只能使用隔离的 in-app browser，不能加载本地 Chrome 扩展；因此上表中的真实 Chrome/Edge 行仍需人工完成。
