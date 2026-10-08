# OJTrace 账号系统实施 Spec

> 状态：账号系统已实施；2026-10-04 已升级时间窗口、分页节奏、覆盖结果和 Hydro 指定域。自动检查及 student 域真实 HTTP 非空采集已通过；主域流程回归为空窗口且含活动警告，Chrome/Edge 扩展人工验收仍待完成。
>
> 范围：授权、规范身份、凭证、权限、首次同步、删除/清空、并发存储。
>
> 绿地策略：唯一存储和消息 schema 为 2；不迁移旧账号数据，不保留旧消息兼容层。

## 1. 模块边界

| 模块                                                                 | 责任                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/domain/account-identity.ts`                                     | origin/domain/provider key 校验、无歧义身份键和品牌键 |
| `src/domain/hydro-scope.ts`                                          | Hydro 域 ID、路径构造和导航范围判定                   |
| `src/domain/types.ts`                                                | 持久化账号、凭证、提交、同步状态和品牌 DTO            |
| `src/domain/merge.ts`                                                | 提交去重、字段合并、每账号 retention                  |
| `src/domain/instance-branding.ts`                                    | 可丢弃品牌缓存合并和淘汰                              |
| `src/application/accounts/account-service.ts`                        | 授权、身份 upsert、首次同步、凭证替换、删除/清空      |
| `src/application/accounts/account-queries.ts`                        | 不含凭证的 `PublicStoredData` 和统一品牌查询          |
| `src/application/storage/store.ts`                                   | 单 writer 事务和单 key 持久化                         |
| `src/application/sync/sync-service.ts`                               | 已启用账号选择、freshness 和事务结果提交              |
| `src/application/sync/collect-account.ts`                            | 同账号任务、冻结窗口、取消/时限和最终合同检查         |
| `src/application/sync/commit-collection.ts`                          | 授权首次采集与常规同步共用的纯事务转换                |
| `src/platform/permissions/hosts.ts`                                  | UI/后台共用权限计划                                   |
| `src/platform/network/`                                              | 请求范围、超时、大小限制、浏览器 Cookie 传输          |
| `entrypoints/settings/AccountForm.tsx`、`useAccountAuthorization.ts` | Adapter 元数据驱动的表单、检测和授权状态              |
| `entrypoints/background.ts`                                          | runtime handler、依赖装配、稳定错误转换               |

无需额外 repository、事件总线、伪 CAS 或 OJ 专属账号服务。Adapter 不写 storage 或请求扩展权限；UI 不计算 identityKey/accountId，不写 storage。

## 2. 数据模型

认证模式只有 `public-handle | browser-session | manual-cookie | password`；每个 Adapter 通过 `metadata.authModes` 声明实际支持的模式及字段。

持久化 `AccountRecord` 必须包含：

- `accountId, source, providerAccountKey, identityKey`；
- `authMode, enabled, verifiedAt, createdAt, updatedAt, credentialRevision`；
- 可选 `origin, domainId, label, providerDisplayName`。

`identifier` 是短生命周期授权输入，不进入账号持久化。`AccountConfig` 是 Adapter 请求输入，不能当作可直接写入的账号对象。凭证只经 `AdapterContext.credentials` 注入，不放在 `AccountConfig`。

`StoredData` 使用一个 `ojtrace:data` key 保存：

```ts
{
  schemaVersion: 2,
  revision: number,
  accounts: AccountRecord[],
  credentials: CredentialRecord[],
  instanceBranding: Record<string, InstanceBrandingRecord>,
  submissions: Submission[],
  syncStates: Record<string, SyncState>,
  preferences: Preferences
}
```

`CredentialRecord` 含 `accountId, credentials: Record<string,string>, updatedAt`。当前明文保存在浏览器本地；类型分离用于控制数据流，不表示加密。

`PublicStoredData` 完全省略 credentials 集合，账号增加 `credentialConfigured: boolean`。GET_STATE、授权、同步和设置响应均使用该公开状态。`AccountRecord` 本身也不包含密码/Cookie。

## 3. 身份与幂等

身份按每项 `长度:内容` 编码，不能裸拼分隔符。固定 OJ 使用 `[source, "", providerAccountKey]`，Hydro 默认域使用 `[source, origin, UID]`，显式域使用 `[source, origin, domainId, UID]`。

- 固定 OJ 的 identityScope 为空；origin 只适用于 Hydro。
- Hydro 必须使用规范化网站 origin、可选 domainId 和经验证的数字 UID。用户名仅展示，改名不会创建新身份；未指定 domainId 表示网站默认域，不猜其 ID。
- 账号输入允许 HTTP/HTTPS 根地址或 `/d/<id>/` 域地址，规范化为纯 origin + domainId；拒绝其他页面路径、query/fragment、嵌入用户名密码及歧义路径。持久化 origin 仍只能为根地址。
- provider key 去首尾空格，拒绝空值/换行；大小写由 Adapter 的站点合同决定。
- 同身份再次授权复用 accountId，保留 createdAt、提交和选择配置，替换认证材料并递增 credentialRevision。
- 同名/同 UID 用户在不同 Hydro origin 或 domainId 下属于不同绑定；重新授权同域幂等，删除不影响其他域。
- 切换认证方式替换整个凭证记录，切回 browser-session/public-handle 清空持久化凭证。

## 4. Adapter 授权合同

`OJAdapter.authorize(input: AuthorizeInput): Promise<CanonicalAccount>` 是唯一身份确认入口。

`CanonicalAccount` 含 `accountId, source, providerAccountKey, displayName?`，禁止包含凭证。授权输入只包含账号、凭证、HTTP、信号和快照上下文，不含采集窗口或额度。各站使用独立身份 helper；Codeforces public handle 使用 user.info，Hydro 通过所选域首页 UserContext 或域内 POST /login 确认真实 UID 和域访问权限。域范围来自经规范化的请求，不由 CanonicalAccount/记录自动切换。授权不得调用 fetchRecent 或依赖目标范围内有没有提交。

字段由 `AuthModeDefinition.credentialFields` 声明。UI、Account Service 只按元数据读取字段；未声明字段拒绝。密码保持原值，不能 trim。Hydro manual-cookie/password 的 identifierRequired 为 false，不另填 UID。

浏览器会话、手动 Cookie、密码是不同认证状态，不抽象成隐式的“自动登录”布尔值。Hydro 同 origin 的授权、同步、品牌和会话检测串行，密码账号同步前确认当前 UID，身份不符时重新登录自己的账号或报 identityChanged。

## 5. 授权与首次同步

`AccountService.authorize` 的顺序：

1. 校验 Adapter/mode/输入，规范化 origin 和可选 domainId，确认后台已拥有网站 origin 权限。
2. 调用 Adapter.authorize；失败不落库。
3. 事务中按身份 upsert 账号和独立凭证，新账号 enabled=true；重新授权保留原 enabled，递增 credentialRevision，不预写 lastSuccessAt。
4. 事务外通过共享 collectAccount 执行首次采集和可选品牌刷新；按保存的 syncRange/followNow 解析范围，无偏好时最近 7 天。范围非法时身份授权仍成功，跳过首次采集并提示。
5. 再次事务检查 accountId + credentialRevision；仍存在且版本匹配才合并记录/状态。
6. 完整采集更新 lastSuccessAt；部分采集合并有效记录、保留旧 lastSuccessAt、stale=true。首次采集失败保留已验证账号和结构化错误，不改变 enabled。
7. 若账号已删除或凭证版本变化，丢弃结果；返回 superseded=true，不能伪报首次同步成功。

`enabled` 只表示是否可参与同步；验证时间由 verifiedAt 表示，同步成功/失败由 SyncState 表示。没有虚构的 pending、authorizationStatus 或额外消息进度协议。

网络请求必须在事务外。事务 callback 同步、纯，只返回新的 StoredData，不 await 网络，不写 UI。

## 6. 存储一致性与同步竞态

`StoragePort` 唯一 API 是 `load()`、`transact((current)=>next)`、`clear()`。业务写入只来自一个 service worker 实例，进程内串行完整读-改-写；完整 snapshot 一次写到单 key。

revision 是诊断计数，不是跨进程 CAS。未来增加第二 writer/cloud sync 时需要真实条件写入方案，不能扩展当前内存队列并声称跨上下文原子。

删除账号的同一事务删除账号、凭证、提交、syncState 和同步选择；清空账号还清空品牌缓存。清空全部数据重置偏好。单账号删除可保留实例品牌缓存供其他账号共享。

同步抓取携带 credentialRevision；提交只接受仍启用且版本匹配的账号。丢弃的结果不出现在返回 sources，不改同步成功时间，不恢复已删账号。

Hydro 提交 guard 和存储加载均校验记录的 source、origin、domainId 与所属账号一致。不同域相同提交 ID 因 accountId 不同而独立；不能通过伪造非 Hydro source 绕过范围校验。

同账号、credentialRevision、since、until、limit 全部相同的在途请求才可复用；不同范围按账号串行，每账号最多一个运行任务和一个不同范围待执行任务，超额返回 busy。派发前重检启用状态与凭证版本。新凭证取消旧任务；旧调用返回 superseded，不能领取新范围的结果。

清空数据或提交会中止采集并推进内存任务代际，阻止已完成但尚未提交的旧结果回填；新同步仍等待旧 HTTP/Cookie 收尾。首次授权回包也检查代际，不伪报已取消采集的完整覆盖。同一规范身份的较旧授权晚返回时不能覆盖已保存的新凭据；清空账号使待确认身份授权失效。这些控制不改变存储 schema。

保留 per-account retention；采集为冻结毫秒闭区间、后台限制最近 35 天，非法范围在采集网络请求前拒绝。freshness 使用 lastAttemptAt 防止部分/失败后重复扫描。每账号任务时限 900 秒（15 分钟）；用户取消丢弃本轮新结果，内部 deadline 可保留已验证页的 partial。手动 force 仅绕过 freshness，不能绕过分页、origin 限流或预算。某来源失败保留本地缓存和其他来源结果。

## 7. 权限与 Cookie 网络边界

权限计划由固定 source origins、Adapter dataOrigins 和 Hydro 精确 origin 共同计算。

- 固定 QOJ 权限由 manifest 声明。
- 用户 Hydro 实例通过可选 HTTP/HTTPS 模式申请，实际申请仅规范化实例 pattern。
- domainId 不改变网站权限、Cookie 和 origin 限流范围；同网站不同域的密码会话仍串行。数据与导航则只接受所选域，回默认域或其他域报 scopeMismatch。
- UI click 中直接调用权限请求，保持用户手势；后台再次 contains 检查，不信任客户端“已授权”标志。
- 自动会话检测只检查权限，不自动弹申请。用户“授权并重新检测”显式请求。
- 不从重定向、活动 URL、favicon 或网络正文扩大权限。

浏览器禁止手写 Cookie 请求头，因此网络层把 Adapter 选择的 Cookie 规范化后临时注入该 origin 的 Cookie store，请求用 include，完成后恢复原值或删除新注入项。同 origin 的所有后台请求共用队列，避免读取临时注入中的别人的 Cookie。AtCoder 第三方公共 API 不能接收官方站点 Cookie。

禁止换行、属性段、无效 cookie name 和空值。恢复失败（包括 set 返回空结果）必须报错并继续恢复其他字段；remove 返回空结果时确认该 Cookie 已不存在。恢复成功/失败/并发路径都有测试。source 专属历史 request options 收敛到同一临时注入实现；新增 OJ 不复制新的注入循环。

每个 origin 的后续逻辑列表页按该 OJ 的分页策略暂停，默认 1500ms ± 500ms；设置页支持基础间隔和随机浮动，保存从下一轮同步生效，本轮配置冻结。策略绑定仍复用同一个 origin 队列；身份/详情/品牌不附加列表暂停，但所有真实 HTTP 尝试均受统一 origin 冷却。429 在响应头返回时立即登记 Retry-After（无效时默认两分钟），只延长冷却。非敏感 `{origin, blockedUntil}` 通过 storage.session 恢复；内存同步更新、最新快照串行写入，存储失败保留内存保护并报告降级。

请求设置超时、取消和响应流大小上限。跟随跳转后仍校验最终 origin；这是一道最终响应校验，不宣称在浏览器 fetch 内预阻止所有跨 origin 跳转。

## 8. Runtime 与错误

schema 2 消息使用现有命名和顶层字段：

`GET_STATE, AUTHORIZE_ACCOUNT, DELETE_ACCOUNT, CLEAR_ACCOUNTS, CLEAR_SUBMISSIONS, CLEAR_DATA, UPDATE_SYNC_ACCOUNTS, UPDATE_SYNC_RANGE, DETECT_BROWSER_SESSION, SYNC_REQUEST`。

站点权限统一由 UI 在用户操作中调用 `ensureAuthorizationPermission` 申请，后台只检查；不再保留无调用方的 `REQUEST_HOST_PERMISSION` 消息和 `pageIdentity` 页面注入身份链路。

AUTHORIZE_ACCOUNT 顶层携带 source、authMode、identifier?、origin?、domainId?、label?、credentials?；DETECT_BROWSER_SESSION 同样传递域。domainId 只允许 Hydro 且使用统一域 ID 校验，后台再次规范化地址并拒绝冲突；没有 payload 包装或旧 UPDATE_ACCOUNT。校验消息公共字段及每类业务字段。返回错误含稳定 code/message；后台不返回任意 Error.message、响应正文、请求头、凭证或堆栈。稳定文案放在 messaging/error-messages.ts，设置页/时间线复用。

首次授权返回不含凭证的 account/data、diagnostics、可选 coverage/error 和 superseded。覆盖结果仅在本次响应返回，不改变主存储/消息 schema 2。完整性只使用 coverage.outcome，不保留冗余的顶层 hasMore；缺少 coverage 的响应不能猜测 complete。活动失败作为本次 diagnostics 返回，不覆盖成功的账号级 SyncState。

## 9. Settings 和品牌

AccountForm 与授权 Hook 负责 UI 流程：

`idle → validating-input → requesting-permission → authorizing → completed/failed`。

授权 command 内部包含验证、upsert 和首次同步，UI 不伪造不可观测的 upserting/syncing 状态。会话检测独立记录 checking/authenticated 等状态，并用序号丢弃过期检测响应。source/mode 切换清空输入；成功清空凭证；同步 ref 防止双击发出多个命令。

图标缓存按 source + normalizedOrigin + 可选 domainId 索引，同域账号共用缓存和在途刷新，不同域隔离。实例名字来自手动 label，默认 HydroOJ，不自动采集站点名称，也不替换账号 displayName。固定 OJ 筛选标签不改；已连接账号和同步选择显示显式域，OJ 首页与记录导航保留域前缀。图标采集合同见 Hydro Spec。缓存损坏或图标失败只回退展示，不丢账号。

## 10. 验证与发布边界

自动化覆盖：

- origin/identity 编码、不同实例隔离、幂等授权、凭证替换与公开查询；
- 验证失败不落库、首次同步失败保留、删除/清空关联数据；
- 删除/替换凭证与在途同步、重复同步与宽窗口请求；
- Hydro 多账号会话串行、身份切换、活动部分成功；
- UI 重复提交、密码原值、成功清空、非法 origin 不申请权限；
- 品牌刷新合并、过期、旧图标保留、缓存淘汰。

质量门禁为 typecheck、lint、test、format:check、build、audit:manifest。真实 Hydro 集成是显式 opt-in 测试，从环境注入根/域地址和凭证，默认跳过；非空采集使用 OJTRACE_HYDRO_REQUIRE_RECORDS=1 单独验收，真实凭证不写仓库。

Chrome/Edge 的扩展加载、权限弹窗、登录态、活动链接和重启持久化仍须人工验收，记录在 docs/qa/browser-matrix.md。升级旧 schema 会初始化为空，需要重新添加账号。

## 11. 维护规则

- 只保留一份 canonical 身份、一个存储 writer、一套提交 merge。
- Hydro tid/tdocs/HTML/登录字段留在 Hydro Adapter，通用层只认识 DTO。
- 品牌纯缓存策略留领域模块，存储不能反向依赖网络刷新服务。
- 新需求优先扩展元数据和现有 DTO；出现第二个实际使用方才抽通用活动框架。
- 修改身份、凭证版本、存储或预算合同必须同时补回归测试和更新本 Spec。
