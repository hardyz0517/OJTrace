# MVP 发布检查清单

## 自动门禁

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm format:check`
- [x] `pnpm build`
- [x] `pnpm audit:architecture`：纯模块/UI 运行时依赖及正反 fixture
- [x] 生产 manifest 与权限审计一致：允许 `storage/tabs/cookies`，不含 `webRequest`、`scripting` 或 `<all_urls>`；Hydro 可选模式仅用于精确实例授权
- [x] 生产代码不上传 Cookie、密码或 token；用户明确输入的凭证仅保存在本地 `chrome.storage.local`
- [x] 设置页支持清除全部本地数据
- [x] Hydro HTTP 集成：普通、比赛、作业、密码重新登录和站点品牌

## 人工门禁

- [ ] Chrome 加载 `.output/chrome-mv3` 并完成 [浏览器矩阵](./browser-matrix.md)
- [ ] Edge 加载同一构建产物并完成 action/Timeline/Settings 验收
- [ ] Codeforces 真实账号同步、刷新、限流降级和重启持久化
- [ ] Luogu 授权、登录态识别、提交同步、失效处理和缓存保留
- [ ] HydroOJ 测试实例：普通/比赛/作业提交、密码重登录、活动诊断和站点品牌
- [ ] 检查扩展详情页权限和数据删除行为

## 发布边界

只有自动门禁和 Chrome/Edge 人工门禁都完成，才可以把版本标记为可发布 MVP。Luogu、QOJ 的支持等级不能因 UI 已存在而升级；必须先补充 `docs/research/` 中的可复现证据。

2026-10-09 复用升级：核心代码与自动门禁完成，598 个用例通过，1 个可选 live 用例跳过；contract 276 个用例通过。应用内浏览器通过共享下拉、日期/同步弹层、窄屏与页面切换验收。Chrome/Edge 真实扩展验收仍未完成，发布边界不变；详情见[执行记录](./code-reuse-audit.md#升级执行记录2026-10-09)。
