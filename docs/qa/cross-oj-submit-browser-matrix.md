# 跨 OJ 提交浏览器验收矩阵

本页记录安全的页面核对和扩展验收。自动化不会在真实 OJ 点击最终提交；提交 ID 的端到端验证需要用户在自己的正常提交流程中确认。

## Codeforces 空代码问题回归

2026-11-04 用户反馈：目标题目和 GNU C++17 已识别，但提交页显示空编辑器。审计发现确定缺陷：表单存在源码 textarea 时，旧逻辑可在未确认 live editor 的情况下直接写字段；若 CodeMirror 随后从空缓冲区同步，代码会被覆盖。已修复为必须先读到 live editor，写入后回读编辑器值，再同步实际表单字段并回读；表单选择覆盖 `submitFrameForm` / `submit-form`，支持 Ace/CodeMirror，提交时点击唯一原生 Submit 控件。Codeforces 现复用洛谷当前标签并在成功后返回原洛谷题页。检测到内嵌 Turnstile 时将控件居中放在操作遮罩上方，等验证完成再提交；扩展不复制或发送验证 token。未初始化编辑器、草稿、歧义实例、回读不符、Submit 控件不唯一、验证超时或缺少 submit 事件都会停止；提交结果不确定时不重放。尚未取得用户登录态 DOM，真实页面验收仍待完成。

回归测试覆盖 CodeMirror/Ace 实例定位、未初始化时拒绝写 backing textarea、实际表单字段同步、原生 Submit 控件点击、Turnstile token 等待及超时停止、已有草稿保护、缺失/歧义实例 fail-closed、同标签任务绑定、并发一次性 claim 和提交结果未知不重试。尚未在用户登录态 Codeforces 账号发起真实提交；自动化不访问真实 OJ 提交端点。

## 页面核对记录

2026-11-04 AtCoder 语言策略：洛谷语言不参与 AtCoder 语言匹配，提交统一选择页面 option 中的 C++23（如 `C++23 (GCC 15.2.0)`）；不硬编码语言 ID。页面未提供 C++23 时停止并提示，不回退到其他标准。2026-11-05 遮罩改为 `document_start` 早期挂载：洛谷跳转 URL 带无敏感信息的 `ojtrace=1` 标记，AtCoder 页面先显示 OJTrace 全屏载入面板，再等待原生提交表单和编辑器初始化；只有跨 OJ 任务启用遮罩，普通访问 AtCoder 不受影响。后续出现 Cloudflare 控件时移入面板中央，离开面板时恢复控件原样式。

GenGen-RMJ 的 AtCoder 处理提供了可复用的页面选择器、ACE 编辑器 API 和等待 Cloudflare/Turnstile 的经验；它还固定语言 ID，并从页面收集 token 后用 `fetch`/`FormData` 自行 POST。OJTrace 仅采用前面几项，使用当前页面真实语言 option、有限时间等待站点生成 token，再点击 AtCoder 原生 Submit；只检查 token 字段是否已生成，不提取或复制 token 内容，也不另行构造提交请求，让 AtCoder 页面继续执行原生校验和请求。

| 日期       | 浏览器环境                             | 站点/登录状态                                      | 场景                                                                                                 | 结果                                                                                                                                                                                                                                                                                 | 限制                                                                                                                 |
| ---------- | -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 2026-11-03 | Codex 内置浏览器；具体浏览器版本不可见 | 洛谷公开题页，未登录                               | `https://www.luogu.com.cn/problem/CF1A`                                                              | 通过；标题为 `CF1A Theatre Square`；`#lentille-context` JSON 的 `data.problem` 含 `pid=CF1A`、`type=CF`；页面链接 `https://codeforces.com/problemset/problem/1/A` 可解析为 `1/A`                                                                                                     | 页面显示“登录后才可提交”；无编辑器、textarea 或语言选择器，不能验证代码读取和语言字段                                |
| 2026-11-03 | 公共 Luogu bundle 源码核对             | 公开前端构建                                       | `problem.show` 拆分 chunk `columba~975b54282e05c3bb.js`、CodeMirror chunk `cdmr~a1c29f54b687709b.js` | `ProblemSubmitBlock` 把 `ProblemShow` 的代码传给 CodeEditor 的 `modelValue`；编辑器是 CodeMirror 6，代码模型完整更新；生产 Vue 根 VNode 存于应用挂载容器 `_vnode`；语言是 `.lang-select` 自定义控件                                                                                  | 源码级证据及对应 Vue VNode 测试；未验证用户登录态页面中的实际 VNode 唯一定位和语言读取                               |
| 2026-11-03 | 洛谷公开题目数据核对                   | AtCoder 题 `AT1202Contest_h`                       | `https://www.luogu.com.cn/problem/AT1202Contest_h#submit`                                            | `lentille-context.data.problem` 标记 `type=AT`，`pid=AT1202Contest_h`；`vjudge.link` 指向 `https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h`。新增解析会从该权威原题链接取 contest/task，并校验 task ID 与 Luogu pid 对应                                                  | 公开响应源码核对及 parser/任务创建回归通过；用户登录态的按钮显示仍需在刷新后的浏览器扩展中确认                       |
| 2026-11-03 | 自动化生产-Vue VNode fixture           | CodeMirror 6 编辑器读取                            | 可见 `.cm-editor` → 包含它的 `CodeEditor.props.modelValue`                                           | 通过；完整多行代码和 C++17 均从模型读取；重复编辑器、空代码或缺失 Vue 模型时 fail closed                                                                                                                                                                                             | fixture 对照公开 bundle 结构，不等同于洛谷登录态浏览器验收                                                           |
| 2026-11-03 | Codex 内置浏览器；具体浏览器版本不可见 | Codeforces 匿名                                    | 请求 `https://codeforces.com/problemset/submit?contestId=1&problemIndex=A`                           | 未能留在目标提交路由；浏览器最终显示 Codeforces 首页和 Enter/Register 登录入口                                                                                                                                                                                                       | 不能确认登录态表单、语言 option、编辑器或提交后详情；不得据此认定选择器已验证                                        |
| 2026-11-03 | Codex 内置浏览器；具体浏览器版本不可见 | AtCoder Guest                                      | `https://atcoder.jp/contests/abc001/submit`                                                          | 通过；`form.form-code-submit`、`#select-task[name="data.TaskScreenName"]`、`select[name="data.LanguageId"]`、`#submit` 均可识别；源码加载 ACE，编辑器为 `#editor.ace_editor`，纯文本回退为 `#plain-textarea[name="sourceCode"]`；详情路由形如 `/contests/{contest}/submissions/{id}` | 只验证公开页面结构。登录态下语言选项、ACE 实例读写和提交后关联仍待验收；页面含 CSRF/Turnstile 字段，扩展不读取或复制 |
| 2026-11-04 | Codex 内置浏览器；具体浏览器版本不可见 | AtCoder 页面会话；导航栏显示 `Hardy_Zheng (Guest)` | `https://atcoder.jp/contests/abc482/submit` 与 `/submissions/me`                                     | 通过；页面有题目与语言选择、ACE 编辑器、原生 Submit 控件；我的提交页成功载入并显示 `No Submissions`。只确认页面结构，没有触发真实提交                                                                                                                                                | ACE 实例的运行时读写、Turnstile 展示情况和真实提交 ID 关联仍未端到端验收                                             |
| 2026-11-03 | 自动化 DOM fixture                     | Codeforces / AtCoder 状态解析                      | 详情页 verdict 白名单读取、未知文字拒绝、限时轮询及状态去重                                          | 通过单元测试；限时最多 30 次/2 秒，只读当前页面 DOM，不发起轮询请求                                                                                                                                                                                                                  | fixture 不是实时 OJ 页面证据；两个站点实际详情页 verdict 节点仍需登录态实测                                          |

## 扩展行为验收

| 浏览器        | 构建                      | 来源权限/登录态                | 场景                                                                | 结果                                           | 证据                                       |
| ------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| Chrome        | 待测 `.output/chrome-mv3` | 洛谷登录态 + Codeforces 登录态 | popup 首次授权、洛谷入口一次提交、编辑器填充/Submission ID/评测结果 | 待登录态验收                                   | 真实提交需用户在测试账号和测试题上明确发起 |
| Edge          | 待测 `.output/chrome-mv3` | 洛谷登录态 + Codeforces 登录态 | popup 首次授权、洛谷入口一次提交、编辑器填充/Submission ID/评测结果 | 待登录态验收                                   | 真实提交需用户在测试账号和测试题上明确发起 |
| Chrome / Edge | 待测                      | Codeforces 登录态              | 用户正常提交后，核对任务是否关联详情页和 Submission ID              | 待用户正常使用时确认；不通过自动化制造真实提交 | 不记录代码、Cookie、CSRF token             |
| Chrome / Edge | 待测                      | AtCoder 登录态                 | 任务、语言、ACE/纯文本填入、原生提交及本次提交详情 ID               | 页面结构已核对；浏览器端最终提交待真实验收     | 不记录代码、Cookie、CSRF/Turnstile 值      |

## 登录态手测步骤

1. 使用开发或生产构建加载扩展，记录浏览器版本和构建产物。
2. 登录洛谷并打开一个支持的 Codeforces 或 AtCoder 原题；在 popup 首次授权。AtCoder 集成会同时请求 AtCoder 页面与 AtCoder Problems 提交记录 API 权限；不刷新页面。
3. 切到洛谷“提交代码”面板，确认 Codeforces 和 AtCoder 入口紧邻“提交评测”右侧且外观一致。
4. 在洛谷编辑器放入无敏感性的测试代码并选择语言。点击目标 OJ 按钮会在当前标签切换到相应原生提交页，由 OJTrace 校验题目、语言与代码后点击原生 Submit。
5. 若出现内嵌 Cloudflare/Turnstile 验证，在目标站原生控件上完成验证；扩展等待验证完成后继续点击原生 Submit。核对账号、题目、语言和结果，不要重复点击洛谷入口。
6. 返回明确 Submission ID 后会回到原洛谷题页。若遇到登录或独立安全拦截页，按目标 OJ 原生提示处理；超时或离开目标域后不自动重放。
7. 核对题号或语言不匹配、编辑器未就绪、目标页已有代码、结果无法关联等降级行为；结果未知时先检查 CF 提交记录，避免重提。
8. 只有用户明确要验证端到端时，才用测试账号和测试题提交一次；不要为验收提交随机代码或重复提交。结果不确定时先检查目标 OJ 提交记录，再决定后续操作。

浏览器重启会清空 `storage.session` 中的任务和待传代码；扩展不会自动重放。若目标 OJ 原生提交已经完成但结果没有被可靠关联，请直接查看目标 OJ 的原生提交记录，再从洛谷重新发起后续操作。

真实浏览器矩阵完成前，当前实现只算自动化验证通过，不能视作 P1/P2 发布验收完成。
