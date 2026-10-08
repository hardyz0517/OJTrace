# HydroOJ 指定域提交与站点图标同步 Spec

> 状态：2026-10-04 已升级时间窗口、共享预算、分页节奏、覆盖结果和指定域采集；自动检查及指定域真实 HTTP 集成已通过，Chrome/Edge 扩展人工验收待完成。主域真实流程回归返回空窗口并含活动警告，不能作为采到提交或完整覆盖的证据。
>
> 范围：每个账号绑定一个实例的默认域或明确指定域，采集普通题库记录、参加过的比赛/作业记录和该域首页图标；实例名称手动填写。
>
> 参考源码：Hydro `7c960fad63a6d19169a9cc8a525732b2b9bf9464`。
>
> 账号授权、凭证和单 writer 存储合同见 [账号 Spec](./account-system-refactor-spec.md)。

## 1. 已确认的服务端合同

普通 `/record?uidOrName=<uid>` 默认排除比赛/作业记录。活动记录仍使用 Record 模型，通过 `contest` 字段关联活动。

用户详情 `/user/<uid>` 在当前 Hydro 域查询已参加活动：

```ts
const tsdocs = await ContestModel.getMultiStatus(domainId, {
  uid,
  attend: { $exists: true },
})
  .project({ docId: 1 })
  .toArray();
const tdocs = await ContestModel.getMulti(domainId, {
  docId: { $in: tsdocs.map((i) => i.docId) },
})
  .project({ docId: 1, title: 1, rule: 1 })
  .toArray();
```

活动查询统一使用：

```text
GET /record?uidOrName=<verified UID>&page=<page>&tid=<ObjectId>
```

比赛入口为 `/contest/<tid>`，作业入口为 `/homework/<tid>`。RecordListHandler 按 `{contest:tid,uid:resolvedUserId}` 查询，并按 `_id` 降序。

HTML 记录是 `record_main` 中的 `tr[data-rid]`；Accept: application/json 可返回含 `page, rdocs, tdoc, pdict` 的 response body。不能把 JSON 中没有 hasMore 当作没有下一页。

活动权限受是否参加、记录可见性、比赛状态等控制。单活动记录页的 403 是当前账号无权读取，静默跳过，不视为采集错误；404/格式错误仍是无法读取。有效空列表只表示当前账号、当前范围没有可见记录，不能推断用户从未提交或活动隐藏。

## 2. 域范围边界

网站传输范围 `origin` 与 Hydro 内部数据范围 `domainId` 分开持久化。`createHydroOJInstance` 是输入规范化入口：根地址得到 `{origin}`，`/d/student/` 得到 `{origin, domainId:"student"}`，也接受无末尾斜杠的域地址。未指定 domainId 表示该网站默认域，不猜测其 ID 一定是 `system`。

- 每个绑定只请求对应域，所有首页、登录、用户、普通和活动记录请求复用同一前缀；例如 `/d/student/record?uidOrName=<uid>&page=<page>&tid=<tid>`。
- 不枚举 `/d/<domainId>`，不传 `allDomain=1`，不从记录中的 domainId 改变采集范围。
- 不扫描全部比赛列表，只发现用户页提供的已参加活动。
- origin 可以是已验证的 HTTP 或 HTTPS 根地址；输入仅接受根路径或 `/d/<id>/`，拒绝页面地址、query、fragment、嵌入凭证、点段、反斜杠及编码后的路径分隔符。显式 domainId 与地址冲突时拒绝。
- 域 ID 使用统一校验 `[A-Za-z0-9_-]{1,64}`；这是客户端输入边界，不保证服务器存在该域。授权通过所选域首页确认真实 UID 与访问权限，403/404 不授权。
- 账号身份按 origin + 可选 domainId + UID 隔离，同网站多个域需分别绑定；记录归属、图标缓存和导航也按域隔离。默认域不与任一显式域自动合并。
- 网站权限、Cookie、会话队列、分页节奏和 429 冷却仍按纯 origin 共用，不能因切换域绕过限流或并行切换密码账号。
- 第三方 CDN 图标不自动申请权限或下载。

Hydro 源码在 domain middleware 提取并剥离 `/d/<id>/` 后执行原路由，因此无需复制各域采集实现。域 URL/导航判定共用 `domain/hydro-scope.ts`。成功响应的最终 URL 必须仍属于所选域；HTML 含 UiContext 时检查其 domainId，显式域 JSON 记录若带不同 domainId 则整轮拒绝。域别名或站点跳转回默认域不静默接受，需使用服务器规范域地址重新绑定。应用提交 guard 和存储加载再次检查记录的 origin/domainId 与账号一致，禁止把其他域数据标成当前域。

## 3. 模块职责

| 文件                                    | 责任                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `hydroj/index.ts`                       | Adapter metadata、授权、统一同步入口和输出预算         |
| `hydroj/session.ts`                     | 身份解析、密码登录、请求、JSON/HTML fallback、实例队列 |
| `hydroj/records.ts`                     | 普通/活动共用分页、归一化和同源导航链接                |
| `hydroj/activities.ts`                  | 已参加活动发现、逐活动采集和部分成功诊断               |
| `hydroj/parser.ts`                      | 纯 HTML/JSON 活动和记录解析                            |
| `hydroj/normalizer.ts`                  | 稳定提交 ID、时间、状态、分数和指标                    |
| `domain/hydro-scope.ts`                 | 域 ID 校验、域路径构造和导航范围判定                   |
| `hydroj/instance.ts`                    | 实例/域地址规范化和各请求 URL                          |
| `hydroj/branding.ts`                    | 所选域首页解析和受限图标读取                           |
| `domain/activity-schedule.ts`           | 活动时间观察、窗口排除、24 小时缓存合并和淘汰          |
| `application/sync/instance-branding.ts` | 刷新时机、同实例同域在途刷新合并                       |
| `domain/instance-branding.ts`           | 缓存字段合并和淘汰                                     |
| `domain/merge.ts`                       | 唯一提交 merge 和 retention 实现                       |

不要为比赛和作业复制两套 parser、normalizer 或分页循环。通用 UI 只读取 activity*、branding 和 diagnostics，不了解 tid、tdocs 或 Hydro 登录协议。

## 4. 身份与请求流程

Hydro canonical providerAccountKey 是真实数字 UID，用户名仅为 displayName。

1. 所选域首页确认当前会话 UID；password 在缺失/不匹配时 POST 域内 /login，并显式携带 redirect 指向所选域首页，避免受 Referer 影响。授权登录成功后再次验证该域访问及 UID。
2. 已保存的 UID 与会话不符：browser-session/manual-cookie 报 identityChanged；password 登录自己的账号并再次验证。
3. 抓取普通记录，再发现并逐个抓取活动记录。
4. 每页先按冻结闭区间 `[since, until]` 筛选，再以 submissionKey/mergeSubmission 合并到普通与活动共用的唯一记录缓冲；范围外不占额度。最终按提交时间降序输出。
5. 应用层独立刷新实例品牌、提交版本匹配的结果。

同 origin（包含不同 domainId）的 authorize、fetchRecent、fetchInstanceBranding、detectBrowserSession 共用 session queue，避免两个密码账号在后台互相切换会话。账号服务在提交时校验 credentialRevision，删除/凭证替换不能被旧结果覆盖。

普通/活动分页中的登录页可触发 password 重新登录一次，并确认返回 UID 未改变。活动发现会话失效同样可重试一次。取消信号贯穿请求；用户/owner 取消丢弃本轮结果，内部 900 秒（15 分钟） deadline 在已有验证页时返回 partial，首个有效页之前失败仍为账号级错误。

## 5. JSON 与 HTML 解析

用户活动 JSON 合同为 `{tdocs:[{docId,title,rule}]}`：

- docId 必须是 24 位 ObjectId，title 为非空文本。
- 无效条目跳过，并返回 activity-invalid 诊断；重复 tid 只查询一次。
- homework 规则为作业；已确认 oi/ioi/acm/noi/codeforces 为比赛；未知规则为 other，展示“活动”，不猜活动详情 URL。
- HTML fallback 读取同源且同域的 contest/homework 链接，解码实体，去除活动徽章，过滤无效 ID/外部链接/其他域链接。

记录 JSON 合同为 `{page:number,rdocs:object[],pdict?:object,tdoc?:object}`。未知整体形状 fallback HTML，挑战页/登录页不能被当成空记录。

pdict 按记录 pid 补题名，显示题号优先 pdoc.pid，然后 docId；题目路径使用 docId/原始 pid。活动题目链接带 tid，提交详情链接为域内 /record/<rid>。普通、活动、题目、记录详情、列表回退及 OJ 首页链接均保留指定域前缀，不能只检查同源。

HTML 复用 record_main 合同，读取状态、分数、题名、时间、内存、语言和 data-timestamp；链接中的 &amp; 解码。两条路径归一到 HydroOJRawRecord，再走同一个 normalizer。

时间合同：

- 有效 submitAt 优先；
- 否则取 ObjectId 前 8 位的创建时间；
- 不以 judgeAt fallback；缺少有效提交时间和 ObjectId 时拒绝记录；
- 重判时间不能改变正常记录的时间线位置。

JSON time 是 ms、memory 是 KiB（真实 HTML 同一记录验证）；HTML B/KiB/MiB/GiB 换算到统一 memoryKb。缺失指标保持 undefined，不把破折号解析为 0。

verdict 与 score 分离。UI 对 Accepted/100 显示两行并复用统一状态颜色。Hydro 当前状态枚举中 `7` 是 Compile Error，`5` 是 Output Exceeded；Adapter 按该枚举映射，不能把旧版编号表当作合同。未知状态保留 raw，不能根据分数猜 Accepted。Hydro 内置语言键映射为站点展示名（例如 `cc.cc20o2` → `C++20(O2)`）；未知自定义语言保留完整键，紧凑 UI 在映射后仅显示前 5 个字符。JSON 中 uid 与当前 UID 不符的记录不入库。

## 6. 分页和预算

采集范围由 application 一次解析冻结，默认最近 7 天，后台限制最近 35 天；上下界均为必填毫秒时间戳，闭区间端点保留。普通列表与活动列表均执行上下界，旧缓存的保留策略独立于本轮窗口。

| 预算                                     | 上限                        |
| ---------------------------------------- | --------------------------- |
| 普通记录页数                             | 100                         |
| 普通、活动、定位和活动发现的共享逻辑页数 | 100                         |
| 实际探测的已参加活动数                   | 50（缓存排除不占名额）      |
| 每活动页数                               | 5                           |
| 全账号唯一输出记录                       | min(1000, FetchInput.limit) |
| 单账号任务时限                           | 900 秒（15 分钟），包含各队列等待      |

每张逻辑页经过共用的 origin 分页器；同页 JSON→HTML fallback 与有限重登在一个回调中完成。该实例的第一张列表页入队后立即执行，后续页（包括另一账号、新活动第一页和用户活动发现）按 HydroOJ 的分页策略额外等待，默认 1500ms ± 500ms。所有实例共用 HydroOJ 设置，不同 origin 的队列仍隔离；本轮配置冻结，设置修改从下一轮同步生效。最后一页后不等待。锁顺序为 instance session → pagination → Cookie → HTTP，等待发生在临时 Cookie 注入前，取消不提前释放仍在收尾的请求锁。

HTML 使用明确 next 链接，JSON 使用明确分页信息或继续至有效空页；缺少 hasMore 或短页本身不能证明尾部。服务端只证明 `_id` 倒序，因此仅当归一化时间确实来自 ObjectId 创建时间、ID/时间顺序均未逆转时使用早于 since 的停止边界；submitAt、judgeAt 或排序异常路径不据此提前结束。晚于 until 的页面用于定位，不能直接停，否则会漏掉后面的目标记录。

完全重复页停止并标 partial；少量重复只合并，不占第二个名额。共享页/记录预算用完后停止新活动请求，未访问活动标 unvisited/缺口，不能标 empty；收到 429 或 deadline 后同样停止后续活动。用户活动元数据只有 docId/title/rule，且按创建 ObjectId 倒序，不是结束时间顺序；不能根据标题、ID 或遇到一个旧活动就停止后续活动。

### 6.1 活动时间缓存与请求优化

首次或缓存过期时仍使用现有活动记录第一页，不另开详情请求或复制分页。JSON 响应包含 `tdoc`，解析其 docId、rule、beginAt、endAt；要求 ID 与请求 tid 一致，显式域的 domainId 字段若存在必须匹配，时间是带时区的 ISO 字符串且 beginAt < endAt，规则属于已核实的 Hydro 内置规则。缺失、未知或非法时间不猜测，继续既有记录采集。

作业的 penaltySince 是开始扣分时间，排除依据必须是包含延期的最终 endAt。已验证时间满足 `endAt < since` 才排除（不是固定写死 now - 35 天）；endAt 等于 since 不排除，扩大到最近 35 天必须重新计算。只排除过去已结束活动，不因未来开始时间而跳过。

每个成功解析的活动第一页输出最小 ActivityScheduleRecord：source="hydroj"、origin、domainId?、activityId、checkedAt、可选 beginAt/endAt。不缓存响应全文、权限判断、账号记录边界或用户名。缓存共享活动本身的时间，不共享不同账号的提交、UID 或覆盖结论。观察到时间缺失或提交时间与活动区间矛盾时，写入未知时间观察以撤销旧结束依据；网络、403/404/429、未验证响应不产生成功观察。

当页内记录身份和时间均通过验证、且与活动区间没有冲突时，新取得的 endAt 可证明当前窗口无后续活动提交，停止额外活动分页；其他路径继续现有 ObjectId 边界或尾页判定。用户取消/身份变更丢弃本轮所有记录和观察，deadline 可提交已验证的部分结果。

缓存 key 为无歧义 source/origin/可选域/activityId tuple，默认域与显式域隔离。storage.local 持久化，跨 service worker 重启有效；最多 512 个观察，按 checkedAt 淘汰。加载时校验、重建 key，损坏只丢缓存；新观察完全替换同项，不把旧 endAt 合并回缺失时间的新观察；更早 checkedAt 不覆盖更新观察。缓存写入与记录合并共用 storage 单写者事务和账号版本/generation 保护。清空账号/全部数据清缓存，单账号删除和清空提交可保留共享活动时间；容量写入失败允许丢弃活动/图标缓存重试，不牺牲账号和提交。

缓存寿命固定 24 小时，自上次真实成功读取第一页算起；命中不刷新 checkedAt，系统时间回退或未来检查时间不算新鲜。每轮先发现所有已参加活动，逐项按本轮窗口排除新鲜历史缓存，再以 50 个实际探测、100 张共享逻辑页和 deadline 限制请求；缓存排除不占请求/探测名额。命中计为已处理活动，预算未访问项不计已完成。

缓存命中属于正常的范围外活动排除，不构成覆盖缺口，不增加 partial 原因；没有其他缺口时 coverage 为 complete（all-streams），正常更新 lastSuccessAt/stale。保留 info 诊断 cached-outside-window 供活动详情和测试查看，但不显示黄色警告、“历史活动未实时复查”或延期提醒。同步完成表示按当前窗口及有效缓存策略完成，不承诺实时核查每个历史活动；用户接受缓存有效期内不关注旧活动延期/重新开放，原有 24 小时寿命、域隔离、时间验证和窗口扩大重算保持不变。

Timeline 只提供普通同步，不提供忽略活动缓存的按钮或菜单入口。普通 force 同步不忽略活动缓存；缓存过期后的下一次同步重新探测活动。内部 SYNC_REQUEST 的 recheckActivities 可选布尔值仍透传到 FetchInput，用于诊断和测试：忽略本轮活动缓存并绕过账号 freshness，但不绕过预算、域隔离、分页节奏、429 或权限，依然可能返回 partial。collector 的在途合并 key 包含复查模式，内部完整复查不得附着到使用缓存的任务。

HttpClient 对每次真实尝试检查同一份 origin 冷却，429 响应头立即登记 Retry-After（无效时默认两分钟），不同实例隔离。非敏感 `{origin, blockedUntil}` 使用 storage.session，在 service worker 重启后恢复；写失败保留内存保护并报告降级。手动 force 不能绕过分页节奏、冷却和预算。

FetchResult.coverage 是唯一覆盖事实：普通列表与所有可读取、未被有效历史缓存排除的发现活动均有结束证据、发现完整且无失败/预算/丢失时才为 complete（all-streams），否则 partial 并给出非空原因。单活动记录页明确返回 403 的活动排除于本轮可读取范围，不因此标 partial；complete 不声称拥有该账号无权读取的记录或已实时复查范围外活动。不保留冗余的 FetchResult.hasMore；分页解析器的 hasMore 仍用于判断下一页。已验证记录可在后续网络、解析、限流或 deadline 问题时保留；身份不符和用户取消仍丢弃本轮新增记录。只有 complete 更新 lastSuccessAt，品牌补全失败独立诊断。

## 7. 活动元数据和合并

Submission 的可选字段：

```ts
activityId?: string;
activityName?: string;
activityType?: "contest" | "homework" | "other";
activityUrl?: string;
```

提交 key 仍为 source + accountId + submissionId，不含 activityId。domain/merge 保留非空活动信息，新值缺失不清空旧值；两个非空 ID 冲突保留首次值。Adapter 在同轮候选中发现冲突会报告 activity-conflict。

题目/提交链接和活动入口相互独立。时间线只有一个 row 展示实现，点击行打开记录，点击题目/活动打开对应页面，复制按钮独立；不嵌套 a 或 button。无记录链接时也保留真实 verdict、题名和活动信息。

“每题最后一次”只影响展示，不参与采集、merge、retention 或提交身份。

## 8. 部分成功与诊断

Diagnostic 包含 source、code、severity、messageKey、retryable，以及可选 activityId/activityName/status。

活动状态为：

- synced：已采集；
- empty：当前时间范围无可见记录；
- auth-required：会话失效；
- unavailable：404、网络或解析失败；
- truncated：本次预算已用完。
- cached-outside-window：根据 24 小时内缓存的最终结束时间排除，正常 info 状态；
- unvisited：受预算/限流/时限影响，本轮尚未探测。

无活动发现权限、未知用户页或单活动失败保留普通记录及其他成功活动。身份失败或首个有效普通记录页之前失败产生账号级 AdapterError；后续页面的已分类失败可以保留已有验证记录并返回 partial。

仅单个比赛/作业记录请求的 HTTP 403（blocked/request）静默排除，不写活动诊断、不新增 unavailable 原因，计入已处理活动并继续后续活动；没有其他缺口时结果仍为 complete。第一页或后续分页被拒绝均适用，已采到的记录和此前真实解析/数据错误保留，不伪装为 empty/synced，也不缓存权限结论。403 若被识别为登录页、重新登录失败、身份变更、用户取消或 deadline，仍走对应错误路径；401、404、429、网络、超时、解析错误不吞掉。首页/授权失败仍为账号级错误；活动发现阶段及普通列表 403 保持原有错误或 partial 语义。

SyncSourceResult 和首次授权响应都透传本次 diagnostics 和可选 coverage；没有 coverage 时 UI 显示覆盖未知。Settings/Timeline 共用 SyncDiagnostics 展开列表，显示具体活动名称和状态。诊断不长期塞入账号级 SyncState；重新打开页面后旧活动诊断不保证保留。

## 9. 站点名称和图标

名称由账号的 label 手动填写，未填写使用 HydroOJ。不再解析 og:site_name/application-name/title 或 hostname 作为名称，图标缓存的 name 保持 HydroOJ。label 只用于展示，不参与身份和权限，也不替换用户名。

图标按 rel/sizes/type 发现并排序：

- 优先接近小尺寸 favicon 的同源 icon；
- 支持 shortcut icon/apple-touch-icon；
- 同源 fallback 包括 favicon.ico 和 Hydro 常见 favicon PNG；
- 相对 URL 基于所选域首页最终 URL；过滤外部 URL、凭证 URL、无效格式；
- 最多尝试 8 个候选，每个最大 64 KiB；
- 支持 PNG/JPEG/GIF/WebP/ICO，同时验证 MIME 和文件签名；
- SVG 暂不接受；
- HttpClient 用流式 maxBytes 限制读取，再生成缓存 data URL。

首页响应校验 origin 和所选域；图标资源可能位于网站根路径，因此只检查最终 origin，不强制图标本身带域前缀。网络允许必要跳转，不把最终检查写成“保证跳转前预阻止”。图标失败不会影响提交；没有可用缓存图标时 OJLogo 使用内置 Hydro 图标。解析图标成功不表示账号认证成功。

## 10. 品牌缓存和展示

InstanceBrandingRecord 为 source、origin、domainId?、name、iconDataUrl?、fetchedAt、iconFetchedAt?。缓存 key 使用与身份模块一致的无歧义 source/origin/可选 domainId tuple。

- 首次授权采集；普通同步仅在没有缓存或超过 7 天时刷新。
- 同实例同域的多个账号共用缓存和在途刷新；不同域独立，不能回退使用另一个域的图标。
- 图标获取失败保留该域旧图标，手动 label 不受刷新影响。
- 缓存最多 32 个范围、约 2 MiB；按 fetchedAt 淘汰旧项。
- 缓存损坏被丢弃，不影响账号/提交加载。
- storage 写失败可清空可丢弃缓存重试，不牺牲账号/记录持久化。
- 单账号删除可保留品牌；清空账号/全部数据同时清缓存。
- OJLogo 本地 data URL 加载失败回退；统一 OJName 被列表和时间线复用。
- OJ 筛选仍固定 HydroOJ；实例品牌不参与身份、权限或来源判断。

## 11. 验证和已知限制

自动化覆盖 HTML/JSON、活动类型、真实 pdict 形状、tid/UID 参数、分页、重判时间、内存单位、去重、部分失败、密码重登录、实例会话串行、缓存和账号竞态。

活动权限回归覆盖单个/全部活动 403 静默排除、首/后续页拒绝、已验证记录和真实错误保留、已处理进度、不缓存权限；401/登录页/404/429/500 仍报告错误，429 停止后续请求，活动发现与普通列表 403 不静默排除。

活动缓存回归覆盖首次复用第一页、24 小时过期/未来时间、最终作业 endAt、延期与记录矛盾、窗口扩大/相等边界、未知规则/缺失日期/不同域元数据、缓存名额与共享预算、缓存缺失降级、内部完整复查模式隔离、取消/账号替换/删除、跨重启加载、损坏与容量失败降级。只有正常缓存排除时应为 complete 并更新 lastSuccessAt，缓存 checkedAt 不延长；混合真实错误时保留对应 partial 原因。UI 不因缓存排除标黄或提示复查、不提供活动复查入口，普通同步继续请求全部所选账号且不绕过活动缓存。live 测试可用 OJTRACE_HYDRO_TEST_ACTIVITY_CACHE=1 比较两轮实际页数，要求至少一个真实历史活动缓存命中，不用零活动冒充优化成功。

指定域回归额外覆盖输入歧义和 runtime 域 ID 校验、普通/比赛/作业分页前缀、登录 redirect、跨域响应拒绝、403/404、同网站不同域密码会话串行、同 UID 分域绑定和删除隔离、提交 guard/存储隔离、图标缓存与在途刷新隔离、UI 权限仅申请纯 origin。

tests/integration/hydroj-live.test.ts 从环境注入地址/用户名/密码，默认跳过。OJTRACE_HYDRO_ORIGIN 接受根地址或域地址；OJTRACE_HYDRO_REQUIRE_RECORDS=1 要求窗口内非空，不能用空列表冒充采到数据。真实凭证不写入仓库。

2026-10-04 指定 student 域实测：UID 1100，最近 35 天取得 30 条普通记录，所有导航链接保留域，清空会话后自动重登（共 2 次登录），图标读取成功且无警告。该域返回零已参加活动，因此域内比赛/作业仅有合同测试，不能声称已获真实活动记录。

同日主域真实回归完成身份验证、会话失效重登、17 个活动探测和图标读取；窗口内取得 0 条记录，3 项活动警告。非空断言因此失败，关闭非空要求后的流程检查通过；这不证明主域有可采提交或完整覆盖。2026-10-02 主域普通/比赛/作业非空记录属于此前版本证据。

2026-10-04 活动时间缓存升级真实 HTTP 回归：主域发现 17 个活动，14 个活动生成时间观察，第二轮命中 13 个历史活动，列表逻辑页由 19 降至 6（减少约 68%）。3 个不可读取活动仍重试并报告警告；窗口内记录为 0，这项证据只证明活动排除与请求减少，不证明非空记录采集或完整覆盖。两轮都有完整会话和 origin 分页器，真实 Chrome 扩展 Cookie/消息仍须浏览器验收。

首次采集默认最近 7 天，仅可选择最近 35 天内范围；更旧的活动提交不属于本轮可同步范围。每次采集有保护上限，达到预算将明确返回部分完成。

尚未完成本机 Chrome/Edge 权限弹窗、扩展重启和活动链接人工验收；见 docs/qa/browser-matrix.md。没有把这些检查标为已通过。

## 12. 维护规则

- 一个 parser/normalizer、一套分页、一套领域 merge；新增题目/活动字段先补脱敏合同测试。
- 只维护 verified UID 这一份 Hydro 身份。
- 活动参数留在 Adapter，UI 和 storage 只认识稳定 DTO。
- 域是明确的账号范围，不通过活动/记录/图标猜测。以后增加自动多域发现时组合现有单域采集，不复制分页和登录实现；身份/共享会话/覆盖结果合同须先更新。
- 不提前创建跨 OJ 活动框架或品牌插件系统。
- 以后增加第二个 OJ 活动实现，再按真实复用抽象。
- 改预算、时间、权限或身份合同，同时更新对应测试和本 Spec。

## 13. 参考资料

- [Hydro `user.ts`：用户活动 `tdocs` 查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/user.ts)
- [Hydro `record.ts`：`tid`、`uidOrName` 和 `contest` 查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/record.ts)
- [Hydro `contest.ts`：活动详情和活动记录查询](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/handler/contest.ts)
- [Hydro 用户活动模板](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/partials/user_detail/activity.html)
- [Hydro 活动侧栏中的“我的提交”链接](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/partials/contest_sidebar.html)
- [Hydro `html5.html`：`og:site_name` 和 favicon 声明](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/ui-default/templates/layout/html5.html)
- [Hydro `base.ts`：`UiContext.cdn_prefix` 和当前域上下文](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/packages/hydrooj/src/service/layers/base.ts)
- [Hydro `framework/base.ts`：Accept/noTemplate JSON 响应分支](https://github.com/hydro-dev/Hydro/blob/7c960fad63a6d19169a9cc8a525732b2b9bf9464/framework/framework/base.ts)
- [Chrome 扩展 service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome `storage` API](https://developer.chrome.com/docs/extensions/reference/api/storage)
