# HydroOJ 主域提交与站点品牌同步 Spec

> 状态：已实施，2026-10-02。真实 HTTP Adapter 集成通过；Chrome/Edge 扩展人工验收待完成。
>
> 范围：账号绑定实例的根域上下文，普通题库记录、参加过的比赛/作业记录和实例名称/图标。
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

活动权限受是否参加、记录可见性、比赛状态等控制。403 是无权读取，404/格式错误是无法读取；有效空列表只表示当前账号、当前范围没有可见记录，不能推断用户从未提交或活动隐藏。

## 2. 主域边界

这里的实例 origin 是账号绑定的规范根地址，不是 Hydro 数据模型的 domainId。

- 只请求当前实例根路径的默认 Hydro 域上下文。
- 不枚举 `/d/<domainId>`，不传 `allDomain=1`，不从记录中的 domainId 拼 URL。
- 不扫描全部比赛列表，只发现用户页提供的已参加活动。
- origin 可以是已验证的 HTTP 或 HTTPS 根地址；路径、query、fragment 和嵌入凭证被拒绝。
- 多个独立实例按 origin 隔离账号、权限和品牌。
- 第三方 CDN 图标不自动申请权限或下载。

未来多域支持需要独立的 domain scope、身份和导航合同，不能在本功能添加隐式开关。

## 3. 模块职责

| 文件                                    | 责任                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `hydroj/index.ts`                       | Adapter metadata、授权、统一同步入口和输出预算         |
| `hydroj/session.ts`                     | 身份解析、密码登录、请求、JSON/HTML fallback、实例队列 |
| `hydroj/records.ts`                     | 普通/活动共用分页、归一化和同源导航链接                |
| `hydroj/activities.ts`                  | 已参加活动发现、逐活动采集和部分成功诊断               |
| `hydroj/parser.ts`                      | 纯 HTML/JSON 活动和记录解析                            |
| `hydroj/normalizer.ts`                  | 稳定提交 ID、时间、状态、分数和指标                    |
| `hydroj/instance.ts`                    | 实例 origin 和各请求 URL                               |
| `hydroj/branding.ts`                    | 根页品牌解析和受限图标读取                             |
| `application/sync/instance-branding.ts` | 刷新时机、同实例在途刷新合并                           |
| `domain/instance-branding.ts`           | 缓存字段合并和淘汰                                     |
| `domain/merge.ts`                       | 唯一提交 merge 和 retention 实现                       |

不要为比赛和作业复制两套 parser、normalizer 或分页循环。通用 UI 只读取 activity*、branding 和 diagnostics，不了解 tid、tdocs 或 Hydro 登录协议。

## 4. 身份与请求流程

Hydro canonical providerAccountKey 是真实数字 UID，用户名仅为 displayName。

1. 根页确认当前会话 UID；password 在缺失/不匹配时 POST /login。
2. 已保存的 UID 与会话不符：browser-session/manual-cookie 报 identityChanged；password 登录自己的账号并再次验证。
3. 抓取普通记录，再发现并逐个抓取活动记录。
4. 统一按提交 ID merge、时间降序和稳定 key 排序，最后截取输出上限。
5. 应用层独立刷新实例品牌、提交版本匹配的结果。

同实例 authorize、fetchRecent、fetchInstanceBranding、detectBrowserSession 共用 session queue，避免两个密码账号在后台互相切换会话。账号服务在提交时校验 credentialRevision，删除/凭证替换不能被旧结果覆盖。

普通/活动分页中的登录页可触发 password 重新登录一次，并确认返回 UID 未改变。活动发现会话失效同样可重试一次。取消信号贯穿请求，取消不是部分成功。

## 5. JSON 与 HTML 解析

用户活动 JSON 合同为 `{tdocs:[{docId,title,rule}]}`：

- docId 必须是 24 位 ObjectId，title 为非空文本。
- 无效条目跳过，并返回 activity-invalid 诊断；重复 tid 只查询一次。
- homework 规则为作业；已确认 oi/ioi/acm/noi/codeforces 为比赛；未知规则为 other，展示“活动”，不猜活动详情 URL。
- HTML fallback 读取同源 contest/homework 链接，解码实体，去除活动徽章，过滤无效 ID/外部链接。

记录 JSON 合同为 `{page:number,rdocs:object[],pdict?:object,tdoc?:object}`。未知整体形状 fallback HTML，挑战页/登录页不能被当成空记录。

pdict 按记录 pid 补题名，显示题号优先 pdoc.pid，然后 docId；题目路径使用 docId/原始 pid。活动题目链接带 tid，提交详情链接为 /record/<rid>。普通/活动生成的链接必须属于当前实例。

HTML 复用 record_main 合同，读取状态、分数、题名、时间、内存、语言和 data-timestamp；链接中的 &amp; 解码。两条路径归一到 HydroOJRawRecord，再走同一个 normalizer。

时间合同：

- 有效 submitAt 优先；
- 否则取 ObjectId 前 8 位的创建时间；
- 最后才允许 judgeAt fallback；
- 重判时间不能改变正常记录的时间线位置。

JSON time 是 ms、memory 是 KiB（真实 HTML 同一记录验证）；HTML B/KiB/MiB/GiB 换算到统一 memoryKb。缺失指标保持 undefined，不把破折号解析为 0。

verdict 与 score 分离。UI 对 Accepted/100 显示两行并复用统一状态颜色。Hydro 当前状态枚举中 `7` 是 Compile Error，`5` 是 Output Exceeded；Adapter 按该枚举映射，不能把旧版编号表当作合同。未知状态保留 raw，不能根据分数猜 Accepted。Hydro 内置语言键映射为站点展示名（例如 `cc.cc20o2` → `C++20(O2)`）；未知自定义语言保留完整键，UI 不按固定字符数截断。JSON 中 uid 与当前 UID 不符的记录不入库。

## 6. 分页和预算

| 预算           | 上限                        |
| -------------- | --------------------------- |
| 普通记录页数   | 100                         |
| 已参加活动数   | 50                          |
| 每活动页数     | 5                           |
| 每活动候选记录 | min(100, FetchInput.limit)  |
| 最终输出记录   | min(1000, FetchInput.limit) |

HTML 按明确 next 链接翻页。JSON 观察第一页长度，后续页等长时继续，空页/变短/到 since/预算时停止。重复页停止并产生分页诊断，不能无限循环。

每个活动至少查询第一页；活动请求串行，复用来源冷却、请求超时和取消机制。记录与活动列表本轮不缓存，品牌单独缓存。

普通/活动候选合并去重后才截取输出 limit。同一个提交从多个入口返回只占一个输出名额。FetchResult.hasMore 汇总普通、活动和最终截断状态；达到保护预算必须返回诊断，不能声称全量历史已抓完。合并结果触及总输出截断时单独返回 output-limit 提示，即使各入口已经翻页完毕。

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
- permission-denied：403；
- auth-required：会话失效；
- unavailable：404、网络或解析失败；
- truncated：本次预算已用完。

无活动发现权限、未知用户页或单活动失败保留普通记录及其他成功活动。只有身份/普通记录主流程失败产生账号级 AdapterError。

SyncSourceResult 和首次授权响应都透传本次 diagnostics。Settings/Timeline 共用 SyncDiagnostics 展开列表，显示具体活动名称和状态。诊断不长期塞入账号级 SyncState；重新打开页面后旧活动诊断不保证保留。

## 9. 站点名称和图标

名称来自当前 origin 根页：

1. og:site_name；
2. application-name；
3. 当前 hostname。

不从 title 猜名称，不使用内部 domain.name 替换实例品牌。文本解码、trim、限制 80 字符并过滤控制字符。登录页可以包含公开品牌；解析品牌成功不表示账号认证成功。

图标按 rel/sizes/type 发现并排序：

- 优先接近小尺寸 favicon 的同源 icon；
- 支持 shortcut icon/apple-touch-icon；
- 同源 fallback 包括 favicon.ico 和 Hydro 常见 favicon PNG；
- 相对 URL 基于根页最终 URL；过滤外部 URL、凭证 URL、无效格式；
- 最多尝试 8 个候选，每个最大 64 KiB；
- 支持 PNG/JPEG/GIF/WebP/ICO，同时验证 MIME 和文件签名；
- SVG 暂不接受；
- HttpClient 用流式 maxBytes 限制读取，再生成缓存 data URL。

网络允许必要跳转，并对最终响应 origin 校验；不要把最终检查写成“保证跳转前预阻止”。图标失败不会影响提交；没有可用缓存图标时 OJLogo 使用内置 Hydro 图标。

## 10. 品牌缓存和展示

InstanceBrandingRecord 为 source、origin、name、iconDataUrl?、fetchedAt、iconFetchedAt?。缓存 key 使用与身份模块一致的无歧义 source/origin tuple。

- 首次授权采集；普通同步仅在没有缓存或超过 7 天时刷新。
- 同实例多个账号共用缓存和在途刷新。
- 名称更新但图标获取失败保留旧图标。
- 缓存最多 32 实例、约 2 MiB；按 fetchedAt 淘汰旧项。
- 缓存损坏被丢弃，不影响账号/提交加载。
- storage 写失败可清空可丢弃缓存重试，不牺牲账号/记录持久化。
- 单账号删除可保留品牌；清空账号/全部数据同时清缓存。
- OJLogo 本地 data URL 加载失败回退；统一 OJName 被列表和时间线复用。
- OJ 筛选仍固定 HydroOJ；实例品牌不参与身份、权限或来源判断。

## 11. 验证和已知限制

自动化覆盖 HTML/JSON、活动类型、真实 pdict 形状、tid/UID 参数、分页、重判时间、内存单位、去重、部分失败、密码重登录、实例会话串行、缓存和账号竞态。

tests/integration/hydroj-live.test.ts 从环境注入实例/用户名/密码，默认跳过。2026-10-02 已用授权测试站点单独执行：普通、比赛、作业均取得记录，模拟会话失效后自动登录，题名/链接补全与站点名称成功。

测试账号的活动记录较旧，首次同步默认 30 天可能看不到；在时间线选择覆盖历史的范围后同步。每次采集有保护上限，全量选择不代表无限抓取。

尚未完成本机 Chrome/Edge 权限弹窗、扩展重启和活动链接人工验收；见 docs/qa/browser-matrix.md。没有把这些检查标为已通过。

## 12. 维护规则

- 一个 parser/normalizer、一套分页、一套领域 merge；新增题目/活动字段先补脱敏合同测试。
- 只维护 verified UID 这一份 Hydro 身份。
- 活动参数留在 Adapter，UI 和 storage 只认识稳定 DTO。
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
