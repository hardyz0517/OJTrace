# AGENTS.md

给编码代理的仓库工作手册。产品说明、安装和用户流程见 [README.md](README.md)。历史阶段任务见 [PLAN.md](PLAN.md)；其中早期 schema 示例和部分 MVP 边界已被后续 Spec 取代，实现以当前代码和 `docs/plan/`、`docs/development/` 为准。

## 项目是什么

OJTrace（题迹）是 Chrome / Edge 的 Manifest V3 扩展：本地优先汇总多个 OJ 的提交时间线，并提供题面 Markdown/PDF、CNOI 转换、跨 OJ 提交辅助和比赛日程。没有自家后端。账号、凭证、提交和偏好只写浏览器本地存储。

当前提交 Adapter：`codeforces`、`luogu`、`atcoder`、`hydroj`、`qoj`（experimental）。`src/adapters/loj/` 不是注册源，不要在未完成验证前接入。

## 开工前读什么

按任务选文档，不要整本扫历史计划。

| 任务 | 先读 |
| --- | --- |
| 账号、授权、存储、消息 | [docs/plan/account-system-refactor-spec.md](docs/plan/account-system-refactor-spec.md) |
| 同步窗口、分页、限流 | [docs/plan/submission-sync-window-and-pagination-throttle.md](docs/plan/submission-sync-window-and-pagination-throttle.md) |
| Hydro 活动/域/品牌 | [docs/plan/hydroj-activity-submission-sync-spec.md](docs/plan/hydroj-activity-submission-sync-spec.md) |
| 题面 Source → CNOI → PDF | [docs/development/problem-markdown-pipeline.md](docs/development/problem-markdown-pipeline.md) |
| CNOI 规则页 | [docs/development/cnoi-rule-management.md](docs/development/cnoi-rule-management.md) |
| 设置页壳 | [docs/development/settings-shell.md](docs/development/settings-shell.md) |
| 比赛日程 | [docs/features/contest-schedule/README.md](docs/features/contest-schedule/README.md) |
| 权限、Cookie、数据边界 | [docs/privacy.md](docs/privacy.md)、[docs/research/permission-matrix.md](docs/research/permission-matrix.md) |
| 站点协议 | [docs/research/](docs/research/) 对应 OJ |
| 发布门禁 | [docs/qa/release-checklist.md](docs/qa/release-checklist.md) |

站点行为必须有 `docs/research/` 或脱敏 fixture 证据，不要靠猜测“应该支持”。

## 环境与命令

- Node：`.nvmrc`（当前 24.18.0），`package.json` 要求 `>=24`
- 包管理器：pnpm；提交 `pnpm-lock.yaml`，安装用 `pnpm install --frozen-lockfile`
- 扩展框架：WXT 0.21.4，产物在 `.output/chrome-mv3`

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract          # tests/adapters + tests/domain
pnpm test:watch
pnpm format:check
pnpm build
pnpm audit:architecture
pnpm audit:manifest         # 依赖 pnpm build 产物
```

浏览器加载的是 `.output/chrome-mv3`，不是源码。**每次改完 `src/`、`entrypoints/`、`public/`、`wxt.config.ts` 或会影响产物的文件后，都必须重新 `pnpm build`，不能只跑测试或 typecheck 就结束。** 已打开的 `pnpm dev` 不能代替这次构建；交付前以全新 `pnpm build` 产物为准。改权限、content script 或 `wxt.config.ts` 时构建后立刻跑 `pnpm audit:manifest`。

改完相关代码后，至少跑与改动同层的测试，再加上 `pnpm typecheck`。触及依赖方向、题面分层、UI 导入边界时跑 `pnpm audit:architecture`。不要把真实 OJ 网络请求加进默认 CI；唯一可选 live 测试是 `tests/integration/hydroj-live.test.ts`，无环境变量时跳过。

加载扩展：Chrome / Edge 开发者模式 → 加载已解压扩展 → `.output/chrome-mv3`。构建成功后如扩展已加载，提醒用户刷新扩展后再验证。

## 目录职责

```text
entrypoints/     WXT 入口：background、popup、timeline、settings、
                 contest-schedule、problem-export、pdf-worker、content scripts
src/domain/      纯领域类型、错误、去重、窗口、覆盖、身份键；无 React / Chrome / 网络
src/sources/     静态站点定义（展示名、授权模式、fixedOrigin）
src/adapters/    提交 Adapter：authorize / fetchRecent / 可选 session 与品牌
src/application/ 用例：账号、同步、存储事务、消息、题面导出、CNOI 规则、导航
src/platform/    HttpClient、限流、分页队列、权限、临时 Cookie
src/problem/     题面 Adapter、Markdown codec、CNOI transformer、Typst 渲染
src/oj-enhancer/ 页面增强（跨 OJ 提交、洛谷题解频道、Cloudflare 挑战补丁）
src/features/    独立功能（比赛日程）；不要并进提交同步或题面管道
tests/           与 src 分层对应；UI 测试在 tests/ui
docs/fixtures/   脱敏真实响应；生产代码不得 import tests/ 或把测试夹具打进 bundle
tools/           架构/权限审计；phase0 探针不得进入产品 bundle
```

页面壳放 `entrypoints/`，领域与用例放 `src/`。设置页没有 React Router，分区是 `settings.html#accounts|collection|cnoi|data`。

## 架构不变量

这些规则由 `tools/audit-architecture.mjs` 和测试强制执行，破坏即失败。

1. **依赖方向**
   - `src/domain`、`src/sources` 不得依赖 `application`、`adapters`、`platform`、`entrypoints`
   - 提交 Adapter 不得依赖 React、页面组件或 `chrome.storage`
   - UI（`entrypoints/settings|timeline|popup|problem-export|pdf-worker|shared`）运行时不得导入提交 Adapter 入口（`src/adapters/<oj>/index.*`）或题面 Adapter/CNOI/Registry
   - 题面 Adapter 不得依赖 `cnoi/` 或 `render/`
   - Markdown codec 与 CNOI transformer 不得依赖 Adapter、Registry 或 renderer
   - 纯渲染（`template` / `markdown-to-typst` / `typst-renderer`）不得依赖浏览器 compiler、worker 或 Adapter
   - 纯模块禁止 `browser` / `chrome` / `window` / `document` / `localStorage` / `sessionStorage` 全局，也禁止 `wxt/browser`
2. **请求与存储**
   - 页面不直接请求 OJ；提交采集由 application / service worker 调度
   - 页面不直接写 `ojtrace:data`；写入走 `StoragePort.transact`。回调必须同步且纯
   - Adapter 网络必须经受限 `HttpClient`，不能接受任意 URL。Hydro 只用当前账号的精确 origin；AtCoder Problems / 临时 Cookie 只能通过已有 option flag
   - `GET_STATE` 等公开查询返回 `PublicStoredData`，不得带凭证或活动日程原文
3. **身份与时间**
   - 每个账号有不可变本地 `accountId`；远端身份是 Adapter 返回的 `providerAccountKey`
   - 持久化账号不含表单输入和凭证；凭证是独立 `CredentialRecord`
   - `submittedAt` 永远是 Unix epoch milliseconds，展示时再转本地时区
4. **错误与协议**
   - UI 只消费领域模型和结构化错误（`AdapterError` / `messageKey`），不解析异常字符串
   - runtime 消息是带 `schemaVersion: 2` 和 `requestId` 的 discriminated union
   - 添加/重新授权只验证身份并保存，不自动采集
5. **一个 OJ 失败不能拖垮其他 OJ。** 同步、比赛日程刷新、品牌缓存都按源隔离；失败不得覆盖该源的有效旧缓存，除非合同明确要求。

## 按任务改哪里

| 要做的事 | 主要路径 | 不要做 |
| --- | --- | --- |
| 新提交站点 | `src/sources/definitions.ts`、`src/domain/types.ts` 的 `SOURCE_IDS`、`src/adapters/<oj>/`、registry、fixture、research 文档、权限矩阵 | 把解析写进 UI 或 service worker 大文件 |
| 提交解析/归一化 | `adapters/<oj>/parser`、`normalizer`、`urls`、`tests/adapters`、`docs/fixtures/<oj>` | 把登录 HTML 当成空提交列表 |
| 同步/覆盖/限流 | `src/application/sync/`、`src/platform/network/`、`src/domain/sync-*.ts`、`pagination-policy.ts` | 手动同步绕过 origin 节奏或 429 冷却 |
| 账号授权 | `src/application/accounts/`、`entrypoints/settings/Account*.tsx`、`src/platform/permissions/` | 在 UI 持久化 Cookie 值到日志或 GET_STATE |
| 设置页交互 | `entrypoints/settings/` + `docs/development/settings-shell.md` | 新增 React Router；卸载已访问表单来“简化状态” |
| 题面提取 | `src/problem/adapters/`、`src/problem/extract/`、`tests/problem`、`docs/fixtures/problem` | 在 Parser/Renderer 里用网页 class 或全局正则清控件 |
| CNOI 规则 | `src/problem/cnoi/`、`src/domain/cnoi-rules.ts`、`src/application/cnoi-rules/` | 跑用户正则、动态脚本、插件式规则 |
| PDF/预览 | `src/problem/render/`、`src/application/problem-export/`、`entrypoints/pdf-worker` | 远程加载 Typst；用 `eval`；打开多余标签页做直接下载 |
| 跨 OJ 提交 | `src/oj-enhancer/features/cross-oj-submit/`、对应 content script | 伪造 Turnstile/Cloudflare token；把源码写入 `storage.local` 或 URL |
| 比赛日程 | `src/features/contest-schedule/`、`entrypoints/contest-schedule/` | 复用提交 Adapter、`ojtrace:data` 或 content script |
| 权限 | `wxt.config.ts`、`tools/audit-manifest.mjs`、privacy/research | 增加 `webRequest`、`<all_urls>`；把可选权限改成默认全开 |

## 题面数据流

唯一正式管道：

```text
页面 DOM / allowlist JSON
  → ProblemAdapter.extractSource
  → SourceProblem { sourceMarkdown, metadata, assets, warnings }
      ├─ 复制：原样返回 sourceMarkdown
      └─ convertSourceToCnoi → CNOI Markdown
          → 直接导出 / ProblemStudio 初始 editedMarkdown
          → 之后只 parseProblemMarkdown + Typst，不再二次 CNOI 转换
```

- Adapter 只交付 Source Markdown、元信息和资源，不输出章节 role / SampleBlock
- 通用 Parser 不接受 OJ 语义；站点规则只在 `src/problem/cnoi/rules/`
- 保留原题语言、原样例编号、图片尺寸和合并表格；不要按位置重编号样例
- 任务开始时冻结 CNOI 规则快照；丢失快照就提示重试，不悄悄用新配置
- 生产代码不得 import `tests/`

## 隐私、权限、站点礼貌

- 无服务端。不上传账号、提交、Cookie、密码、token 或代码
- 凭证仅用于对应 OJ。手动 Cookie / Hydro 密码只存在 `chrome.storage.local`；诊断只许 Cookie 名称、作用域、数量，不许值
- 临时 Cookie 注入必须在请求结束后恢复或删除
- host permission 保持最小。QOJ 与洛谷题面增强是固定 host；Codeforces / AtCoder / AtCoder Problems / Cloudflare challenge / 任意 Hydro origin 是 optional，且 Hydro 运行时仍校验用户输入的精确 origin
- 禁止用反爬、验证码、限流绕过逻辑。429 立即登记 origin 冷却，尊重 Retry-After
- 分页间隔只约束列表逻辑页，不拿来“加速”身份、详情或品牌请求
- CSP 已允许本地 Typst WASM（`wasm-unsafe-eval`）；不要再放宽到远程脚本或 `eval`

## 测试约定

- 默认 `vitest` 环境是 `node`。需要 DOM 的 UI 测试在文件头写 `// @vitest-environment jsdom`
- Adapter / 领域测试用 `docs/fixtures/` 和 `tests/helpers/`（`memoryStorageArea`、`immediatePagination`）。只有 Adapter 单测可以绕过分页延迟；队列/限流测试必须走真实 runtime
- 外部响应都要经过 parser 和字段校验。登录页、Cloudflare 挑战、空列表、畸形 JSON、限流都要有用例
- UI 测试覆盖设置壳、授权、采集、CNOI 预览、popup、导出等交互；不要为了过测试去 mock 掉正在改的合同
- 架构审计的正反 fixture 在 `tests/tools/architecture.test.ts`；改分层时同步更新审计规则和测试

## 代码风格

- TypeScript `strict`，`noUncheckedIndexedAccess`，`verbatimModuleSyntax`。类型导入用 `import type`
- 与邻接文件保持一致：命名导出、显式类型、小而直的模块，不引入新的抽象层或状态库
- 错误用现有 `AdapterFailure` / `AccountCommandError` / 结构化 `messageKey`，不要 `throw "字符串"`
- 不要把 `PLAN.md`、lockfile、研究文档、fixture 当作格式化目标（见 `.prettierignore`）
- 不要添加版权头。不要提交 `.output/`、`.wxt/`、`.tmp/`、`node_modules/`

## 明确不要做

- 不要为了方便让 UI 直接 `fetch` OJ 或读写凭证
- 不要在 content script 长期注入题面采集；题面工具按当前标签页、用户手势和 URL 校验按需执行
- 不要把 contest cache 写入 `ojtrace:data`
- 不要把 Typst、字体、WASM 改成 CDN
- 不要扩大默认权限来“先打通再收敛”
- 不要在未更新 research / fixture / 测试的情况下宣称新 OJ 或新页面结构已支持
- 不要用新依赖解决可以靠现有 platform 工具完成的问题；Typst 补丁只走 `pnpm-workspace.yaml` 里已有的 `patchedDependencies`
- 不要在未重新 `pnpm build` 的情况下声称改动已完成或可在浏览器里验证
