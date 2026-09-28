# OJTrace（题迹）

OJTrace 是一个 local-first 的 Chromium Manifest V3 扩展，把多个 OJ 的最近提交记录合并成时间线。第一版只在浏览器本地保存账号配置和提交数据，不提供服务端，也不读取或保存完整 Cookie。

## 当前 MVP 范围

- Codeforces：稳定支持，使用官方 `user.status` API，按 handle 获取最近记录。
- Luogu：实验性适配器，必须使用现有登录态；成功字段和单条提交链接仍待真实浏览器验证，账号默认停用。
- QOJ、LibreOJ：当前没有可复现的用户提交历史接口，显示为不可用占位，不申请站点权限。
- Timeline、OJ/时间筛选、手动同步、设置页、缓存优先展示、单来源失败降级和本地去重已经实现。

## 开发环境

- Node.js `24.18.0` 或兼容版本
- pnpm `11.x`

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

生产构建在 `.output/chrome-mv3`。在 Chrome 或 Edge 的扩展管理页打开开发者模式，选择“加载已解压的扩展程序”并选择该目录。

## 权限和隐私

默认只声明 `storage`、`tabs`。四个 OJ 的 host permission 都是可选且按来源逐项请求；当前不会申请 `cookies`、`webRequest`、`scripting` 或 `<all_urls>`。Codeforces 请求不需要登录态；Luogu 仅尝试通过 `fetch(..., { credentials: "include" })` 使用扩展自身已有的站点会话，不复制或持久化 Cookie。

详细决策、数据源证据、风险和执行顺序见 [PLAN.md](./PLAN.md) 与 `docs/`。

## 已知限制

Codex 当前环境无法通过浏览器控制面加载本地 Chrome 扩展，因此 action、权限弹窗和真实登录态仍需在本机 Chrome/Edge 手工验收。接口变化时先更新 `docs/research/` 和脱敏 fixture，再修改对应 Adapter。
