# OJTrace（题迹）

OJTrace 是一个 local-first 的 Chromium Manifest V3 扩展，把多个 OJ 的最近提交记录合并成时间线。第一版只在浏览器本地保存账号配置和提交数据，不提供服务端，也不读取或保存完整 Cookie。

## 当前 MVP 范围

- Codeforces：稳定支持，使用官方 `user.status` API，按 handle 获取最近记录。
- Luogu：MVP 主线支持，用户授权洛谷站点后使用当前登录态扫描最近提交；真实 Chrome/Edge 登录态验收仍需在本机完成。
- QOJ：实验性支持，使用登录后的 UOJ 风格 HTML 提交列表（`/submissions?submitter=<用户名>&page=N`）；匿名访问会回到登录页。
- HydroOJ：实验性支持 HTML 提交列表，可配置官方或自部署实例地址；自部署实例按精确 origin 授权，尚需真实浏览器验收。
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

默认只声明 `storage`、`tabs`、`scripting`。固定 OJ 的 host permission 和 HydroOJ 自定义实例权限按需请求；HydroOJ 为兼容 Chrome 的动态权限规则声明可选的 HTTP/HTTPS host pattern，但运行时仍只访问用户输入并校验后的精确 origin，不会请求 `<all_urls>` 或 `webRequest`。浏览器 session 使用 `credentials: include`，手动 Cookie 仅保存在本地账号配置。

详细决策、数据源证据、风险和执行顺序见 [PLAN.md](./PLAN.md) 与 `docs/`。

## 已知限制

Codex 当前环境无法通过浏览器控制面加载本地 Chrome 扩展，因此 action、权限弹窗和真实登录态仍需在本机 Chrome/Edge 手工验收。接口变化时先更新 `docs/research/` 和脱敏 fixture，再修改对应 Adapter。
