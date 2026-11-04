# 题面导出交互与编辑预览实现计划

> 2026-10-16：题面链已升级为 Adapter → SourceProblem → CNOI Transformer → CnoiProblem → 共用 Markdown Parser → Renderer；复制始终取 Source，编辑初始化取 CNOI，编辑后不再转换。当前职责与验收见[维护说明](../development/problem-markdown-pipeline.md)和[执行报告](../qa/problem-markdown-pipeline-upgrade.md)。下文与此冲突的数据流属于历史实现。Chrome/Edge 原生矩阵仍待实机。

> 2026-10-15 popup 次级操作改为并排等宽、36px 高的淡灰底与淡边框按钮，分别为「编辑 / 预览」和「复制 Markdown」。蓝色「直接导出 PDF」继续为唯一主按钮，时间线和设置保留最低层级；下文纯文字操作相关描述为历史记录。

> 2026-10-15 生成反馈与响应性修复：popup 使用蓝色常亮的「正在生成 PDF…」及旋转指示，不再用等待光标和禁用淡化表达进度。字体、WASM 初始化、题面排版、SVG/PDF 编译统一迁入 `problem-render.worker.ts`，直接导出与编辑页共用 `WorkerProblemRenderer`，主界面仅接收结果。下载结束、Worker 异常和页面关闭均释放相应资源；原有 Typst 模板和串行 shadow 队列继续复用。

> 2026-10-15 直接导出已改为后台采集 → 隐藏的 `pdf-worker.html` 本地 Typst 编译 → Downloads API 下载，不创建或切换标签页。确认下载完成后释放 Blob 并关闭 offscreen document；90 秒超时、下载中断、重复触发均有清理和错误返回。`problem-export.html` 只保留编辑器及其加载/失败状态，原自动下载结果页面已删除。下文直接导出打开页面的描述为原实现记录。

> 2026-10-15 popup 已移除 Split Button，改为全宽「直接导出 PDF」主按钮，下方并排放置带轻量图标的「编辑 / 预览后导出」和「复制 Markdown」文字按钮；时间线和设置继续位于底部。下文 Split Button 相关描述为原实现记录。

> 2026-10-15 编辑页数据流已改为完整 Markdown → `parseProblemMarkdown` → `ProblemDocument` → 现有 Typst Renderer。标题、OJ、题号、原题 URL、时限和内存统一来自 YAML front matter；旧的元信息表单和 `ProblemDraft` 字段状态已移除。编辑器支持行号、语法折叠及较弱的 front matter 高亮，顶部保留轻量导航与导出按钮。下文表单相关描述为原实现记录。

> 状态：已实现。2026-10-14 编辑预览导出已接入现有 Renderer。Chrome / Edge 真机矩阵未运行，不能记为通过。
>
> 基线是已经落地的 [题目页 PDF 实现计划](problem-pdf-export.md) 和 [题面 PDF 可靠性与复用升级计划](problem-pdf-reliability-upgrade.md)。采集、五个 OJ Adapter、`ProblemDocument`、限额、字体和 Typst 发射不重开。
>
> 本文取代原计划里 popup 只有一个「导出题面 PDF」主按钮的交互。可靠性计划里「预览必须展示 Typst 产物，不恢复第二套版式」仍然有效。

## 0. 评审结论

方向可以做，而且不应该新开一条导出链路。风险不在 Split Button，而在编辑页把同一份题面变成第二份会长期分叉的状态。下面这些做法会把现有页面、端口和解析堆成难以回收的分支，本轮明确禁止：

- 在 `apply-draft` 里把旧 AST 和新解析结果逐块拼回去，用来掩盖 Markdown 往返损失。
- 文本框、job、URL 和端口消息各存一份会互相覆盖的题面。
- 抽一个同时知道「自动下载」和「防抖预览」的 hook，再往里加模式开关。
- 编辑页长时间占用 `problem-export` 端口，或让现有的 90 秒总超时拆掉编辑页。
- 每次按键都往 Typst 的 shadow 队列里追加一次编译。
- 解析失败时仍下载上一次的 PDF。
- 预览放不进页面时，顺手加 PDF.js 或恢复 HTML 打印版式。
- 把 Split Button 做成通用菜单框架。

收紧后的规则：后台仍然只交付一次不可变的 `ProblemDocument`。编辑状态只活在编辑页内存里。两种导出只共用纯函数 `renderProblemPdf` 和现有的 Typst Renderer。Markdown 只有在用户真正改过正文时才走现有的 HTML 中转，并且必须先用夹具证明这条中转不会丢掉样例、公式和图片。

## 1. 要补上的行为

支持的题目页上，popup 不再只用一个「导出题面 PDF」按钮。导出分成两条路径，复制保持独立：

1. `直接导出 PDF`：沿用现在的默认 NOI 模板，生成后立即下载。
2. `编辑 / 预览后导出`：打开同一导出页的编辑外壳。左边改题面，右边看同一份 Typst 源编译出的 SVG。导出仍下载 PDF。

直接导出不经过 Markdown 再解析。编辑页只有正文被改过才解析。两条路径最后都把一个 `ProblemDocument` 交给同一个 Renderer。禁止再做一份导出服务、第二套 Typst 模板，或恢复已经删除的 HTML 打印版式。

第一版编辑页只改题目标题、时限、内存和正文 Markdown。后续如果要加排版设置，只能给 `ProblemDraft` 加字段，再由 `applyProblemDraft` 写进现有文档或现有渲染参数。不能加第二套模板，也不能在文本框里放 Typst 源码。

## 2. 当前链路里哪些保持不动

现在的生产路径是：

```text
popup「导出题面 PDF」
  -> START_PROBLEM_EXPORT
  -> background 采集并 extract 一次
  -> ProblemDocument
  -> problem-export.html 经 runtime.Port 接收
  -> TypstProblemRenderer
  -> 下载 PDF
```

`复制题目 Markdown` 另走 `EXTRACT_PROBLEM_MARKDOWN`，剪贴板内容是 `formatProblemMarkdown` 的结果。正文 Markdown 是 `ProblemDocument.markdown`，由 `serializeMarkdown(blocks)` 生成。洛谷 JSON 已经通过 `markdownToHtml` 再进入 `htmlToStatement`。Typst 只读 `blocks`，不在 Renderer 里重解析 Markdown。

这些约束继续有效：

- popup 不接收完整题面，也不编译 PDF。
- background 不编译 PDF。job 仍然只有 token、标签页、原页面 URL 和过期时间。不把 HTML、Markdown、图片、PDF 或 intent 写入 storage。
- 一次导出只 `extract` 一次。编辑页不再回页面采图。
- Typst 的 shadow 队列仍然是 `browser-typst-compiler.ts` 里那个模块级队列。页面不再包第二把锁。
- Typst WASM 仍然只从 `problem-export` 这个 entrypoint 加载。
- 未改正文时，送进 Renderer 的 `blocks` 必须就是 Adapter 提取的那一份。

## 3. Popup 的 Split Button

支持题目时，题目卡片里的主动作改成一组 Split Button。`复制题目 Markdown` 仍是它下面的独立按钮。不支持、识别中和识别失败的状态不显示这组按钮。

```text
OJTrace

Codeforces
1A · Theatre Square

[ 直接导出 PDF | v ]
编辑 / 预览后导出

[   复制题目 Markdown   ]

时间线    设置
```

结构：

```text
problem-actions
├─ ExportSplitButton
│  ├─ 主按钮「直接导出 PDF」
│  └─ chevron，展开后只有一行「编辑 / 预览后导出」
└─ CopyMarkdownButton
```

交互：

- 主按钮和 chevron 是同一行、同一高度的一个控件。chevron 只占窄宽度，不能再排成第二个通栏主按钮。
- 展开后的那一项放在控件下方的普通文档流里，使用文本按钮样式，不使用主按钮样式。扩展 popup 会裁切超出文档盒的浮层，所以这里不做绝对定位弹出层，也不做通用菜单系统。
- 点击主按钮：收起菜单并直接导出。点击那一行：收起菜单并打开编辑页。再次点击 chevron、按 Escape，或点击这项以外的 popup 区域，收起菜单。
- 导出或复制进行中时，主按钮、chevron 和复制按钮一起禁用。主按钮文案仍用「准备导出…」。
- 两条导出路径都先调用现有的 Codeforces 图片权限请求。手势只在 popup 点击时有效，编辑页不再申请权限。
- 复制按钮的文案、超时、剪贴板写入和错误提示保持现状。它不打开编辑页，也不读取编辑页里的草稿。
- popup 宽度维持 `320px`～`360px`。
- 在编辑页能完成预览或明确显示「无法内嵌预览」之前，不把菜单项暴露给用户。intent 的消息测试可以先做。

无障碍：chevron 使用 `aria-expanded` 和 `aria-controls`。展开的那一项是普通按钮。不引入组件库。

## 4. 直接导出流程

直接导出只把按钮文案改成「直接导出 PDF」，并在启动消息里带上意图。采集和下载语义不变。

```text
点击「直接导出 PDF」
  -> START_PROBLEM_EXPORT { intent: "download" }
  -> 创建现有的短时 job
  -> 打开 problem-export.html?intent=download
  -> 导出页连接端口并接收 ProblemDocument
  -> 页面自动 renderProblemPdf
  -> 校验 PDF 头后下载
  -> 关闭 popup
```

- `intent` 只存在于启动消息和导出页 URL。job、fallback job 和 `isProblemExportJob` 不增加字段。
- 消息守卫接受缺省 intent，也接受 `"download"` 和 `"edit"`。其他值拒绝，不另造消息类型，schema 仍是 1。
- URL 缺省或无法识别时，页面按直接下载处理。
- 导出页继续自动下载，不展示编辑器。
- 现有的交付超时、编译失败只显示 `compileDiagnostic`、超时后不下载迟到结果，都只作用于这条直接下载路径。
- job 仍在文档成功交付后删除。完整题面不进 URL。

## 5. 编辑 / 预览页

编辑页不是新的扩展入口。它是同一个 `problem-export.html`，URL 上的 `intent=edit` 选择外壳。后台提取不读取 intent，因此两种路径不会各自演化。

```text
点击「编辑 / 预览后导出」
  -> START_PROBLEM_EXPORT { intent: "edit" }
  -> 与直接导出相同的 job、端口、采集和 ProblemDocument
  -> 页面保存文档后断开端口
  -> 进入编辑外壳，不自动下载
```

端口规则：

- 文档一旦通过现有校验并写入页面状态，编辑页立刻 `port.disconnect()`。此后编译、预览和下载都不再向后台要题面。
- 断开发生在 `deliver` 已经清除 `activeExports` 之后，所以不会把已交付的任务再取消掉。
- 不在编辑期间保持端口。服务工作线程休眠或重连都不得成为编辑状态的一部分。
- 现有 90 秒页面超时只覆盖「等到文档」和直接下载的那一次编译。编辑页收到文档后清除这个定时器。单次预览失败不关闭页面。

刷新编辑页不会恢复草稿。文档不进 storage。job 交付后即删除，刷新只显示现有的「任务已失效，请回到题目页重新发起」。这是本轮的明确边界，不为它增加草稿存储。

### 5.1 页面结构

宽屏是同一块工作区里的左右两栏，而不是两张分开的卡片。窄于约 `960px` 时上下排列。右栏是这份 Typst 源的 SVG，按栏宽缩放；它不是浏览器 PDF 查看器，也不是另一套排版。

```text
页眉：题号（只读）· 来源（只读）          [导出 PDF]
同一工作区
  题目标题 | 时间限制 | 内存限制
  正文 Markdown                 Typst SVG，宽度 100%
                                过期标记或编译诊断盖在预览上
提取警告在工作区上方，不把两栏顶开
```

- `导出 PDF` 是明确操作。预览刷新不得下载。
- 左栏是三个短字段加一个 Markdown 文本框，不引入编辑器依赖，也不做所见即所得设计器。
- 题号、OJ、原题 URL 和语言只读。文件名仍由现有规则从题号和标题生成。
- 原题页面保持不动。

### 5.2 数据流

```text
端口交付的 ProblemDocument          不可变基线，收到后不再更新
        |
        v
ProblemDraft                        只在编辑页内存
  title
  timeLimitDisplay
  memoryLimitDisplay
  markdown                          初始值是 document.markdown
        |
        v
applyProblemDraft(base, draft) -> ProblemDocument
        |
        v
预览：renderProblemPreview(document) -> SVG
导出：renderProblemPdf(document) -> Uint8Array
        |
        +--> 右栏只挂 SVG，按栏宽缩放
        +--> 只有 PDF 字节对应当前草稿时才可下载
```

字段规则：

- 初始 Markdown 用 `document.markdown`，不用 `formatProblemMarkdown`。后者只服务于复制按钮。
- 文本框的值只由用户输入改变。解析后禁止把 `serializeMarkdown` 的结果写回文本框，避免光标跳动和来回解析。
- PDF 页眉标题只来自「题目标题」。正文里的标题仍是正文标题。
- 时限和内存沿用 `parseTimeLimit` / `parseMemoryLimit`。能解析就带上数值；解析不到就只保留 `display`。清空则去掉该字段。不新增单位选择器。
- 正文未改时，返回的文档复用基线的 `blocks`、`assets`、`markdown` 和 `warnings`，只替换标题和限制。判断标准是字符串相等，不先格式化再比较。
- 正文改过时，整份 `blocks` 用下面的现有管道替换，不做新旧 AST 合并：

```text
markdownToHtml
  -> htmlToStatement(html, originalUrl, language)
  -> mergeCapturedImages(新资源, 新警告, 基线里已有数据的资源)
```

- `mergeCapturedImages` 是唯一的贴图函数。编辑页不调用 `captureImages`，不接受新的本地图片，也不另写 URL 匹配。
- 正文改过时，非图片警告保留基线里的原警告；图片是否嵌入只由 `mergeCapturedImages` 的现有结果决定。
- `oj`、`problemId`、`originalUrl` 和 `language` 始终复制基线。

解析失败或编译失败时，右栏保留上一份成功 PDF，但必须标成「预览已过期」。`导出 PDF` 不得下载这份过期字节，也不得把它当成当前草稿的结果。

### 5.3 Markdown 往返门槛

编辑页可以改 Markdown，是因为洛谷已经使用 `markdownToHtml` 和 `htmlToStatement`。这不等于任意 `serializeMarkdown` 的结果都能原样回来。样例目前依赖「输入 / 输出」标签和其后的代码块重新合并；序列化若多写出代码语言、改掉图片或拆掉指令，第一次按键就会让 PDF 变样。

在写出编辑页之前，用现有题面夹具做一次往返比较：

```text
serializeMarkdown(blocks)
  -> markdownToHtml
  -> htmlToStatement
```

比较样例、公式、表格、图片和指令的结构。发现差异时只修 `markdown-serializer.ts` 或 `html-to-statement.ts`。修不动又不值得为了一个构造大改解析器时，停止编辑页，不在 `apply-draft` 里加特例。没有这道门槛，就不能暴露 popup 的编辑入口。

## 6. 实时预览

文本框和三个元信息字段每次输入只改 draft。

调度只保留两个槽：

- 一个正在执行的预览或导出任务。预览只编译 SVG；导出先编译 PDF，成功后再刷新同一份源的 SVG。
- 一个等待中的最新 draft。新的输入替换等待槽，不追加编译。
- 当前编译结束后，如果等待槽仍在，才编译那一版。过期结果只允许丢弃，不能进入右栏，也不能下载。
- 输入停止 `400ms` 后才把草稿放进等待槽。输入法组合期间不计时，`compositionend` 之后再开始。
- 不在页面里再包一层 shadow 锁。少调用，由现有 `enqueueShadow` 保证实际执行不交错。

右栏：

- 预览调用 `$typst.svg`，导出调用 `$typst.pdf`。两者共用 `problemDocumentToTypst`、同一批 shadow 文件和同一个 `enqueueShadow`。
- SVG 放进 shadow root，并设成栏宽的 100%。不使用浏览器 PDF 查看器，避免工具栏、横向滚动和页面被裁切。
- 不放宽 CSP，不加 PDF.js，也不恢复 HTML 版式。
- 直接下载路径不嵌入预览，行为与现在一致。

「导出 PDF」不等待防抖。它把当前 draft 放进等待槽并标记为需要下载。编译完成且 generation 仍是这一版时才下载。已有对应当前草稿的成功字节时直接下载，不再编译。

## 7. 怎样保证只有一套 Renderer

共用的编译入口是一个纯函数，放在现有渲染模块旁：

```text
renderProblemPdf(
  document: ProblemDocument,
  compiler: TypstCompiler,
): Promise<Uint8Array>
```

`renderProblemPdf` 只构造现有的 `TypstProblemRenderer` 并调用 `render`。`renderProblemPreview` 调用同一个 Renderer 的 `preview`，源码和资源与 PDF 相同，输出是 SVG。两个函数都不读取 intent，不处理防抖，也不下载。

`ProblemExport.tsx` 创建一次 `BrowserTypstCompiler`，把这两个函数传给编辑外壳；直接下载只用 PDF：

```text
直接下载外壳 --> renderProblemPdf ----\
编辑外壳导出 --> renderProblemPdf -----+--> TypstProblemRenderer
编辑外壳预览 --> renderProblemPreview -/
```

- 直接下载外壳不导入 `apply-draft`。
- 编辑外壳不导入端口、后台消息或 `BrowserTypstCompiler`。
- 两个外壳都调用同一个 DOM 下载函数。下载前仍做现有的 PDF 头校验。
- 不修改 `template.ts` 和 `statement-to-typst.ts`。编辑不能通过新增渲染参数改变版式。

## 8. 文件

不新增 entrypoint，也不放宽架构审计的入口白名单。

### Popup

- 修改 `entrypoints/popup/main.tsx`。
- 新增 `entrypoints/popup/ExportSplitButton.tsx`。它只包含主按钮、chevron 和固定的一项，不接收菜单配置。
- 修改 `entrypoints/popup/style.css`。

### 导出页

- 修改 `entrypoints/problem-export/ProblemExport.tsx`。它继续拥有端口、文档校验和直接下载超时；收到编辑文档后断口并清除超时，然后把基线文档和渲染函数交给编辑外壳。
- 新增 `entrypoints/problem-export/download-pdf.ts`。只放文件名、PDF 校验和 Blob 下载。
- 新增 `entrypoints/problem-export/ProblemStudio.tsx`。它拥有草稿、两个编译槽、左右栏和导出按钮。
- 修改 `entrypoints/problem-export/ProblemExport.css`。
- 不新增 `use-problem-pdf.ts`。两种生命周期不共享一个有状态 hook。

### 应用层

- 修改 `src/application/problem-export/messages.ts` 的启动消息和守卫。
- 修改 `src/application/problem-export/client.ts`：`startProblemExport(tab, intent = "download")`。
- 修改 `src/application/navigation/extension-pages.ts`，只在打开页面时写入 URL。
- 修改 `src/application/problem-export/service.ts` 的 `start`，让它把 intent 传给打开页面的函数。`deliver` 不分支。
- 不修改 `export-state.ts` 的 job 形状。

### 题面模型

- 新增 `src/problem/apply-draft.ts`。这里只有草稿类型和 `applyProblemDraft`。
- 新增 `src/problem/render/render-problem-pdf.ts`。
- 往返差异若存在，只改 `src/problem/extract/markdown-serializer.ts` 或 `src/problem/extract/html-to-statement.ts`。
- 时限和内存继续用 `src/problem/extract/metadata.ts`。贴图继续用 `src/problem/merge-images.ts`。

### 配置

- CSP 只有 spike 证明必要时才改 `wxt.config.ts`。对应的 manifest 审计一起改那一项。
- 不新增权限，不加 `contextMenus`。

## 9. 实现顺序

### 阶段 0：两道门槛

- 夹具往返比较。过不了就先修共享解析，不开始编辑页。
- blob 预览 spike。失败就确定本轮右栏只显示说明，不引入查看器。

### 阶段 1：纯渲染函数

抽出 `renderProblemPdf` 和 `download-pdf`。直接导出的外部行为不变。

### 阶段 2：intent

消息、URL 和打开页面的路径带上 intent。此阶段可以测两种 URL，但不显示 popup 菜单项。`download` 仍自动下载。

### 阶段 3：编辑外壳

接上草稿、往返、两个编译槽、右栏和导出按钮。端口在收到文档后断开。然后才显示 popup 菜单项。

阶段 1 和阶段 3 结束时运行：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm format:check
pnpm audit:architecture
pnpm build
```

`pnpm build` 必须继续证明 Typst chunk 只被 `problem-export` 引用。

自动检查至少覆盖：

- 主按钮发送 `download`，菜单项发送 `edit`，复制按钮仍走原消息。
- 非法 intent 被守卫拒绝；缺省 intent 打开的 URL 按下载处理。
- job 存储器里没有 intent、Markdown 或 PDF。
- 两种 intent 的 `deliver` 提取次数和文档一致。
- 只改标题或限制时，`blocks`、`assets`、`markdown` 和 `warnings` 仍是基线值。
- 改动 Markdown 后才调用 HTML 中转；图片只通过 `mergeCapturedImages` 按完整 `sourceUrl` 贴回。
- 往返夹具覆盖样例、公式和图片。`apply-draft` 的源码不包含按块回退到旧 AST 的分支。
- 连续输入最多产生一个在飞编译和一个等待草稿。过期结果不展示、不下载。
- 解析或编译失败后，导出不会下载上一份 PDF。
- 编辑页收到文档后不再发送端口消息。90 秒定时器不会在收到文档后把编辑页改成错误态。

Chrome/Edge 里的按钮、CSP、预览和五个 OJ 仍按浏览器矩阵人工验收。未运行的检查不能记成通过。

## 10. 本轮明确不做

- 不新增 `entrypoints/problem-editor` 或其他 PDF 页面。
- 不恢复 HTML 打印 Renderer，也不把 Markdown 直接交进 Typst。
- 不加 PDF.js 或其他预览渲染器。预览 SVG 来自现有 Typst 编译器，不是第二套版式。
- 不做字体、页边距、页眉样式、模板选择或 Typst 源码编辑。
- 不编辑题号、OJ、原题 URL 和语言。
- 不把草稿、完整文档或 PDF 写入 storage。
- 不在编辑页重新抓取题目或图片。
- 不改复制按钮的 Markdown 格式。
- 不把直接导出改成先转 Markdown 再解析。
- 不把编辑页的端口保持到用户关闭页面。

## 11. 实现记录

2026-10-15 更正预览呈现：浏览器 PDF iframe 会带上查看器工具栏，页面也不能按栏宽缩放，工作区被切成两张卡片。预览改为与 [cnoi-statement-generator](https://github.com/Mr-Python-in-China/cnoi-statement-generator) 相同的方式，把同一份 Typst 源编译成 SVG，放在同一块工作区的右栏。导出仍是 PDF，不新增模板或 PDF.js。

代码已按本文落地。直接导出和编辑页共用 `renderProblemPdf`。编辑状态只在页面内存。正文未改时复用基线 `blocks`、`assets`、`markdown` 和 `warnings`；正文改过才走现有 HTML 中转，并用 `mergeCapturedImages` 按完整 `sourceUrl` 贴回图片。

预览更正后已重新通过：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`（736 通过，1 跳过）
- `pnpm test:contract`（276 通过）
- `pnpm format:check`
- `pnpm audit:architecture`
- `pnpm build`。Typst chunk `esm-DcUtR0X6.js` 只被 `problem-export` 引用。
- 真实 Typst WASM 会把同一份题面编译成以 `<svg` 开头的预览

未运行：Chrome / Edge 里的按钮、CSP、预览和五个 OJ 手工验收。这些不能记为通过。
