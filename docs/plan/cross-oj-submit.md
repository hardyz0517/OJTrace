# OJTrace 跨 OJ 提交实施计划

> 状态：P1 Codeforces 与 P2 AtCoder 均已实现目标站原生表单自动提交和有界结果关联，并通过自动化验证；洛谷登录态编辑器、Codeforces 登录态编辑器和自动提交、AtCoder 登录态最终提交仍待真实提交验收。AtCoder 页面结构已在浏览器核对，尚未触发真实提交。Codeforces Gym/Group 暂不纳入支持范围，等取得登录态页面证据再评估。
> 本文对应“洛谷 → 原 OJ 提交”功能，第一阶段优先支持 Codeforces，第二阶段支持 AtCoder。
> 本计划建立在 2026-11-03 的源码审计、参考项目阅读和匿名页面测试之上；登录态浏览器验证完成前，不把目标站页面选择器、语言 ID 或提交响应当作稳定接口。

## 设计审查结论

整体路线采用成熟的浏览器扩展模式：洛谷页面集成、Background 编排、短期任务传递、按站点适配，并让目标站原生页面完成表单提交。原稿遗漏了用户希望从洛谷一次发起并完成 CF 提交的行为，修订后的原则如下：

- P1 只实现洛谷 → Codeforces；不提前创建 AtCoder 入口或通用 OJ Enhancer 生命周期/注册框架。
- 先以少量完整模块实现并验证边界；只有文件确实变大或第二个 Adapter 出现重复职责时再拆分，不按每个 DOM 查询都单独建文件。
- 可选站点权限由扩展自己的 popup 在用户点击时申请；popup 仅负责首次授权和启用页面脚本，实际提交入口位于洛谷原生“提交评测”按钮右侧，不刷新含有未保存代码的页面。
- 一次性任务不通过 URL 传递 ID。Codeforces 和 AtCoder 都复用发起操作的洛谷标签页，在目标 OJ 原生提交页完成表单提交。任务绑定到浏览器提供的 tabId 与精确 origin。
- `storage.session` 读改写不是原子事务。领取任务必须经过 Background 内的串行队列，并在返回代码前持久化一次性提交状态，防止并发重复提交。
- 用户点击洛谷的“提交到 Codeforces”即授权本次一次性提交；提交使用当前浏览器的 Codeforces 登录态。目标结果页会显示识别到的账号和 Submission ID。
- 不将无法唯一关联的结果伪装成失败；返回未知状态并停止自动动作。

## 1. 目标和边界

用户在洛谷题目页点击“提交到原 OJ”，OJTrace 完成以下工作：

1. 从洛谷页面读取明确的原题来源和原题编号。
2. 读取洛谷编辑器中的完整代码和当前编程语言。
3. 用户点击 Codeforces 入口即确认提交；创建一次性任务并在当前标签切换到 Codeforces 原生提交路由，以 OJTrace 遮罩维持连续操作界面。
4. 在目标页唯一识别编辑器 API，填入代码和目标语言、回读校验，等待原生 Cloudflare 验证完成后点击唯一的 Codeforces Submit 控件发起一次提交。
5. 解析能够明确归属于本次操作的 Submission ID 和详情链接。
6. 将成功、失败、登录失效、安全验证、结果未知、等待评测等状态反馈给用户；结果不确定时不重试。
7. AtCoder 选择页面当前提供的 C++23 option（与洛谷语言无关），在 OJTrace 全屏提交面板覆盖下写入原生表单并点击原生 Submit；Cloudflare 验证控件显示在该面板中，仍由 AtCoder 页面处理，完成后按题目和提交信息关联本次提交并返回原洛谷题目页。

本功能不做以下事情：

- 不按标题模糊匹配后直接提交。
- 不读取、导出或复制 Codeforces/AtCoder Cookie、密码或 CSRF 值。
- 不把完整代码放进 URL、查询参数、剪贴板之外的外部服务或远程服务器。
- 不全局劫持洛谷的 fetch/XHR，也不取消洛谷原生提交请求作为默认实现。
- 不绕过 Cloudflare、验证码、Turnstile 或其他安全验证；页面遮罩只调整原生验证控件的展示位置，验证仍由用户与 Codeforces 的原生组件完成。
- 不在结果未知时自动重复提交。
- 不把跨 OJ 提交逻辑放入题面提取、CNOI、PDF、时间线采集或现有提交同步 Adapter。

P1 的“完整链路”定义为：洛谷识别 → 读取代码和语言 → 用户点击“提交到 Codeforces” → CodeMirror 编辑器写入及回读 → Codeforces 原生表单提交 → 返回明确的 Submission ID/详情链接。若账号、题号、语言或编辑器无法唯一确认，则停止且不重试。

## 2. 当前基线

### 2.1 已通过源码验证的事实

- WXT 版本为 `0.21.4`，当前使用 MV3 Background，入口为 [`entrypoints/background.ts`](../../entrypoints/background.ts)。
- Codeforces、AtCoder 与洛谷页面脚本都由 manifest 静态注入；popup 只申请目标站的 optional host permission，后台仅对安装或扩展重载前已打开的洛谷标签页补注入一次。
- Background 已有消息 schema、requestId、sender 校验、runtime port 和错误响应模式，可作为新功能的通信基础。
- [`src/application/problem-export/export-state.ts`](../../src/application/problem-export/export-state.ts) 已实现短期任务、TTL、`storage.session` 优先、一次性读取后删除的类似能力，可借鉴其生命周期设计。
- [`src/problem/adapters/luogu.ts`](../../src/problem/adapters/luogu.ts) 能解析洛谷题目 URL 和 pid，但属于题面导出边界，不包含编辑器读取和提交行为。
- 题面测试已覆盖 `CF1A`、`CF1936C`、`AT_abc175_f` 等洛谷题库编号。
- 当前 `wxt.config.ts` 已声明 Codeforces、洛谷和 AtCoder 的可选 host permission；现有 manifest 审计禁止 `webRequest` 和 `<all_urls>`。
- 当前 OJ 记录同步中的语言表只能解释历史提交记录，不能直接作为编辑器语言读取或目标 OJ 语言 ID 映射。

### 2.2 已通过实际页面或接口测试的事实

- 洛谷公开 `CF1A` 页面返回 `lentille-context`，其中包含 `pid=CF1A`、`type=CF`、题目名称和原题相关数据。
- 洛谷 `AT_abc175_f` 夹具和公开页面数据包含 AtCoder 题目编号；题面正文还可能包含 `problemUrl`。
- Codeforces 公开 API 可以返回稳定的题目编号和 Submission ID，但 Codeforces 页面请求在当前网络路径中返回 Cloudflare 403。
- AtCoder 未登录提交页会跳转到登录页；匿名提交页不能作为可用提交表单处理。
- AtCoder 公开提交数据接口可提供记录数据，但这不是提交页面接口，不能代替浏览器原生提交流程。
- 洛谷 2026-11-03 公共前端 bundle 显示，提交编辑器使用 CodeMirror 6；`CodeEditor` 组件通过 `modelValue` 接收由 `ProblemShow` 提供的代码，语言选择器为 `.lang-select` 自定义控件。生产版 Vue 会把 render VNode 存在应用挂载容器 `_vnode`，不会依赖 devtools 才存在的 `__vueParentComponent` / `app._instance`。这是公开 bundle 源码证据，登录态真实页面仍需实测。

### 2.3 仍需登录态浏览器验证的事实

- 洛谷登录态页面中 CodeMirror 6 对应 `CodeEditor` 实例能否从生产 render VNode 唯一定位。
- 登录态编辑器的 `modelValue` 是否随输入即时更新，以及 `.lang-select` 的当前语言文本。
- 洛谷 SPA 路由切换后编辑器实例是否复用、重建或延迟初始化。
- Codeforces 登录后的 contest、problemset、gym、group 页面表单结构和语言选项。
- Codeforces 提交后的重定向、状态页和能否可靠关联到本次 Submission ID。
- AtCoder 登录后的 ACE 编辑器、任务选择、语言选项和提交后结果页。
- 目标站在已登录浏览器标签页中是否能通过扩展注入脚本正常读取和修改页面状态。

## 3. 总体技术方案

### 3.1 目录边界

新增 feature-local 模块。首期只保留能隔离变化和测试的边界，不按每个概念单独建目录：

```text
src/oj-enhancer/features/cross-oj-submit/
├── model.ts              # ProblemRef、EditorSnapshot、消息和任务状态
├── problem.ts            # 洛谷题号、Codeforces 路由及提交记录 URL 解析
├── language.ts           # 洛谷语言到 Codeforces 当前 option 的匹配
├── luogu-editor.ts       # 在 MAIN world 中只读洛谷编辑器
├── client.ts             # popup 权限启用和历史读取
├── luogu-page-entry.ts   # native button 定位、插入和 DOM 合同
├── service.ts            # 创建/领取/更新/取消任务及状态迁移
├── background-bridge.ts  # 浏览器 API、sender 校验和 storage.session 边界
├── codeforces-page.ts    # Codeforces 表单检查与安全预填
├── atcoder*.ts           # AtCoder 路由、语言映射和独立表单适配
├── history.ts            # 去重、校验和有界的本地提交摘要
└── evaluation.ts         # 页面 verdict 解析和限时读取

entrypoints/
├── luogu-cross-oj.content.ts
├── codeforces-cross-oj.content.ts
└── atcoder-cross-oj.content.ts
```

P1 先采用 feature-local 边界；P2 加入 AtCoder 后，只提取实际重复的表单结果合同，并复用已验证的任务生命周期，没有建立全局 enhancer 框架或空壳 transport。职责边界如下：

- 纯函数解析/映射只依赖输入值，不碰 DOM、浏览器 API 或存储。
- `service.ts` 负责业务状态迁移；`background-bridge.ts` 负责 WebExtension API、安全校验和 `storage.session`，由现有 `entrypoints/background.ts` 注册调用。
- `luogu-editor.ts` 只读取洛谷页面编辑器；Codeforces 和 AtCoder 各自维护页面选择器、编辑器实例与语言选项。
- 洛谷 Content Script 只负责原生按钮旁入口、用户点击授权以及经过 Background 的编辑器读取/任务创建，不持有任务存储。
- popup 只负责首次权限申请、runtime 脚本注册/注入和历史；不提供第二个提交入口。
- 两个目标站 Content Script 只处理本站页面、有限消息和提示，不承载任务存储或另一套状态机。

### 3.2 任务模型

`model.ts` 中的 P1 领域类型如下：

```ts
type ProblemRef = {
  oj: "codeforces";
  contestId: string;
  index: string;
  source: "luogu-pid" | "luogu-origin-link";
};

type EditorSnapshot = {
  code: string;
  luoguLanguage: string;
  editorKind: string;
  capturedAt: number;
};

type CrossOjSubmitTask = {
  sourceTabId: number;
  sourceUrl: string;
  targetOrigin: "https://codeforces.com";
  targetTabId: number;
  problem: ProblemRef;
  editor?: EditorSnapshot;
  createdAt: number;
  expiresAt: number;
  state:
    | "pending"
    | "claimed"
    | "submitting"
    | "awaiting-user-submit"
    | "observing-result"
    | "completed"
    | "result-unknown"
    | "failed";
  submitObservedAt?: number;
  errorCode?:
    | "unsupported-language"
    | "editor-unavailable"
    | "target-page-changed"
    | "expired"
    | "result-unmatched"
    | "internal-error";
  result?: {
    submissionId?: string;
    detailUrl?: string;
    observedAt: number;
  };
};
```

上面的代码块记录 P1 首版的 Codeforces 合同。P2 后的实际类型将问题引用和 `targetOrigin` 扩展为 Codeforces/AtCoder 联合类型；两个目标站的表单与语言合同仍独立。Background 持久化任务后返回目标 URL，由洛谷页面在当前标签页导航到目标 OJ；任务以 Background 内部的目标 tabId 为 session key，不再增加无消费者的随机任务 ID。目标 Content Script 通过可信的 `sender.tab.id` 领取，不能自行声明标签页或 origin。

代码只短暂保存在 `storage.session`：目标站页面先验证 origin、允许的提交路由、目标题号、登录状态和安全验证，再请求领取；Background 在串行队列中把任务从 `pending` 改为 `submitting` 并成功写回后才返回一次代码。Codeforces 与 AtCoder 都在回读目标编辑器和表单字段后点击原生 Submit，并清除代码后观察本次结果。AtCoder 会在原生提交前读取同题提交列表中的最高 Submission ID；跳转到提交列表后优先要求 ID 大于该基线，若页面提供时间则同时要求时间晚于本次任务开始时间，避免把同题旧记录认成新提交。任务过期、目标标签页关闭、离开目标 origin 或失败时清理代码和任务。任何目标站都不自动重试；结果不确定时提示用户先核对提交记录。AtCoder 目标 URL 只附带 `ojtrace=1` 这个流程标记，不携带任务 ID、代码或账号信息；AtCoder Content Script 在 `document_start` 先挂全屏遮罩，再等待表单/编辑器就绪，普通直接访问 AtCoder 不挂载该遮罩。

### 3.3 状态机

```text
idle → resolving-problem → reading-editor → pending → submitting
     → observing-result / awaiting-user-submit → completed / result-unknown

任意阶段可因 `unsupported-language`、`editor-unavailable`、
`target-page-changed`、`expired` 等错误码进入 `failed`。在领取前发现登录页或安全验证页时保持 `pending`，仅提示用户处理，不传输代码。
```

不保存确认前的 draft，也不保存每个 UI 子步骤。活动任务只保留 `pending`、`submitting`、`awaiting-user-submit`、`observing-result`；完成、失败和结果未知的摘要通过当次消息返回，随后立即删除 session 任务和 TTL alarm。登录页或已识别的验证页在领取前不传输代码；任务保持 `pending`，用户在同一标签页完成处理并回到允许的提交表单后可继续。Codeforces 的原生提交动作最多发起一次；TTL 到期或离开目标站点后不自动重放。`result-unknown` 不能自动回到 `pending`。

## 4. 关键实现设计

### 4.1 洛谷题目识别

P1 只解析 Codeforces 来源，按以下优先级解析：

1. 读取洛谷结构化数据中的 `pid` 和来源类型。
2. 若结构化数据未包含完整来源，读取题面内明确的 Codeforces 原题链接。
3. 对 `CF<contest><index>` 解析为 Codeforces `contestId + index`。
4. 来源、pid 和链接互相矛盾时返回 `ambiguous`，交给用户确认，不自动提交。

不要将标题、翻译标题、题目难度或相似题名作为唯一依据。解析器需要覆盖大小写、数字后缀、URL 编码和非法路径测试。

新增测试：

- `CF1A`、`CF1936C`、带数字后缀的 CF index。
- pid 与原题链接冲突。
- 缺少来源、重复 pid、非题目 URL、恶意域名和编码异常。

### 4.2 洛谷编辑器读取

采用“点击触发的只读编辑器 API”作为首选：

1. 洛谷页面 Content Script 从当前题目 URL 识别公开 pid，并在原生提交按钮后插入 `type="button"` 入口。
2. 用户点击页面入口后请求 Background 执行读取；Background 以 `sender.tab.id` 和精确 Luogu URL 校验，再在 MAIN world 读取页面状态。
3. 当前洛谷 bundle 使用 CodeMirror 6；从生产版 Vue 根 VNode 遍历到唯一包含当前可见 `.cm-editor` 的 `CodeEditor` 组件，读取其完整 `props.modelValue`，并读取唯一可见 `.lang-select` 文本。不读取虚拟化行 DOM，也不依赖 devtools 专用实例属性。
4. 读取后做最小校验：代码必须是字符串、保留空格和换行、不能被追加注释或自动格式化；语言必须能映射到 OJTrace 的语言键。
5. 读取失败、编辑器尚未初始化或语言未知时，向 UI 返回明确原因，不创建任务。

读取器按洛谷当前 bundle 的组件名和 Vue render VNode 定位 CodeMirror 6 的 `CodeEditor`，再读取对应 Vue prop。页面组件名、VNode 和 prop 是洛谷实现细节，因此必须唯一匹配、失败即停止；登录态页面和每次编辑器升级仍需复核。不要从高亮行 DOM 拼接代码，也不要退回无法区分的 textarea 或全局 fetch/XHR 劫持。

需要在浏览器实测中记录：编辑器类型、实例发现方式、读取函数、语言字段、初始化时机、SPA 切换行为和卸载行为。每种编辑器写最小单元测试或页面夹具；真实页面只做读取，不触发洛谷提交。

### 4.3 跨标签页传递

`background-bridge.ts` 采用 Background + `storage.session`，并用短期 `alarms` 在 service worker 休眠期间保证到期清理；完整任务不放进 URL。它由现有 `entrypoints/background.ts` 注册到 runtime message handler；不另建第二个 Background 入口：

1. Background 收到 `CREATE_CROSS_OJ_TASK`，先校验来源 tab 和 `EditorSnapshot`；Codeforces 与 AtCoder 都复用来源 tab，保持当前浏览器登录态和一次连续的页面体验。
2. 得到真实 `targetTabId` 后，以该 ID 为 session key 将任务只写入 `storage.session`，TTL 建议 10 分钟；同时创建对应的 `alarms` 清理事件，不写入 `storage.local`。写入或 alarm 创建失败时关闭刚创建的标签页。
3. Background 将任务绑定到该 tabId 和精确目标 origin；洛谷页面在收到有效响应后导航到带 `ojtrace=1` 流程标记的目标提交路由。目标 tabId 和任务内容不放进 URL，也不向目标页面发送任务标识。
4. 目标 Content Script 只发送不带任务标识的 `CLAIM_CROSS_OJ_TASK`；Background 用 `sender.tab.id` 查找唯一绑定任务，并从浏览器提供的当前 URL 取得 origin，不信任页面自报的 tabId 或 origin。登录和已识别验证路径不领取任务；同一 tab 回到允许的 CF 提交路由且检查通过后再领取。
5. Background 通过按 `targetTabId` 建立的 keyed serial queue 串行执行“查找 → 校验 → 标记 `claimed` → 写回”。只有写回成功后才返回一次任务内容；竞争请求或已领取任务失败。
6. 离开 Codeforces origin、进入不在允许列表中的路径、重复领取或任务过期时返回结构化错误并清理任务；已识别的登录/验证跳转保留 `pending` 任务。Codeforces 页面唯一定位编辑器并回读代码后，Content Script 等待原生验证完成，再点击唯一的 Submit 控件最多提交一次；Background 清除代码并观察结果。
7. 目标页仅在确认本绑定标签页的原生 submit 事件后，将任务改为 `observing-result`，才尝试读取随后的成功响应页/详情页。只有能从该导航链明确取得 Submission ID 和对应题号时才报成功；无法唯一关联就写入 `result-unknown`，不通过“最新提交”列表猜测。

任务中不得保存 Cookie、密码、CSRF token 或目标站页面全文。任务完成、失败、过期和取消都要清理。

### 4.4 Codeforces Adapter（P1）

P0 公开页核对后，在 `problem.ts`、`codeforces-page.ts` 和 `entrypoints/codeforces-cross-oj.content.ts` 中实现该站路由、登录/验证识别、表单读取、预填和结果读取；纯解析函数单独测试。只有代码规模或测试隔离确有需要时再拆分 `page-reader`、`form-filler` 等模块。

P1 支持常规 contest 和 problemset；Gym、Group 不预建接口，待有真实需求和路径证据再扩展。页面集成仅在目标表单可识别、题号与任务相符时操作；CodeMirror、Ace 等 live editor 必须唯一可读写，再验证目标语言、题号、完整代码和实际表单字段后点击唯一的原生 Submit 控件。遇到已有用户代码时保持原内容并停止提交。

语言映射不能把洛谷名称直接传给 CF。先定义稳定的内部语言键，例如 `cpp17`、`cpp20`、`python3`，再根据目标页面当前 `<option>` 文本和 value 选择。匹配顺序为：精确名称 → 版本和编译器特征 → 明确别名；多个选项匹配时要求用户选择，零匹配返回 `unsupported-language`。

P1 不自行构造 Codeforces POST，也不读取或复制 CSRF；通过当前页面的原生表单控件提交，保留 Codeforces 的登录态、表单校验和站点事件处理。Cloudflare 验证组件若已出现在表单中，就在 OJTrace 遮罩下展示并等待用户完成；独立拦截页或登录页不注入代码、不绕过验证。一次提交无法确认时不重试。

### 4.5 AtCoder Adapter（P2）

AtCoder 适配使用同一任务生命周期和消息合同，但独立实现题号/路由、登录/验证识别、任务选择、ACE/纯文本编辑器读写和结果识别。AtCoder 目标语言固定选择页面当前提供的 C++23 option，不根据洛谷语言映射，也不硬编码语言 ID；页面没有 C++23 时安全停止。不能共享 Codeforces 页面选择器。两个站点都经过登录态验收后，再判断是否需要抽取公共 adapter interface。

## 5. Background 消息协议

在 `src/application/messaging/` 之外新增 feature 内部消息文件，避免把跨 OJ 提交类型塞进现有同步协议。P1 只保留四类命令：

```text
CREATE_CROSS_OJ_TASK
CAPTURE_CROSS_OJ_EDITOR
CLAIM_CROSS_OJ_TASK
UPDATE_CROSS_OJ_TASK
CANCEL_CROSS_OJ_TASK
```

编辑器读取由洛谷 Content Script 在用户点击后请求 Background 执行 MAIN-world 只读函数；经校验的 `EditorSnapshot` 随本次明确的“提交到 Codeforces”点击创建一次性任务，不再增加第二次确认。阶段和结果由 Background 根据目标 Content Script 的有限事件更新，不新增通用事件总线。

所有命令都使用现有消息 envelope 的 `schemaVersion` 和 `requestId`。Background 从浏览器提供的 `sender.tab.id` 取得发送者身份并要求 `sender.frameId === 0`，不接受页面自报身份。

命令字段保持最少：`CAPTURE_CROSS_OJ_EDITOR` 与 `CREATE_CROSS_OJ_TASK` 只接受顶层 Luogu sender；来源 tabId/URL 从浏览器 sender 取得，不信任页面自报。创建消息携带题目与经校验的 `EditorSnapshot`，这是唯一允许跨到 Background 的代码载体。`CLAIM_CROSS_OJ_TASK` 不带 tabId 或代码，按可信 sender tab 查找。`UPDATE_CROSS_OJ_TASK` 只接受绑定目标页的有限事件且不携带代码。`CANCEL_CROSS_OJ_TASK` 只接受绑定的目标页。Background session key 使用内部目标 tabId，不向目标 Content Script 暴露。

响应统一包含 `ok`、结构化 `code`、面向用户的 `message` 和可选诊断信息。`login-required`、`security-check` 等可恢复提示只作为本次响应的 code，不写入终态错误字段；诊断信息不得含代码、Cookie、密码或 CSRF token。

## 6. UI 实施

P1/P2 在洛谷原生提交按钮旁提供页面入口；popup 不承担提交启动流程：

- popup 根据当前洛谷 tab URL 中可验证的题号显示一次性“授权并启用页面入口”设置；用户点击时只请求 Luogu 与当前目标 OJ 的 optional host permission。
- 洛谷 content script 由 manifest 的静态 `matches` 注入；popup 只负责申请目标 OJ 的 optional host permission。授权后，页内权限门会重试并自动显示入口，无需刷新页面。后台启动时只对安装或扩展重载前已打开的洛谷标签页补注入一次，不存在第二份动态注册。
- 页面入口沿用洛谷原生按钮样式，紧邻插入在“提交评测”右侧，保持独立 `type="button"`，不拦截或触发洛谷原生提交。
- `提交到 Codeforces` 和 `提交到 AtCoder` 按钮点击本身就是本次提交授权；不弹出额外确认、不要求用户在目标站再次点 Submit。AtCoder 的 Cloudflare/Turnstile 验证若出现，由用户在 AtCoder 原生页面完成，扩展随后点击原生 Submit。

洛谷入口开始处理后应显示即时状态：

- 目标平台。
- 原题编号和证据来源。
- 正在读取代码、正在向 Codeforces 提交、提交已发起或失败。
- 目标账号由 Codeforces 结果页的提示显示；洛谷页面不猜测账号。
- 语言无法唯一匹配、目标页已有草稿、编辑器或表单不能确认时，明确停止且不重试。

Codeforces 与 AtCoder 页上的提示应说明提交已发起、不要重复操作，并显示 Submission ID 与评测结果。AtCoder 的安全验证控件在 OJTrace 遮罩中央展示；验证后由扩展点击 AtCoder 原生 Submit，不要求用户再切换页面或手动提交。

## 7. 权限与安全改动

### P1 权限

- 使用已有 Luogu、Codeforces、AtCoder optional host permission；popup 在用户点击时只申请 Luogu 与当前目标 OJ 权限。
- 权限申请必须从 popup 用户手势触发；成功后由静态注册的洛谷 content script 在权限门重试中自动生效。Content Script 不调用 `permissions.request`。
- 不新增 `webRequest`、`<all_urls>`、远程脚本、外部服务器或新的 Cookie 读取能力。
- `scripting`、`tabs`、`storage.session` 使用现有扩展能力；`alarms` 仅用于 TTL 清理。如果浏览器不提供 `storage.session` 或 `alarms`，任务创建失败并提示重试，不回退到 `storage.local`。

### 安全检查

- 所有目标页面消息校验 `sender.id`、`sender.tab.id`、当前 URL 和目标 origin。
- 任务只按 Background 内部的 target tabId 索引，不把该 ID 发给目标页面。
- 任务代码只允许一次 claim；Codeforces 原生提交最多发起一次，并发 claim 只有一个成功。
- TTL 过期、目标标签页关闭、离开目标 origin、目标域不匹配和重复读取都必须使任务失效。
- 代码只经过扩展内部消息和 `storage.session` 短暂暂存，在目标页写入表单；Codeforces 用户点击授权后会由其原生表单发送代码，不会向 OJTrace 服务器上传。代码不写 URL、日志或持久化设置。
- UI 和页面注入代码不得把用户代码插入 `innerHTML`。
- 失败诊断只显示错误类别和页面状态，不显示敏感请求头、Cookie 或代码。

## 8. 分阶段执行清单

### P0：浏览器实测和合同冻结

- [x] 建立不涉及真实提交的浏览器验收记录；记录见 `docs/qa/cross-oj-submit-browser-matrix.md`。
- [x] 在洛谷 CF 题页确认公开来源字段和原题链接；SPA 路由仍需登录态或开发构建验证。AtCoder 公共表单结构在 P2 单独实测。
- [x] 从公开 Luogu bundle 确认 Vue 提交状态与自定义语言选择器源码；登录态实例定位和读取验收仍待完成。
- [ ] 确认 Codeforces 登录后的 contest/problemset 页面结构、语言选项和 Cloudflare 状态。
- [x] 源码确认 popup 在用户点击时按当前目标站申请 optional host permission；洛谷脚本由静态 `matches` 注入，不再动态注册。
- [x] 确认在当前 Luogu tab 注入页面脚本，不刷新含有未保存代码的页面。
- [x] 检查 WXT 构建产物包含洛谷脚本，manifest 静态声明 `matches`；实际浏览器验收待完成。
- [ ] 记录 Codeforces 表单、挑战页、登录状态和提交后 URL/ID 的代码证据；真实 Submission ID 验证由用户在正常提交时手动完成，自动化不触发真实提交。
- [x] 将公开页实测选择器、页面版本和失败样例写入 `docs/qa/cross-oj-submit-browser-matrix.md`；登录态细节仍待补。
- [x] 冻结 P1 最小 `ProblemRef`、`EditorSnapshot`、任务状态和错误码合同。

**退出条件：** 公开题号识别、权限申请、当前标签页启动和未知结果降级已由源码/自动检查覆盖。登录态编辑器、Codeforces 表单和提交后 URL 仍未实测，因此 P0 的浏览器合同冻结只部分完成，不把这些站点页面选择器当作已验证稳定接口。P0 不要求完成 AtCoder 实测或真实 OJ 提交。

### P1：洛谷 → Codeforces（实现与自动化验证完成；登录态浏览器验收待完成）

- [x] 新增 feature-local 模块和 Codeforces content entrypoint；不创建全局 core/registry/lifecycle 或 OJ 通用框架。
- [x] 新增洛谷题目解析器和来源证据模型。
- [x] 新增洛谷编辑器只读桥接；失败时返回明确错误，不触发原生提交。
- [x] 新增 Codeforces 路由、登录页/验证页识别和表单读取。
- [x] 新增独立语言映射表和 option 匹配器。
- [x] 新增 Background task lifecycle、session storage 和 TTL alarm；不向目标页面暴露任务标识。
- [x] 新增洛谷原生提交按钮右侧入口和状态提示；Codeforces 与 AtCoder 点击即授权一次原生表单提交；popup 仅负责首次授权和启用页面脚本。
- [x] Codeforces 复用当前标签；兼容 CodeMirror/Ace live editor，回读并同步实际提交字段，再点击原生 Submit 控件；检测到 Turnstile 时等待用户完成验证，不覆盖已有代码。
- [x] 只在观察到本任务目标页的原生表单提交后读取结果；不能由导航链明确关联 Submission ID 时报告未知。
- [x] 为题号/语言纯函数、Codeforces 表单编辑器、任务状态迁移、并发 claim 和结果关联增加针对性测试。
- [x] 更新 manifest/architecture 集成并运行审计。

**退出条件：** 自动化覆盖“识别、单击授权、创建任务、CodeMirror 读写、原生表单提交动作、结果关联与不确定状态不重试”。登录态 Codeforces 常规 contest/problemset 的真实浏览器链路尚未验收；自动化测试不访问真实提交端点，登录态提交结果仍需受控真实浏览器验证，因此不宣称端到端验收完成。

### P2：洛谷 → AtCoder（代码实现与自动化验证完成；登录态真实提交验收待完成）

- [x] 新增 AtCoder 路由和 `contestId/taskId` 校验。
- [x] 新增 AtCoder 登录、验证和提交页识别。
- [x] 新增 ACE 与纯文本编辑器读取/写入桥接，并校验写入后的完整代码。
- [x] AtCoder 固定选择当前页面的 C++23 option；不读取洛谷语言版本，不硬编码 option value；缺少 C++23 时安全停止。
- [x] 新增 AtCoder 提交 ID 识别、提交时间关联和未知结果降级。
- [x] 支持洛谷题号不编码 contest ID 的 AtCoder 题目：必须以洛谷结构化数据中的原题 URL 解析，并由 Background 对照当前页面再次验证。
- [x] 增加 AtCoder 页面夹具、任务链路自动化测试和浏览器页面结构核对记录。
- [ ] 用已登录浏览器验收 AtCoder 原生表单提交和本次提交结果关联；不通过自动化触发真实提交。

**退出条件：** AtCoder 使用同一任务生命周期与安全合同，站点页面选择器、语言匹配和结果识别独立于 Codeforces。自动化合同和登录态页面结构已核对；真实提交链路仍是发布门禁。

### P3：结果同步和扩大覆盖

- [x] 在已识别的提交详情页对可见 verdict 做限时 DOM 读取：每 2 秒检查一次，最多 30 次，不直接轮询 OJ 网络接口；只在值变化时写历史，页面导航后停止，无法识别时保留 unknown。
- [ ] CF Gym/Group 继续保持不支持；取得路径、可选权限、登录态表单和结果关联证据后再单独扩展。
- [x] 本地保存最多 50 条去重提交摘要，并在 popup 显示详情链接与“评测中 / 已完成 / 状态未知”；不保存源代码。
- [x] 定义保守恢复：详情页刷新时仅凭仍处于 `observing-result` 的 session 任务重试同一结果关联；目标标签页关闭会清理任务；浏览器重启清空 session 代码与任务，不自动重放，用户回洛谷重新发起。已提交但未能关联时不自动重试，用户可在目标 OJ 原生提交记录中核对。

## 9. 测试计划

### 单元测试

- 题号解析、来源证据和冲突判断。
- Codeforces 路由生成和 URL allowlist；AtCoder 测试随 P2 增加。
- 语言映射：精确匹配、版本匹配、多个候选、无候选、目标不支持。
- 任务 TTL、tabId 绑定、一次性 claim、并发 claim、重复读取和错误 origin。
- 状态机迁移和错误码映射。
- 评测状态白名单解析、限时轮询停止条件、提交历史去重/上限和终态不可回退。

### 集成测试

- Background 消息 schema、sender 校验和响应 guard。
- `storage.session` 任务创建、读取、删除和过期清理。
- 目标页 URL 改变后任务失效。
- 不把代码出现在 URL、日志和持久化 local storage。
- 跨 OJ 历史清理会随“清除提交记录/清除全部”执行；保存记录只含提交元数据。
- 代码中不依赖现有 `src/problem/adapters`、CNOI、PDF 或时间线模块。

### 浏览器验收

至少覆盖：

| 场景                     | 预期                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| 洛谷 CF 题目             | 显示 CF 题号和提交入口                                                  |
| 洛谷 AtCoder 题目        | P1 暂不提交，显示 P2 计划或不可用状态                                   |
| 来源缺失/冲突            | 要求用户确认，不自动打开提交页                                          |
| 编辑器未初始化           | 明确提示并保持洛谷页面不变                                              |
| 空代码                   | 阻止创建任务                                                            |
| 不支持语言               | 显示原因，不静默改用其他语言                                            |
| Codeforces 未登录        | 在同一标签页登录并返回提交表单后可于任务 TTL 内继续；过期后回洛谷重发起 |
| Cloudflare/验证码        | 不领取代码；用户完成验证后回到提交表单继续，不尝试绕过                  |
| 用户已填写目标代码       | 不覆盖，要求用户检查                                                    |
| 目标页导航变化           | 任务失效并提示重新发起                                                  |
| 同一目标标签页重复 claim | 第二次读取失败                                                          |
| 提交后无法关联 ID        | 显示结果未知，不重试                                                    |

真实 OJ 测试只允许使用明确授权的测试账号和测试题；自动化测试不得向真实 OJ 随意提交代码。

## 10. 验收和发布门禁

实现每个阶段前后运行：

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm audit:manifest
pnpm audit:architecture
pnpm format:check
```

发布前还需要：

- P1/P2 浏览器矩阵通过 Chrome/Edge 的洛谷与相应 Codeforces/AtCoder 登录态验收。
- 结果未知不会自动重试。
- 目标站 Cookie、密码、CSRF token 和完整代码不进入日志、URL 或持久化数据。
- 洛谷原生提交行为、题面导出、时间线采集和设置页面回归通过。
- 文档记录每个选择器和接口的验证日期、页面版本、成功条件和失效降级。

## 11. 主要风险和处理方式

| 风险                             | 处理                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| 洛谷编辑器升级导致 API 变化      | 编辑器读取器隔离；启动时检测版本和实例；读取失败时停止，不猜测 DOM 文本                      |
| Codeforces Cloudflare 拦截       | 使用原生目标页和用户验证；不做后台直 POST 或验证绕过                                         |
| 页面动态重绘覆盖预填代码         | 只在编辑器稳定后写入；写入后读取回校验；检测到用户修改后停止覆盖                             |
| 语言名称和 ID 变化               | 读取当前 option，使用内部语言键匹配；无唯一候选时要求用户选择                                |
| 提交结果无法唯一关联             | 返回 `result-unknown`，提供目标站提交记录入口，不自动重试                                    |
| Background service worker 被回收 | 任务写入 `storage.session`；目标页 claim 时重新加载；TTL 和一次性状态保持可验证              |
| 任务泄露或重复读取               | 仅以 Background 内部 target tabId 索引；目标 origin/tab 绑定、单次 claim、短 TTL、读取后删除 |
| 现有架构边界被破坏               | 新模块独立；增加 architecture audit 规则和依赖测试                                           |

## 12. 实施顺序

实施顺序与状态：

1. [x] 完成公开页面核对、feature-local 合同和题号/语言/状态机。
2. [x] 实现 Background 一次性任务、消息协议和 session TTL。
3. [x] 在洛谷原生提交按钮右侧插入明确的 Codeforces 提交入口，并实现点击即授权与编辑器读取。
4. [x] 实现 Codeforces 页面识别、CodeMirror 写入回读、一次性原生提交及未知结果降级。
5. [x] 运行自动测试、类型、lint、格式、构建、权限和架构审计。
6. [ ] 用已登录浏览器验收洛谷编辑器读取、Codeforces 自动原生提交与评测关联，以及 AtCoder 页面结构和原生提交链路。
7. [x] 按计划实现 P2 AtCoder 独立适配器。
8. [x] P3 有界页面状态读取、本地去重历史与恢复语义。
9. [ ] 用登录态 Chrome/Edge 完成 P1/P2 浏览器门禁；仅在用户测试账号和测试题上明确授权后验证真实提交。
