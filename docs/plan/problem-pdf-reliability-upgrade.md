# 题面 PDF 可靠性与复用升级计划

> 状态：代码和自动门禁已完成。真实浏览器矩阵仍未执行，不能记为通过。制定日期：2026-10-14。完成日期：2026-10-14。
>
> 自动门禁：`pnpm typecheck`、`pnpm lint`、`pnpm test`（719 通过，1 跳过）、`pnpm test:contract`、`pnpm format:check`、`pnpm audit:architecture`、`pnpm build`。构建里 Typst chunk 只被 `problem-export` 引用。
>
> [题目页 PDF 实现计划](problem-pdf-export.md) 保留已落地的功能和验收记录。后续可靠性、复用和扩展边界以本文为准。

## 0. 完成记录

P1–P6 和图片收口已经落在当前工作区。没有补写事后基线。已知差异仍有效：HTML 页眉本来就不同于 Typst；洛谷探针标题可以不同于 JSON 标题。

自动检查已通过。Chrome/Edge 里的真实下载、CSP、五个 OJ 和自部署 Hydro 仍按浏览器矩阵单独验收，本文件不把它们记成通过。

## 1. 升级目标与范围

本轮要减少 PDF 链路上各自演化的转换和限额，让失败可解释，并让新增题面结构或新 OJ 有固定落点。

| 目标 | 完成后应能观察到的变化 |
| --- | --- |
| 可靠 | 正文提取成功后，图片失败仍能导出 PDF；同一导出页里的编译不会互相覆盖 shadow；公式或模板导致的编译失败能在导出页看到原因 |
| 可维护 | 真正重复的限额各有一个数据入口；字体文件和视觉参数分开；站点特例由该 Adapter 调用，不注册进核心 |
| 可扩展 | 新的 `StatementBlock` 或行内节点漏渲染时，类型检查失败；新 OJ 先写自己的清理函数，再调用现有转换 |
| 实际减少重复 | Typst 发射不再用松散对象；图片类型只判断一次；样例框外壳只写一次；HTML 打印不再维持第二套版式 |

不以文件行数、新增抽象个数或删除测试数量作为成功标准。不能靠多一个注册表、预算对象或解析器来宣称已经复用。

范围约束：

- 不更换 Typst WASM、WXT、React 或消息协议，不把编译移到服务器。
- 不改变 A4、页眉、样例框、表格和正文字号的既有视觉结果，除非某一阶段写明是合同修正并附对照。
- 不提高或降低现有图片大小、张数和 HTML 截断值。去重只消除第二份数字。
- 不把提交同步 Adapter 和题面 Adapter 合成一个框架，也不为五个 OJ 做通用页面 DSL、提取器钩子或 Adapter 基类。
- 页面注入函数仍然不能 import 模块。只能把该函数实际用到的数字作为参数传进去。

不包含：多题合并、题解、提交代码、右键菜单，以及 Chrome/Edge 真实扩展矩阵本身。那份矩阵仍按 [题面 PDF 浏览器验收矩阵](../qa/problem-pdf-browser-matrix.md) 单独验收。

## 2. 当前链路与要处理的问题

当前生产路径：

```text
popup
  -> background ProblemExportService
  -> 页面内 capturePage / captureImages
  -> ProblemAdapter.extract
  -> ProblemDocument.blocks
  -> problemDocumentToTypst
  -> BrowserTypstCompiler
  -> 导出页下载 PDF
```

复制 Markdown 使用同一次提取产生的 `markdown`，不进入 Typst。HTML 打印渲染器不参与这条路径。编译器跑在导出页，不在后台；两个导出页没有共享的 shadow 文件系统。

| 编号 | 问题 | 现状 | 升级要求 |
| --- | --- | --- | --- |
| R1 | Typst 发射不穷尽 | `statement-to-typst.ts` 把节点收成 `UnknownRecord`，未知类型静默变成段落，还保留旧别名 | 按 `StatementBlock` 和 `InlineNode` 穷尽。穷尽只证明没有漏分支，不证明 Typst 语法正确 |
| R2 | 纯文本被再次解释 | 文本节点里的 `$...$` 会再走 `mitex` | 先用现有夹具确认公式已经在数学节点上。确认后文本只转义。若夹具仍依赖这次重扫，修提取器，不保留两个公式解释器 |
| R3 | 公式失败没有诊断 | 公式经 `#mi` 交给 MiTeX。字符串阶段不会失败；编译失败时整份 PDF 失败，导出页只有笼统错误 | 展示编译诊断。不把失败公式改写成正文，也不再加一套 TeX 预检查 |
| R4 | 限额多处手写 | 512KB 和 2MB 写在页面采图、扩展拉图和 Typst 准备三处。`snapshot.ts` 的 HTML 上限小于真实采集。页面脚本另有一套图片魔数嗅探 | 只合并已经有两个调用方的数字。图片类型只由 `embeddableImageType` 判断。只出现一次的超时和交付体积留在原操作旁 |
| R5 | 有图就整页再提取 | `deliver` 提取后采图，再跑一次 Adapter。第二次失败则悄悄留下第一次结果。页面返回值会把 `sourceUrl` 改成解析后的地址 | 只提取一次，并用现有贴图函数按请求时的 `sourceUrl` 贴回。采图超时仍有上限，但不再丢掉已经提取的正文 |
| R6 | 同一页里的编译可重入 | 导出页模块级编译器共用一个 shadow，`compile` 没有锁。页面超时不能取消已经进入 WASM 的调用 | 同一页内的编译串行，临界区包含最后一次 `resetShadow`。超时后丢弃迟到的 PDF。不建跨页面锁 |
| R7 | 字体名单可能漂移 | `FONT_PATHS` 与 `style-tokens.ts` 的字体族各写一份，但二者不是同一类数据 | 文件清单和视觉参数保持两个模块。测试只约束路径存在、样式族名都在清单声明中。不解析字体 name table，也不合成一个字体样式对象 |
| R8 | 样例框外壳写了两遍 | `template.ts` 的 `#show raw` 和 `oj-sample-lines` 各画一套框。HTML CSS 已与 Typst 不一致 | 共用框的外壳。行内容仍按代码行和样例行分别处理。HTML 退出 PDF 版式合同 |
| R9 | 共享提取器里有站点痕迹 | 通用提取器含洛谷样例标题函数，以及注释写成 Codeforces 专有、实际被多站使用的分隔和复制按钮规则。洛谷 JSON 经 Markdown 和 HTML 回到 AST | 只移走夹具证明只影响一个站点的清理。`$`/`$$` 扫描和通用复制按钮留在原处。不新增第二套块构造器，也不删除 HTML 中转 |
| R10 | 预览和 PDF 标题本来就可以不同 | 探针不复制 JSON，`ProblemPageProbe` 也没有 `sourceData`。洛谷弹窗标题来自 DOM，PDF 可优先用 JSON 标题。各 Adapter 的 inspect 和 extract 已经共用标题函数 | 保持这个差异。不给字段加预览标记，也不把 JSON 复制进探针。显示名改为读来源定义；主语言子标签只留一个函数 |

显示名和语言归一化并入 R10 的收尾，不单独立项。`problemDisplayName` 改为读取 `sourceDefinitions.metadata.displayName`，不再保留一份手写枚举。PDF 页眉怎么排继续留在渲染器。`documentElement.lang` 的主语言子标签只用一个函数：按 `-` 分割取第一段，只认 `zh`、`en`、`ja`，其他非空值是 `other`，空值保持空。写作时 `common.ts` 的 `startsWith` 会把 `japanese` 认成日语；该实现已经换成 `normalizeProblemLanguage`，还要删的只是 P5 里的转发别名。Hydro 和 AtCoder 的 `lang` 查询参数继续精确匹配，不调用这个函数。

## 3. 兼容合同

实施前先记录当时的 commit、相关未提交差异，以及 `pnpm typecheck`、`pnpm test`、`pnpm test:contract` 的结果。不沿用本文写作时的历史测试数量。

必须保持：

1. 导出页只下载通过 `%PDF-` 校验的字节。Typst 不可用时不生成 HTML 冒充 PDF。
2. 图片采集或嵌入失败不把已经提取的正文变成失败。公式在提取阶段保持数学节点；编译阶段失败则整份 PDF 失败并展示诊断，不降级成正文。样例结构仍按现有提取规则处理，本轮不承诺单个样例异常也能输出成功 PDF。
3. 图片策略维持单张 512KB、合计 2MB、最多 12 张，以及现有可嵌入 MIME。超出的图保留原图链接和 `image-unembedded` 警告。
4. 页面探针继续做 DOM 裁剪；快照继续保留 Adapter 选根所需的正文。生产快照上限仍是 3MB，探针 HTML 上限仍是 512KB。
5. 任务 token、端口阶段、URL 校验、取消和“存储短暂不可见时用 fallback job”保持不变。渲染警告不进入端口协议。
6. 复制 Markdown 仍从 `StatementBlock` 序列化，不从 Typst 或 HTML 反推。
7. 已有样例行距、公式和真实 Typst smoke test 的预期继续有效。R2 只有在夹具证明可以去掉重扫后才允许改变公式输出，并把差异写进该阶段记录。

允许且必须单独立项的行为修正：

- 正文已经提取成功后，采图超时或失败不再把整个导出变成“处理超时”。交付带警告的文档。用户取消整次导出时，采图仍然取消。
- `createSnapshot` 和 `isProblemPageSnapshot` 改为接受生产快照上限 3MB。这只放宽测试助手和本地校验，不改变页面里已经按 3MB 截断的采集结果。
- Typst 或 MiTeX 编译失败时，导出页展示简短诊断，并且不下载文件。不把失败公式改成普通文本后再生成一份成功的 PDF。用户可见文案仍避免堆栈和内部路径。

消息 schema、权限、存储结构和同步链路不在本计划内改变。

服务端计时在文档消息发出时结束。现有 `30_000 * 3` 仍是这个期限的长度，不再把它解释成“可能提取三次”，也不改成别的数字。正文捕获或提取还没完成时，期限到了仍是整单超时。提取已经成功后，同一期限只中止剩余采图，然后交付带警告的正文。导出页现有 90 秒覆盖“等待文档加上编译”，不把编译倒计时改成服务超时的剩余时间，也不再叠加第二个 90 秒。

## 4. 完成后的模块职责

```text
Adapter 一次 extract
  -> 已有贴图函数补上图片字节
  -> 穷尽的 statement -> Typst
  -> 导出页内串行编译
  -> 成功则下载 PDF；编译失败则在本页展示诊断
```

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `src/problem/statement.ts` | 题面 AST | HTML、Typst、OJ、限额 |
| `src/problem/budget.ts` | 两组已重复常量：HTML 捕获、图片字节和张数 | 交付体积、字体、MIME、超时、编译和策略函数 |
| `src/problem/snapshot.ts` | 用 HTML 捕获上限构造探针和快照 | 图片嵌入和交付体积 |
| `src/problem/extract/html-to-statement.ts` | 通用 HTML 到 AST，含数学分隔、KaTeX、MathJax、TeX script 和通用复制按钮 | 单站输出分支、采图、Typst |
| `src/problem/extract/markdown-to-html.ts` | Markdown 到 HTML。生产上只有洛谷调用 | 洛谷字段、样例重组、直接构造语句块 |
| `src/problem/extract/image-type.ts` | 唯一的图片类型判断，以及这四种类型的文件后缀 | 张数、字节上限、页面脚本、第二份后缀表 |
| `src/problem/merge-images.ts` | 按请求时的 `sourceUrl` 贴回字节，并且只在这里去掉已经嵌入成功的 `image-unembedded` | 采图、第二次提取、类型判断 |
| `src/problem/adapters/*` | 选根、站点清理、调用通用转换、标题和限制 | Typst、注入脚本、限额字面量 |
| `src/application/problem-export/service.ts` | 标签页、任务、端口、调用贴图、文档 5MB 和 Markdown 2MB | 第二遍题面解析、Typst 语法、图片和 HTML 限额字面量 |
| `src/problem/render/statement-to-typst.ts` | AST 到 Typst 正文 | 抓取、OJ、shadow |
| `src/problem/render/template.ts` | 页眉、页脚和样例框外壳 | 站点块规则 |
| `src/problem/render/style-tokens.ts` | 字号、边距和字体族名字 | 字体文件路径 |
| `src/problem/render/font-manifest.ts` | 打包字体路径，以及每个文件人工声明的 Typst 族名 | 字号和页边距 |
| `src/problem/render/browser-typst-compiler.ts` | 单个导出页里的 WASM 会话队列 | 文档模型、跨页面协调 |
| `entrypoints/problem-export` | 下载、本页警告和 90 秒等待 | 提取、限额定义 |
| `src/sources/definitions.ts` | 来源显示名等静态事实 | PDF 页眉排版 |

约束：

- `StatementBlock` 仍是 PDF 和 Markdown 的唯一中间结构。
- 注入页面的函数只处理 DOM 和本次传入的限额，返回 JSON 可序列化的结果。它不复制限额字面量，不判断图片类型，也不认识某个 OJ。
- 站点特例是 Adapter 文件里的普通函数。通用提取器不保存回调列表，Adapter 也不向它注册。
- `render` 继续返回 PDF 字节。编译失败抛出带简短诊断的错误，由导出页接住。不要为了传递警告改变返回值，也不要让每个排版函数返回字符串加数组。
- HTML 打印不再是第二种排版实现。

## 5. 分阶段实施

每个单元独立完成迁移、删除旧维护点、验证和记录。没有两个调用方的共享模块不新增。

| 阶段 | 内容 | 依赖 | 退出标准 |
| --- | --- | --- | --- |
| P0 | 记录基线、现有夹具和已知双路径差异 | 无 | 后续阶段能对照同一基线，不把已有差异当成新回归 |
| P1 | R1、R2：穷尽 Typst 发射，文本不再重扫 | P0 | 新增块类型无法静默丢弃；公式夹具要么不变，要么有记录过的提取器修正。编译诊断留到 P4 |
| P2 | R4：合并重复限额，图片类型只判断一次 | P0 | 生产数值不变；512KB 和 2MB 不再出现第二份；页面脚本不再嗅探图片类型 |
| P3 | R5：取消第二次提取 | P2 | 采图失败仍交付第一次文档；`extract` 只有一次；贴图规则只有一份 |
| P4 | R6、R7：页内编译互斥和字体清单 | P1 | shadow 操作不交错；超时调用不能抢先重置；资源加载失败、`pdf()` 报错和调用方超时可区分 |
| P5 | R9、R10：只移动夹具证明的单站清理；显示名和主语言子标签各留一处 | P1、P3 | 通用公式和复制按钮仍在通用提取器；洛谷仍走现有 HTML 中转；探针仍不读 JSON |
| P6 | R8：只共用样例框外壳，移除 HTML 版式 | P1 | 样例行距不变；行号不进外壳；补两条 Typst 断言后删 HTML，不把 HTTP 白名单搬进 Typst |

P2 可以和 P1 并行。P5 不提前做。P5 不重写洛谷主解析器。

### P0：基线

记录当前 commit、PDF 相关未提交改动，以及类型检查、单元测试和契约测试结果。列出以下夹具作为视觉和行为基线：Typst 编译 smoke、CSP 编译、样例行距、渲染器快照、导出服务采图和五个 OJ Adapter。

额外记录两类现有差异，避免后面误当回归：HTML 页眉和限制行已经不同于 Typst；洛谷探针标题可以不同于 JSON 标题。

不在本阶段改生产代码。

### P1：穷尽 Typst 发射

修改 `src/problem/render/statement-to-typst.ts` 及其调用方。图片尺寸、图组和表格对齐也改为读取正式类型，不只改最外层 switch。

- 语句块和行内节点使用判别联合，不把节点改成 `Record<string, unknown>`。
- 删除运行时别名。输入端继续只产生正式类型。
- 没有 `default` 落成段落。`never` 分支只用于证明穷尽。
- 先跑现有公式夹具，区分输出来自数学节点还是文本重扫。全部来自数学节点时，文本只转义。仍有文本重扫命中时，把对应来源补成数学节点后再删除重扫。
- 现有 `mitex` 继续只负责把 LaTeX 放进 `#mi` 字符串。它不会抛出转换错误。P1 不给它加预判，也不恢复另一套 TeX 转换器。
- 不修改 `ProblemRenderer.render` 的返回类型。采图警告仍走 `ProblemDocument.warnings`。编译诊断留在 P4。

合同测试构造每种块和行内节点，断言都有非空 Typst。这只阻止漏分支。语法和版式仍以现有编译夹具和样例行距测试为准。故意写错的公式只断言源码仍是引用过的 `#mi` 字符串，不断言它能编出 PDF。

### P2：只合并重复的限额

新增 `src/problem/budget.ts`，只导出两组已经有多个调用方的冻结常量：

- HTML 捕获：探针 512KB，快照 3MB。`snapshot.ts` 和导出服务的页面捕获都引用这一组。
- 图片：单张 512KB，合计 2MB，最多 12 张。字节上限同时给采集、扩展补拉和 `prepareTypstDocument`。12 张只作为参数传给采集，渲染器不按张数再丢图。

文档 5MB 和 Markdown 2MB 只有 `deliver` 在用，继续留在导出服务。不要为了“限额都进一个文件”把它们搬进 `src/problem`。也不要把字体、MIME、5 秒、8 秒、15 秒、30 秒或 90 秒放进 `budget.ts`。这些超时没有第二份拷贝，移动它们只会得到一个什么都管的配置模块。页面采图和扩展补拉继续把超时写在各自操作旁。

`captureImages` 从参数接收字节上限和 12 张上限，函数体不再写这些数字。`scripting.executeScript` 的参数和返回值必须能用 JSON 序列化，不能返回 `Uint8Array`：它会变成普通对象或直接失败。页面按大小和张数截断后，返回请求时的 `sourceUrl`、base64 字符串，以及响应声明的 Content-Type。扩展侧先解码，再调用 `embeddableImageType(声明类型, 字节)` 并生成 data URL。渲染器把 data URL 放进 shadow 前用同一个函数再核一次；这是不可信文档边界，不是第二套策略，也不要为了“只调用一次”删掉它。页面脚本不调用它。不能只交字节，否则原来靠 `image/svg+xml` 放行、但文件头不符合嗅探规则的图会被丢掉。页面不判断 MIME，也不为 MIME 生成警告；类型不通过时由扩展侧给出现有的 `image-unembedded`。删除页面脚本里的 PNG、JPEG、GIF 和 SVG 魔数分支。不向页面传递 MIME 列表，也不再从页面返回 data URL。张数截断和 `image-count-limit` 警告只留在页面函数这一处。

`readExtensionImage` 和 `prepareTypstDocument` 使用同一组字节上限。渲染器不重新套用 12 张限制，也不再写类型正则。

`createProbe`、`createSnapshot` 和 `isProblemPageSnapshot` 改用生产 HTML 上限。检查现有调用，确认只是助手上限从 96KB/2.5MB 对齐到生产截断值，而不是让页面采集变大。探针的 DOM 裁剪规则保持原样。

本阶段不动字体文件清单。

### P3：图片贴回，不再第二次提取

提取完成并得到 `ProblemDocument` 后：

1. 没有图片时直接交付。
2. 有图片时，只按文档里已经记录的 `sourceUrl` 采集字节。不再解析 HTML 来重新发现图片。
3. `extractDocument` 里现有的按 `sourceUrl` 合并 data URL、MIME 和警告的逻辑提取成一个纯函数。直接调用 Adapter 时，这个函数仍处理快照上已经带有的图片。`deliver` 只在采图之后对已经得到的文档调用一次，不再提取第二遍，也不把同一批字节合并两次。
4. 合并键只用文档和采图请求里的 `sourceUrl`。页面解析出来的最终地址只用于 `fetch`，不能替换这个键。已经嵌入的请求地址不得因为 href 规范化和请求地址不同而再走一次扩展拉取。后来嵌入成功就去掉对应 `image-unembedded` 的规则只留在 `mergeCapturedImages`。匹配方式见下面的收口，不用子串包含。
5. 页面访问或采图失败时保留正文，为未嵌入图片添加现有警告。
6. 采图使用子取消信号。页面内 15 秒、单张 5 秒和扩展单张 8 秒仍写在各自操作旁。父级 `30_000 * 3` 到期时，如果正文已经提取成功，只中止子信号并交付带警告的文档；正文还没提取成功时，仍是整单超时。用户取消中止子信号并且不交付。页面 URL 变化仍是现有的 `tab_changed`，不降级成警告。
7. 不要在提取成功后 `clearTimeout` 来解除总期限。那会让卡住的 `executeScript` 一直占着 `activeExports`。超时后忽略迟到的页面结果，不要把它们再贴进已经决定交付的文档。

正文采集和提取失败仍按现有错误失败。导出页 90 秒的含义见第 3 节，本阶段不改它的长度。

测试里的 registry mock 记录 `extract` 调用次数，成功采图时期望为 1。采图抛出 `capture_failed`、页面内采图超时或服务期限在采图阶段到期时，端口仍收到原文档和警告。部分图片超限时，成功的图片被嵌入，其余保留链接。用户取消或 `tab_changed` 时不交付文档。

### P4：导出页内的编译会话

修改 `src/problem/render/browser-typst-compiler.ts` 和导出页。

- 队列只保护这个页面模块里的同一个编译器。不使用存储、后台或跨页面锁。
- `typstApi()` 的单次初始化可以留在队列外。进入队列之后才能碰 shadow。一个名额包含 `resetShadow`、映射文件、`pdf`，以及 `finally` 里的 `resetShadow`。
- 调用方超时后立即向该次导出返回失败，并丢弃之后才返回的 PDF，不能下载。名额仍占到 WASM 调用结束并完成重置。下一个编译在这之前不能映射文件。同一页上的重试只是继续排队，不能插队或提前重置。
- 不提供“看到超时就报告忙并开始重置”的第二条策略。WASM 永不返回时，该页面的后续编译继续等待；提示关闭导出页后重试。计划不假设 Typst 可以被中止。
- 编译错误把简短诊断留在导出页。只区分三处已经分开的失败：字体或资源加载失败、`pdf()` 抛错、调用方超时。不要解析 Typst 诊断文本去猜测缺的是哪一个字体。用户文案不暴露绝对路径和堆栈。
- 假编译器测试断言两组 shadow 操作的顺序不交错，并断言第一组的最终重置早于第二组的映射。不要求超时返回的同一时刻 shadow 已经为空。

新增 `src/problem/render/font-manifest.ts`，列出打包路径和人工声明的 Typst 族名。编译器只从这里读取路径。`style-tokens.ts` 不引用路径。测试断言每个路径都在 `public/problem-fonts` 下存在，并且样式里使用的每个族名都出现在清单的声明族名中。一个族可以对应多个字重文件。声明和样式字符串不一致时，修正其中一份错误字符串，不写模糊匹配。本轮不解析字体文件内部的 name table；自动测试不能被说成已经证明文件内部族名正确。更换字体文件时，要同时核对清单里的人工声明。

真实 WASM 不能被取消这一点写入浏览器验收矩阵的已知限制，不记成自动测试已经证明可中断。

### P5：站点差异留在调用方

先用现有 roundtrip 夹具冻结通用提取结果，再移动调用位置。

- 不新增提取器钩子、回调注册表、pass 列表或 Adapter 基类。
- `$`、`$$`、`$$$` 和 `$$$$$$` 仍由通用提取器的同一次分隔扫描处理。洛谷 Markdown 也依赖 `$` 和 `$$`。不要把这套扫描拆进 Codeforces Adapter。
- `input-output-copier` 可以由 Codeforces Adapter 在调用 `htmlToStatement` 前从题面根去掉。`copy-button`、`click-to-copy` 和 `data-clipboard-target` 仍留在通用提取器。KaTeX、MathJax 和 TeX script 同样留在原处。
- `输入 #1` 这种样例标题整理，先用五个 OJ 的夹具确认影响范围。只有洛谷依赖它时，才移到洛谷 Adapter 的块后处理。其他站点也依赖时，去掉函数名里的站点前缀并留在通用样例合并中。多站共用的样例合并留在原处。
- 不新增 `markdownToStatement`。洛谷 JSON 现在只有一处 `markdownToHtml`，各段转成 HTML 后再和现有样例 HTML 拼成一份文档，经 `extractDocument` 进入 `htmlToStatement`。这仍是唯一的块构造路径。为一个调用点再包一层，测试却继续分两步调用，只会多一个名字。
- DOM 回退在 JSON 不可用时保留，并且也调用同一个 `htmlToStatement`。
- 不给 capture hints 加预览标记，也不把 JSON 复制进探针。`capturePage` 今天只在快照模式读 `jsonScripts`，`ProblemPageProbe` 没有 `sourceData`。洛谷探针标题继续来自 DOM，PDF 仍可优先使用 JSON 标题；这个差异留在 P0 的基线里。
- 各 Adapter 的 inspect 和 extract 已经共用标题、限制和选根函数。本阶段只在发现第二份手写拷贝时，把拷贝并回该 Adapter 文件里的现有函数。不把五个 OJ 的流程提升成公共模板。
- `problemDisplayName` 读取 `sourceDefinitions.metadata.displayName`，删除手写 switch。`src/problem/domain.ts` 可以引用 `src/sources/definitions.ts`，因为来源定义不引用题面模块。错误码、诊断标识和账号 label 不改。
- 主语言子标签只留 `normalizeProblemLanguage`。`common.ts` 的 `startsWith` 已经不在。还留着只做转发的 `normalizeLanguage`，AtCoder 是唯一调用方。删掉这个别名，AtCoder 直接调用 `normalizeProblemLanguage`。不要为了一个调用点留兼容名字。Hydro 和 AtCoder 的 `lang` 查询参数继续精确匹配，不调用这个函数。

完成标准是通用提取器不再为了单个站点改变输出。用夹具证明某条单站清理不运行时，该站专有控件不会被误删，其他站点的公式和样例仍在。不要用“源码禁止出现站点名字”的扫描代替这些夹具。新增 OJ 的特殊 DOM 放在自己的 Adapter 里。只有第二个站点出现同一条规则时，才把那条规则移入通用提取器。

### P2/P3 收口

限额、一次提取和 `mergeCapturedImages` 已经在工作区。这里只补三个已经露出的洞，不重做搬迁，不新开阶段。

- 栅格类型不能只信声明。`embeddableImageType` 现在看到 `image/png`、`image/jpeg` 或 `image/gif` 就返回，不再看字节。标成 PNG 的 HTML 会进 Typst，整份 PDF 编译失败，前面的采图降级就白做了。声明是这三种时，必须和现有 `sniffImageType` 的结果相同，否则返回 undefined，走现有 `image-unembedded`。`image/svg+xml` 仍信任声明，因为现有文本嗅探会漏掉合法 SVG。空类型和 `application/octet-stream` 仍只靠嗅探。不新增校验模块，不改变 512KB、2MB 和 12 张。
- 四种 MIME 和文件后缀放在 `image-type.ts` 的同一张表里。`prepareTypstDocument` 删掉自己的 `imageExtensions`。表里没有的类型不能嵌入。不要把这张表放进 `budget.ts`，也不要另建 MIME 注册表。
- 去掉已经嵌入图片的 `image-unembedded` 只发生在 `mergeCapturedImages`。条件是警告文案以 `：` 加这个 `sourceUrl` 结尾，不用 `includes`。`https://x/a` 嵌入成功时，不得清掉 `https://x/a.png` 的警告。删掉 `fetchMissingImages` 里的同款过滤。不给 `ProblemWarning` 增加 url 字段。现有文案必须仍以该 URL 结尾。`image-time-limit` 和 `image-count-limit` 不参与这条过滤。

测试只覆盖这些边界：声明 PNG 但字节是 HTML 时不嵌入；声明 PNG 且魔数相符时嵌入；`octet-stream` 加 PNG 魔数仍嵌入；声明 SVG 且不以 `<svg` 开头时仍可嵌入；两个互为前缀的 URL 只清除真正嵌入的那条警告。

### P6：版式只留 Typst

`#show raw` 和 `oj-sample-lines` 各写了一套框：外层 gutter、左右描边、inset、上下两条线。行的排法不是重复。普通行走 `show raw.line`。含公式行自己循环，最后一行不要 trailing leading。

- 只提取外壳，做成接收正文的一个 Typst 函数。它拥有外层两个 block、边框、inset、上下横线，以及两边都有的 `set par(spacing: 0pt)`。`#show raw` 和 `oj-sample-lines` 都把各自的行放进这个正文槽。
- 行号、`measure`、`show raw.line`、公式行循环和最后一行 `below: 0pt` 留在调用处。不要把行号位置放进外壳。两套行号来源塞进同一个函数，就会出现模式开关。
- 不加 `last`、`math`、`raw` 之类的参数，也不再抽一个同时服务两种行的行函数。行号那一次 `place` 允许继续各写一遍。
- 样例行距测试的关键尺寸，以及最后一行不留额外 leading，保持不变。外壳如果改变正文和底边的相对位置，撤回外壳，不要加参数把它救回来。
- 含公式样例行里把 `...` 换成 `\ldots` 的那一处保留。它只服务行距，不是已经删掉的正文重扫。不要扩成公式规范化，改外壳时也不要顺手删掉。`plainCodeMath` 不动。
- 先补 Typst 断言，再删 HTML。现有 Typst 测试已经覆盖正文转义，以及未嵌入图片走 `#link` 而不是 `#image`。只补两条：未嵌入图片的链接文字包含“查看原图”；链接 URL 里的引号和 `#` 留在 `#link("...")` 里面。然后删除三则 HTML 测试：打印页相似、HTML 公式 class、打印回退图片。不要把 `safeResourceUrl` 的 http/data 白名单搬进 Typst。PDF 链接不是浏览器跳转，新白名单会是第二套策略。
- 删除 `HtmlPrintRenderer`、`htmlPrintCss`、`blocksToHtml` 和 `createProblemRenderer`。后者没有生产调用方，不要留一个只负责抛错的工厂。导出页继续直接构造 `TypstProblemRenderer`。`style-tokens.ts` 里把 HTML 打印写成后备的注释改成只描述 Typst。

不把 HTML 重写成另一套 visitor。以后需要预览时展示 Typst 产物或明确诊断，不恢复第二套版式。

## 6. 验证

每个阶段至少运行与改动直接相关的测试，阶段结束再跑：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm format:check
pnpm audit:architecture
```

P4 和 P6 若改变导出页打包内容，再运行 `pnpm build`，确认 Typst WASM 仍只由导出页加载。

必须新增或扩展的自动检查：

- 所有语句块和行内节点都有 Typst 分支。编译夹具继续负责语法和视觉回归。
- 512KB 和 2MB 由图片嵌入常量的同一引用决定采集和渲染。
- 图片字节只经过 `embeddableImageType`。渲染器可以再次调用它，页面脚本不能。声明为 png、jpeg、gif 但魔数不符的字节不嵌入；声明为 svg 时仍可在嗅探失败时嵌入。文件后缀和这四种类型同一张表。
- `image-unembedded` 只由 `mergeCapturedImages` 按 URL 结尾删除。互为前缀的地址不会互相清除。
- 一次导出只调用一次 `extract`。用户取消、`tab_changed` 和采图超时的结果不同；采图超时仍受现有服务期限约束。贴图键是请求时的 `sourceUrl`。
- 页面采图返回值是 JSON 可序列化的 base64 和声明类型，不包含 data URL。
- 同一页内两组编译的 shadow 操作不交错，最终重置早于下一次映射。超时后迟到的 PDF 不会被下载。
- 字体清单路径存在，样式族名都能在清单声明中找到。测试不声称已经核对字体文件内部族名。
- 用夹具证明单站清理的移动没有误删其他站点的公式和样例。不扫描“通用提取器源码不含站点名称”。洛谷 JSON 和 DOM 回退仍进入同一个 `htmlToStatement`。探针标题仍可以不同于 JSON 标题。

真实浏览器中的下载、CSP、五个 OJ 和自部署 Hydro 仍是人工验收。未运行的视觉或 live 检查不能记为通过。

## 7. 回退与完成标准

每阶段可独立回退。回退顺序与依赖相反：先恢复调用方，再移除共享常量或新的渲染返回值。P1 不改变 `render` 的返回结构。若后续阶段改变抛出的错误类型，回退时同时恢复导出页对这个错误的展示。

不通过清空用户数据回退。本计划不迁移存储。

完成清单：

- [x] P0：已知差异已写在本文。没有补写事后测试日志。
- [x] P1：Typst 发射穷尽；文本重扫只在夹具证明后删除。公式仍只包进 `#mi`，不在本阶段预判编译成败。
- [x] P2：重复限额只有一个数据入口；图片类型只有一个判断函数；栅格声明类型和现有嗅探一致；四种后缀不再另写一份；生产数值不变。
- [x] P3：有图片的导出不再第二次提取；采图失败仍交付 PDF 和警告；取消仍会中止交付；嵌入警告只在 `mergeCapturedImages` 按完整 URL 结尾清除。
- [x] P4：同一导出页的编译串行，超时不会抢先重置会话；编译失败展示诊断且不下载；字体清单和样式参数分开并受测试约束。
- [x] P5：只移走夹具证明的单站清理；通用公式和复制按钮仍在原处；洛谷仍走现有 HTML 中转且没有新入口；探针仍不读 JSON；显示名读来源定义；主语言只剩 `normalizeProblemLanguage`，没有转发别名。
- [x] P6：样例框只有外壳一份，行号和末行 leading 仍分开；没有行模式参数；HTML 打印版式和 `createProblemRenderer` 已移除。
- [x] 自动检查通过；真实浏览器矩阵中未执行的项目仍保持未完成。

## 8. 明确不新增的结构

以下做法看起来像复用，但会形成新的并行实现，本计划禁止：

- 一个同时存放限额、超时、MIME、字体和样式的 `budget` 对象。
- 提取器钩子、站点 pass 注册表，或带空回调的 Adapter 基类。
- 为洛谷 JSON 另写一套 `StatementBlock` 构造，同时保留现有 Markdown 到 HTML 到 AST 的路径。
- 为了去掉 HTML 中转而在本轮重写指令、表格和公式解析。
- 跨导出页的编译锁，或超时后立即 `resetShadow` 的第二条恢复路径。
- 把渲染警告加进端口消息，再由后台转发回导出页。
- 用一个带大量布尔开关的 Typst 函数同时描述普通代码行和含公式样例行。
- 把 `style-tokens.ts` 和字体文件路径合成一个模块后两边互相读取。
- 为了让一条坏公式不拖垮整份 PDF，而恢复第二套 TeX 转换，或在字符串阶段把公式降级成正文。
- 为了让通用文件里不出现站点名字，把 `$`/`$$` 扫描或通用复制按钮判断搬进某一个 Adapter。
- 为了让探针标题和 PDF 标题变成同一个字符串，给 capture hints 加预览标记或把 JSON 复制进探针。
- 为一个调用点新增 `markdownToStatement`，让测试和生产各走一层包装。
- 提取成功后清除父级总期限，让采图或 `activeExports` 可以无限等待。
- 让页面注入函数返回 `Uint8Array` 或 data URL，或者用解析后的地址替换请求时的 `sourceUrl`。
- 把文档 5MB 和 Markdown 2MB 放进 `src/problem/budget.ts`。
- 解析 Typst 诊断文本或字体 name table，做成缺字体分类器。
- 为了让扩展成为 `embeddableImageType` 的唯一调用点，删掉渲染器对 data URL 的同函数复核。
- 把行号、末行 leading，或样例里的 `...` 重写，放进样例框外壳。
- 保留 `normalizeLanguage` 作为兼容别名。
- 给 `ProblemWarning` 加 url 字段来修子串误删。
- 新写一套栅格校验模块。栅格核对就在 `embeddableImageType` 里调用现有嗅探。
- 把 Markdown 标题和 PDF 页眉的题号判断合成一个函数。两边规则不完全相同。
- 因为 `html-to-statement.ts` 太长就拆 pass、注册表或 Adapter 基类。
