# P0-G 工具链验证

验证日期：2026-09-28
验证环境：Windows PowerShell，E:\Dev\Projects\OJTrace

## 已验证版本

- Node.js：`v24.18.0`
- npm：`11.16.0`
- pnpm：`11.17.0`
- WXT registry 当前可解析版本：`0.21.4`

## 决策

- 使用 pnpm，必须提交 `pnpm-lock.yaml`；
- 使用 Node.js LTS/当前团队固定版本，写入 `package.json.engines` 和版本文件；
- 使用 WXT + TypeScript + React；
- 使用 Vitest 做纯函数、Adapter fixture 和 application 测试；
- live OJ 请求不进入默认 CI；
- 正式初始化在 Gate 0 结论后进行；
- 统一使用 WXT 的 WebExtension API 适配层，业务代码不直接混用全局 `chrome` 和 `browser`。

## 已完成验证

- WXT 项目已初始化并锁定依赖；
- `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build` 已通过；
- 生产构建已生成 Chrome MV3 产物，manifest 只包含 `storage`、`tabs` 和四个精确可选 host permission；
- live OJ 请求不进入默认 CI，Codeforces 的同机 HTTP 200 探针已记录在研究文档中。

## 尚未完成验证

- 当前环境未能通过 Codex 浏览器控制面加载本地 Chrome 扩展，因此 Chrome/Edge 的 action、权限弹窗和页面生命周期仍需人工或可用浏览器环境验收；
- Luogu 的真实登录态字段、CSRF 和单条 submission URL 仍需测试账号脱敏 Network 证据；
- Playwright 不加入正式依赖，除非后续 E2E 验收证明浏览器自动化确有必要。

## 验收条件

正式项目初始化后必须通过：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

并在 Chrome、Edge 中加载构建产物。
