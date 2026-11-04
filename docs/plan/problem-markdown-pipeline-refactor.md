# OJTrace 题面 Markdown 数据流重构实施计划

> 历史文档：本文件描述允许并行 `structure` 的上一轮实现，已被 [Source Markdown 重构计划](../plan/source-markdown-cnoi-refactor-plan.md)及[本轮验收记录](../qa/source-markdown-cnoi-refactor.md)取代。旧完成状态和测试数量不代表本轮架构；历史正文保留。

- 日期：2026-10-16。
- 状态：用户已授权执行；阶段一至四与阶段五的代码清理、自动门禁已完成，Chrome/Edge 原生扩展矩阵待实机。完成范围与证据见[执行报告](../qa/problem-markdown-pipeline-upgrade.md)。
- 原计划编制时范围：仅审查和计划；用户随后明确授权“按照计划执行升级直到完成”。本次实施未提交、未发布。
- 实施原则：按确认后的五阶段顺序推进；前一阶段的完成条件未满足，不开始依赖它的下一阶段。每阶段结束提供改动、验证证据和剩余风险。

## 1. 目标、范围与当前基线

目标数据流：

```text
OJ Adapter → SourceProblem → CNOI Transformer → CnoiProblem
                                                ↓
                                     同一 Markdown Parser
                                                ↓
                                  现有 Typst / PDF Renderer
```

三种文本状态必须明确命名并分别持有：

| 状态           | 产生位置                                   | 用途                            | 后续允许的变化                                           |
| -------------- | ------------------------------------------ | ------------------------------- | -------------------------------------------------------- |
| sourceMarkdown | Adapter 的忠实提取结果                     | 复制 Markdown；作为转换输入保留 | 不允许转换、编辑、资源补齐回写其字符串                   |
| cnoiMarkdown   | Transformer 对一次 Source 提取结果转换所得 | 直接导出；编辑器初始值          | 转换完成后保持不变                                       |
| editedMarkdown | 编辑页首次接收 cnoiMarkdown 时建立的副本   | 用户修改、预览、编辑导出        | 只接受用户编辑，不被转换结果、解析结果或预览结果重新覆盖 |

“转换一次”指同一次提取/导出任务在 Source 形成后只调用一次 Transformer。复制不调用 Transformer；预览、导出、重试编译和 React 重渲染都不调用 Transformer。用户重新从网页发起一次任务会有新的提取与一次新的转换，不引入全局缓存去强行复用不同快照。

### 1.1 重构前核对的实现基线

| 实际模块                                                                                                                                                  | 当前行为                                                                 | 本计划中的处理                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [domain.ts](E:/Dev/Projects/OJTrace/src/problem/domain.ts) / [statement.ts](E:/Dev/Projects/OJTrace/src/problem/statement.ts)                             | ProblemDocument 同时保存 blocks、markdown、元信息和资源                  | 保留 ProblemDocument 作为解析后的 Renderer 输入；另外明确 SourceProblem、CnoiProblem，不继续让 markdown 兼任三种状态 |
| [adapters/common.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/common.ts) 的 extractDocument                                                           | HTML → AST → Markdown                                                    | 复用 HTML 提取设施；把结构识别与内容改写拆开，产出不可变 Source                                                      |
| [html-to-statement.ts](E:/Dev/Projects/OJTrace/src/problem/extract/html-to-statement.ts)                                                                  | 提取时也合并样例、处理站点标题样式及 Luogu 样例标签                      | 保留通用语法提取；移出 OJ 结构识别和内容改写；通用 Parser 不再猜裸 Input 是样例                                      |
| [markdown-serializer.ts](E:/Dev/Projects/OJTrace/src/problem/extract/markdown-serializer.ts)                                                              | 丢失图片布局字段、表格 spans；固定输出中文样例说明                       | 先补齐保真，再统一路径；语法序列化不生成内容标签                                                                     |
| [problem-markdown.ts](E:/Dev/Projects/OJTrace/src/problem/problem-markdown.ts)                                                                            | 编辑初始化添加 front matter、补中文章节；解析再次删题名并重提取          | 保留 front matter 校验、语法解析与资源关联；章节和题名策略交给 Transformer                                           |
| `format-problem-markdown.ts`（实施后删除）                                                                                                                | 复制时追加 H1 和中文来源、链接及限制                                     | 最终复制直接返回 sourceMarkdown；不保留暗中加工的复制分支                                                            |
| [service.ts](E:/Dev/Projects/OJTrace/src/application/problem-export/service.ts)                                                                           | 复制单独提取；download/edit 共用 deliver，但直接导出没有 Markdown 再解析 | 复用采集、资源及任务生命周期；统一准备 CnoiProblem 后，两条路径调用同一 Parser                                       |
| [ProblemStudio.tsx](E:/Dev/Projects/OJTrace/entrypoints/problem-export/ProblemStudio.tsx)                                                                 | 初始化自行 serialize，预览/编辑导出调用 parseProblemMarkdown             | 初始接收已准备的 cnoiMarkdown；后续只解析 editedMarkdown                                                             |
| [statement-to-typst.ts](E:/Dev/Projects/OJTrace/src/problem/render/statement-to-typst.ts) 的 sample                                                       | 忽略原标签，重新编号并生成中文样例标题                                   | 移除生成内容的职责；只排版已经确定的标题与代码块                                                                     |
| [typst-renderer.ts](E:/Dev/Projects/OJTrace/src/problem/render/typst-renderer.ts) / [template.ts](E:/Dev/Projects/OJTrace/src/problem/render/template.ts) | 共用 Typst source、资源准备及 NOI 风格模板                               | 保留字体、样式、尺寸和编译设施；仅收窄输入内容的职责                                                                 |

当前导出路径仍有实际差异：直接导出使用 Adapter 生成的 blocks；编辑页无修改也会经过 serializeProblemMarkdown → parseProblemMarkdown。两者共用编译设施不等于内容已一致。

### 1.2 本轮核对发现的基线更新

上一轮审查后，Luogu 已有需要保留的语言隔离修复：

- luogu.ts 的 statementContent() 对 contenu / content / 顶层字段整份选版本。
- luoguProblemRecord() 优先保留译文记录，避免较长原文替换译文。
- 译文的空、null、缺失、空白字段不再从原文或顶层补齐。
- [luogu-banks.test.ts](E:/Dev/Projects/OJTrace/tests/problem/luogu-banks.test.ts) 已有 language isolation 回归；[typst-csp.test.ts](E:/Dev/Projects/OJTrace/tests/problem/render/typst-csp.test.ts) 也覆盖真实题面编译及语言内容检查。

因此不再将“Luogu 逐字段跨语言回退”列为当前未修复问题；重构必须保留整份选版本的语义。固定中文章节、通用样例误识别及 Renderer 重编号仍是本次需要修复的问题。

### 1.3 本计划替代的历史约定

现有 [编辑预览计划](E:/Dev/Projects/OJTrace/docs/plan/problem-pdf-edit-preview.md) 含有历史描述，例如“直接导出不解析 Markdown”“未改正文复用原 AST”“不修改 statement-to-typst.ts”。本计划获确认并执行后，以本文的统一数据流与职责划分为准。不会为了遵守历史描述绕过保真门槛或保留双轨行为。

本次不更新这些历史文档；第五阶段再统一其有效约定，保留真实历史记录。不得把本计划中的待验证事项提前写成已通过。

## 2. 实施前锁定的架构与兼容决策

### 2.1 SourceProblem、CnoiProblem 与渲染文档

在现有 domain.ts 中新增简单的数据契约，不创建通用插件系统、规则 DSL、管线框架或第二套完整 AST。

ProblemMetadata 从现有 problem-markdown.ts 的私有元信息类型提升/统一到共用领域类型，字段映射只在 front matter codec 处理；Adapter、Transformer 与 Parser 不各自维护一份相近但不同的元信息接口。

目标契约示意，字段最终沿用现有类型：

```ts
interface SourceProblem {
  readonly metadata: ProblemMetadata;
  readonly sourceMarkdown: string;
  readonly structure:
    | { readonly ok: true; readonly blocks: readonly SourceBlock[] }
    | { readonly ok: false; readonly diagnostics: readonly ProblemWarning[] };
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}

interface CnoiProblem {
  readonly cnoiMarkdown: string; // 完整 front matter + 正文
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
  readonly language?: ProblemLanguage; // 旧 header 缺 language 时的明确回退
}

// Parser 的输出继续复用 ProblemDocument；它是瞬时渲染输入。
// ProblemDocument.markdown 只表示本次已解析的正文，不能再用它找回 Source。
```

SourceBlock 复用 StatementBlock，仅附加必要的识别事实：章节角色、是否为网页题名、样例所属组、原始编号、来源字段/容器标识。采用 node 与 recognition 两部分的简单包装即可，不继承多层类型，不另建完整 AST。不要存另一套可编辑的标题、样例文本或独立正文。

- sourceMarkdown 是 Source 的唯一文本依据；structure 是同次选定题面来源的不可变解析/识别快照，不能独立更新。原生 Markdown 必须从选定的同一版本解析出 structure，不能把 JSON 的正文与另一语言或另一 DOM 版本的 AST 拼成一个 Source。
- DOM 来源也由同一个来源树产生文本和结构；两者通过 codec 保真比较建立对应关系。构造成功后不允许单独替换文本或结构，需要重新提取时创建一个新 Source。
- 以 structure.ok 明确区分可完整转换与仅可复制的结果，避免“可选 AST 缺失时该走哪条隐式回退”的歧义。structure.ok=false 时复制仍使用完整原文；导出给出明确内容诊断，不把部分 AST 当成完整题面。
- Transformer 只读取完整的 structure 和元信息，不能反过来重写 sourceMarkdown。公开返回值沿用项目已有的 ok/value 或 ok/error 约定，不为转换新增一套异常框架。
- 识别注解用于初次 Transformer，不能作为编辑后的定位补丁。Parser 不利用旧块位置补回用户已经删除的内容。
- Source 文本和结构只在后台本次任务中持有；给编辑页只交付 CnoiProblem，避免传输两套正文和原 AST。
- 资源补齐创建新资源集合/新 SourceProblem 值；不得原地修改 sourceMarkdown 或 structure。被共享的 metadata、limit、asset 与节点字段同样声明只读；Transformer 只复制需要改变的节点路径，不要求生产环境反复 deepFreeze 或深拷贝整篇题面。
- 不引入持久化草稿、数据库迁移、完整文档 storage 或全局 Source 缓存。

### 2.2 结构识别与结构改写的明确边界

| 允许 Adapter 做的识别与提取                         | 只允许 Transformer 做的改写                          |
| --------------------------------------------------- | ---------------------------------------------------- |
| 选择题面根、原语言版本、来源字段                    | 规范章节层级、生成确有必要的缺失章节                 |
| 排除网页导航、按钮、系统提示和不可见非题面内容      | 删除重复题名、消除由字段组装导致的重复章节           |
| 记录 description / input-format / sample 等原站角色 | 整理样例顺序、补足缺失编号与展示标签                 |
| 记录样例容器、原标签、原编号和说明范围              | 将确认属于同一样例的输入、输出、说明整理为 CNOI 结构 |
| 解析原站数学与方言的语法语义                        | 将 OJ 专属写法转换为通用、可编辑的 CNOI 表达         |
| 保留原文、原始编号及所有代码和资源属性              | 按来源身份去除重复表示，而非按文本相同就删除         |

清理网页控件不属于内容改写；删除题面中的分隔线、分数段落、真实标题或说明则必须区分“网页壳”与“题面正文”。没有明确网页壳证据时，Adapter 保留并标注，是否调整由 Transformer 负责。AtCoder 当前删除配点及 hr 的策略也按此边界逐项迁移，不机械地全部留在 Adapter。

### 2.3 Source 与复制的输出约定

- sourceMarkdown 保存选定题面版本的正文及正文真实存在的标题、标签和说明；网站原生 Markdown 尽量原样保存。
- 网页外壳中的题名、题号、来源、时间和内存作为 metadata；不人为再套一层中文来源列表或新增 H1。
- 结构化字段必须组装时，保留原内容及顺序；已有原标签直接保留。没有原标签的字段通过识别注解保留角色，不在 Source 中捏造中文标题。
- DOM 来源允许通过保真 codec 表达，允许受控 HTML/扩展；“忠实”指内容与已有布局语义保持，不要求与 HTML 字节相同。
- 复制响应严格等于 sourceMarkdown。移除旧的 formatProblemMarkdown 外包装是明确的行为调整，不能为兼容旧外包装而破坏 Source 定义。
- 复制仍使用原有消息和剪贴板机制，不打开页面、不申请编译资源、不处理编辑草稿。

### 2.4 保留样例语义，Parser 只识别显式文档语法

保留现有 SampleBlock 的分组价值，移除其隐式标签和编号策略。提前删除该类型并把全部样例压平，会丢掉输入、输出、说明的关系，也会增加以后调整分页与分组样式的成本。本次不以删除 SampleBlock 作为架构目标。

1. Adapter 依据 OJ 容器/字段和上下文记录样例角色、原标签、组标识、编号；裸 Input + pre 不构成通用样例证据。
2. Transformer 决定最终样例组、已有或补足的编号、原语言标签；结果继续使用 SampleBlock，明确保存 inputLabel、outputLabel、说明标签和说明块。需要扩展说明字段时使用块数组，不再压成一个内联数组。
3. cnoiMarkdown 用一种明确的通用 sample 容器语法保存分组与标签。优先扩展现有 statement-directives 的容器基础；阶段二先定稿标签与各部分的显式表示及转义规则，不同时创造几种可互换的新语法。
4. Parser 从这些显式容器恢复 SampleBlock，仅做语法解析；普通标题/代码仍是普通块，不执行 coalesceSamples，不依据 Input 字样推断分组，不分配编号。标签位置也必须由语法明确表示，不能重新猜第一个段落就是标签。
5. Renderer 的 sample() 保留为纯排版函数：透传已经存在的标签和内容，复用 heading()、code()、样例框及数学代码行样式；删除 sample 计数器、中文默认名和缺失内容补写。标签为空时按准备好的结构展示，不在 Renderer 自行补标签。

说明必须保留原标签、段落与块级结构，不能沿用只存 explanation 内联数组、最后固定写“说明”的有损模式。旧说明字段只在迁移边界单向读取，最终只保留一种块级表示，不长期维护两种写法。保留已有不连续编号；无编号的同组输入/输出只补一次编号，补号避开已用编号。编号冲突、无法确定的配对保留原内容并给出明确诊断，禁止把不同原编号强行合并。

样例扩展只服务于声明已有语义；普通新建 Markdown 无需包 sample 容器也能导出，只按普通标题和代码排版。不能为了没有容器而自动转换、猜测或拒绝普通 Markdown。

保留分组不等于改变分页：默认仍沿用现有标题与代码段的发射、行距和可分页策略，不为整个 SampleBlock 新加不可分页的大容器。后续确需调整样例分组样式时，只改 Renderer 与相应视觉回归，不回头改各 OJ。

### 2.5 语言、章节与题名规则

- CNOI 表示结构与排版规范，不等于中文化；保留原语言和原章节文字，优先只调整层级。
- 确实需要补标签时，按明确的选定原语言使用小型词表；未知/混合语言且无可靠标签时保留原状，不猜成中文。
- Luogu 整份选内容版本；AtCoder 继续只取实际选定的语言分支；QOJ/Hydro/Codeforces 的语言信息不以 OJ 名称直接替代题面版本证据。
- 题名去重只发生在初次 Transformer：比较识别为文档题名的节点及元信息，基于解析文本处理转义/格式，不对全文做正则替换。
- 编辑后用户新增的 H1、修改的章节或编号不自动删除、不自动重排；Parser 不继续调用 withoutRepeatedTitle。
- 无正文说明就不生成说明章节；字段内已有同名章节就不再包第二层；不扫描代码块里的标题样式文本。

### 2.6 Renderer 与现有设施的保留范围

保留现有 template.ts / style-tokens.ts 的 NOI 风格参数：A4、字体、字号、页边距、标题间距、章节括号、页眉页码、表格线、样例框、行号、普通与数学代码行节距、图片不放大与约束尺寸策略。

只修改内容发射边界：删除样例计数器、固定中文样例名和语义补写。限制行的显示标签由准备/解析阶段按明确语言形成，Renderer 原样展示；不在 template.ts 新增 OJ 分支。

继续复用：

- [render-problem-pdf.ts](E:/Dev/Projects/OJTrace/src/problem/render/render-problem-pdf.ts) 的 PDF / SVG 入口。
- [worker-problem-renderer.ts](E:/Dev/Projects/OJTrace/src/problem/render/worker-problem-renderer.ts)、[problem-render.worker.ts](E:/Dev/Projects/OJTrace/src/problem/render/problem-render.worker.ts) 的线程模型。
- [browser-typst-compiler.ts](E:/Dev/Projects/OJTrace/src/problem/render/browser-typst-compiler.ts) 的 WASM、字体、包、shadow 串行队列及清理。
- [direct-download.ts](E:/Dev/Projects/OJTrace/src/application/problem-export/direct-download.ts)、[pdf-worker/main.ts](E:/Dev/Projects/OJTrace/entrypoints/pdf-worker/main.ts)、[pdf-worker/renderer.ts](E:/Dev/Projects/OJTrace/entrypoints/pdf-worker/renderer.ts) 的隐藏导出和 Blob 生命周期。
- [merge-images.ts](E:/Dev/Projects/OJTrace/src/problem/merge-images.ts)、图片限额、类型校验、按完整 URL 关联、无法嵌入时的提示及链接。

不更换渲染引擎，不引入 PDF.js、HTML 打印后备路径或第二套模板，不放宽 CSP，不新增依赖、权限、入口或后台编译器。

### 2.7 规则扩展与错误处理的维护契约

- transformToCnoi 是唯一调度入口。使用一张静态 OJ 到专属函数的映射，再调用一次通用整理；不做动态扫描、依赖注入容器、规则优先级 DSL 或跨站插件注册。
- 专属规则只处理自己 OJ 的角色与来源写法，通用规则拥有最终章节层级、全篇编号补足及序列化。专属规则不直接序列化，不再次调用通用转换；通用规则不 import 某个 Adapter，也不按 oj 写站点分支。
- 每条规则需要写清匹配条件、改变的内容和不匹配时的行为，并包含正例、近似反例及其他站点不受影响的用例。未有真实需要的站点规则不建立空文件；静态入口保留该站点可增补规则的位置即可。
- 新增某 OJ 的内容调整，应只修改该 OJ 规则及夹具；页面模板变化优先只改 Adapter；新增通用文档语法才修改 codec；单纯视觉变化只修改渲染与样式。这四类变化是可维护性的验收边界。
- 一次修复若需要同时给所有 OJ、Parser 和 Renderer 添加同一个站点判断，应先检查职责是否放错，而非复制分支。只有内容类型或文档语法确实新增时才允许跨层扩展；对应的语法、类型、codec 和 Renderer 消费需在同阶段一起完成。
- 模糊的样例/章节识别应保留原块并提示，不使整题失败；未嵌入图片继续使用现有警告及原图链接。可原样表示的未知文本保留为普通内容，不因陌生标记一律阻断导出。
- 只有无法保留的实质内容、损坏的已声明扩展、非法元信息或预算超限才阻断相应导出。诊断沿用 code/message，涉及内容时补来源字段/块或行范围；不保存一份冗余题面作为诊断，不吞错继续输出残缺 PDF。

### 2.8 解析上下文、缓存与阶段隔离

- Parser 的确定性输入是“完整 Markdown + 不可变解析上下文”。上下文包含本任务资源、警告和旧 header 缺 language 时的原语言；相同输入对必须得到相同文档，不能读取活动网页、全局 OJ 状态或系统语言。
- cnoiMarkdown 的 front matter 是转换后的元信息文本依据；用户修改后以 editedMarkdown 的 front matter 为准。显示标签是根据明确语言派生的渲染字段，不成为第二份可编辑元信息。
- 现有 PDF 成功缓存按 Markdown 字符串命中，只在同一个任务、同一份冻结资源上下文内有效。新任务需要重建编辑组件并清空缓存，资源上下文变化也必须失效；不能拿上一题或旧图片的同名文本 PDF 复用。
- 阶段二/三不切换复制或 PDF 入口；新的纯 Parser、Adapter 入口和转换函数先供夹具验证。共享 codec 的保真修复和 Renderer 的标签透传可以在阶段二逐项接入，但必须记录其已知错误修复，不能悄悄改变旧流程的样例识别策略。
- 新增 AST 字段与消费这些字段的最小 Renderer 支持在同一阶段完成，避免 Gate F 依赖尚未实施的阶段四。生产 Parser 包装中的旧猜测逻辑在阶段四切换时退出，不能提前删除而使仍在运行的旧流程失效。
- 临时入口仅存在于明确的迁移边界：阶段四同时切换两条 PDF 路径的调用方，阶段五删除旧包装。无需新增长期运行模式；具体的迁移子步骤见阶段四，类型检查和相关测试在每个子步骤都应可运行。

## 3. 阶段一：固定基线、契约与迁移边界

### 目标与依赖

这是开始阶段，不改变生产入口行为。先固定“当前正确效果”“已知错误”“预期修复”，为后续保真与版式比较建立可靠依据。

### 实际涉及文件

- domain.ts、statement.ts、[adapter.ts](E:/Dev/Projects/OJTrace/src/problem/adapter.ts)、[registry.ts](E:/Dev/Projects/OJTrace/src/problem/registry.ts)。
- 现有 [docs/fixtures/problem](E:/Dev/Projects/OJTrace/docs/fixtures/problem) 及 tests/problem、tests/application、tests/ui 下相关测试。
- [renderer.test.ts](E:/Dev/Projects/OJTrace/tests/problem/render/renderer.test.ts)、[typst-compile.test.ts](E:/Dev/Projects/OJTrace/tests/problem/render/typst-compile.test.ts)、[sample-line-pitch.test.ts](E:/Dev/Projects/OJTrace/tests/problem/render/sample-line-pitch.test.ts)。
- [architecture.test.ts](E:/Dev/Projects/OJTrace/tests/tools/architecture.test.ts) 与既有 audit-architecture.mjs，用于锁定后续模块的实际依赖边界。
- 新增测试优先放在现有测试目录，不先创建通用测试框架。

### 实施步骤

1. 重新记录实际工作区状态和既有检查结果；不覆盖已有修改、不清理用户临时文件。
2. 将同一输入快照下选定的原题内容、语言、资源、原 AST、Typst source 和代表性 PDF/SVG 纳入基线。Source 尚未实现时用原站字段和页面片段作为依据，不能让旧的有损 AST 自证正确。既有正确中文题和丰富媒体题作为版式基准。
3. 为已知问题建立最小复现：重复题名、字段内重复章节、Input 格式误识别、不同编号误配、日文入力例、英文说明变中文、图片尺寸与表格跨度丢失、数学代码行被当作普通字符串。
4. 明确目标契约与字段所有权；仅添加后续需要的 Source/Cnoi/识别注解类型。新类型不立即替代所有调用方，也不把旧 document.markdown 直接命名为 sourceMarkdown 后宣称问题已解决。
5. 为旧 Renderer 的正确视觉参数建立断言；需要实际编译的测试沿用现有 bundled fonts/packages，不额外下载运行时组件。
6. 迁移期间不让调用方普遍接受 SourceProblem | CnoiProblem | ProblemDocument 联合体。必要的短期兼容仅限 registry/service 边界，并在第五阶段删除。
7. 记录当前架构审计的覆盖缺口：现有纯逻辑根只匹配 src/domain、src/sources，未直接覆盖 src/problem 核心。阶段二/三增加模块时同步补针对 codec、Adapter、Transformer 及 Renderer 边界的运行时依赖检查，不只靠命名约定或搜索字符串。

### 保留与兼容

保留 popup 三个按钮、任务 token、URL 校验、提取次数、下载与编辑页生命周期。当前不切换复制或导出接口，不产生“部分 OJ 已走新链”的用户可见双轨。

### 测试、验收与完成条件

- 新复现有明确输入、原行为和目标行为；未修复的复现不能作为成功断言或永久跳过的测试计入完成。
- 基线测试应通过；尚未修复的目标用例可先作为诊断材料，阶段二/三实现时转成正式通过的回归。
- 语言隔离、图片资源、模板和下载生命周期的既有正确行为被记录为后续不可退化项。
- 完成产物：契约、夹具清单、视觉基准、差异分类、已有失败项说明。只有这些到位才进入阶段二。

## 4. 阶段二：补齐 Markdown codec 保真能力，建立硬门槛

### 目标与依赖

依赖阶段一的夹具和字段契约。让列入支持范围的内容及视觉语义能够经过 Markdown 往返。此阶段不统一生产导出入口，也不移除直接导出的原 AST 路径；新增字段所必需的最小 Renderer 透传支持同阶段完成。

### 实际涉及文件

- markdown-serializer.ts、[markdown-to-html.ts](E:/Dev/Projects/OJTrace/src/problem/extract/markdown-to-html.ts)、html-to-statement.ts。
- [luogu-dialect.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/luogu-dialect.ts)（原 statement-directives.ts，实施后迁移）、statement.ts、problem-markdown.ts、[markdown-front-matter.ts](E:/Dev/Projects/OJTrace/src/problem/markdown-front-matter.ts)。
- statement-to-typst.ts 的 sample()、相关样例类型和渲染测试：仅增加保真字段消费、改为原标签透传并删除计数器，不调整既有样例视觉参数。
- tests/problem/extract/roundtrip.test.ts、pipeline-fidelity.test.ts、directives.test.ts、tests/problem/problem-markdown.test.ts；真实来源的编辑往返回归已归并至 pipeline-fidelity，移除重复的 editor-roundtrip 测试文件。
- 若确需独立小型辅助函数，只放在现有 extract 模块旁，不引入第二套 Markdown 库。

### 具体实施顺序

1. 定义 codec 的显式可表达范围与受控 HTML/扩展白名单，继续复用 marked、现有 HTML AST 和数学 tokenizer。产出一份短的语法说明及可运行夹具，固定富代码、图片、合并表格与 sample 容器的标签/分部表示；这是 Gate F 的交付物，不把语法设计留到接入口时临时决定。
2. 先修普通代码和数学代码行，再修图片、表格、显式样例、图注/容器、链接与复杂嵌套；逐项补正反向夹具，不在业务入口补旧 AST。SampleBlock 保留原标签并增加说明标签/块级说明；临时读取旧 explanation 时只在一处转换成新表示，不双写两种字段。
3. 把通用的纯语法解析入口独立出来：不带 OJ 参数，不执行样例猜测、题名删除、章节增补或未知指令静默丢弃。旧生产包装如需暂留，必须与该入口明确分开，不能新增大量 mode 开关。
4. CNOI 正文语法保持可编辑：标准 Markdown 能完整表达时继续使用；复杂情况才生成受控 HTML/扩展。
5. front matter 保留现有键和校验语义；增加可选 language，旧 header 缺失时使用交付资源中的原语言。非法字段或未闭合 YAML 继续明确报错。
6. 同步让 Renderer 消费新增说明与标签字段，保留 SampleBlock 分组但停止计数/生成中文标签。当前提取器在迁移期间也需保留识别到的原说明标签；这属于修复数据丢失，不在此时扩大样例识别范围。已知错误修复产生的预期标签变化单独记录，布局参数不变。
7. 建立 AST 语义比较与真实 Typst 编译比较，确认保真门槛通过后才允许后续切换。Gate F 所用 Renderer 就是带上述字段支持的同一 Renderer，不建立测试专用的第二模板。

### 保真清单与建议表达

| 内容                   | 必须保留的字段/行为                                              | 最小表达方式                                                                               |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 块级与行内图片         | URL、alt、width/height、zoom、宽度比例、最大尺寸及行内位置       | 无布局属性时普通图片 Markdown；有属性时受控 img，保留当前 ImageFrame 支持的属性            |
| 普通表格               | 表头、列数、对齐、换行、转义与单元格内容                         | 能完整表达时 GFM 表格                                                                      |
| 合并表格               | colspan、rowspan、覆盖位置、表头与列对齐                         | 受控 table/thead/tbody/tr/th/td；跳过被覆盖格，不补出伪空单元格；只接受必要属性            |
| 数学                   | 原始 TeX、行内/独立/嵌入显示属性、转义                           | 沿用数学 tokenizer；不经全局正则改写正文或代码                                             |
| 普通代码               | 字面值、语言、缩进、空行、反引号、HTML 字符及有意义的末尾换行    | 正确围栏；不能证明可逆的边界情况使用受控 pre/code                                          |
| 含数学的 pre           | CodeBlock.lines 的行内节点、行数和语义，普通 value 与 lines 一致 | 明确的富代码 pre 表达，逐行保存文字和数学节点；不能把 $公式$ 写进普通 fence 后期待再次解析 |
| 样例                   | 原标签、编号、独立输入/输出、说明原文与多段落结构                | 来源识别保留，不在 codec 生成输入/输出/说明文案                                            |
| 图注、容器、列表、引用 | caption、figure、align、嵌套顺序、列表语义及可见文本             | 复用明确的通用 figure/align 表达；图注不能只靠序列化后的位置猜测                           |
| 链接                   | URL、可见内容、可用 title 及转义                                 | 可逆的 Markdown 或受控 a；不删除真实题面链接                                               |

Luogu/tuack 方言的“识别其原意”留在 Adapter 的来源语法辅助中；“转成通用 CNOI 表达”在阶段三完成。已经作为通用文档语法的 figure/align 和明确的 sample 容器可以由 codec 解析，通用 Parser 不按 oj 选择方言行为。未知内容按 2.7 分类：可原样表示就保留，只有实质保真无法满足时阻断相应导出。

### 保留与兼容

- 继续兼容现有完整 front matter、普通 Markdown、数学写法和已使用的通用指令。
- 受控 HTML 只被惰性解析为 AST，不能插入页面 DOM、执行脚本或接受任意事件属性；沿用现有 URL/资源类型边界。
- 沿用现有文本/图片预算，并对新增嵌套扩展、块数量和表格跨度展开设置有界处理；异常输入不能无限递归或膨胀。AbortSignal 不能抢占同步解析，不能把下载总超时当作 Parser 的工作量限制；先用边界夹具验证，无需本轮另建解析 Worker。
- 图片只按完整 URL 关联已有资源；编辑中添加 URL 仍按现有未嵌入策略处理，不新增网络抓取或权限申请。
- 禁止“无修改用旧 AST、修改后走新 Parser”或将旧块按位置拼回新结果的补丁。

### 测试、验收与完成条件：Gate F

以下条件全部满足，才算通过 Gate F：

1. 对支持清单覆盖的块/行内类型及其嵌套，parse(serialize(blocks)) 的内容和渲染语义一致；比较允许排除对象身份、识别注解及临时 typstPath，不允许排除尺寸、跨度、样例分组/标签/原编号、TeX 或代码内容。该门槛不宣称支持任意网站 CSS；未覆盖的实质内容按诊断策略处理。
2. 对手工固定的目标 cnoiMarkdown 夹具（本阶段尚未接入 Transformer），解析结果可稳定序列化/解析，不反复改变空行、代码、标题或资源。
3. 代表性图片尺寸、合并表格、数学代码行和长题面经过真正的 Typst PDF/SVG 编译，内容与几何检查通过；PNG/截图人工检查无缩放、合并格、行距或分页退化。
4. 限额附近的复杂 HTML/Markdown 序列化体积已测量；不靠放宽限额掩盖重复内容或三份正文传输。
5. Gate F 有固定的扩展语法说明、夹具、自动检查结果和视觉检查证据。纯 codec 用例可使用规范化结构比较；样例、图注等不能只比较扁平文本。仅类型检查或 mocked Renderer 通过不算保真通过。

Gate F 使用本地真实 Typst 编译及产物检查，不依赖 Chrome/Edge 已安装扩展；原生浏览器生命周期验收留在阶段五。新增 OJ 方言或新的内容能力必须补相应 Gate F 用例，不能靠一次通过永久豁免后续 codec 变更。

若 Gate F 未通过，继续修 codec；不能进入统一入口的阶段四，也不能使用旧 AST 隐式回退制造“看起来一致”。

## 5. 阶段三：建立忠实 Source 与一次性 CNOI Transformer

### 目标与依赖

依赖阶段二的保真 codec。形成可独立验证的 Source → CNOI 结果，集中修复章节、语言、题名和样例问题。本阶段先用固定快照验证新链，不提前切换部分生产按钮；旧入口在阶段四一次性切换。

### 实际涉及文件

- 五个实际 Adapter：[luogu.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/luogu.ts)、[codeforces.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/codeforces.ts)、[atcoder.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/atcoder.ts)、[qoj.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/qoj.ts)、[hydroj.ts](E:/Dev/Projects/OJTrace/src/problem/adapters/hydroj.ts)。
- adapters/common.ts、adapter.ts、registry.ts、domain.ts、statement.ts。
- html-to-statement.ts、statement-directives.ts、problem-markdown.ts、format-problem-markdown.ts。
- 新增 E:/Dev/Projects/OJTrace/src/problem/cnoi/transform.ts。
- 新增同目录 rules/common.ts，以及确有内容调整的 OJ 专属规则文件；入口静态映射支持 Luogu、Codeforces、AtCoder、QOJ、HydroOJ。没有实际专属调整时只走通用规则，不为占位创建 identity 函数/空文件，也不创建配置注册系统。

### 实施步骤与顺序

1. 为五个 Adapter 增加明确的 extractSource 入口并由 registry 统一暴露；先复用现有 DOM/JSON 读取和 metadata/image 辅助，保留原语言、文本、标题等级与资源。迁移期旧 extract 只供旧生产入口使用，不复制整套选择器或抓取设施；新旧链只在固定夹具验证时分别运行，不在同一生产任务中各提取一次。阶段四调用方统一切换后，阶段五清除旧返回形状和入口。
2. 将 section-title / section_header、样例容器、Luogu 原标签等识别放到对应 Adapter，形成最小结构注解。通用提取器只解析 HTML/Markdown 的语法语义。
3. Luogu 继续整份选内容，保留 pid 校验与原题库路由。对字段记录 background/description/formatI/formatO/hint 角色；字段组装不提前生成 CNOI 中文标题或移动样例。已有原标签保留，没有标签的源字段保留角色供 Transformer 使用。
4. 实现单一 transformToCnoi(source)。处理顺序固定为：验证 structure 完整 → 读取识别事实 → 应用对应 OJ 专属规则 → 通用去重与章节/样例整理 → 确定最终标签与说明结构 → 保真序列化正文与 front matter。完整样例保持显式分组，不在尾部又压平为失去关联的代码块。
5. 专属规则提供来源相关判断和必要调整，通用规则只执行一次。规则不得写回 source.structure、sourceMarkdown、资源对象或警告数组；原始编号和最终标签也不能形成两份可独立修改的渲染依据。
6. 在新转换链中将补章节和去题名职责集中到 Transformer，保留纯 front matter 序列化辅助。新 Parser 不调用 withoutRepeatedTitle / coalesceSamples；旧 serialize/parse 包装暂供未切换生产入口使用，阶段四再退出其旧职责，避免阶段三破坏旧调用方。
7. 在目标 Parser 中使用明确的 language 和资源；补充 Renderer 需要的限制显示标签，由准备阶段提供。编辑后的 oj 字段变化不触发新一轮 OJ 规则。
8. 用新链输出与已通过 Gate F 的结构比较；不得引入长久的旧规则副本或按按钮选择转换策略。

### 各 OJ 的具体边界

| OJ         | Adapter 保留的识别/兼容                                                                                  | Transformer 专属内容规则                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Luogu      | 原题库全部已支持路由；JSON 两种路径及 DOM 回退；整份语言选择；字段角色、原生 Markdown 与独立样例来源身份 | 字段章节与已有标题协调；独立 samples 与题面中同一来源样例的重复表示处理；原标签/语言保护；cute-table 等来源方言转换为通用表达 |
| Codeforces | problemset/contest/gym 路由；外层 header 与正文分离；复制控件清理；sample-test 中 input/output 的上下文  | 只整理已识别的样例组；裸正文 Input 不算样例；保留原英文标签，不改成中文                                                       |
| AtCoder    | 显示语言及 URL/快照选分支；外层标题和限制；明确标注 Input 格式、Sample Input / 入力例角色                | 输入格式 pre 不进入样例；日文与英文样例标签都可整理；保留配点/hr 中属于真实题面的内容，仅按明确策略处理已识别内容             |
| QOJ        | statement tab/article 与网页 shell 分离；题名及 badge 限制；语言证据和原标题角色                         | 重复题名、样例分节及编号整理；不引入中文兜底或重新采集整页导航                                                                |
| HydroOJ    | 官方/自部署实例及 domain/contest/homework 路由；平台标记；系统 note/warn 排除；语言证据                  | 已识别正文题名与 PDF 顶层题名去重；仅整理可靠样例结构，模糊 Input 保留原样                                                    |

上表中的 cute-table 对应既有来源指令 ::cute-table{tuack}，不是新增语法。

### 去重与编号的具体限制

- 题名只删除一个确认与 metadata 对应的正文题名表示，不能删除正文中同名的小节或代码文本。
- 字段已有标题时不再另包同名章节；不根据“正文第一个节点不是 H2”就补中文描述标题。
- 样例去重依赖明确的来源字段/容器身份和原组编号；不同样例的数据恰好相同不得合并。
- Input 2 与 Output 3 不配对；孤立输入/输出保留，不编造另一半。
- 已有编号、标题文字和说明原语言保留；需要补号时统一在 Transformer 内一次分配，避免覆盖已有编号。
- 若无法证明某个已嵌入样例就是独立 samples 的重复，保留并提示可能重复；不冒险删除题面数据。

### 保留与兼容

复用原 AST 和提取辅助；不同时重写 JSON 读取、页面捕获、图片抓取。旧生产链仅为迁移期保留，不对外承诺三状态已经全部生效；禁止在通用 Parser 添加 detectOj、normalizeForPdf 或隐藏的第二轮 Transformer。

### 测试、验收与完成条件：Gate T

- 五个 OJ 固定快照均能产出 Source 和 Cnoi；Source 在转换前后内容、资源及识别结构未变化，测试可深冻结输入验证。
- 当前 Luogu language isolation 全部继续通过；SP1 英文、AtCoder 英日文、Luogu 中译文和未知语言都不因转换加入其他语言标题。
- 题名去重、已有章节、输入格式、日文样例、错号配对、缺号、孤立样例、多个说明段落和重复来源用例通过。
- 调整后的样例通过明确的 sample 语法保留分组、最终标签及完整说明；Parser 不再改变样例标签或数量，Renderer 只透传标签。
- 一条 OJ 专属规则增改后，必须同时跑该站正例/近似反例和其他四站的代表性固定夹具，证明规则不会越过静态分派边界。
- 依赖审计对新 Transformer/codec 已生效：禁止其运行时到达 application、下载、浏览器 API 或编译设施；Renderer 不得运行时到达 Adapter/专属规则。增加允许导入与拒绝导入的测试夹具，不能直接把所有 render 文件都标为纯逻辑而误伤现有 Worker/BrowserTypstCompiler 边界。
- 模糊角色可保持原样导出，实质保真失败则明确失败且 Source 仍可复制；不同失败等级不走同一个“全部阻断”分支。
- 同一个 Source 重复独立调用纯转换函数得到相同结果；这用于验证确定性，不代表运行时允许反复转换编辑文本。
- 新链的未改内容仍满足 Gate F，保真通过记录更新。Gate T 完成后才进入阶段四。

## 6. 阶段四：统一生产入口，收窄 Renderer，隔离编辑状态

### 目标与依赖

仅在 Gate F 与 Gate T 均通过后执行。本阶段统一 Source 复制、Cnoi 交付与两条 PDF 路径的 Parser。Renderer 的保真字段支持和标签透传已在阶段二验收，此处核对契约并移除剩余旧包装，不把所有职责迁移挤到一个难以回归的大改中。两条 PDF 路径最终同时采用新契约，不发布其中一条仍走旧 AST 的中间状态。

### 实际涉及文件

- service.ts、messages.ts、[transport.ts](E:/Dev/Projects/OJTrace/src/application/problem-export/transport.ts)、[client.ts](E:/Dev/Projects/OJTrace/src/application/problem-export/client.ts)、[background.ts](E:/Dev/Projects/OJTrace/entrypoints/background.ts)。
- [ProblemExport.tsx](E:/Dev/Projects/OJTrace/entrypoints/problem-export/ProblemExport.tsx)、ProblemStudio.tsx、[MarkdownEditor.tsx](E:/Dev/Projects/OJTrace/entrypoints/problem-export/MarkdownEditor.tsx)、[front-matter-editor.ts](E:/Dev/Projects/OJTrace/entrypoints/problem-export/front-matter-editor.ts)。
- problem-markdown.ts、[validate-document.ts](E:/Dev/Projects/OJTrace/src/problem/validate-document.ts)、statement.ts、statement-to-typst.ts、template.ts、typst-renderer.ts。
- direct-download.ts、pdf-worker/renderer.ts、[pdf-worker-messages.ts](E:/Dev/Projects/OJTrace/src/application/problem-export/pdf-worker-messages.ts)、[pdf-compile-message.ts](E:/Dev/Projects/OJTrace/src/problem/render/pdf-compile-message.ts) 只做必要的类型/校验适配；不重写生命周期。

### 统一后的精确调用顺序

```text
复制：
  capture → Adapter.extractSource → SourceProblem
  → response.markdown = source.sourceMarkdown → 原有剪贴板逻辑

直接导出：
  DirectProblemDownload.run（先启动 offscreen / keepalive / 总超时）
  → loadDocument 回调内调用共用 prepareCnoiProblem
    → capture → Adapter.extractSource → 补齐资源
    → transformToCnoi 一次 → CnoiProblem
  → parseProblemMarkdown(cnoiMarkdown, 固定解析上下文)
  → OffscreenPdfRenderer
  → WorkerProblemRenderer.pdf → 现有 Typst PDF

编辑：
  与直接导出相同的 Source / 资源 / prepareCnoiProblem
  → 一次交付 CnoiProblem → 立即断开交付端口
  → editedMarkdown 初始化为 cnoiMarkdown
  → 每次预览/导出均 parseProblemMarkdown(editedMarkdown, resources)
  → WorkerProblemRenderer.preview / pdf → 同一 Typst source 和资源
```

prepareCnoiProblem 是 service.ts 内部返回 Promise<CnoiProblem> 的小型共用准备方法，包含唯一的采集、资源补齐与一次转换流程；在既有任务作用域内执行，不新建第二个 ExportService 或第二把锁。接收可选的进度回调，不接收 port、不生产传输事件。

deliver 只负责把该结果/进度/错误写到真实端口；直接导出的 readExportDocument 消费同一方法的类型化返回值并调用 Parser，不再通过构造假的 port、接收事件后强转类型来获得文档。该整理仅提取既有服务主体，不重写 job 或编译生命周期。

任务作用域仍是 token 校验、activeExports、交付期限和取消的唯一所有者：准备函数返回不等于已经交付，不能在真正交付/内部成功消费前提前释放占用或删除 job。编辑端口交付成功后才删除 job；交付前断开仍按当前语义保留可重试任务；直接路径在成功取得解析文档的内部交付点消费任务，失败仍由既有 finally 清理。若提取共用作用域，只在 service.ts 使用一个私有 helper，不引入生命周期框架。

必须保留 DirectProblemDownload.run 当前先创建 offscreen、再执行 loadDocument 的顺序：隐藏宿主的 keepalive 与总超时需要覆盖采集/转换/解析，不能把准备工作挪到 run 之前。将其 AbortSignal 传给 loadDocument 回调及既有采集控制器；取消后不得继续转换、编译或下载迟到结果。编辑路径则继续由交付端口和现有任务取消控制。

### 具体实施步骤

1. 复制服务直接返回 Source.sourceMarkdown；删除生产路径对 formatProblemMarkdown 的调用。客户端响应仍可使用 markdown 字段，明确注释其 Source 含义，不为字段改名重写剪贴板逻辑。
2. 共用 prepare 方法在图片资源合并后构造一次 CnoiProblem；直接导出和真实编辑端口消费同一返回契约。保留既有 job 清理及 token 取消语义，不能把 port 断开后的取消误作用于已交付的编辑状态；Parser 与 Transformer 不采集资源。
3. readExportDocument 在 DirectProblemDownload 的 loadDocument 回调内部等待准备结果、调用共同 Parser 并返回 ProblemDocument。offscreen/compile worker 继续只接收已解析的文档，不在渲染 Worker 中再次转换 Markdown；总超时、失败及清理覆盖范围不缩小。
4. 编辑页验证 CnoiProblem 后交给 ProblemStudio；以本次 token/任务身份建立稳定组件实例，初始 cnoiMarkdown 与 editedMarkdown 分别持有。移除 useState/effect 中 serializeProblemMarkdown(base) 的重复初始化；同任务 rerender 不重置草稿，新任务必须重新初始化并清空成功缓存。
5. 现有 generation id、一个在飞任务/一个最新等待任务、400ms 防抖、IME、旧预览过期提示、仅当前成功字节可下载的行为继续保留。
6. Parser 不写回 editedMarkdown，不使用旧 AST 填补删除内容。元信息以用户 front matter 为准；非法元信息不下载旧 PDF。首次生成的题名去重不再影响之后用户新增的正文标题。
7. 核对 Renderer 的 sample() 已纯透传最终标签和说明，保持 SampleBlock 的显式分组；删除生产包装中残留的重编号/补标签入口。不得为了清理而删除有效样例类型或用 renderer 内的 oj 判断补回旧行为。
8. template.ts 只按输入展示题名和准备好的限制标签。保留当前 heading/code 的视觉规则与全部 style-tokens 参数，不能顺手重调字号/边距。
9. 同步更新边界校验与体积计算，分别验证 Source 字符串、Cnoi 消息和渲染文档；大资源不因新结构重复传输。继续沿用现有限额，不在此阶段随意放大。

阶段四的内部顺序为：先补类型化服务准备方法及回归 → 接入直接下载回调 → 同步接编辑交付/状态与协议 → 删除旧生产解析职责 → 完整验收。每一步保持 typecheck 和相关测试可运行，发布前必须合并为同一版完整契约；无需靠长期功能开关维护两个导出体系。

### 消息与旧数据的兼容处理

- 保留现有按钮、intent、短时 job 字段、fallback job 和 storage 语义；完整文档、HTML、图片、Markdown、PDF 均不写入 storage 或 URL。
- 编辑交付由旧 ProblemDocument 改为明确的 CnoiProblem，属于不兼容 payload 变化。本计划采用将 PROBLEM_EXPORT_SCHEMA_VERSION 从 1 升至 2 的方案，同步修改发送方、接收方及守卫，不靠猜字段兼容旧 payload。
- 新后台应识别已知版本 1 请求的版本不匹配，使用旧调用方能读取的错误响应外壳返回“服务已更新，请重新发起”；这仅兼容错误反馈，不转换旧文档 payload，不能静默忽略到超时。新客户端遇到旧后台或断开的通道明确提示重新打开。未完成的旧交付任务按现有取消/过期规则退出，不迁移草稿。
- offscreen 与 compile-worker 的文档入口继续使用解析后的 ProblemDocument，不为统一 Markdown 额外引入传输协议；如添加必要显示字段，同步更新其守卫与测试。
- 旧完整 front matter 可继续解析；缺少 language 使用交付原语言。现有 URL/OJ/限制校验、清空限制语义不变。
- 新 CnoiProblem 守卫验证版本、非空完整 Markdown、语言、资源/警告字段及实际尺寸限额；数据通过校验前不能初始化编辑器或提交编译。沿用现有校验风格，不额外引入运行时 schema 依赖；任务与资源标识不可由正文 front matter 覆盖。

### 测试、验收与完成条件：Gate U

1. 同一固定快照的直接导出与编辑页无修改导出，Parser 输入字符串相同，语义 AST、Typst source、图片资源映射及实际页面内容一致。
2. 通过导出服务集成测试证明：每个成功任务 extract 一次、transform 一次；复制 transform 零次；多次编辑/预览/编译重试不增加 transform 调用。准备完成但交付尚未结束时，同 token 的并发请求仍被拒绝；交付前断开、成功交付、失败清理分别验证，不能因抽 helper 丢失重试语义。
3. cnoiMarkdown 与 Source 始终不变；编辑、元信息修改、预览失败及同任务 rerender 均不会重置 editedMarkdown；新任务及资源变化不会命中旧任务 PDF 缓存。
4. 预览与下载针对同一版 editedMarkdown 使用同一 Parser 输出。PDF 与 SVG 允许分别编译，但必须共用同一 Typst source 和资源；不要求复用同一个二进制对象。
5. 直接导出不创建/切换可见标签页；offscreen/keepalive 在采集前启动，采集慢或失败、关闭 popup、取消/总超时及 Worker 异常均有顺序回归；成功/失败后仍清理 Blob、offscreen、下载监听和任务，迟到结果不下载。
6. 修改样例标题/编号在预览和 PDF 均可见，没有 Renderer 覆盖；英文/日文标题不新增中文；重复题名只在初次转换解决。
7. 阶段一正确视觉基准与 Gate F 丰富内容继续通过真实编译和视觉复核。仅两条路径“以相同方式丢失信息”不能通过 Gate U。
8. 所有相关 UI、消息和任务生命周期回归通过，才能进入阶段五。不能单独发布只切一条 PDF 路径的中间结果。

## 7. 阶段五：清理旧职责、完成全量回归与浏览器验收

### 目标与依赖

依赖 Gate U。删除迁移桥接，证明最终只有一套转换、一套 Parser、一套 Renderer，并完成真实扩展行为与版式验收。

### 实际涉及文件

- registry/service 的临时兼容层，format-problem-markdown.ts 及对应旧调用/测试，problem-markdown.ts 的过期导出或注释。
- html-to-statement.ts、statement-directives.ts 中尚存的 OJ 特例；statement.ts 中已退出使用的旧说明字段及迁移声明。保留有实际用途的 SampleBlock，不为追求类型数量少而删除语义。
- [audit-architecture.mjs](E:/Dev/Projects/OJTrace/tools/audit-architecture.mjs) 及 tests/tools/architecture.test.ts：复核阶段二/三加入的核心依赖约束，保护实际运行时导入图；[audit-manifest.mjs](E:/Dev/Projects/OJTrace/tools/audit-manifest.mjs) 继续核对构建入口，不扩大运行时权限/入口白名单。
- [problem-pdf-browser-matrix.md](E:/Dev/Projects/OJTrace/docs/qa/problem-pdf-browser-matrix.md)、[release-checklist.md](E:/Dev/Projects/OJTrace/docs/qa/release-checklist.md)、README、现有三份 PDF 计划文档中的有效约定。

### 实施步骤

1. 清除复制旧外包装、编辑初始化二次转换、解析题名去重、通用样例猜测、Renderer 重编号及临时桥接。无剩余引用再删除文件，不为“清理”扩大改动范围。
2. 检查 runtime 依赖：Adapter/Transformer/codec 保持纯逻辑，UI 不导入 Adapter，Renderer 不导入 OJ rules，Transformer 不导入 browser/编译/下载代码。
3. 更新测试预期时逐个说明“修复内容差异”与“不得变化的样式”；不批量重录视觉基线掩盖回归。
4. 运行全量检查并核对生产构建。浏览器中验证 popup、隐藏导出、编辑预览、下载、中断和资源清理。
5. 更新文档：明确三种 Markdown、一次转换、两条路径共用 Parser、已知受控语法、尚未支持的真实页面形态。不能恢复历史的未改正文绕过 Parser 约定。

### 全量检查命令

按项目实际 scripts 执行，记录每条结果：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm format:check
pnpm audit:architecture
pnpm build
pnpm audit:manifest
```

format:check 当前不覆盖 docs/**/*.md；本计划及后续文档另行使用不写入文件的 Markdown 格式/链接检查。构建后再执行 manifest 审计；失败必须区分既有基线问题与本次新增问题。

### 浏览器与视觉矩阵

在 Chrome、Edge 各执行一次；不能将模拟 runtime API 的测试算作真实扩展验收。

| 场景       | 必须覆盖                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Luogu      | 中文主库、四份已捕获远程题库材料、DOM 回退、语言隔离、已有章节与独立 samples                                   |
| Codeforces | problemset、contest/gym；英文；sample-test；格式代码、长样例、多行及图片权限                                   |
| AtCoder    | en / ja；切换后的显示语言；输入格式 pre；Sample Input 与 入力例；数学代码行                                    |
| QOJ        | 可访问的 statement article；正确排除 shell；标题、限制、表格与样例                                             |
| HydroOJ    | 官方及自部署、domain 路由；系统提示、正文 H1、模糊样例标签                                                     |
| 富内容     | 宽高/百分比/zoom/最大尺寸图片、行内图片、rowspan/colspan、复杂公式、嵌套容器、图注、多页长代码                 |
| 用户操作   | 三按钮、复制前后编辑、只改 front matter、修改样例编号、清空/非法 YAML、连续输入和 IME、过期预览、关闭页面/取消 |

视觉比较分两组：

- 无内容改写的基准题：检查 A4、字体、边距、行距、代码节距、图片几何、表格跨度、样例框和分页，禁止无关视觉退化。
- 已知错误修复题：允许移除重复标题、修正样例误判或改回原语言造成的必要重排；逐项记录预期差异，不把所有分页变化都放行。

不以 PDF 字节相等为断言；结合归一化内容、相同 Typst source、资源、SVG 几何及逐页视觉检查。若某站点不可访问，保留夹具自动化证据并明确记为未完成的实机项，不能勾选已通过。

### 最终完成条件

- [ ] 三种文本状态及所有权清晰，Source 不被转换或编辑覆盖。
- [ ] 复制严格返回 Source；没有隐式格式包装或编译。
- [ ] 每任务 Transformer 一次，用户编辑后只有解析与渲染。
- [ ] 五个 OJ 的识别与专属改写各在正确模块，通用 Parser 与 Renderer 无 OJ 内容策略。
- [ ] 规则的正例、近似反例与跨 OJ 回归齐全；无空占位规则、动态规则框架或重复的通用转换调用。
- [ ] Gate F、Gate T、Gate U 全部具备实际证据。
- [ ] 两条 PDF 路径共用 Parser/Renderer，未改编辑导出一致，预览与 PDF 同源。
- [ ] 显式样例语法可还原分组、原标签及块级说明；普通 Input 标题和代码不会被当作样例。
- [ ] 新任务缓存隔离、类型化服务准备与采集前 offscreen/keepalive 顺序均有回归。
- [ ] 保留原语言，修复题名重复、样例误识别/误配、中文标签混入，保留最新 Luogu 语言隔离修复。
- [ ] 图片、表格、公式、代码、样例和既有 NOI 风格无未解释退化。
- [ ] 编译、下载、资源、消息校验及取消/超时行为通过回归。
- [ ] 全量自动检查、生产构建及 Chrome/Edge 验收状态如实记录。
- [ ] 无遗留双轨开关、旧 AST 补丁、第二渲染模板或未删除迁移桥接。

## 8. 关键风险、前置问题及应对

| 风险/前置问题                                     | 何时解决          | 应对与停止条件                                                                                        |
| ------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| 原生 Markdown 与提取 AST 不等价，未知方言先被丢掉 | 阶段一/二         | 对照原站选定字段而不只比较两个已丢信息的结果；未知内容明确诊断，Source 可复制；不能带损失进入统一入口 |
| 图片/表格有损转换被统一链放大到所有导出           | Gate F            | 逐字段、真实编译与视觉证明；失败则保留旧生产链，不切入口                                              |
| 含数学代码行被 fence 当普通文本                   | 阶段二            | 明确富代码表示，比较 lines 与实际节距；不能只断言 PDF 文件头有效                                      |
| Source 识别注解脱离原文，错误整理样例             | 阶段三            | 注解与同次提取绑定；以原容器/字段证据识别；编辑后彻底丢弃旧定位，不回填                               |
| 过度去重删除合法的相同样例/章节                   | 阶段三            | 使用来源身份与角色，不按内容 hash 全局去重；无法确认则保留并诊断                                      |
| Luogu 语言隔离修复回退、日文标签未识别            | 阶段三            | 保留当前测试并扩展 SP1、en/ja、空译文字段、跨记录选择；不以站点固定语言生成标题                       |
| React 初始化/effect 再次覆盖用户草稿              | 阶段四            | Cnoi 在后台完成；编辑 state 仅首次任务初始化；加入 rerender/预览失败/元信息变更回归                   |
| 压平样例或 codec 字段先于 Renderer 落地           | 阶段二/四         | 保留显式 SampleBlock 分组；字段与透传支持同阶段验收；旧说明字段只在单一边界兼容，不再自动补标签       |
| 新旧服务准备路径复制、通过假 port 获得内部文档    | 阶段四            | 提取同一类型化 prepare 返回值；transport 只负责外部消息；token、取消和清理仍由单一既有所有者控制      |
| 将采集移到 offscreen/keepalive 启动前             | 阶段四            | 准备工作留在 DirectProblemDownload.run 的 loadDocument 回调中，总超时及取消覆盖范围不得缩小           |
| 文本缓存跨任务命中、同文本但资源已变化            | 阶段四            | 任务身份重建编辑状态；资源上下文固定；新任务/新资源清空旧成功缓存，加入对应回归                       |
| 消息版本混用导致旧编辑页等待超时                  | 阶段四            | 明确升级协议、同步守卫和版本错误提示；不默默丢弃旧请求                                                |
| 受控 HTML 扩大执行面或嵌套内容被扁平化            | 阶段二/四         | 惰性 AST 白名单解析；可见内容、布局和 URL 逐项测试；不直接挂载来源 HTML                               |
| 完整 Source/AST/Cnoi/图片一起传输超过预算         | 阶段二/四         | Source 留后台短期内存；只交付 Cnoi 和必要资源；测量复杂输入，沿用现有限额                             |
| 借重构重新调样式使现有 PDF 退化                   | 各阶段，尤其四/五 | style-tokens 和编译设施保持；语义变化与样式变化分别验收；禁止无依据重录基线                           |
| 自动检查通过但实际扩展权限/CSP/下载有问题         | 阶段五            | Chrome/Edge 原生扩展矩阵单独验收；未运行即未完成                                                      |
| 保真门槛范围无限扩大、未知文本一律报错            | 阶段二/三         | 固定已支持语义及扩展文法；可保留内容保守透传，仅实质损失阻断；新增能力同时补 codec 和真实编译用例     |

## 9. 阶段依赖、回退与交付纪律

```text
阶段一：基线与契约
  → 阶段二：保真 codec ── Gate F
    → 阶段三：Source + Transformer ── Gate T
      → 阶段四：统一入口/Parser/状态契约 ── Gate U
        → 阶段五：清理 + 全量/实机验收
```

- 阶段一至三优先以纯逻辑和固定夹具验证新链，必要的 codec/Renderer 保真修复逐项验收；正式入口不逐站、逐按钮零散切换。阶段四前 Gate F 失败时停留修复，不用开关长期维持双轨。
- 每阶段只做依赖它的最小文件改动；不顺带重构提交同步、账号、时间线或 popup 样式。
- 阶段四如需回退，整体恢复该阶段的协议、交付和 Parser 调用，不能只恢复一个按钮；阶段二已独立通过兼容测试的 codec/Renderer 保真修复不随之倒退。任何回退都不删除用户数据，也不保留混用协议或两条 PDF 路径契约不同的半成品。
- 提交与发布按用户当阶段授权执行；本计划本身不授权后续自动提交或发布。
- 每阶段报告至少列出：变更文件、职责迁移、测试命令与结果、富内容/视觉证据、未执行项目、是否满足完成条件。不得用上一阶段或上一轮审查的测试数量代替本阶段验证。

## 10. 计划交付与复核记录

初版基于当前代码核对了 Luogu 语言隔离的新基线，并建立五阶段计划。2026-10-16 进一步复核可靠性、维护与扩展边界后修订了以下问题：

1. 将可选 AST 改为明确的完整/不可完整识别状态，约束 Source 文本与结构来自同一选定来源，避免双重权威和隐式回退。
2. 保留样例分组及原标签，采用显式文档语法解析；不提前删除 SampleBlock，不让 Parser 再猜样例。
3. 将新增 AST 字段所需的 Renderer 透传支持放入同一保真阶段，消除 Gate F 依赖阶段四的潜在顺序冲突；旧生产识别包装退出时间明确。
4. 补充静态规则分派、规则所有权、反例/跨站测试和未知内容分级处理；不创建空规则文件或动态框架。
5. 明确 Parser 的资源上下文及跨任务缓存失效，避免相同文本命中另一题或旧图片 PDF。
6. 保留直接下载采集前启动 offscreen/keepalive 的真实顺序；以类型化准备结果替代模拟 port 的内部取值方式，维持原取消/超时和清理所有权。
7. 补齐扩展语法定稿、有界解析、阶段内部步骤与回退范围，使后续变更能按职责局部实施与验证。
8. 明确当前架构审计尚未覆盖 problem 核心，新增职责边界必须有实际导入图的正反例测试，不以“已有 audit 通过”替代新架构约束。

以上为计划编制与复核时的历史记录。后续用户已授权实施；现状、门禁与未执行项目以执行报告为准。

## 11. 2026-10-16 实施结果

Source/CNOI/edited 三种状态、一次转换、共用 Parser/Renderer、保真 codec、站点规则隔离和依赖审计已落地。Gate F/T/U 均有固定夹具与实际编译证据。阶段五自动部分通过全部门禁；原生 Chrome/Edge 矩阵未执行，不能据此标记可发布。

详见[验收记录](../qa/problem-markdown-pipeline-upgrade.md)及[当前维护说明](../development/problem-markdown-pipeline.md)。本计划前文保留重构前分析作为实施依据；已删除的旧模块链接是历史引用。

2026-10-16 追加旧链路复核：删除旧任务消费 API/占用集合、无发送方的端口命令、未用片段类型及测试专用生产包装；快照构造移到 tests。生产可达性与构建 JS 检查通过，清理后 891 个用例通过、1 个可选 live 用例跳过。详细清单见[执行报告的补查记录](../qa/problem-markdown-pipeline-upgrade.md#旧链路补查与清理2026-10-16)。原生矩阵状态不变。
