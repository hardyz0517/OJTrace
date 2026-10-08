# 项目复用审计

审计日期：2026-10-08。审计对象为当前工作区，包含尚未提交的新功能与修改，不是仅审计 Git HEAD。本次仅新增报告，没有修改产品代码、测试或已有文档。

## 结论与范围

项目已经有较好的分层：账号身份、提交合并、存储事务、账号采集协调、分页节流和 Cookie 恢复都有公共入口。主要问题是 **Adapter 内部的公共采集规则没有继续下沉，以及 UI 仍在各处维护相同的消息、元数据和样式规则**。

最可能明显减少重复代码的方向是：分页采集公共策略、错误构造、测试基础设施、共享组件样式。来源元数据与消息客户端的主要收益是减少修改点和类型漏洞。单纯拆分长文件的删代码收益较低。

检查覆盖五个 Adapter、domain/application/platform 层、后台与两个 React 页面、共享组件及相关测试。方法包括源码与调用关系核对、重复片段扫描及测试基线验证。扫描以连续 12 行非空、非整行注释代码为窗口，归一化空白后发现 34 个跨文件重复窗口；这些窗口有重叠，不能当作 34 个独立问题，也不能据此计算整个项目的重复率。语义相同但变量名或来源不同的实现另行人工核对。

审计读取时，洛谷与 QOJ Adapter 分别为 572、701 行，Timeline 入口为 1,055 行；两个页面样式合计 1,534 行。这些是候选区域大小，不是可删除行数。尚未实施重构，因此不承诺净删行数或百分比。

下列 P1/P2/P3 表示复用改造优先级，不表示已经确认相应级别的功能故障。

| 编号 | 优先级 | 复用机会                             | 预期收益                                 | 改造风险 |
| ---- | ------ | ------------------------------------ | ---------------------------------------- | -------- |
| R01  | P1     | 分页采集中的公共状态与规则           | 高：重复控制逻辑最多，规则修复可集中生效 | 中高     |
| R02  | P1     | 轻量来源元数据与固定站点事实         | 高：新增 OJ、改名称或域名时减少多处修改  | 中       |
| R03  | P1     | 页面消息客户端与响应封装             | 高：统一类型、响应检查和消息公共字段     | 低至中   |
| R04  | P2     | Adapter 错误构造及通用 HTTP 错误规则 | 高：大量错误对象样板可收敛               | 中       |
| R05  | P2     | 共享下拉样式与页面基础样式           | 中高：已有组件复用，但 CSS 重复仍明显    | 低至中   |
| R06  | P2     | 测试存储、异步控制及响应构造         | 高：降低契约变动时的批量维护成本         | 低至中   |
| R07  | P2     | 授权表单与服务的纯输入规则           | 中：减少字段规则和规范化的重复实现       | 中       |
| R08  | P2     | HTML 实体解码等解析基础函数          | 中：直接重复，边界修复可一次完成         | 低至中   |
| R09  | P2     | 请求前与重定向后的 URL 规则          | 中：同一网络端点约束维护一次             | 中       |
| R10  | P3     | 串行队列实现及可取消等待             | 小至中：代码不多，但生命周期规则可统一   | 中       |

## R01：优先复用分页采集中的公共规则

证据：

- 洛谷的页序验证、时间窗口筛选、去重与额度处理在 [index.ts:439](../../src/adapters/luogu/index.ts#L439)；QOJ 的对应逻辑在 [index.ts:588](../../src/adapters/qoj/index.ts#L588)。两者的 `ordered`、`previousOldest`、`seenRecords` 及下界判断基本相同。
- 洛谷 [index.ts:512](../../src/adapters/luogu/index.ts#L512) 与 QOJ [index.ts:643](../../src/adapters/qoj/index.ts#L643) 的异常处理近乎复制：区分用户取消与 deadline、首个成功页之前抛错、身份错误继续抛出、后续失败转为部分完成并附诊断。
- 两者还分别维护重复页签名、进度计数和最终 coverage。现有 [submission-window.ts](../../src/adapters/shared/submission-window.ts) 只集中窗口分类、deadline 判断与 coverage 构造。

建议先抽取有限的公共策略：降序时间边界跟踪器、入选记录缓冲区、重复页检测、逻辑页进度计数、分页失败分类。第一轮只让洛谷和 QOJ 共用这些规则；如果调用方式仍高度一致，再提取页码式采集驱动。

站点层继续负责请求、认证与身份核验、解析、归一化，以及“是否存在下一页”的证据。洛谷使用 `count/perPage`，QOJ 使用 HTML 的 `hasMore`，它们不是一个布尔值就能完全统一的契约。

AtCoder 是升序且包含游标边界的时间分页；Hydro 需要 ObjectId 时间依据、多个活动流共用额度及记录合并；Codeforces 目前是一次最多 1,000 条的单页请求。它们可以复用小策略，但不应在第一轮强行改成同一个大分页框架。

验收重点：跨页乱序不能误判完整；窗口外记录不占额度；重复页及时停止；第一张失败与后续失败不同；身份变化不能作为部分成功保存；只统计逻辑页；保留用户取消和 deadline 的区别。

## R02：来源元数据与站点事实应有一份定义

名称至少分别维护在 Adapter metadata、[Timeline:41](../../entrypoints/timeline/main.tsx#L41) 和 [OJLogo:13](../../entrypoints/shared/OJLogo.tsx#L13)。固定站点地址又分别出现在：

- [权限模块:9](../../src/platform/permissions/hosts.ts#L9) 的 `SOURCE_ORIGINS`。
- [HTTP 客户端:9](../../src/platform/network/http-client.ts#L9) 的 `ALLOWED_ORIGINS`。
- [浏览器 HTTP 客户端:11](../../src/platform/network/browser-http-client.ts#L11) 的 `FIXED_ORIGINS`。
- [授权说明:7](../../entrypoints/settings/AccountAuthContent.tsx#L7) 与 Timeline 的首页映射，以及各 Adapter 的 URL 模块。

[AccountForm](../../entrypoints/settings/AccountForm.tsx)、[授权 Hook](../../entrypoints/settings/useAccountAuthorization.ts)、[PaginationSettings](../../entrypoints/settings/PaginationSettings.tsx)、[设置入口](../../entrypoints/settings/main.tsx)、[SyncDiagnostics](../../entrypoints/shared/SyncDiagnostics.tsx) 和权限模块均通过完整 Adapter 注册表读取元数据。核对静态导入关系后，设置页与时间线均能到达五个 Adapter 实现；构建器最终保留多少代码尚未测量，不能直接将可达性当作实际 bundle 增量。

建议新增不执行网络请求的来源定义模块，以类型约束覆盖全部 `SourceId`，集中名称、默认首页、固定 origin、授权模式与凭证字段。Adapter 引用对应定义，UI 与权限层不再导入采集注册表。图标路径等展示信息可以保留在独立的 UI 配置中，名称仍读取同一份来源定义。

复用的是事实，权限决策仍须分开：导航目标、公开数据请求和凭证注入具有不同的允许范围。AtCoder Problems 的公开数据 origin 不能自动成为 Cookie 注入目标；Hydro 必须保留精确实例和域限制。不能简单把所有地址合并成一个宽泛 allowlist。

## R03：消息发送与公共响应封装需要共享

三个重复发送函数分别在 [设置入口:16](../../entrypoints/settings/main.tsx#L16)、[授权 Hook:60](../../entrypoints/settings/useAccountAuthorization.ts#L60)、[Timeline:64](../../entrypoints/timeline/main.tsx#L64)，都接受 `object`；两个函数还允许调用方用泛型直接指定预期响应。[PaginationSettings:147](../../entrypoints/settings/PaginationSettings.tsx#L147) 则直接调用 `sendMessage` 并断言响应。

这会让漏字段和错误消息类型绕过发送位置的检查，也让调用方自行假定响应类型。当前设置页加载会检查 `STATE`，Timeline 加载主要依赖泛型断言，说明调用方式已经分化。

建议共享一个接受 `RuntimeMessage`、返回 `RuntimeResponse` 的客户端，或使用严格的命令到响应映射。统一公共的 schemaVersion/requestId 生成；有同步进度关联的请求允许显式传入 requestId。客户端或调用方必须实际检查 `ok/type`，不能仅把断言移到新文件中。

[后台](../../entrypoints/background.ts) 中六个 `UPDATED` 分支重复填写 schema、requestId、ok、type 和 `publicStoredData`。可增加小型响应构造函数，公共字段使用已有版本常量。无需为此建设通用 RPC 框架。

后台的运行时输入检查和公共状态脱敏继续保留；页面客户端不替代这些边界检查。

## R04：AdapterFailure 样板很多，通用错误政策已经分化

审计读取时，Adapter 目录共有 53 处 `new AdapterFailure(...)`。并非全部可合并，但大量对象反复填写 source、stage、messageKey、retryable、userAction、httpStatus、requestId。

[QOJ:147](../../src/adapters/qoj/index.ts#L147)、[Hydro session:83](../../src/adapters/hydroj/session.ts#L83)、[AtCoder submissions:16](../../src/adapters/atcoder/submissions.ts#L16) 各有自己的 `failure` 工厂；洛谷和 Codeforces 更多使用展开的对象。洛谷的身份请求和列表请求还各写一套 403/429/其他非成功状态处理。

已有可观察的政策差异：QOJ 工厂对所有 `network` 错误设 `retryable: true`；AtCoder 工厂只有没有 HTTP 状态或状态至少 500 才设为 true；洛谷 HTTP 错误同样依状态判断。比如普通 HTTP 400，在这些实现中的可重试标志不同。是否应保留这种差异需要明确，不应在去重时顺带改变行为。

建议提供带请求上下文的错误构造器，以及少量通用 HTTP 错误默认规则，允许站点覆盖 messageKey、stage、retryable 和 userAction。已有 `AdapterFailure.fromTransport` 继续复用。优先集中公共字段与默认值，不把登录页、挑战页或活动无权限等站点语义塞进全局状态码表。

验收重点：保留 401/403/429 的站点含义、传输错误 cause 与冷却信息、身份错误的失败语义。Hydro 活动的 403 无权读取与账号认证失败仍须区分。

## R05：共享组件已复用，样式还没有归属组件

[AnimatedSelect](../../entrypoints/shared/AnimatedSelect.tsx) 已由两个页面共用，但其箭头、菜单、选项、打开状态、隐藏状态分别定义在 [设置样式:519](../../entrypoints/settings/style.css#L519) 和 [Timeline 样式:334](../../entrypoints/timeline/style.css#L334)。两套样式分别占约 80、106 行，并具有不同的动画时长、尺寸、层级与高亮方式。

两页还分别维护 root/body/reset，以及声明相同的 `.shell` 与 `.settings-page` 容器。

建议将下拉的行为状态样式放入组件自己的 CSS 并由组件导入；页面用少量 CSS 变量或明确的变体控制尺寸和外观。页面基础样式抽为 shared base，保留 Timeline 的横向滚动及最小宽度等页面差异。

这比只增加通用 Button/Input 包装更有实际收益。当前两个包装只提供默认 type，没有公共外观或交互规则，不宜仅为统一标签使用而批量替换原生元素。

验收重点：保留键盘焦点、菜单隐藏时的可见性、容器与弹层层级、窄屏布局及减少动画设置。视觉验收不能只依赖 jsdom。

## R06：测试基础设施是另一处高收益复用点

已有 [account-fixture.ts](../../tests/account-fixture.ts) 是有效复用。其他基础设施仍分散：

- `deferred<T>()` 分别在 [collect-account:27](../../tests/application/collect-account.test.ts#L27)、[sync-progress:29](../../tests/application/sync-progress.test.ts#L29)、[sync-races:12](../../tests/application/sync-races.test.ts#L12)。
- 多个 application 测试分别实现闭包式内存 storage area；例如 [sync:12](../../tests/application/sync.test.ts#L12)、accounts、pagination-preferences、collect-account、sync-progress、sync-races。
- Hydro 的 session/domain/window/activity/cache 测试分别构造近似的 `HttpResponse` 和 `FetchInput`。多个文件反复写立即执行的 `PaginationRuntime`。
- Timeline 的两个 UI 测试重复绕过入口自挂载、获取真实 React root 和设置浏览器 mock。

建议增加小而独立的 `tests/helpers/`：deferred、内存 storage area、文本/JSON 响应、立即执行分页端口、基础 FetchInput/Submission 工厂；按需要再加 UI 挂载与清理 helper。存储错误、延迟写入和损坏数据测试需要明确的覆盖入口。

优先复用“准备环境与构造合法基础对象”。站点 HTML fixture、关键输入、预期值和行为断言仍放在用例旁。不要用被测 normalizer/coverage 构造器生成预期结果，也不要用一个庞大的 `setupEverything` 隐藏竞态触发顺序。

## R07：授权输入规则应共享，边界校验仍各自执行

[授权 Hook:185](../../entrypoints/settings/useAccountAuthorization.ts#L185) 与 [AccountService:97](../../src/application/accounts/account-service.ts#L97) 分别解释 `identifierRequired`、`credentialFields`、`required`，筛选凭证并处理空值。

另外，[消息校验:298](../../src/application/messaging/messages.ts#L298) 与 [存储凭证清理:55](../../src/application/storage/store.ts#L55) 重复判断键是否为空、值是否为字符串、是否包含 CR/LF；消息层拒绝整条请求，存储层过滤坏字段，这是不同边界的合理策略。

建议共享根据 AuthModeDefinition 执行的纯输入规范化与校验函数，返回字段错误或 messageKey，UI 负责呈现，服务负责拒绝。基础凭证条目的合法性谓词也可以共享，但消息拒绝与缓存修复策略继续分开。浏览器会话检测、用户手势下的权限申请和服务端身份验证不能被合并为同一个校验函数。

保留密码原始值、其他字段的裁剪规则、未知字段拒绝和各来源特殊 Cookie 解析。不要为了复用把所有凭证统一 trim。

## R08：HTML 解码有直接重复，适合小范围提取

[QOJ parser:23](../../src/adapters/qoj/parser.ts#L23) 与 [Hydro parser:103](../../src/adapters/hydroj/parser.ts#L103) 的 `decodeHtml` 相同；[Hydro branding:9](../../src/adapters/hydroj/branding.ts#L9) 另有近似版本，少了 `&nbsp;`。QOJ/Hydro 的 `textOf` 与 [AtCoder parser:25](../../src/adapters/atcoder/parser.ts#L25) 的 `stripHtml` 也部分重合。

建议建立 Adapter 共享的实体解码函数，再根据已确认的调用契约共享基础文本清理步骤。QOJ 清理 script/style、Hydro 活动标题移除徽章等步骤仍由站点层明确组合；不能把所有文本处理强行替换成一种语义。

收益是新增实体支持、非法 Unicode code point 处理等边界规则只修一次。实体解码本身不是 HTML 消毒，不应用它替代 URL 或展示安全检查。

## R09：HTTP URL 规则在请求前后各维护一套

[HTTP 客户端:156](../../src/platform/network/http-client.ts#L156) 请求前验证与 [同文件:270](../../src/platform/network/http-client.ts#L270) 最终响应 URL 验证，分别重复 AtCoder submissions、problem metadata、submission detail 的路径约束，以及来源允许范围。

建议从 options 构造一次请求目标策略，共享一个验证 URL 的纯函数，分别用于初始 URL 和最终 URL。初始凭证选项的来源一致性检查可单独保留，不能在重定向检查中遗漏相关约束。

[Timeline:245](../../entrypoints/timeline/main.tsx#L245) 的 `navigationUrl` 与 [Timeline:549](../../entrypoints/timeline/main.tsx#L549) 的 `allowedRowUrl` 则可以直接复用已有行链接允许判断；前者只负责挑选提交链接或回退列表链接。这是小收益的就地复用，不需要新建大型导航层。

验收重点：初始 URL 和最终 URL 使用同一端点限制；附加公开数据 origin 不获得其他权限；Hydro 域与 Cookie 注入范围继续受原有约束。

## R10：队列与等待函数可共享实现，但锁实例必须独立

[temporary-cookies:21](../../src/platform/network/temporary-cookies.ts#L21) 的 `withCookieScope` 与 [Hydro session:290](../../src/adapters/hydroj/session.ts#L290) 的 `withInstanceSession` 都实现了按 origin 的 Promise 串行队列：前一个失败后继续、记录 operation、结束时比较当前 tail 再删除。

可以提取一个创建串行任务队列的函数，各调用处创建自己的实例。不能合并两个 Map：Hydro 会话锁内会进入 Cookie 锁，合并同源锁会破坏既有锁顺序，并可能自等待。分页队列另有 queued cancellation、延迟、冷却和 idle TTL，不应直接替换成这个简单队列。

[HTTP retry:126](../../src/platform/network/http-client.ts#L126) 与 [pagination sleep:27](../../src/platform/network/pagination-throttle.ts#L27) 的可取消计时器也可复用。统一时需要明确 AbortSignal 是否可选、是否保留 signal.reason，并保证清理 listener/timer。两个实现现在的拒绝值不完全相同，不能视为纯搬家。

这两项删代码收益小于分页采集和测试 fixture，适合在相关维护时顺手完成。

## 次优先机会与应保留的边界

- [domain 的滚动时间范围](../../src/domain/sync-range.ts#L71) 与 [UI 的滚动时间范围](../../entrypoints/shared/date-time-range.ts#L15) 分别实现 today、followNow、数字天数 preset。可共享滚动窗口计算，UI 保留格式化、365/36500 的筛选范围，同步业务保留 35 天限制及非负时间裁剪。不能直接扩大同步允许的 preset。
- Timeline 入口虽然超过千行，但长文件不等于重复。抽取选择保存与同步 Hook、行视图有助于职责隔离；仅把函数移入多个文件，不应计入本次“减少重复”的收益。
- 各站 verdict、语言编码、时间戳来源和解析结构应保留独立定义。例如数字状态 `1` 在 Hydro 和洛谷就不具有相同含义。只因输出都是 Submission，不能用一套泛化映射替代。
- Adapter 内的窗口筛选与应用层 `guardCollection` 是采集策略和写入前防线；应复用相同的基础规则，但不能删掉后一层检查。存储、消息和 UI 的边界检查同理。
- 已有 `mergeSubmission/submissionKey`、`buildIdentityKey`、`publicStoredData`、`commitCollections`、`accountCollectorFor`、`createPaginationRuntime`、`normalizeCookieHeader/cookieHeaderFromCredentials`、`reportProgress`、`AppHeader`、`AnimatedSelect`、`DateTimeRangePicker` 已经形成可用公共入口，应优先扩展和调用它们。

## 建议实施顺序

1. **先做低风险收敛**：R02 来源定义、R03 消息客户端与响应 helper、R05 下拉组件 CSS、R08 实体解码，以及 R06 的基础测试 helper。每项应能单独评审，验证现有行为保持一致。
2. **再处理主要业务重复**：R04 错误上下文与显式政策，然后 R01 洛谷/QOJ 共用的采集策略。先提取小状态对象和纯函数，再判断是否值得合并完整循环。不要一次重写全部 Adapter。
3. **按实际维护需要补充**：R07 授权纯规则、R09 URL 策略、R10 队列与等待实现、滚动时间范围。它们主要减少规则分化，净删代码量不是第一目标。

每轮对比净变更行数、同一业务规则的实现份数、类型契约和测试结果。只有提取后真正减少独立实现和维护点，才能算复用改善；抽出更多文件本身不算。

## 本次验证

- `pnpm typecheck`：通过。
- `pnpm test`：运行时 47 个测试文件通过、1 个跳过；503 个用例通过、1 个跳过。
- 未实施产品重构，未测量重构后的代码缩减或 bundle 大小，未执行真实浏览器登录态和视觉验收。
- 测试结果反映本次运行时的工作区。审计过程中可观察到其他工作区变动，本报告未改动这些文件或暂存区。
