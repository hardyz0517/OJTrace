# MVP 发布检查清单

## 自动门禁

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm format:check`
- [x] `pnpm build`
- [x] 生产 manifest 不包含 `cookies`、`webRequest`、`scripting` 或 `<all_urls>`
- [x] 生产代码不保存 Cookie、密码或 token
- [x] 设置页支持清除全部本地数据

## 人工门禁

- [ ] Chrome 加载 `.output/chrome-mv3` 并完成 [浏览器矩阵](./browser-matrix.md)
- [ ] Edge 加载同一构建产物并完成 action/Timeline/Settings 验收
- [ ] Codeforces 真实账号同步、刷新、限流降级和重启持久化
- [ ] Luogu 授权、登录态识别、提交同步、失效处理和缓存保留
- [ ] 检查扩展详情页权限和数据删除行为

## 发布边界

只有自动门禁和 Chrome/Edge 人工门禁都完成，才可以把版本标记为可发布 MVP。Luogu、QOJ 的支持等级不能因 UI 已存在而升级；必须先补充 `docs/research/` 中的可复现证据。
