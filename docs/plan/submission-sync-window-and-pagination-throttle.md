# 提交采集时间边界与分页节奏升级计划

> 状态：2026-10-04 已实施，自动化与构建门禁由最终交付记录确认；Chrome/Edge 浏览器验收待完成。本轮真实 Hydro live 测试未运行（默认跳过）。
>
> 当前实现：冻结闭区间窗口、默认 7 天/最近 35 天限制、按 OJ 设置的同源逻辑页暂停（默认 1.5 秒 ±0.5 秒）、立即登记并通过 storage.session 恢复 origin 冷却，以及部分覆盖诊断。2026-10-08 增加设置页基础间隔与随机浮动，逐来源存储覆盖值，并冻结每轮同步的配置。
>
> 关联：[总体计划](../../PLAN.md)、[账号系统 Spec](./account-system-refactor-spec.md)、[HydroOJ Spec](./hydroj-activity-submission-sync-spec.md)。实现以本计划定义的窗口、分页与覆盖合同为准；账号/Hydro Spec、README 和浏览器矩阵已同步更新。

> 2026-10-09 校正：当前添加/重新授权账号不自动采集；以下采集规则只在同步请求中执行。

## 1. 审查结论与本次修正

原方向可行，但按原稿直接实现，仍容易出现重复状态、漏采、死锁和多个入口不一致。本次修正如下：

| 原稿问题                                             | 修正决策                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 采集时间可选，身份探测也复用 FetchInput              | 采集边界改为必填；授权使用独立输入，复用身份 helper，不复用批量采集                 |
| 分页端口携带页码，首页与跨活动等待语义不清           | 执行器接收 origin、signal、请求回调及可选策略；是否等待按同 origin 实际派发历史决定 |
| 同步结束后才更新冷却，排队请求可以继续发出           | 429 在传输层立即登记；所有真实 HTTP 尝试发出前检查同一份冷却                        |
| 分页、Cookie、Hydro session 三种锁的职责不够明确     | 固定嵌套顺序，禁止重入；取消不能提前释放仍在运行的请求锁                            |
| complete、stopReason、hasMore 三份事实可能矛盾       | 覆盖结果使用 complete/partial 的联合类型；删除无消费方的顶层 hasMore                |
| 预算、超时、取消及部分成功处理不明确                 | 局部预算归 Adapter，任务时限归 application；用户取消和预算到期有不同提交语义        |
| 普通页、活动页的合并可能重复计数或耗尽预算后继续探测 | 统一唯一提交预算；用完停止后续活动并明确标记未访问活动                              |
| 授权后采集失败可能把有效账号禁用                     | 授权成功与提交采集成功分离，首次采集失败不撤销有效身份                              |

不引入万能分页框架、持久化游标、插件注册中心或覆盖缓存。只抽取窗口纯函数、分页执行端口、网络冷却三处真实复用，站点认证、解析和下一页规则留在各 Adapter。

## 2. 目标与接口能力边界

必须保证：

1. 同步开始时冻结用户选择的 `[since, until]`，一直使用该窗口。
2. `submittedAt > until` 的记录不进入新结果、不占记录额度、不触发单条详情请求、不入库。
3. 能可靠地给服务端传上界时使用服务端过滤；已越过所选区间时不请求下一页。
4. 相邻逻辑列表请求按该 OJ 的配置暂停（默认 `1500ms ± 500ms`），通过同 origin 队列串行执行。
5. 截断、限流、错误和未知覆盖分别反馈，不能把“没找到”冒充“范围内没有”。

**现有洛谷、QOJ、Hydro 入口从新到旧翻页。遇到晚于 until 的记录不能立即停止，否则会漏掉后面较旧的目标记录。** 没有服务端上界时，读取少量定位页仍可能必要；这些记录只能用于定位，不能继续请求其详情。倒序在越过 since 后停，升序在越过 until 后停。页序未知时不使用时间提前终止。

例如选择 10 月 1 日 10:00–11:00：倒序第一页全是 10 月 3 日，应继续定位；读到早于 10:00 的可靠边界才停止。真正省掉这些定位页需要已验证的服务器上界或稳定游标，不能靠给当前 URL 随便增加参数。

CF 保留单次最近 1000 条。AtCoder 后续修正为按已验证的 500 条批次及升序时间游标读取所选范围；若接口不能覆盖完整窗口，准确报告 partial。扩成全历史扫描不属于此次升级。

## 3. 时间与入口合同

### 3.1 有效窗口

```ts
interface SyncWindow {
  readonly since: number;
  readonly until: number;
}

interface AdapterContext {
  account: AccountConfig;
  credentials?: AccountCredentials;
  signal: AbortSignal;
  now: number; // 用于 fetchedAt 等快照时间；不能作为限流器的实时钟
  requestId: string;
  http: HttpClient;
}

type AuthorizeInput = AdapterContext;

interface FetchInput extends AdapterContext, SyncWindow {
  limit: number;
  pagination: PaginationRuntime;
}
```

- 内部采集的两端必填；仅 RuntimeMessage 的旧请求字段继续可选，在 application 入口一次性补齐。
- authorize/validateAccount 与 fetchRecent 分开输入；不要增加 `identityOnly`、`skipDetails`、`ignoreWindow` 等开关来兼容旧复用路径。
- 现有 helper 改为接收所需的最小 Context/Pick，不把 FetchInput 当所有操作的通用入参。
- 窗口使用闭区间，毫秒时间戳。所有时间戳为非负安全整数，`since <= until <= now`，且 since 不早于 `max(0, now - 35天)`。
- 非法或已过期的显式范围在网络请求前拒绝；不静默移动、交换或扩大用户范围。
- UI 解析 followNow 后发显式时间戳；后台不在翻页途中移动 until。秒级接口使用 `floor(since/1000)`，结果再按毫秒过滤。
- 时间字段无效的记录不得作为停止边界；完整性判断必须考虑可能缺失的目标记录。

### 3.2 默认采集范围

共享默认回看 **7 天**，与当前 Timeline 默认一致。该常量和采集偏好解析放在 `domain/sync-range.ts`；显示筛选仍独立。

| 调用               | 有效范围                                                   |
| ------------------ | ---------------------------------------------------------- |
| 显式 since + until | 原样校验并冻结                                             |
| 只传 since         | until = now                                                |
| 只传 until         | since = max(0, until - 7天)，随后校验最近 35 天限制        |
| 两端未传           | 解析已保存 syncRange；没有偏好时最近 7 天                  |
| 添加/重新授权账号  | 只验证身份与保存配置，不采集提交；点击同步后使用上面的规则 |

固定偏好只有在超出最近 35 天、落在未来或起止非法时才需要重新选择；一个正常的历史固定窗口不会因为 `to` 在过去就失效。采集范围失效时，同步在网络请求前拒绝；身份授权不依赖采集范围，仍可独立成功。新账号授权成功后可启用，已有账号的 enabled 选择保留；不能因初次提交采集限流、截断或范围错误自动禁用账号。

身份授权不得调用 fetchRecent 清空 since/从 0 获取历史。优先复用各站点的身份 helper；CF public-handle 使用经许可验证的轻量身份 API。确需第一页验证时单独实现有限身份探测，不发详情请求，不根据范围内有没有记录推断账号不存在。

### 3.3 账号任务与并发

- 同账号、credentialRevision、since、until、limit 完全相同才复用在途任务；参数包含关系不代表实际完整覆盖。
- 不同窗口按账号串行，不合并区间；进入执行前再次检查账号是否存在、启用及凭证版本。
- 每账号最多一个运行任务和一个不同窗口的待执行任务；相同键的调用共享 promise，超出容量返回 application-level busy，不无限排队。待执行任务也受任务时限和凭证失效取消约束。
- 新凭证取消旧任务；旧快照不能取消新任务，也不能把新任务的不同窗口结果当自己的结果。旧调用返回 superseded 并跳过写入。
- 相同键的调用者共享同一个 promise，不提供会中断共享任务的独立 waiter signal；只有任务 owner/controller 可以取消。需要独立取消时，必须先引入引用计数任务模型，不能临时给现有 promise 加 abort。
- 采集统一经内部 `collectAccount` 用例执行；授权仅由 account-service 验证/保存身份并使旧凭证采集失效，不调用该采集入口。历史授权后自动首次同步已取消，不能因复用迁移恢复。
- 采集用例返回结果，不直接修改主存储。提交结果使用一个共享的纯事务转换 helper，集中版本检查、最终过滤、merge 和同步状态更新；同步用例调用现有 storage.transact，不新增第二个 writer 或通用事件总线。
- 采用小规模函数与现有在途 Map 演进，暂不建立通用任务框架。不能在持有账号锁时递归调用会再次获取该锁的 syncOne。

## 4. 模块分工与防止代码堆积

| 模块                                      | 唯一责任                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `domain/sync-range.ts`                    | SyncWindow、默认范围、偏好解析、窗口校验和基础时间谓词           |
| `domain/adapter.ts`                       | AdapterContext/AuthorizeInput/FetchInput、分页端口和返回合同     |
| `adapters/shared/submission-window.ts`    | 已归一化页面的窗口分类与边界判断；纯函数，不请求网络、不建计时器 |
| 各 Adapter                                | 身份、URL、解析、站点页序证明、下一页/游标判断、局部页预算       |
| `platform/network/pagination-throttle.ts` | 同 origin 列表串行、抖动等待、队列清理和取消                     |
| `platform/network/rate-limit.ts`          | Retry-After 解析、唯一 origin 冷却状态和轻量持久化               |
| `platform/network/http-client.ts`         | 每次物理 HTTP 尝试的许可/冷却检查、请求、立即登记 429、有限重试  |
| `application/sync/collect-account.ts`     | 单账号任务窗口、生命周期、提交列表采集与结果汇总                 |
| `application/sync/sync-service.ts`        | 选择账号、freshness 策略、调用用例及串行事务提交                 |
| UI                                        | 显示范围、部分结果与来源诊断；不理解 OJ 页码和内部锁             |

维护约束：

- 同一规则只能有一个负责模块。Adapter 不另建 cooldown Map，不写自己的随机 sleep；application 不识别 tid、rdocs、HTML。
- 只复用已归一化字段与现有 submissionKey/mergeSubmission，不在公用模块引入 OJ 条件分支、策略继承树或 raw-record 联合类型。
- 网页 next、重登、fallback 留在站点 helper；小幅重复循环允许存在，共享业务规则必须复用。
- 网络冷却和分页间隔是不同职责：前者限制所有同源 HTTP 请求，后者只为逻辑列表请求追加配置的等待（默认 1–2 秒）。
- RateLimitRegistry 通过接口注入，storage.session 适配器只在 background 提供；HttpClient、Adapter 测试和纯领域代码不直接导入浏览器存储。
- 不为了未来功能先暴露 streamKey/page/requestClass 等无使用需求的参数；Adapter 自己记录页序，网络队列只认识 origin。

## 5. 筛选、排序与记录额度

先完整解析当前页、验证其时间顺序，再进行候选收集；不能遍历到第一条越界记录就返回。

```text
submittedAt > until            -> 跳过，不占唯一提交额度，不请求详情
since <= submittedAt <= until  -> 接受，相同 submissionKey 只计一次
submittedAt < since            -> 跳过；有可靠倒序合同才可作为停止依据
```

1. 当前页/跨页发现排序异常、无效时间或身份异常时按下文处理。
2. 范围内记录使用已有唯一提交 key 去重/merge，之后才比较 limit。
3. 明确到尾部或已跨可靠时间边界时停止；但当前页目标记录被 limit 截断，仍是 partial。
4. 还有未知目标记录但预算耗尽时 partial；只有预算充分才执行下一页。
5. 定位页不占记录额度，但仍占页预算和时间；最后一页后没有额外 sleep。

排序证据：

- 洛谷/QOJ 必须有站点合同和跨页 fixture；对单页本地 sort 不能证明后面的页面更旧。
- Hydro 按 `_id` 倒序不能直接证明 submitAt/judgeAt 倒序。停止判断必须使用已验证的提交时间合同，不以重判时间或任意 fallback 时间证明边界。
- 已观察到页序逆转时，关闭本次时间提前停止，按可靠尾部/预算结束；未知或失效排序合同不能声称根据边界采齐。
- 首次实现对无法证明排序的路径标记未知，不能为了性能默认倒序。排序异常后的 fallback 有限，不升级成无上限扫描。
- 完全重复页立刻停止并提示 partial；跨页少量重复应去重而不是直接把整个同步判成失败。
- next/pageCount 等是尾部证据；短页/空页仅在站点合同确认可靠时才算尾部。Hydro JSON 缺少 hasMore 不能直接当作结束。
- 无效目标候选、活动权限/发现失败等单独记缺口；登录页、挑战页、401/403/429、未知响应整体结构绝不能当成功空页。

## 6. 分页执行器与网络冷却

### 6.1 最小端口

```ts
interface PaginationRuntime {
  runPage<T>(input: {
    origin: string;
    signal: AbortSignal;
    request: () => Promise<T>;
    policy?: { readonly intervalMs: number; readonly jitterMs: number };
  }): Promise<T>;
}
```

一个回调代表一张逻辑列表页，含必要的同页 HTML fallback/有限重登。执行器持锁到整个回调完成；内部 helper 不再次 runPage，同 origin 重入会死锁。

正式第一页也必须通过 runPage。Hydro `fetchRecordPages` 当前的 firstResponse 参数在生产没有调用需求，应删除，避免调用者先发未经分页器调度的请求；fixture 通过模拟 HttpClient 注入响应。JSON/HTML fallback 始终在同一次页回调内取得。

在 background 创建一个生产分页器和一个 RateLimitRegistry，共享给实际 HTTP client 与所有采集入口。测试工厂注入 random、实时 clock、sleep 和冷却存储；不能在 Adapter 内临时创建分页器。正式 FetchInput 不允许缺失分页器时自动免等待。

origin 从受许可的 URL helper/实例配置规范化取得；同 Hydro 实例的普通、活动、多账号共用队列，不同实例可并行。分页器不代替 HttpClient 的 URL/权限验证。

### 6.2 精确节奏与队列状态

```ts
delayMs = Math.round(policy.intervalMs + (sample * 2 - 1) * policy.jitterMs);
// sample 为钳制到 [0,1] 的 random 值，非有限值回退 0.5。
// 默认 policy 为 { intervalMs: 1500, jitterMs: 500 }。
```

- 每个 origin 的第一张实际列表页立即执行，但仍入队。之后每张逻辑列表页发出前按策略完整暂停一次，默认 1000–2000ms。
- 不能用 page=1 免等待；新账号、新活动、重复点击同步不清空同 origin 请求历史。
- 每次继续翻页都暂停，即使解析上一页已经耗时；实际间隔还包含解析、网络与排队时间。
- 对一次逻辑页的 JSON→HTML、认证恢复、HTTP 内部重试不叠加分页暂停；请求数仍计真实尝试，局部重试保持有上限。
- 结束时不 sleep；若预算/冷却已阻止下一页，直接报告结果。身份/品牌/详情不使用分页暂停，但仍受统一网络冷却。

每个 origin 保留最小状态 `{ tail, hasDispatched, lastUsedAt }`。真正发出回调时设置 hasDispatched，失败也算已发出；等待中取消不派发。tail 完成不立即删除 hasDispatched，避免各 Adapter 解析间隙使下一页再次变成“第一页”。仅无排队/无运行操作且空闲超过 TTL 时清理；清理不影响仍有效的冷却。生产空闲 TTL 初值 10 分钟，只用于内存淘汰。

### 6.2.1 可配置策略

`domain/pagination-policy.ts` 集中默认值、范围、校验、旧数据修复及等待计算。基础间隔为 1500–600000ms，浮动上限与基础间隔上限共用 600000ms，均以 100ms 递增；必须满足 intervalMs - jitterMs >= 1000ms。浮动为 0 表示固定等待。每个来源的默认策略通过 `Record<SourceId, PaginationPolicy>` 穷尽登记，前端从现有 Adapter 注册表生成行。

Preferences 可选 `paginationBySource` 只存用户覆盖，旧 schema 2 数据无需重置。`UPDATE_PAGINATION_POLICY` 每次仅 patch 一个来源，null 删除覆盖以恢复默认；消息入口和更新用例拒绝非法值，存储读取独立丢弃损坏项。单 writer 事务保留同时修改的采集范围、账号选择和其他 OJ 设置。

同步入口按批次读取配置，在 collector 入队前复制策略；策略值参与在途任务去重，修改后新任务不误复用旧策略任务。每个 Adapter 获得绑定策略的分页端口，端口继续调用后台唯一分页器，不创建新队列。同源第一页免等待仅由共享队列状态决定。运行中不读取变动后的设置，也不改变 900 秒（15 分钟）时限、页数/记录/活动预算、429 冷却或取消收尾。设置页监听本地存储变化并丢弃旧读取回包，写入成功后更新输入值和按钮状态；行内仅显示校验或保存错误，不显示成功文案及来源状态副标题。

设置行在输入失焦后显示具体校验错误，重新编辑时收起提示，仅标红对应字段。基础间隔无效时不追加依赖它的浮动范围错误；浮动过大时提示当前基础间隔允许的实际上限。保存按钮始终按完整策略有效性启用，恢复默认或刷新已保存配置后清除旧校验提示。

### 6.3 锁与取消

```text
Hydro（如适用）：instance session queue
  -> pagination origin queue
  -> sleep（未注入临时 Cookie）
  -> request callback
     -> Cookie origin queue
     -> 必要的临时 Cookie 注入
     -> HTTP 尝试 / 恢复 Cookie
  -> 回调真正 settled 后释放 pagination queue
```

- 有限重登调用 HTTP helper，不反向取得 session/pagination 锁；所有锁顺序写入注释和测试。
- 在排队、sleep 前后、请求派发前检查信号；sleep 取消清理 timer/listener。
- 排队项可及时向调用者报告任务取消，但内部串行链仍等待前项实际完成，才跳过取消项并处理后项；取消项不能切断前项仍在持有的锁。
- 请求正在运行时，不能 Promise.race(abort) 后马上释放 tail/Cookie 锁。传 signal 给 HTTP，等回调结束及 Cookie finally 完成后再释放；否则取消可能导致请求重叠及凭证污染。
- 别把 abort catch 成空页或网络可重试；信号中止要原样传播，由 application 区分取消/预算到期。

### 6.4 429 的唯一处理路径

- HttpClient 验证 URL 后，以真实请求 origin 检查共享冷却；每次重试也要检查，不仅第一次。
- 一收到 429 响应头立即登记冷却，发生在 Adapter 解析/抛错、UI 回包、所有账号 Promise.all 完成之前。
- 一个 parseRetryAfter 解析秒数和 HTTP 日期；无有效值沿用两分钟默认。用响应时刻的实时钟，不能用同步开始时 input.now；已有冷却只延长不缩短。
- `HttpClientError` 增加 `rate_limited` code 和 `retryAfterMs` 元数据；传输层发出前被冷却阻止时也返回同一结构化错误。`AdapterFailure.fromTransport` 保留 `rate_limited`、HTTP 状态和 retryAfterMs，不能变成 generic network。
- 原始 429 继续由 Adapter 转为现有站点错误/部分结果。Adapter 不再维护冷却；删除 sync-service 的 sourceRateLimitUntil 双重状态。
- 冷却按真实 origin：kenkoooo.com 与 atcoder.jp 分开；两个 Hydro 实例分开。分页器检查同一份 registry，HTTP 是最后一道检查。
- Registry 本轮将非敏感 `{origin, blockedUntil}` 存到 browser.storage.session 并在后台入口使用前恢复，避免 worker 重启立即失去冷却。先同步更新内存，再串行写入最新快照；所有创建任务共享同一恢复 promise。禁止并发旧快照覆盖新冷却；只清理过期项，不为了容量静默撤销有效冷却。存储不可用时保留内存保护并报告降级，不声称已保证跨重启冷却。此状态不使用账号凭据和主 StoredData schema。
- 一次 429 后不得再派发该 origin 的后续活动/详情；已派发的请求可能结束，不能承诺撤回已发送请求。force 只绕过 freshness，不绕过冷却。

## 7. 预算、任务中止与部分成功

预算不放进分页器，也不让 HttpClient理解账号/活动：

| 预算                 | 负责模块与规则                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 范围内唯一提交数     | Adapter；沿用每账号最多 1000 条，范围外和重复记录不占名额                                                          |
| 单列表页数           | Adapter；洛谷/QOJ/普通 Hydro 100 页、每 Hydro 活动 5 页                                                            |
| 活动数               | Hydro；沿用最多发现/处理 50 个活动                                                                                 |
| Hydro 本轮总列表页数 | Hydro 专用预算对象；初值 100，包含普通、活动、定位及用户活动发现页，所有分支扣同一份额度                           |
| 网络尝试             | HttpClient 保留超时、大小限制、GET 最多一次重试；不将逻辑页计数冒充物理 HTTP 次数                                  |
| 单账号任务时限       | collect-account；默认 900 秒（15 分钟），含账号/session/page/Cookie 队列等待及采集；注入 clock，定时中止并分类结果 |

总页额度用完时，Hydro 不继续逐活动“试第一页”；未访问活动标记未采集/预算用尽，不显示 empty。不在本轮做公平的多列表续采调度；结果明确说明覆盖缺口。普通/活动候选在同一账号缓冲中用 submissionKey 和 mergeSubmission 合并，重复提交只占一次最终输出名额。

时限是主动停止机制，**不是 service worker 存活保证**。分页 sleep 不应持有注入后的 Cookie；实测浏览器可能中断长事件时，只能报告未完成，不能当作完整空结果。不要为了“保活”添加反复 ping；可靠跨重启续跑留到后续任务协议。2026-10-08 按用户要求将默认时限从 240 秒调整为 900 秒（15 分钟）；Chrome/Edge 实际长任务行为仍需验收。

| 结束情况                                        | 结果和写入                                           |
| ----------------------------------------------- | ---------------------------------------------------- |
| 身份不符、授权无效、账号删除/凭证替换           | 丢弃本轮结果；保留旧缓存，不更新成功时间             |
| 用户/owner 取消                                 | 丢弃本轮新结果；请求全部收尾后释放锁，不自动继续     |
| 提交扫描未完成，已验证页面后达到页数/条数/时限  | 保留已有合格记录，coverage=partial，停止新请求       |
| 可恢复网络/解析失败或 429，已有验证身份及有效页 | 保留已验证的部分记录，coverage=partial；诊断具体原因 |
| 首个有效页尚未取得就失败                        | 返回账号级 error；不能将失败变为 complete 空结果     |
| 无范围内记录但已到可靠边界/尾部且无缺口         | complete，可显示范围内无可见记录                     |

用户取消与内部任务超时通过 signal.reason/任务终止原因区分。超时后不能继续派发品牌/详情；可保留的页必须在事务前再次检查账号版本。异常路径不依赖 `records.length > 0` 才报告部分：已经观察有效空页但覆盖不足时也可能 partial。

若提交扫描已经完整，只是在可选详情/品牌补全阶段到期，保留基础记录的 complete，另报补全未完成诊断；不能把可选指标缺失误报成缺提交。

Adapter 的候选缓冲保持在单次调用内部：每页成功后累积。分页循环先分辨内部 deadline 与用户取消，再处理已分类的 `AdapterFailure`；deadline 按上述扫描/补全阶段规则返回，用户取消直接抛出。若身份已确认、至少有一页成功且失败属于后续页的网络/限流/解析问题，则将已有候选、diagnostic 和 partial coverage 作为正常 `FetchResult` 返回；首个身份页失败、身份不符和未知异常直接抛出并丢弃。不要由 application 根据空 records 猜测部分结果，也不要把中间结果存进模块全局变量。各 Adapter 可以在自己的循环中做这层很小的 catch，不能为此增加一个依赖 raw record 的通用异常框架。

## 8. 各 OJ 的实施要求

| OJ         | 本轮改动                                                                                                  | 完整性与能力约束                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Codeforces | 响应按两端筛选；继续一次最近最多 1000 条                                                                  | from/count 是偏移参数；不到可靠边界就 partial，不扩大成全历史扫描                                   |
| 洛谷       | 两端筛选→去重→limit；runPage 包住每张列表页；修正 count/perPage 尾页判断                                  | 非空页不是永远有 next 的证据；验证全局时间序                                                        |
| QOJ        | 同上；增加重复页保护，保持登录/Cloudflare/身份判断                                                        | 明确 HTML next 合同；时间格式与时区继续走当前 normalizer                                            |
| HydroOJ    | 普通/活动共用 fetchRecordPages；同页 fallback/有限重登放回调内；共享总页/唯一记录预算                     | `_id` 与归一化时间须证明；活动发现失败、漏访问、无权限都汇总缺口                                    |
| AtCoder    | 500 条升序批次按含首秒游标读取；先筛 `[since,until]`、去重及 limit，再发官网详情；无入选行跳过题名表/详情 | 短批/空批或越过 until 可判 complete；满批重读尾秒去重，同秒游标停滞、顺序异常、额度或限流则 partial |

CF：当前固定请求最近最多 1000 条，再按窗口筛选及输出 limit。少于请求 count 且合同证明尾部，或可靠倒序已经跨 since，并且无丢失候选，才 complete。满 1000 条且最旧仍不早于 since 为 partial；1000 条全晚于 until 时必须提示尚未到达所选区间。

AtCoder（2026-10-04 根因修正）：上游 [接口文档](https://github.com/kenkoooo/AtCoderProblems/blob/master/doc/api.md)、[控制器](https://github.com/kenkoooo/AtCoderProblems/blob/master/atcoder-problems-backend/src/server/user_submissions.rs) 和 [SQL](https://github.com/kenkoooo/AtCoderProblems/blob/master/atcoder-problems-backend/sql-client/src/submission_client.rs) 确认每批最多 500 条、`epoch_second >= from_second`、按时间升序。空批/短批证明读取结束；升序批跨过 until 证明范围读完。满批以最后一秒作为下一游标，重叠 ID 去重，不直接加一秒以免漏掉同秒记录；满批尾秒不能前进时 partial/unverified-coverage，禁止无限重试。翻页使用共享节流和最多 100 页/1000 条/任务时限。保持详情调度上限 4、总数不超过入选唯一记录数；生产 Cookie origin queue 可能进一步串行，这是凭证传输行为，不能把“4”描述为实际网络并发保证。429 后不领取新详情任务。详情失败或被该 origin 冷却阻止，只提示指标未补齐；已完整取得的基础提交列表不因此变为缺记录。详情缓存作为后续减压项，不塞入本轮存储迁移。

Hydro：当前仅当归一化时间来自 ObjectId 创建时间、ID/时间顺序均未异常时使用下边界停止；submitAt/judgeAt 路径继续至可靠尾部或预算。用户活动 JSON 当前只有 docId/title/rule，不能根据 ID 创建时间、标题或未经验证的日期跳过活动。发现最多 50 个但实际列表更多、发现失败或某活动失败，账号汇总不能声称覆盖了全部参与活动。

## 9. 覆盖结果的单一事实来源

```ts
type PartialReason =
  | "record-limit"
  | "page-limit"
  | "activity-limit"
  | "deadline"
  | "pagination-repeated"
  | "unverified-coverage"
  | "invalid-record"
  | "rate-limited"
  | "unavailable";

type CoverageOutcome =
  | {
      status: "complete";
      evidence: "exhausted" | "window-boundary" | "all-streams";
    }
  | {
      status: "partial";
      reasons: readonly [PartialReason, ...PartialReason[]];
    };

interface SyncCoverage {
  window: SyncWindow;
  outcome: CoverageOutcome;
  pagesFetched: number;
  acceptedRecords: number;
}
```

- partial 的 reasons 必须非空、去重；由唯一的 finalizeCoverage 函数构建。不要另存 complete 布尔值或多套成功判定。all-streams 只用于所有子列表已分别证明覆盖的聚合结果。
- 状态统计必须有唯一定义：pagesFetched 是实际派发的逻辑页数（含失败页，fallback/retry不重复计）；acceptedRecords 是最终范围内唯一输出数。
- 一张旧边界页不能覆盖之前的截断/错误；Hydro 仅所有相关列表有覆盖证据、活动发现完整、无丢失候选且最终未截断时 complete。
- complete 描述本轮接口可见范围的扫描结果，不承诺隐藏记录/其他 Hydro 域，也不保证服务端给出强一致快照。记录删除、插入造成页码移动是偏移分页的实际限制；活动/记录状态保留去重，并将已检测到的分页异常标 partial。
- FetchResult 必须带 coverage；SyncSourceResult 在账号级错误/取消时没有伪造 coverage。保留现有 AdapterError 作为错误来源。
- FetchResult 不再保留无消费方的兼容 hasMore；完整性只使用 coverage.outcome。站点分页解析中的 hasMore 继续作为下一页证据，不代表整个窗口的覆盖结果。
- 采集协调器统一执行最终过滤。若最终过滤剔除了 Adapter 越界记录，加入契约违规诊断并降为 partial，而不是过滤掉后宣称适配器正确。
- complete 才更新 lastSuccessAt；partial 保留 lastSuccessAt，stale=true，仍 merge 有效记录。身份授权不能预先写 lastSuccessAt。lastError 只来自真实 AdapterError，不虚构“上限错误”。
- freshness 的短期防重复改用现有 lastAttemptAt（包含 partial/失败），避免未采齐时因 lastSuccessAt 不更新而连续重抓；它不代表覆盖证据。手动 force 可跳过这层防重复，仍遵守分页节奏、任务容量与网络冷却。
- freshness 跳过与网络冷却阻止要作为可解释的跳过/错误结果返回，不能返回空 sources 并让前端误判成功；跳过本轮不生成 complete 覆盖证据。
- 保留已有范围外缓存；retention 独立执行，不把采集完整当作本地永久保留。response 新 coverage 为可加字段，消息 schema 2 和主存储 schema 2 不变。

UI 用 outcome 展示部分完成和缺口，即使有记录也不能显示无条件成功。旧标签页可忽略新增字段；新版 UI 面对缺失 coverage 显示覆盖状态未知，不能猜 complete。本轮 coverage 不长期存进主 StoredData，不新增 dashboard/遥测系统。

## 10. 实施顺序与验收

### P0：先确定合同和单账号入口

- [x] `domain/sync-range.ts`：SyncWindow、默认 7 天、范围解析校验。
- [x] `domain/adapter.ts`、`domain/index.ts`：必填采集边界、独立授权输入、最小分页端口及覆盖结果。
- [x] `application/sync/collect-account.ts`：复用单账号采集、终止分类与最终过滤；让 sync-service/accounts 共用。
- [x] 在途去重与事务提交：两端相同才复用，重新校验账号版本；授权保存与手动采集分离。
- [x] 共享纯事务转换 helper：complete/partial/失败的时间戳、stale、版本防线一致；授权不含采集；同步使用统一 merge 逻辑。

验收：所有适配器拿到冻结窗口；非法显式范围不发请求；授权不调用无界 fetchRecent；不同 until/凭证的任务不能串错。

### P1：窗口执行与分页网络规则

- [x] 共享页窗口纯函数；五个 Adapter 筛两端、去重、额度和可靠停止判断。
- [x] 分页器：同 origin 回调串行、抖动、可取消、空闲 TTL，锁顺序测试。
- [x] RateLimitRegistry 与 HttpClient：立即记录 429、每次真实尝试检查、session 恢复；移除同步服务重复冷却状态。
- [x] Hydro 普通/活动共享预算及缺口汇总；AtCoder 范围外不发详情，429 后停止新调度。

验收：实际请求间隔满足配置的额外暂停（默认 1–2 秒）；多个第一页不绕过规则；abort 不导致锁提前释放；未知排序不误停。

### P2：结果一致性与交付

- [x] finalizeCoverage 及各来源输出；complete/partial、lastSuccessAt/stale/授权 enabled 统一规则。
- [x] Settings/Timeline/SyncDiagnostics 和安全 DTO 展示部分完成；旧消息/标签页兼容。
- [x] 更新账号/Hydro Spec、README、QA；自动化与构建结果以最终交付记录为准。
- [ ] Chrome/Edge 真实浏览器检查完成并留存脱敏证据；本轮没有可用 Chrome/Edge 自动化表面，Hydro live 集成未运行。

P0–P2 构成一次完整交付；可以分步骤提交代码，但不在生产同时启用半套新合同。无需为此引入永久双实现或长期 feature flag。

## 11. 必测矩阵

自动化注入 clock/random/sleep，使用 fake timers 和模拟 HTTP，验证实际请求序列，不对真实站点循环压测。

| 测试        | 验收行为                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| 边界/兼容   | 等于 since/until 保留，前后 1ms 排除；秒级参数不漏边界；旧消息补默认值                                |
| 定位/停止   | 多页全晚于 until 后仍找到目标区间；倒序跨 since 后零后续请求；未知顺序不误停                          |
| 页序证据    | 单页本地 sort 不改变全局证明；跨页逆序、重复页、Hydro 时间 fallback 不伪造完整                        |
| 记录/页预算 | 范围外不占记录名额但占页数；同 ID 跨入口计一次；页内/最终截断、未访问活动均 partial                   |
| 节奏        | random=0/0.5/1 为1000/1500/2000ms；连续页、新账号/新活动首页都遵守；最后一页无额外等待                |
| 队列/锁     | 同源回调不重叠；不同源可并行；解析间隙不会重置队列；fallback/重登不重入                               |
| 取消        | 排队/sleep/HTTP/Cookie恢复各阶段取消；调用者返回取消后队列仍等真实收尾；后项不受失败污染              |
| 429         | 响应头返回即阻止后续请求，非等待 Promise.all；Retry-After 两种格式、不同 origin 隔离、worker 重启恢复 |
| 任务结束    | 用户取消丢弃新结果；deadline保留有效部分；初始失败不complete；账号版本不符丢弃                        |
| 授权/状态   | 有效身份不因首次partial禁用；授权不能更新lastSuccessAt；complete/partial状态与UI一致                  |
| AtCoder     | 越界记录的详情 URL 不出现；空入选集无元数据请求；详情429不再领取任务，列表完整性独立                  |
| CF          | 满1000条没到边界partial；定位不到的零结果不显示完整空结果                                             |
| 前端/存储   | 旧缓存保留；旧标签页新增字段兼容；session冷却恢复与主存储schema无关                                   |

建议扩展现有 adapters、application/sync、accounts、messaging、platform/http 测试；新增窗口和分页器/冷却模块测试。不要让 sleep 在测试中默认免执行；纯 Adapter fixture 可注入立即执行器，完整节奏必须由真实分页器 + fake timers 单独验证。

项目验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm audit:manifest`，以及修改文件格式检查。窗口、分页器、冷却、适配器、账号竞态与覆盖状态已有自动回归；最终通过数量与构建结果以交付时运行输出为准，不使用原审计基线冒充升级验收。

2026-10-04 最终运行：298 项测试通过，1 项 opt-in Hydro live 测试跳过；上述命令和全仓/文档格式检查通过。整合复查补齐了清空操作对运行及已完成结果的代际失效、清空后立即重试、较旧授权晚返回不能覆盖新凭据、取消/缺失来源提示，以及 HTTP 响应体取消和 Cookie 恢复的完整锁收尾；这些行为均有回归测试。代际只存在于后台任务内存，不进入主存储或响应 DTO。

Chrome/Edge 实测：后台网络间隔、停止页、范围外详情为零、同实例跨活动、账号重授权/取消、长事件中断及worker重启冷却。浏览器实测不使用 fake timers；未完成项不能标通过。

还必须覆盖任务容量/busy、partial 后短期防重复、session 存储写失败及旧快照竞态；worker 无法返回结果时 UI 显示同步中断，不能显示成功。

## 12. 后续扩展与完成条件

后续单独设计：服务端上界/稳定游标定位、AtCoder题名/详情缓存、覆盖缓存、跨worker短批次任务。必须处理同秒提交、页码漂移、凭证/权限变更、retention/清空失效与重判；不持久化裸页码就宣称可靠续采。

本轮完成检查：

- [x] 结束时间进入所有正式采集入口；范围外不新增详情请求和入库记录。
- [x] 停止规则依页序证据，不因until误停倒序第一页。
- [x] 分页、冷却、覆盖判定各只有一个实现和唯一状态来源。
- [x] 同源第一页不会绕过节奏，取消不提前释放Cookie/请求锁。
- [x] 预算/未知覆盖有明确partial；授权与采集成功、指标与记录完整性分开。
- [x] 身份版本、旧缓存、现有消息及存储合同保留；单账号入口不重复业务逻辑。
- [x] 自动化回归验证实现合同；没有新增全历史扫描、万能采集框架或持久化游标。
- [ ] Chrome/Edge 真实验收通过，包括网络节奏、长事件中断和 worker 重启冷却。
- [ ] 升级后的真实 Hydro HTTP 集成使用授权测试实例显式重跑，或在发布记录中明确未运行。

代码已按上述边界实施，剩余发布前工作是真实浏览器验收和显式 live 集成。主要复杂度集中在有必要的并发和站点合同上。若实现需要不断给公共接口添加 OJ 专用开关，应回到 Adapter helper 修正职责，而不是扩大公共框架。
