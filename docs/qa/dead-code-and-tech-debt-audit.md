# 死代码与技术债审计

审计日期：2026-10-04。范围：`src/`、`entrypoints/`、测试、生产静态资源和检查配置。

## 第一轮已处理

| 项目                          | 证据与处理                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LibreOJ 历史 unsupported 工厂 | `src/adapters/unsupported.ts` 没有导入方，参数已经是 `never`；删除整个文件。                                                                                                                         |
| 无调用方的跳转封装            | `src/platform/extension/navigation.ts` 没有导入方；当前 Timeline 用经过 URL 校验的链接跳转，删除旧封装，保留实际使用的 allowlist。                                                                   |
| 旧权限申请链路                | 当前设置页在用户操作中直接调用 `ensureAuthorizationPermission`；删除无人发送的 `REQUEST_HOST_PERMISSION` 消息、后台分支、`PERMISSION` 响应和旧申请辅助函数。                                         |
| 页面注入身份的残留            | UI 没有发送 `pageIdentity`，后台也没有转发；删除消息字段、Adapter 输入字段及 AtCoder/Codeforces/Hydro 的旧分支，删除两条只覆盖该分支的测试。QOJ 从 HTTP 响应校验身份的逻辑保留。                     |
| 无消费方的契约                | 删除 `AdapterCapabilities`、五个 Adapter 中的六项 capability 标志及从未实现、从未调用的 `validateAccount`。                                                                                          |
| 废弃来源开关                  | `enabledSources` 只有类型和默认存储值，无实际消费方；删除，以账号的 `enabled` 和 `syncAccountIds` 为准。加载偏好时使用字段白名单，并把非法 retention/cooldown 恢复为默认值。已有账号及有效偏好保留。 |
| 重复下拉组件                  | Timeline 与设置页合并使用 `entrypoints/shared/AnimatedSelect.tsx`，保留 Timeline 的键盘导航、Escape/外部点击关闭和隐藏菜单的 Tab 行为；删除重复名称映射及无引用的 `.select-check`。                  |
| Cookie 恢复的隐式错误优先级   | 将 `finally` 中抛错改为保存请求结果、尝试恢复全部 Cookie、最后决定返回或抛错。恢复失败仍优先报告，恢复成功则保留原始请求错误，包括 `undefined` 拒绝值；补充队列释放回归验证。                        |
| 实例跳转约束                  | `isAllowedOriginNavigation` 原本未使用 `source`；现在明确只允许 HydroOJ 的精确实例 origin，补充跨来源和错误 origin 验证。                                                                            |
| 无引用的生产资源              | 删除 `atcoder.png`、`atcoder.svg`、`hydroj-favicon.ico`、`qoj-glyphicons.woff2`，共 118,517 字节；所有当前图标和 CSS 使用的三个指标 SVG 保留。                                                       |
| 静态检查债务                  | 处理未使用导入/参数和不安全的可选链断言，保留 QOJ 用户名的控制字符校验并注明该 lint 例外的用途；启用 TypeScript 未使用变量/参数检查以及 oxlint `--deny-warnings`。                                   |

通过生产入口的静态 import/re-export 图核对，删除的两个模块均不可达。`src/env.d.ts` 是类型声明，不能按运行时 import 图判为死代码。历史计划、旧响应 fixture 和拒绝非法旧数据的测试也不能仅凭“旧”字删除。

第一轮没有升级存储版本、修改采集算法或覆盖仓库开始时已有的未提交改动。当前有效页面消息及本地存储继续使用 schema 2。

## 第二轮已处理

| 项目                   | 证据与处理                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 冗余的采集完整性字段   | `FetchResult.hasMore` 没有生产消费方，五个 Adapter 仅根据 `coverage.outcome.status` 派生它；删除类型字段、返回值和测试 fixture，完整性只读取 `coverage.outcome`。Hydro/QOJ 分页解析器实际使用的 `hasMore` 保留。                                                                                                                                    |
| 无写入方的品牌旁路     | 没有 Adapter 返回 `FetchResult.instanceMetadata`，只有采集器读取；删除字段和不可达的品牌短路条件，品牌统一经 `refreshInstanceBranding` / `fetchInstanceBranding` 刷新，保留缓存及取消检查。                                                                                                                                                         |
| 旧洛谷解析入口         | `parseLuoguResponse` 只有测试调用，生产使用 `parseLuoguDocument`；删除旧函数，把 JSON fixture 与登录页拒绝测试迁移到生产解析入口，保留行为覆盖。                                                                                                                                                                                                    |
| 旧 Hydro JSON 断言     | `assertHydroOJJsonResponse` 只有测试调用，生产请求由 `assertRecordResponse` 校验；删除函数及其独立断言，保留挑战页、有效 JSON 和坏数据解析测试。                                                                                                                                                                                                    |
| 旧设置页布局及状态样式 | 精确核对 JSX 和动态类名后，删除 `auth-methods`、`browser-actions`、`session-help`、`auth-heading-title`、`recommended-badge`、`field-label`、`session-status.is-checking/is-error`、`status-mark`、`session-status-block`、`account-form-actions`，同步删除媒体查询中的残留及无对应元素的后代选择器。当前授权状态与其他组件的 `is-error` 样式保留。 |
| 旧时间线页头及样式残留 | 当前页面使用 `AppHeader` 的 `app-header/app-brand`，删除无引用的 `topbar/brand` 及媒体查询残留；删除注释掉的原生 select 样式和三个无声明的 metric 空规则，保留动态生成的指标/判题状态类。                                                                                                                                                           |

同步更新账号、Hydro 和采集窗口计划中的结果合同，避免文档继续要求已经删除的兼容字段。此次修改均在现有工作区上增量完成。

复核时，原 P1「采集窗口、分页预算与完整性反馈」已由[专项实现](../plan/submission-sync-window-and-pagination-throttle.md)处理：`FetchInput` 已含必填窗口和分页端口，应用层/UI 已使用 `coverage`。因此从剩余技术债中撤下该旧条目；浏览器真实登录态验收仍见该专项计划。

## 剩余技术债，按优先级处理

### P1：缓存提交及同步状态的结构校验

位置：[存储加载](../../src/application/storage/store.ts)、[时间线渲染](../../entrypoints/timeline/main.tsx)、[存储测试](../../tests/application/storage.test.ts)。

提交加载目前只检查少量字符串和时间戳，没有检查 `problemId`、`verdict`、合法 source 或账号与 origin 的一致性。现有存储测试甚至允许缺少 verdict 的记录通过；Timeline 会访问 `item.verdict.code/raw`。损坏缓存可能导致页面渲染失败。`syncStates` 目前也只校验外层是对象。

建议增加 `sanitizeSubmission` 和 `sanitizeSyncState`，按账号来源/实例校验关联，只丢弃坏条目，保留其他账号及记录；用缺失 verdict、非法来源、错误 origin 和坏错误对象覆盖回归。无需引入大型 schema 库。

### P2：前端读取元数据，却依赖整个 Adapter 注册表

位置：[AccountForm](../../entrypoints/settings/AccountForm.tsx)、[授权 Hook](../../entrypoints/settings/useAccountAuthorization.ts)、[权限模块](../../src/platform/permissions/hosts.ts)、[注册表](../../src/adapters/index.ts)。

前端和权限计划通过全量 `adapterBySource` 读取名称、认证模式、公共数据 origin，注册表同时包含全部采集实现。这使 UI 模块依赖网络和解析实现，也增加页面 bundle 的负担。

建议先把不执行网络请求的元数据抽到一个轻量注册表。UI/权限层只依赖元数据，后台继续装配 OJAdapter；新增 OJ 时仍保持一份元数据定义。

### P2：消息发送端用 object 和泛型断言绕过契约

位置：[设置页](../../entrypoints/settings/main.tsx)、[授权 Hook](../../entrypoints/settings/useAccountAuthorization.ts)、[时间线](../../entrypoints/timeline/main.tsx)。

三个发送辅助函数接受 `object`，有的允许调用方把响应直接断言成任意 RuntimeResponse 子类型。缺字段或错误消息类型无法在发送位置被 TypeScript 提前发现。

建议合并为接受 `RuntimeMessage`、返回 `RuntimeResponse` 的发送函数，由调用方检查 `ok/type` 后使用结果。后台运行时校验继续保留。

### P3：Timeline 页面组件承担过多状态管理

位置：[Timeline App](../../entrypoints/timeline/main.tsx)。

账号选择保存队列、时间范围持久化、同步交互、筛选分组及页面渲染集中在一个文件。先把有独立生命周期的保存/同步状态拆为 Hook，再拆视图组件；避免仅为减少行数增加抽象层。

## 第一轮验证记录

- `pnpm typecheck`：通过，包含新增未使用项检查。
- `pnpm lint`：通过，0 警告；基线为 8 条警告。
- `pnpm test`：223 通过、1 个 live Hydro 集成测试跳过。包含新增的下拉键盘交互、Cookie 错误优先级/队列释放、偏好修复及实例跳转测试。
- `pnpm test:contract`：101 通过。
- `pnpm format:check`、`pnpm build`、`pnpm audit:manifest`、`git diff --check`：通过。
- 清理资源后生产构建约 745 KB。构建仍输出 Radix 依赖的 `use client` directive 告警，未影响构建完成。
- Chrome/Edge 的扩展加载、权限弹窗和真实登录态人工验收未在本轮执行。

## 第二轮验证

- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`：通过。
- `pnpm test`：324 通过，1 个 live Hydro 集成测试默认跳过。
- `pnpm build`、`pnpm audit:manifest`、`git diff --check`：通过。
- 源码、入口和测试中已无 `instanceMetadata`、`parseLuoguResponse`、`assertHydroOJJsonResponse` 引用；剩余 `hasMore` 均用于 Hydro/QOJ 页级解析及其测试。
- CSS 全量类名比对后，逐项核对动态生成的类和后代元素；动态指标、判题状态和日期组件错误状态不按静态字面量缺失判为死代码。
- 构建约 805 KB，仍有 Radix/lucide 依赖的 `use client` directive 告警，构建成功。未执行 Chrome/Edge 扩展人工验收和真实 Hydro live 请求。

## 第三轮：测试清理

2026-10-04 对现有测试发现范围、测试辅助模块、响应 fixture 引用和重复断言进行复核。清理前为 44 个通过的测试文件、427 个通过用例，另有 1 个按凭据条件跳过的 live 测试。

| 删除项                                   | 保留覆盖的位置与依据                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/application/sync-cancel.test.ts`  | 该文件唯一用例只验证重复同步不发起第二次采集，没有触发取消，并依赖固定 5ms 延时。并入 `sync-progress.test.ts` 的并发批次测试：通过默认采集器执行两个批次，使用相同窗口、不同 `now`，等待两个采集调用确实发生后才释放结果；同时验证只采集一次、新记录只在首次提交时计数，以及两个批次的最终状态。实际取消/清空测试继续保留。 |
| `sync.test.ts` 中重复的 Luogu 未选中用例 | 与「仅同步持久化选择」使用相同账号、偏好和响应。把精确请求来源断言合入保留用例，继续同时验证实际请求和返回的账号集合。显式选择覆盖偏好、空持久化选择等不同分支保留。                                                                                                                                                        |
| `http-client.test.ts` 中基础读流超时用例 | 已被「等待异步流取消后才结束超时请求」覆盖：同样验证 `timeout` 错误和一次取消，还验证取消完成前不结束及计时器清理。等待响应头的超时、调用方取消、响应大小上限等不同路径保留。                                                                                                                                               |

`tests/account-fixture.ts` 有实际导入方，保留。默认跳过的 Hydro live 测试可通过环境变量启用，保留。12 个没有被测试直接读取的响应文件仍被 `docs/research/` 的研究结论引用，属于研究证据，保留。

- `pnpm test`：43 个测试文件通过，424 个用例通过，1 个 live 测试默认跳过；净删 3 个重复用例、1 个测试文件。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`git diff --check`：通过。
- 本轮仅修改测试和此审计记录，未执行真实凭据请求。
