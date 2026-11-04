# OJTrace：以 Source Markdown 为唯一内容来源的重构执行计划

> 版本：1.0 · 日期：2026-10-16（Asia/Shanghai）。
>
> 状态：**P0–P5 实施完成，可执行验收通过**。2026-10-16 用户授权“按照计划执行直到完成”后完成本轮重构；Chrome/Edge 原生扩展矩阵因环境不可用仍未验证。原始需求快照保持不变，实际结果见[本轮验收记录](../qa/source-markdown-cnoi-refactor.md)。
>
> 需求基准：[用户需求原文快照](./source-markdown-cnoi-requirements.md)。后续实施以原始要求和用户明确的新指令为准，不以旧实现、旧测试或旧验收报告反向定义目标。

## 0. 需求保存、适用范围与防止偏离的执行方式

### 0.1 文档优先级

1. 本轮用户原始要求及之后用户明确提出的变更。
2. 本计划中落实原始要求的职责边界、阶段任务与验收条件。
3. 代码现状与历史文档，仅作为迁移材料和回归参考。

以下历史文档中允许 Adapter 输出并行 `structure`、允许 Transformer 直接读取来源角色或结构的条款，已与本次要求冲突，不再作为本轮设计依据：

- [旧 Markdown 管线计划](./problem-markdown-pipeline-refactor.md)，尤其是 SourceProblem.structure、SourceBlock、role/sourceKey 的设计。
- 维护文档的旧版调用关系和“QOJ/Hydro 无独立规则模块”的约定；[当前维护文档](../development/problem-markdown-pipeline.md)已按本轮实现重写。
- [旧管线验收记录](../qa/problem-markdown-pipeline-upgrade.md)，其中“已完成”只描述上一轮实现，不能证明本次架构已完成。

本轮保存这些历史记录；实际重构时给旧计划加上被本计划取代的说明，重写维护文档，另写本次验收记录，不把旧报告改造成新架构已经通过的证据。

### 0.2 原始要求的保存与校验

- 原文保存在同目录的 `source-markdown-cnoi-requirements.md`，含六部分需求及最后“先别开工、先写计划”的范围指令。
- 原文区域使用 `USER_REQUIREMENTS_BEGIN/END` 注释标记；不对该区域自动格式化、删节或以摘要覆盖。
- 校验约定：将整份文件的 CRLF 统一为 LF，取开始标记后与结束标记前的原文，不包含标记行及紧邻标记的换行；以 UTF-8 计算 SHA-256。
- 本版原文校验值：`26fcfdf0c2b7c2c480e8b2204fa83f0c57775bac8a6f6957a7d7d026a3b6e1d1`。
- 后续用户改变范围时，追加“用户指令 → 调整内容 → 受影响阶段/测试”的记录；原始快照仍保留。

### 0.3 后续每次继续实施时必须先做的事

1. 重读需求原文、本计划的不变量、上次阶段记录和未完成清单。
2. 检查实际工作区及已有 diff，确认当前进度和未提交改动归属；不根据聊天摘要猜测实现状态。
3. 选取下一个具备依赖条件的任务，列明对应需求、不允许改变的边界和验证方法。
4. 每完成一阶段，记录实际修改、执行命令、结果、未解决项及下一阶段；只有具备证据才勾选完成。
5. 发现设计偏离时修正实现或计划中的实施细节，不能通过放宽需求、恢复隐藏 AST、删除关键测试来维持“通过”。

默认在当前任务内按依赖顺序执行；本计划不要求多代理、创建新工作区、提交、推送或发布。后续获得开始实施的指令后，按本计划持续推进，不把每个阶段变成重复确认环节。

### 0.4 本次范围与保留设施

重构范围包括 `src/problem`、题面导出 application 层、编辑器与 PDF Worker 的相关接口、测试、架构审计和维护文档。

保留并接入新模型：网页快照采集、OJ 路由及语言版本选择、图片获取与资源限制、Typst/WASM 编译器、字体包、现有 PDF/SVG 排版、Worker/offscreen 生命周期、下载与取消机制。账号同步、时间线、账号存储等无关业务不做设计变更。

不在本次新增规则设置 UI、动态插件引擎、任意脚本规则、持久化题面数据库、全局 Source 缓存、另一套 PDF 引擎或兼容旧结构的长期分支。

## 1. 实施前代码基线与实际问题

以下保留 2026-10-16 计划编写时的代码基线，不表示实施后的当前架构。工作区当时已有大量修改及未跟踪文件，实施时保留并在其上继续，没有 reset/clean 或提交。未发现适用的 `AGENTS.md`。最终实际数据流见第 12 节及维护文档。

### 1.1 实施前实际调用关系

```text
网页快照 DOM / allowlist JSON
  → registry.extractSource
  → 五个 Adapter
  → adapters/common.extractSourceDocument
      ├─ sourceMarkdown
      └─ structure.blocks[SourceBlock(role, sourceKey, StatementBlock[])]

复制：extractMarkdown → sourceMarkdown

导出：prepareCnoiProblem
  → 图片补齐
  → transformToCnoi(source)
      → 直接读取 source.structure；没有解析 sourceMarkdown
      → 站点规则 → normalizeStructure
      → serializeMarkdown + serializeProblemMarkdown
  → cnoiMarkdown
      ├─ 直接下载：parseProblemMarkdown → ProblemDocument → offscreen/Worker
      └─ 编辑页：editedMarkdown → parseProblemMarkdown → ProblemDocument → Worker

parseProblemMarkdown 正文：Markdown → marked 生成 HTML → htmlToStatement → StatementBlock[]
Renderer：StatementBlock[] → Typst → SVG/PDF
```

三种 Markdown 状态的命名和两种导出的部分汇合已经存在，可以复用；**Transformer 的内容依据仍是 Adapter 的 structure，核心目标尚未达到**。

### 1.2 模块审计与迁移方向

| 现有模块                                                                                                                            | 已确认行为                                                                                                                    | 本轮处理方向                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [domain.ts](../../src/problem/domain.ts)                                                                                            | `SourceProblem` 同时持有 sourceMarkdown 与 structure；`ProblemDocument` 同时持有 blocks 与 markdown                           | Source 只留 Markdown、元信息、资源、诊断；渲染模型只留解析后的通用 AST 及渲染上下文                           |
| `statement.ts`（已删除/迁移）                                                                                                       | 通用节点混有 `SampleBlock`、`sampleRole`；部分信息只有来源结构保有                                                            | 改为通用 Markdown AST；章节角色与样例配对仅为 Transformer 内部临时分析结果                                    |
| [adapters/common.ts](../../src/problem/adapters/common.ts)                                                                          | 实际函数名为 `extractSourceDocument`；调用 recognizeSamples，组装 role/sourceKey；原生字段拼接文本与 structure 可表达不同信息 | 删除并行结构输出与语义识别；保留来源提取、元信息、资源处理；原生字段边界须编码进 Source                       |
| [Luogu Adapter](../../src/problem/adapters/luogu.ts)                                                                                | 选择 JSON 内容版本、组装分字段内容和样例，并结合 DOM 标签生成结构                                                             | 保留整份选版本能力；将字段及样例关系完整写入 Source，不把语义结构旁路交给 Transformer                         |
| [Codeforces markup](../../src/problem/adapters/codeforces-markup.ts)                                                                | 写入 data-ojtrace-sample-role，并处理字体及预格式化行                                                                         | 保留公式/字体/代码行的忠实提取；样例判断迁入 Transformer；Source 必须保留 Examples 与下级 Input/Output 的层级 |
| [QOJ Adapter](../../src/problem/adapters/qoj.ts)                                                                                    | 在 Adapter 内遍历标题，依 Samples/Examples 父章节给 Input/Output 标记样例角色                                                 | 整段上下文语义判断迁入 QOJ/通用 Transformer 规则                                                              |
| `recognize-samples.ts`（已删除/迁移）                                                                                               | 在提取时识别、配对样例并收集说明                                                                                              | 从 Adapter 删除；所需算法改写为 Transformer 对通用 AST 的分析，不整体搬运旧契约                               |
| `html-to-statement.ts`（已删除/迁移）                                                                                               | 通用 HTML 提取、网页 UI 清理、受控 HTML 解码、显式 sample/role 解码等混合在同一入口                                           | 分离网页提取与通用语法解码；编辑正文不能被网页 UI class 过滤策略误删                                          |
| [cnoi/transform.ts](../../src/problem/cnoi/transform.ts)                                                                            | 不读取 sourceMarkdown，只读取 structure；规则目前只有 Luogu、CF、AtCoder                                                      | 改成通用 AST → 通用 AST；完整链路在唯一编排入口显式解析 Source 后调用                                         |
| [cnoi/rules/common.ts](../../src/problem/cnoi/rules/common.ts)                                                                      | 依来源 role 增补标题、调整层级、样例补号、相邻标题去重                                                                        | 从 Markdown 标题及祖先上下文识别；移除强制补号和过宽去重；内容删除须有明确证据                                |
| [站点规则目录](../../src/problem/cnoi/rules)                                                                                        | Luogu 依 sourceKey 去重；AtCoder 移除配点和所有分隔线；CF 处理引号中的等宽文字                                                | 重建来源于 AST 的规则；补齐 QOJ、Hydro 两个独立模块；审查有内容损失风险的旧行为                               |
| `markdown-serializer.ts`（已删除/迁移）                                                                                             | serializeMarkdown 与 serializeSourceMarkdown 两套输出入口，后者展开 sample；复杂内容采用受控 HTML                             | 合成一个语法 Serializer；保留图片、表格、精确代码等保真能力，移除 sample 展开入口                             |
| [problem-markdown.ts](../../src/problem/problem-markdown.ts)                                                                        | front matter 编解码、正文解析、资源关联、显示标签派生在同一文件；正文通过 HTML 中转                                           | 元信息信封与正文语法职责明确；编辑元信息只来自当前 Markdown；正文统一进入新 Parser                            |
| [Typst Renderer](../../src/problem/render/typst-renderer.ts) / `节点转换`（已删除/迁移）                                            | 现有 sample 渲染已直接展示标签，未在该函数重新编号；仍依赖旧模型                                                              | 保留视觉与编译逻辑，迁移输入模型，禁止增加语义修补；无需为了“清理”重写已正确设施                              |
| [service.ts](../../src/application/problem-export/service.ts) / [ProblemStudio](../../entrypoints/problem-export/ProblemStudio.tsx) | 已有单任务转换、editedMarkdown 初始化、共用解析、取消和缓存逻辑                                                               | 更新为真实 Markdown 基础链路，保留已合理的任务和编辑行为                                                      |
| [source-test-helpers.ts](../../tests/problem/source-test-helpers.ts)                                                                | 用 structure 构造 Source，或从 structure 拼回 document 断言                                                                   | 删除隐藏结构测试捷径；分为 Source 文本断言、独立转换断言、最终渲染断言                                        |

旧名称处理以实际引用为准：需求中提到的 `extractDocument` 当前已是 `extractSourceDocument`；`format-problem-markdown.ts` 等已在工作区删除，不重新创建这些旧入口。本轮记录实际清理内容，不把不存在的旧文件算作新完成工作。

### 1.3 已有测试的价值与不足

可复用：五站网页夹具、Luogu 题库/多语言回归、图片/表格/公式保真夹具、真实 Typst 编译、Worker 与 CSP、服务交付、直接下载、编辑页测试。

必须改变：现有 `tests/problem/cnoi.test.ts` 多数先经 Adapter 构造 Source；一些断言直接检查 structure/sample；`sourceFromDocument` 可让 Markdown 与 blocks 不一致而测试仍通过。这些测试不能证明固定 Source Markdown 能独立转换，也不能作为新架构的完成条件。

现有历史报告中的通过数量不作为本轮基线。实际重构开始后重新运行并保存结果；本次编写计划没有运行项目测试或构建。

## 2. 架构不变量与验收约束

| ID  | 不变量                                                                                           | 必须具备的验证                                              |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| A01 | Source Markdown 是唯一正式题面内容；Source 无 structure、内容 blocks、section roles 或另一份正文 | Source 类型、运行时对象和 fixture 均检查；源码依赖审计      |
| A02 | 复制直接返回 sourceMarkdown，不转换、不套元信息包装                                              | 复制结果严格相等；Transformer 调用次数为 0                  |
| A03 | 导出转换前必须解析实际 sourceMarkdown；更改 Source 文本必须改变转换结果                          | 固定 Markdown 测试及文本变更反例；不接受隐藏 AST 构造器     |
| A04 | Parser 只识别 Markdown/受控扩展语法，不推断 input/sample 等题面语义                              | 无 OJ 规则依赖；同一文本换 OJ 上下文得到相同语法 AST        |
| A05 | 全部语义判断、结构重排、包装移除、必要标题调整集中在 Transformer                                 | Adapter/codec/Renderer 无语义正则和站点转换依赖；对应正反例 |
| A06 | 通用规则与五个独立 OJ 规则存在清晰分派，规则以可序列化配置为主                                   | 各站可独立测试；结构化规则配置校验与确定性测试              |
| A07 | 保留语言和原有编号；无号样例默认不自动编造编号                                                   | zh/en/ja/other、非连续编号、无编号、冲突编号测试            |
| A08 | 内容无法可靠归类时保留；移除包装不丢包装里的正文、说明和特殊章节                                 | 混合包装、未知标题、交互/输出题、约束/评分等夹具            |
| A09 | Serializer 只编码，不能在序列化时配对样例、改标题或排序                                          | AST → Markdown → AST 保真与稳定性测试                       |
| A10 | PDF Renderer 只对当前 Markdown 的解析结果做排版，不能重跑转换                                    | Renderer 依赖审计；用户自定义标题/次序/编号完整输出         |
| A11 | sourceMarkdown、cnoiMarkdown 不被转换、资源补齐、编辑或预览回写                                  | 冻结输入及多阶段前后比较                                    |
| A12 | 两种导出对相同最终文本共用 Parser、资源解析及 Typst 路径                                         | AST、Typst source、资源映射及 PDF 内容/排版一致             |
| A13 | 图片布局、合并表格、公式、代码精确内容跨全链路保留                                               | 保真矩阵及真实 PDF/SVG 检查                                 |
| A14 | 保留现有字体、字号、行距、页边距、样例框、分页策略和编译设施                                     | 样式配置/字体清单差异审查、固定最终文档视觉回归             |
| A15 | 不存在长期双流程、旧结构兜底或生产依赖测试夹具                                                   | 清理清单、运行时依赖审计、构建产物检查                      |
| A16 | 验证状态有真实证据；浏览器无法执行时明确记为未验证                                               | 命令退出码、失败/跳过原因、浏览器版本与证据记录             |

## 3. 目标模型、接口与真实数据流

### 3.1 唯一内容模型

以下是目标职责示意，实际字段沿用已有合理命名；不能以字段重命名恢复第二套内容来源。

```ts
interface SourceProblem {
  readonly sourceMarkdown: string;
  readonly metadata: ProblemMetadata;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}

interface MarkdownRoot {
  readonly type: "root";
  readonly children: readonly MarkdownBlock[];
}

interface CnoiProblem {
  readonly cnoiMarkdown: string;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}

interface RenderDocument {
  readonly metadata: ProblemMetadata;
  readonly ast: MarkdownRoot;
  readonly assets: readonly ProblemAsset[];
  readonly warnings: readonly ProblemWarning[];
}
```

- `ProblemMetadata` 独立定义，不再从“同时含 Markdown/blocks 的 ProblemDocument”用 Omit 派生。
- Metadata 只含 OJ、题号、题名、URL、时限、内存、语言等事实；不放章节文本、样例数据、语义结构或节点定位旁表。
- 旧 `ProblemDocument` 改为职责单一的 `RenderDocument`，只在解析最终 Markdown 后创建；不携带另一份可修改的 markdown 字段。Worker 协议、校验器及测试同步迁移，不长期保留类型别名。
- 通用 AST 保留标题、段落、列表、引用、表格、图片、代码、数学、分隔线，以及确有需要的显式容器/布局语法。删除 Adapter 声明的 sampleRole 和通用语法 AST 中的语义 SampleBlock。
- 输入/输出/样例等语义只在 Transformer 内部的临时分析中存在；其输出仍为通用 AST，通常由普通标题、代码、段落等表达。现有 sample 渲染本质为顺序展示标签与内容，可去除该中间语义节点并沿用视觉函数。

### 3.2 各层接口和唯一编排入口

```text
Adapter.extractSource(snapshot)
  → SourceProblem

parseMarkdown(sourceMarkdown, { baseUrl })
  → 通用 MarkdownRoot + 语法诊断

transformToCnoi(ast, { metadata, rules })
  → 新 MarkdownRoot + 转换诊断

serializeMarkdown(transformedAst)
  → CNOI 正文 Markdown

元信息信封编码(metadata, body)
  → cnoiMarkdown（沿用可编辑的 YAML front matter + 正文）
```

完整 Source → CNOI 流程只提供一个编排入口，建议放在 `src/problem/cnoi/convert.ts`；它显式执行“解析 → 转换 → 序列化”，无网页访问、React、Chrome API 或编译依赖。`transformToCnoi` 本身只做 AST 变换，不能另读 Adapter 的产物、重新抓网页或把字符串解析藏在旧 structure 兼容分支中。

这不是两套转换入口：`convert` 是唯一完整用例，`transform` 是其内部可单测的 AST 阶段。现有 service.prepareCnoiProblem 负责采集、资源补齐、任务取消和调用该用例，不再内嵌另一套转换步骤。

### 3.3 最终 Markdown 到 PDF 的共用入口

```text
                            ┌─ 复制：严格返回 sourceMarkdown
SourceProblem ──────────────┤
                            └─ parse Source → Transformer → Serializer
                                                  ↓
                                            cnoiMarkdown
                                         ┌────────┴────────┐
                                         ↓                 ↓
                                     直接导出       editedMarkdown 初始副本
                                         ↓                 ↓ 用户编辑
                                         └────────┬────────┘
                                                  ↓
                                 读取当前 front matter + parseMarkdown
                                                  ↓
                                      资源关联 → RenderDocument
                                                  ↓
                                同一 Typst 节点转换、模板、资源准备
                                         ┌────────┴────────┐
                                         ↓                 ↓
                                    SVG 预览           PDF 编译/下载
```

“Renderer 负责解析最终 Markdown”落实为同一条渲染准备边界：所有用户可见预览和 PDF 都先经过相同的最终 Markdown 解析入口。底层 Typst 编译器接收 RenderDocument/Typst，无需在 Worker 内重复解析同一文本。直接路径与编辑路径不能各自实现一套 Parser 或元信息回退策略。

### 3.4 三种文本与元信息的生命周期

| 状态           | 产生和持有位置               | 使用方式与不可变约束                                 |
| -------------- | ---------------------------- | ---------------------------------------------------- |
| sourceMarkdown | Adapter 创建，任务范围内保存 | 复制与首次转换；不由 Transformer/编辑器/资源补齐更新 |
| cnoiMarkdown   | 唯一转换用例创建             | 直接导出和编辑器初始化；不拿编辑结果覆盖             |
| editedMarkdown | 编辑器按新任务 token 初始化  | 用户更新；预览、导出、编译重试只读取该副本           |

- 不为满足命名而在无编辑器的直接下载任务中额外创建 editedMarkdown。
- 不为每次 React 重渲染、预览或导出重新执行 CNOI 转换。重新捕获网页的新任务可有一次新转换；失败重试按现有任务语义处理，不新增跨任务缓存。
- CNOI 文档继续使用 front matter 保留现有编辑元信息能力；它属于文档编码，Serializer 不据此修改章节。
- 编辑后 title、URL、限制、语言等以当前 front matter 为准；删除/清空字段不从旧 metadata 或 resources.language 偷补。必需字段无效时显示解析诊断，不能下载旧缓存冒充成功。
- 图片嵌入只替换资源集合；图片位置、尺寸等内容字段来自当前 Markdown AST。删除图片即从渲染引用中消失，不能按旧 AST 或数组位置补回。

## 4. Markdown Parser / Serializer 的实现策略

### 4.1 统一语法链路

优先使用项目现有的 `marked` 依赖，以其词法 token 直接构建通用 AST；复用现有公式 tokenizer 和经过验证的图片、表格、代码解码能力。先验证能力，再确定实现细节，不在编写计划时升级依赖。

目标不再把整份 Markdown 先变成 HTML 再当 OJ 网页重新提取。受控 HTML 节点可调用共享的惰性 HTML 语法解码器；该解码器不根据 OJ 名称、网页 UI class、Input/Output 标题清理或归类内容。

若现有 token 能力存在经夹具证明的缺口，实施时只为实际缺口调整解析实现；需要替换解析依赖时先核对官方文档、许可证、体积、MV3/CSP、浏览器/Worker 支持，并同步 lockfile 和 notices。不能以接入新解析库为理由保留旧语义通路。

### 4.2 必须明确的语法合同

| 内容               | Source / CNOI 的表达策略                                      | 保真要求                                                                     |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 原生 Markdown      | 尽量保留选定版本原文；仅按来源实际字段组装                    | 文字、原有标题、字段顺序不被 CNOI 规则提前改写                               |
| 标题及嵌套         | 标准 # 标题；必要时显式来源容器                               | 保留级别、顺序、标题内格式和父子上下文                                       |
| 段落、列表、引用   | 标准 Markdown；复杂嵌套使用受控 HTML                          | 有序列表起始值、空项、嵌套和多段内容不丢失                                   |
| 数学               | 行内/块级数学语法，复用现有已支持定界符                       | TeX、上下标、字面量美元、转义和代码内文本不混淆                              |
| 代码/预格式化      | 可保真时 fenced code；否则精确 pre/code 扩展                  | 缩进、空行、末尾换行、反引号、语言、题注、数学行保留                         |
| 图片               | 普通 Markdown 图片；尺寸等使用 img 受控属性                   | width/height、比例、zoom、max-width/height、alt、行内位置保留                |
| 表格               | 简单表格用 GFM；复杂表格用受控 table                          | rowspan/colspan、无表头、对齐、不等长、公式/代码中的竖线保留                 |
| 对齐/figure/题注   | 现有受控布局语法，经统一 codec 整理                           | 结构和显示属性保留；不从图片后任意正文自动推断新题注                         |
| 来源 JSON 字段边界 | 优先原页面同版本标签/标题；无法表达时采用正文中的有限来源容器 | 只记录原始字段键/容器边界，不塞完整 JSON、另一套 AST 或 Transformer 预判角色 |
| 未知扩展/HTML      | 保留可表示的惰性内容；无法安全完整渲染时给出诊断              | 不静默删正文，不回退到隐藏结构或另一语言                                     |

来源容器只在标准 Markdown 确实无法保留信息时使用。例如原生 JSON 的 `formatI` 没有题面标题时，可在 Source 正文保留该原始字段键，Parser 只解析为带属性的普通容器，Luogu 规则再识别其意义。不能把所有标题旁边都注入 `role=input`/`role=sample`，也不能把并行 structure 改名后藏进 HTML 注释。

对于非 h1–h6 的网页视觉标题，Adapter 可以忠实映射页面已有层级关系；已有 h1–h6 不得为了 CNOI 统一改成 h2。Codeforces 的 Examples 与内部 Input/Output 必须在 Source 中保留两层关系，不能先展平成同级再让 Transformer 猜测。

### 4.3 codec 验收定义

- `parse(serialize(ast))` 的内容与显示语义等价；可忽略 source position、对象身份和渲染临时路径，不得忽略文字、编号、顺序、换行、尺寸、跨度或 TeX。
- `serialize(parse(serialize(ast)))` 在规范编码后稳定，不因多次保存逐渐增添空行、标签或包装。
- Serializer 不读取 OJ 规则、推断标题或生成样例编号；Source 与 CNOI 使用同一语法编码设施。
- Adapter 的原生 Markdown 尽量不经无必要的 parse/serialize，防止“为了统一输出”改写原文。
- 保留现有长度、深度、节点、表格和资源限制；错误发生在哪一层就在该层报告，不再用 `source.structure.ok=false` 代替语法/转换错误。

## 5. Transformer：分析、规则与内容保护

### 5.1 处理顺序

1. 读取通用 AST 的标题序列，建立仅在本次转换内使用的标题树/祖先栈。标题范围在遇到同级或更高标题时结束；引用、列表、显式来源容器的范围单独处理。
2. 应用所选 OJ 的来源语法解释和别名配置，结合通用规则识别可能的描述、输入格式、输出格式、样例包装、样例输入/输出/说明等。
3. 先判断上下文，再判断标题词面。Examples/Samples 下的 Input/Output 优先归为样例；顶层 Input/Output 归为格式；不能看见 `Input + code` 就判定样例。
4. 根据语义分析建立变换动作：标准章节的稳定重排、标题级别调整、包装展开、必要的同语言标题补全、样例整理。变换动作保留原节点范围，不对原 AST 原地修改。
5. 执行动作并保留正文。移除包装标题时，包装里的引言、图片、表格、说明、子章节必须有明确去向，不能整体丢弃包装子树。
6. 对发生歧义或无法配对的内容保守保留，必要时追加诊断。输出通用 AST，交给 Serializer 编码。

章节分析可使用简单内部结构，但它必须由本次 Source Markdown 的解析结果生成、只在 Transformer 内存在；不得被 Adapter 返回、在 Source 中缓存或通过外部 metadata 注入。

### 5.2 数据驱动的规则边界

建议将通用识别/变换算法与规则数据分开，配置至少能表达：标题别名、适用语言、允许的父章节上下文、包装名称、目标层级、标准章节顺序、可选的同语言标题映射。配置使用普通只读对象和有界枚举动作，不在配置中保存任意执行脚本。

五个 OJ 各自导出明确的规则配置，通用规则合并后使用；不做动态注册、类继承或五个只调用同一函数的空包装。确有复杂来源特例时允许少量、局部、可测试的代码处理，先证明必要性，避免为少数特例建通用规则语言。

默认策略如下：

- 识别并规范已确认的标准章节；重排使用稳定顺序。未知章节、Constraints/制約、评分、交互协议、输出题说明等不能被粗暴并入“提示”或跨越其他段落移动。
- 重排目标是常见的背景、描述、输入、输出、样例、说明关系；对未知锚点及含特殊结构的题面保留原文关系，规则和测试中明确具体可移动范围。
- 保留已有英文/日文/中文标题；必要改名只在 Transformer 中按原语言完成，不把所有标题中文化。
- 原有数字、字母、罗马数字或其他明确样例标识按原文保留，不使用“遍历第几个样例”覆盖。默认不为无号样例自动补号。
- 输入 2 与输出 3 不配对。只有输入或只有输出也保留，不拿别组内容补齐。说明的归属取决于章节范围及编号证据，不能越过下一组样例吞并。
- 不按文本相同删除标题、段落或样例；只有同一来源的重复表示且证据充分时去重。
- 不无条件删除 AtCoder 所有分隔线或配点段落。先区分页面装饰和题面信息；实质评分内容保留，移除仅限有明确来源/结构证据的包装或装饰。

### 5.3 Codeforces 必须先落实的上下文回归

使用用户给出的固定 Source Markdown 作为第一组核心夹具：

```markdown
## Input

输入格式……

## Output

输出格式……

## Examples

### Input

样例输入……

### Output

样例输出……
```

必须验证：顶层 Input/Output 仍是格式章节；Examples 下的 Input/Output 被识别为样例；取消 Examples 包装后，原 h3 样例标题升为 h2；所有正文原样保留。为避免展平后同名标题失去样例语境，CF 规则可将该处 `Input/Output` 同语言补全为 `Sample Input/Sample Output`，不补造编号；明确写入配置和期望夹具。

扩展同组反例：Examples 后新顶层 Input；引用中的 Input；Input 标题后无代码；多个 Examples；包装中有正文和图片；非连续编号 2/7；样例说明下另有 Input；包含单词 input 的普通标题。测试要同时证明正确识别和不越界识别。

### 5.4 五个 OJ 的 Adapter 与规则任务

| OJ         | Adapter 保留/修正重点                                                                                                                  | 对应独立 Transformer 规则                                                                                                      | 重点夹具                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Luogu      | 保留 `lentille`/已有 JSON 形态、DOM 回退、题号题库路由；整份选择一个语言版本；保留字段原文、字段边界、原样例序列、原标签和精确代码字节 | 由 Source 中的标题或原始字段键解释背景/描述/输入/输出/提示/样例；处理样例包装、层级和有来源证据的重复表示；不依 sourceKey 旁表 | P/B/U/T 路由现有覆盖、AT/CF/SP/UVA 题库、译文字段为空、嵌入与原生样例、Luogu 指令和合并表格 |
| Codeforces | 保留正文、原生 Examples 层次、样例行、字体、TeX/图片；仅清除复制控件和页头等已确认网页壳                                               | 区分格式 Input/Output 与 Examples 内样例；展开包装并提升子标题；保留编号与 Note；等宽引号特例需保真证据，不改真实代码          | problemset/contest/Gym、Examples 下裸 Input、多组及无号样例、数学预格式化行、顶层格式反例   |
| AtCoder    | 保留实际显示 en/ja 分支、题名、限制、Score/配点、分隔线和原始章节顺序                                                                  | en/ja 标题别名、样例与说明上下文、h3 主章节调整；分离格式和样例；评分/约束/交互内容保守处理                                    | en/ja、DOM 显示与 URL 不同、Sample Input/Output 2/7、入力例/出力例、制約、配点、正文分隔线  |
| QOJ        | 保留 article/statement tab 定位与元信息；删除 Adapter 标题栈及 sample-role 注入；区分网站 tabs 与正文                                  | 独立 QOJ 配置识别 Samples/Examples/样例包装及子 Input/Output；处理说明与已知标题变体，未知 UOJ 变体不套 CF 假设                | 普通/比赛路由、英文/中文、独立及嵌套样例、格式与样例同名、正文 alert/引用                   |
| HydroOJ    | 保留题面 marker、自部署域名支持、来源语言和资源；核对系统 callout 清理证据，不能仅凭 note/warn class 删除正文                          | 独立 Hydro 配置处理已验证的中英文样例、输入输出格式、说明/数据范围变体；原有包装和标题关系由 Source 呈现                       | 官方/自部署、domain 路由、样例与数据范围、合并表格、真实正文 note/warn、挑战页              |

Luogu 方言的**来源解码**仍属于 Adapter：例如 `:::align`、原始表格写法转成可保真的 Source 语法；CNOI 的标题/样例整理属于 Transformer。未知方言不能静默丢弃，通用 Parser 也不能仅因为 metadata.oj=luogu 而执行来源变换。

每站必须有独立配置文件和本站正反例；共享规则可以复用，但不能以“当前通用规则足够”为由省略 QOJ、Hydro 模块，也不能把本站语义处理继续留在 Adapter。

## 6. 按依赖执行的阶段与完成门槛

执行顺序为 `P0 → P1 → P2 → P3 → P4 → P5`。P1/P2 可先用离线夹具开发；五站、共享类型和生产接线在 P3 一并切换，不能先切一站而为其余站长期保留 structure 分支。

中途允许存在尚未接入生产的底层新模块；不允许增加用户可选的旧/新转换模式、`structure ?? parseMarkdown` 回退或第二个公开导出路径。若共享类型使 P3/P4 需要在同一集成批次完成，就合并该批次，不能为了每个小步骤都可发布而设计兼容层。

### P0：冻结基准、补充来源证据和建立测试清单

- [x] 重新阅读本计划/需求原文，检查 AGENTS、git status 与已有 diff，记录哪些改动属于原工作区。
- [x] 运行当前 typecheck、相关测试与构建，保存实际结果；现有失败单独记录原因，不能回滚用户改动来取得“干净基线”。
- [x] 保存依赖、字体清单、style-tokens/template、编译配置及 PDF 样式基准；选取固定最终 Markdown 生成 Typst/SVG/PDF 参考证据。
- [x] 清点五站现有 HTML/JSON 夹具、语言、路由和资源覆盖；为 CF/QOJ 上下文、非连续编号及 Source 字段边界补充最小回归输入。
- [x] 给每个旧测试标记“继续保留、改为 Source 断言、迁入 Transformer、删除错误期望”，写明理由。

**产出：** 本次基线记录、模块依赖/删改清单、夹具覆盖表、样式参考。**Gate 0：** 不能把旧测试通过当作新架构正确；开始 P1 前应明确现有来源信息在哪些 Source 中丢失。

### P1：建立通用 AST、Parser、Serializer 和保真合同

- [x] 在 `src/problem/markdown/` 建立单一通用 AST 与 parse/serialize 模块；抽取可复用的 HTML 解码、数学 token、图片/表格/代码编码。
- [x] 移除通用模型的 sampleRole/SampleBlock 设计；用普通节点表示内容，显式来源/布局容器仅保留原文语法属性。
- [x] 将网页 UI 清理与受控 HTML 解码分开，避免编辑用户的 HTML/class 时被当网页壳删除。
- [x] 实现第 4 节的语法与受控扩展合同；每个扩展有保真正例、无效输入诊断、近似普通内容反例。
- [x] 独立 `ProblemMetadata`；落实最终渲染模型设计，不再让多个正文属性互相兜底。
- [x] 用真实丰富内容及小型精确案例检查 AST 往返、稳定序列化和 Typst 可表达性。

**产出：** 纯语法模块、受控语法说明、离线 codec 测试。**Gate 1：** 内容保真通过，Parser 不引入 OJ 语义；未知语法不静默丢失。不能携带旧结构通过测试。

### P2：从固定 Markdown 开发通用与五站 Transformer

- [x] 建立 `tests/problem/fixtures/source-markdown/`，每个用例包含独立 `.md`、最小 metadata、预期 CNOI `.md` 及必要资源；不包含 Adapter 生成的 structure。
- [x] 实现通用标题上下文分析、章节识别、稳定重排、包装展开、层级调整和保守保留策略。
- [x] 实现 `common/luogu/codeforces/atcoder/qoj/hydroj` 规则配置；为复杂来源特例提供小型、局部测试。
- [x] 先完成用户 CF 例子，再覆盖 zh/en/ja、未知语言、多组样例、无号/非连续编号、不同编号、不完整样例和说明范围。
- [x] 建立唯一 `convertSourceToCnoi` 编排用例，明确调用 Parser → Transformer → Serializer → front matter 编码。
- [x] 加入 Source/AST 深冻结与“只改 Markdown 即改变输出”测试；任何测试都不能凭旧 blocks 填充结果。

**产出：** AST Transformer、五站规则配置、固定 Markdown/预期夹具、唯一转换用例。**Gate 2：** 不访问网页、不调用 Adapter 即可证明转换规则正确；无自动翻译、强制补号、越界配对或包装正文丢失。

### P3：五站 Source 契约与生产数据流整体切换

- [x] 修改 SourceProblem/ProblemAdapter/registry：Source 无 structure、SourceBlock、SourceSectionRole 或外部语义注解旁表。
- [x] 调整 common 提取工具：只生成忠实 Source、metadata、assets、warnings，删除 recognizeSamples 调用及语义结构构造。
- [x] 依次完成 Luogu → Codeforces → AtCoder → QOJ → HydroOJ 的 Source 夹具校验；每站同时核对原语言、层级、样例、资源和特殊节点。
- [x] Luogu 原生字段不能裸拼到无法区分；CF 的 Examples 子标题不能与格式同级；QOJ 不再写 sample-role。
- [x] service.prepareCnoiProblem 仅调用新的完整转换用例；copy 只返回 sourceMarkdown。保留捕获、资源补齐、大小限制、取消、交付成功后消费任务的合理机制。
- [x] 最终文档解析统一改为新 Parser，返回 RenderDocument；移除 Markdown → 整页 HTML → 网页提取器的编辑流程。
- [x] 同步更新 transport、Worker/offscreen 消息、运行时守卫、文件名工具和 UI 类型；必要时提升内部协议版本并明确拒绝旧报文，不保留旧对象转换兜底。
- [x] 对五站各跑一条完整路径：来源快照 → Source → 新转换 → 最终解析 → Typst。

**产出：** 五站生产入口全部基于 Source Markdown、单一正式转换路径、纯渲染模型。**Gate 3：** 无来源 structure 读取点；实际 Source 文本是输出内容的充分依据；共享接口、typecheck 及集成回归通过。

### P4：编辑器、渲染与两条导出一致性

- [x] ProblemStudio 只用 cnoiMarkdown 初始化 editedMarkdown；同一任务不覆盖编辑，新 token 才创建新副本。
- [x] 预览、编辑导出和直接导出使用同一最终文档解析、资源关联与 Typst source/资源准备。
- [x] 删除编辑序列化/Parser/Renderer 中残余的 CNOI 语义操作；保留 front matter 语法校验和纯展示标签配置。
- [x] RenderDocument → Typst 迁移保留当前模板、字体、样例框和分页代码；删除旧 sample 节点分支，直接按 AST 顺序展示。
- [x] 编辑标题、编号、章节顺序、正文、代码、图片、表格、公式和元信息后，检查预览与 PDF 均忠实变化；没有旧内容补回。
- [x] 保留 IME、防抖、最新任务队列、取消、超时、迟到结果丢弃、Worker 释放与文本/资源一致的缓存判断。
- [x] 用相同捕获快照和资源比较直接导出与编辑未改导出的 AST、Typst、资源、PDF；不能两次访问变化网页后声称一致性失败或成功。

**产出：** 编辑/直接导出统一渲染链路、状态不变性和视觉回归证据。**Gate 4：** 三态清晰，编辑不转换、无修改两路一致，PDF 样式无额外调整。

### P5：删除旧实现、补文档并执行最终验收

- [x] 按第 7 节逐个删除被替代的函数、类型、文件及测试辅助层，检查生产引用和构建入口，不只搜索旧名称。
- [x] 扩展 architecture audit：新 markdown 目录受边界约束；Adapter/Parser/Serializer/Renderer 不能导入站点 Transformer；Transformer 不能导入 Adapter/registry/Renderer/浏览器 API。
- [x] 更新维护文档、旧计划取代说明、五站规则扩展说明、受控语法和本次 QA 报告；历史验收数字不复制为本次结果。
- [x] 执行第 9 节的相关测试、完整测试、契约测试、静态检查、构建和 manifest 审计。
- [x] 执行可用浏览器验证，保存证据；原生扩展环境不可用的项目明确列为待验证。
- [x] 按第 11 节复核所有需求项，填写第 12 节阶段记录并给出最终报告。

**产出：** 唯一正式链路、无冗余入口、可持续维护的规则/夹具和完整验证记录。**Gate 5：** 架构、内容、视觉、工程门禁都有证据；剩余限制如实交代，不伪装成全部验证完成。

## 7. 模块增改删清单

### 7.1 目标目录及依赖方向

下列是实施落点，不要求为每个小功能创建新文件；同一职责可保持紧凑，不能留下同功能的旧目录副本。

```text
src/problem/
  domain.ts                         # Source/CNOI/Metadata/Assets 等边界数据
  adapter.ts、registry.ts           # 五站 Source 提取契约与分派
  adapters/
    common.ts                       # 仅来源提取辅助
    luogu.ts / codeforces.ts / atcoder.ts / qoj.ts / hydroj.ts
    luogu-dialect.ts                 # 原站方言忠实解码
    codeforces-markup.ts             # 原站字体、公式、预格式化等忠实映射
  markdown/
    ast.ts                          # 通用语法节点，无 OJ 语义角色
    parse.ts                        # Markdown → 通用 AST
    serialize.ts                    # 通用 AST → Markdown
    html.ts                         # 必要的惰性 HTML/受控扩展语法支持
  cnoi/
    convert.ts                      # 唯一 Source→解析→转换→序列化用例
    transform.ts                    # AST→AST；语义分析/变换算法
    rules/
      common.ts
      luogu.ts / codeforces.ts / atcoder.ts / qoj.ts / hydroj.ts
  extract/
    html-document.ts                # 现有有界、惰性 HTML 基础设施
    metadata.ts / image-assets.ts / image-type.ts
    [仅在确有需要时保留独立的网页 HTML→通用 AST 提取模块]
  problem-markdown.ts               # 完整文档元信息信封与最终渲染准备边界
  markdown-front-matter.ts          # 现有 front matter 范围语法工具
  render/
    [通用 AST→Typst 节点转换]        # 迁移原 statement-to-typst 的有效实现
    template.ts / style-tokens.ts / font-manifest.ts
    typst-renderer.ts / browser-typst-compiler.ts
    [现有 Worker、PDF、诊断等设施]
```

依赖规则：Adapter 可使用通用语法与 HTML 基础设施；Parser/Serializer 只依赖语法及必要资源基础类型；Transformer 只依赖通用 AST、规则与元信息；convert 用例调用 Parser/Transformer/Serializer；Typst 层只消费解析后的最终 AST 与资源；application 负责网络、Chrome API、任务和编排。

### 7.2 必须消除的旧结构和职责

| 项目                                                       | 最终处理                                              | 删除前/后的检查                                           |
| ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `SourceProblem.structure`                                  | 删除，不提供可选字段或旧数据兜底                      | 五站输出、service、Transformer、测试均无读取              |
| `SourceBlock` / `SourceSectionRole` / 外部 role/sourceKey  | 删除这些正式内容合同                                  | 所需来源事实已完整进入 Source 文本；metadata 无旁表       |
| `StatementBlock` 中 SampleBlock/sampleRole                 | 删除语义节点；通用节点迁入 markdown AST               | Renderer 普通节点顺序输出相同内容，测试不再构造隐藏样例块 |
| `adapters/recognize-samples.ts`                            | 删除                                                  | 所有样例识别在 Transformer，独立 Markdown 测试覆盖        |
| QOJ 标题栈、CF sample-role 属性写入                        | 删除语义判断/注入                                     | Source 自身标题/容器足以恢复父子关系                      |
| `normalizeStructure(SourceBlock[])`                        | 删除/重写为新 Transformer 内部逻辑                    | 不保留旧签名桥接层；无 Adapter role 输入                  |
| 旧 `transformToCnoi(SourceProblem)` 实现                   | 替换成 AST 转换；完整编排仅 convert                   | service 无旧分支，导出/编辑不绕过 Source Parser           |
| `serializeSourceMarkdown`                                  | 删除专用 sample 展开入口                              | 来源临时 AST 使用同一 Serializer；原生 Markdown 直接保留  |
| `extract/markdown-serializer.ts`、`statement-html.ts`      | 保真逻辑迁入统一 codec 后删除旧实现                   | 无重导出兼容壳，无重复编码器                              |
| `extract/markdown-to-html.ts`                              | 完整 Markdown 解析替换后删除，公式 tokenizer 迁移复用 | 生产不再借网页提取器解析最终 Markdown                     |
| `htmlToStatement` 旧综合入口                               | 拆分职责并删除旧入口；必要提取算法保留                | 网站清理不影响编辑正文；无裸标题样例判断                  |
| 旧 `ProblemDocument.blocks + markdown`                     | 改成仅含通用 AST 的 RenderDocument                    | Worker/UI/文件工具/校验器/测试统一，无长期类型别名        |
| localization 中 CNOI 章节/样例标签生成                     | 迁入规则配置                                          | 限制/页码等纯显示文案可保留，不重写正文                   |
| 测试辅助器 `sourceFromDocument` 等旧 blocks/structure 路径 | 删除或改成真实 Source 文本夹具                        | 禁止测试数据同时携带两份互不一致正文                      |
| 旧语义兼容、mode 开关、fallback parser                     | 删除                                                  | 运行时依赖图、全项目引用及构建产物共同确认                |

不能把搜索到的所有 `blocks` 都删除：通用容器/AST 内部的子节点集合是合法结构，问题是来源模型中的并行内容和语义旁路。也不能因为名字旧就删除仍有真实调用的网页解析、图片处理或编译设施。

### 7.3 必须同步更新的集成位置

- `src/application/problem-export/service.ts`：复制、采集/转换、直接渲染准备、交付编辑页。
- `messages.ts`、`transport.ts`、`pdf-worker-messages.ts` 及 `validate-document.ts`：真实类型、版本和大小/字段校验。
- `direct-download.ts`、`entrypoints/pdf-worker/renderer.ts`、render Worker 消息：新渲染模型和错误传播。
- `ProblemExport.tsx`、`ProblemStudio.tsx`、下载文件工具：新类型、同一解析入口、状态和缓存约束。
- `tools/audit-architecture.mjs`、`tests/tools/architecture.test.ts`：新目录与禁止依赖的正反例。
- 维护文档、QA 文档；如实际变更依赖再更新 package/lockfile/THIRD_PARTY_NOTICES，不做无必要升级。

## 8. 测试设计与需求追踪

### 8.1 测试分层和夹具组织

```text
docs/fixtures/problem/                      # 已有脱敏网页/JSON 来源材料
tests/problem/fixtures/source-markdown/
  common/、luogu/、codeforces/、atcoder/、qoj/、hydroj/
    *.source.md                            # 固定、可单独阅读的 Source
    *.expected.md                          # 人工审查的 CNOI 期望
    [最小 metadata / assets / 说明文件]
tests/problem/markdown/                     # 纯语法、往返、稳定性
tests/problem/cnoi/                         # 通用与各 OJ 转换规则
tests/problem/adapters.test.ts 等             # 只测试来源提取合同
tests/problem/render/                       # Typst、样式、真实编译
tests/application/、tests/integration/       # 统一真实链路与扩展流程
tests/ui/                                  # 三态、编辑、预览、下载
```

固定 Markdown 夹具应能只使用正文、最小 metadata 和必要 assets 调用转换，不需要安装浏览器、登录、网络请求或执行 Adapter。可以将真实来源提取结果人工审查后固化为夹具，但测试运行时不能重新提取来生成“期望”。

### 8.2 必须覆盖的测试矩阵

| ID  | 输入或场景                                       | 断言重点                                                              | 对应需求/不变量         |
| --- | ------------------------------------------------ | --------------------------------------------------------------------- | ----------------------- |
| T01 | 五个 OJ 的 HTML/JSON                             | Source 原文、语言、标题层级/关系、metadata、assets 完整；无 structure | 一、二.1、五.1；A01/A13 |
| T02 | Luogu 同版本 native/DOM、空译文字段              | 不混入另一语言，不裸拼丢字段边界，不静默遗漏样例                      | 二.1、五.1/2；A01/A07   |
| T03 | CF 原始 DOM 的 Examples 与 Input/Output          | Source 保留包装和上下级，不提前 CNOI 化                               | 二.1/3；A01/A05         |
| T04 | 用户给出的 CF 固定 Markdown                      | 正确区分格式/样例、移除包装、提升层级、完整保留正文                   | 二.3、五.3/9；A03/A05   |
| T05 | 同一 Input 标题在不同祖先下                      | 只有上下文成立才归类；离开包装即结束样例范围                          | 二.3、五.3；A04/A08     |
| T06 | zh/en/ja 与未知/混合语言                         | 原标题和正文语言保留，不默认生成中文、不翻译原题                      | 二.3、五.2；A07         |
| T07 | 样例编号 2/7、字母、罗马数字、无编号             | 原标识保留，无重排补号；无号不自动补成 1/2                            | 二.3、五.4；A07         |
| T08 | 输入 2/输出 3、只有输入/输出、多段说明           | 不错误配对、不补造数据、不吞下一组                                    | 二.3、五.4；A07/A08     |
| T09 | 包装中有段落、图片、表格、嵌套特殊章节           | 移除包装标题仍保留所有正文及合理相对位置                              | 二.3、五.4/5；A08/A13   |
| T10 | Constraints/制約、评分、交互/输出题、未知章节    | 不硬套普通题顺序、不无证据删除内容或分隔线                            | 二.3、五.4；A08         |
| T11 | 重复标题、内容相同的不同样例                     | 不按文本等值误删；去重仅适用于有来源证据的重复表示                    | 二.3/四；A08            |
| T12 | 冻结 Source 与语法 AST，转换多次                 | 输入完全不变；同一规则配置输出确定                                    | 三、五.6；A11           |
| T13 | 只改 fixture 的 Source 正文/层级                 | 输出相应改变，不能受旧 AST/metadata 语义旁表支配                      | 一、四、五.9；A01/A03   |
| T14 | 任意 OJ 对相同 Markdown 做语法解析               | AST 只由语法和 base URL 等语法上下文决定；裸 Input 仍是普通标题       | 二.2；A04               |
| T15 | 所有支持节点 parse/serialize 往返                | 图片尺寸、表格跨度、顺序、语言、TeX、代码内容等价，序列化稳定         | 二.2/4、五.5；A09/A13   |
| T16 | 精确代码：首尾空行、缩进、特殊字符、数学行       | 代码数据不被 trim/重新解释，围栏不会截断正文                          | 二.1/2/4、五.5；A13     |
| T17 | 图片行内/独立、尺寸/比例/zoom/max、缺图          | 全链路布局字段保留；缺图诊断及资源映射合理                            | 二.1/5、五.5；A13/A14   |
| T18 | 合并/无表头/对齐/复杂单元格表格                  | Source、codec、Transformer、Typst 中跨度与内容不丢                    | 二.1/2/4/5、五.5；A13   |
| T19 | 复制 Source                                      | 字符串严格相等，不调用 Transformer，不打开编辑器/编译                 | 三、五.6；A02/A11       |
| T20 | 同一成功导出任务及编辑后多次预览/导出            | 首次转换一次；后续只解析 editedMarkdown，无重转换和状态回写           | 三、五.6/8；A10/A11     |
| T21 | 同一 Source/资源直接导出与编辑未改导出           | 最终文本、AST、Typst source、虚拟资源及 PDF 内容/排版一致             | 三、五.7；A12/A14       |
| T22 | 编辑编号、标题级别、顺序、公式、代码、图片、表格 | SVG/PDF 全部反映编辑；删除内容不补回；source/cnoi 不变                | 三、五.6/8；A10/A11     |
| T23 | 编辑 front matter，清空限制、改 URL/语言、无效值 | 以当前文档为准；相对资源按当前 URL；无效时不导出旧缓存                | 三、五.8；A10/A12       |
| T24 | 未知扩展、超限、语法未完成                       | 复制可保留已提取 Source；转换/渲染明确诊断，无隐藏结构回退            | 二.1/2/5、四；A01/A15   |
| T25 | 任务取消、超时、重复连接、迟到结果、下载失败     | 已有任务/Worker/offscreen 释放和重试语义不退化                        | 四、六；A14/A16         |
| T26 | 固定最终 Markdown 的真实 Typst 编译              | 字体、样例框、表格、数学、页边距与分页策略保持                        | 二.5、五.5/7；A13/A14   |
| T27 | 架构审计与构建产物                               | 无并行 Source 正文、旧入口或反向依赖，打包无废弃流程                  | 四、六；A05/A15         |

### 8.3 更新旧测试的原则

- Adapter 测试断言 Source 文本、metadata、assets，不能要求 Adapter 已经产生 SampleBlock 或 CNOI 标题。
- Transformer 测试以固定 Markdown 为核心；保留五站端到端测试作为额外集成覆盖，不能用它代替规则单测。
- 删除将错误中文标题、样例自动重编号、原有包装层级长期不提升视为正确的旧断言；新期望必须能对应需求条目和人工审查的输入。
- 原来验证“不误识别普通 Input”“用户编辑不被重写”“多语言不混入”“代码/资源保真”的回归继续保留，并迁移到正确层。
- 禁止先执行实现自动生成全部 expected 再直接接受快照；必须核对标题上下文、样例原标识、特殊章节和资源字段。
- 不为每个委托函数写重复 spy 测试；重点验证内容结果、职责边界和有真实风险的状态/任务行为。

### 8.4 PDF 一致性与样式回归的判定

分开验证两个问题：

1. **新流程内部一致性：** 同一最终 Markdown、资源与编译配置下，直接导出和编辑未改导出得到相同的 AST、Typst source 和资源映射，并对比页数、文字及布局。若编译产物包含不稳定元数据，不强求 PDF 字节完全相同，但不能据此跳过内容/排版比较。
2. **样式保持：** 使用固定最终 Markdown 对比重构前后的字体、字号、行距、页边距、样例框、表格规则及分页。新 Transformer 有意修正标题/章节导致分页自然变化时，记录具体内容变化；不能把所有视觉差异都解释成正常。

复用真实 WASM 编译测试，生成有效 SVG/PDF，选择多页、长代码、图表、中文/日文/英文代表材料逐页检查。新增视觉工具或截图比较只在现有能力不足时使用，不为本次重建整套测试平台。

## 9. 工程验证命令与证据

以下命令来自当前 package.json；实际实施时先确认包管理器和本地依赖可用，沿用 lockfile，不为了运行测试自动升级依赖。

### 9.1 分层回归

P1/P2 运行新语法与规则测试目录；目录尚未创建前不能记录为已经执行。

```powershell
pnpm exec vitest run tests/problem/markdown tests/problem/cnoi
```

P3/P4 运行相关现有测试与更新后的集成/UI 测试，至少包含：

```powershell
pnpm exec vitest run tests/problem
pnpm exec vitest run tests/application/problem-export-service.test.ts tests/application/problem-export-client.test.ts tests/application/problem-export-transport.test.ts tests/application/direct-problem-download.test.ts tests/integration/direct-pdf-download.test.ts
pnpm exec vitest run tests/ui/problem-export.test.tsx tests/ui/problem-studio.test.tsx tests/ui/markdown-editor.test.tsx tests/ui/typst-preview.test.tsx tests/ui/offscreen-pdf-renderer.test.ts
```

这些文件如在重构中合理移动，执行记录必须填写真实新路径；不能只记录计划里的旧命令。旧 tests/problem/cnoi.test.ts 的有效用例迁移到新目录后删除原重复文件。

### 9.2 最终完整门禁

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

- 按变更增量运行相关检查，全部接线与清理完成后再执行一次完整门禁；后续只有新修改、失败或未解决风险才重复相应测试。
- 另检查本次修改的 Markdown 文档格式与本地链接；需求原文区域不自动格式化。
- `tests/integration/hydroj-live.test.ts` 当前是依赖 OJTRACE_HYDRO_* 环境配置的可选线上测试，主要验证同步功能，不能冒充本次题面提取的五站实测；没有配置时如实记录跳过。
- 记录命令、退出码、通过/失败/跳过数量、失败原因、构建路径和本次证据位置；不复用历史运行结果。
- 若已有环境问题或无关业务失败，说明是否在本次范围、复现步骤及对验收的影响；不能删测试、屏蔽失败或静默跳过来取得全绿。

## 10. 浏览器实测范围与不可执行项的记录方式

编写计划阶段没有访问 OJ 或执行浏览器验收。获授权实施后按以下范围检查可用环境；实际浏览器/PDF 证据及原生矩阵缺口记在本轮验收记录中。

### 10.1 可用浏览器中的生产页面验证

优先使用生产构建和真实 Parser/Transformer/Typst Worker；必要时使用最小本地测试宿主模拟扩展端口，避免为了 QA 改造产品流程。

每个代表材料执行：加载 CNOI → 预览 → 编辑标题/编号/正文/图表/公式 → 更新预览 → 导出并检查真实 PDF；同时核对 Source 复制与无修改两路导出。记录来源/fixture、语言、版本、具体修改、渲染结果和 PDF 证据。

内置浏览器本地宿主能验证实际页面、编辑器、Worker、WASM 和 SVG/PDF；不能证明 activeTab、原生 offscreen、Downloads API、登录态或关掉 popup 后继续下载正常。

### 10.2 Chrome / Edge 原生扩展矩阵

在可用的原生浏览器中加载 `.output/chrome-mv3`，参考[现有 PDF 浏览器检查清单](../qa/problem-pdf-browser-matrix.md)，至少覆盖：

| 维度     | 需执行的项目                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 五站来源 | Luogu 中文及一个远程题库；CF 普通/比赛或 Gym；AtCoder en/ja；QOJ article/比赛；Hydro 官方/自部署或 domain 路由 |
| 功能     | 复制 Source、直接导出、编辑未改导出、修改后预览/PDF                                                            |
| 内容     | 输入/样例上下文、多组非连续编号、图片/合并表格/公式/长代码、多页题面                                           |
| 生命周期 | 无新增标签的直接下载、关闭 popup、取消/超时、重复点击、原网页导航变更、Worker/offscreen 清理                   |
| 错误     | 无题面、登录/WAF/未加载、缺图、解析错误；不得拿旧缓存当新成功结果                                              |

能执行的立即执行并记录；没有已加载扩展的 Chrome/Edge、线上 OJ 无法访问或登录条件缺失时，把项目明确标为“未验证/受阻”，保留复现条件。不能将模拟端口的测试、旧截图、历史报告或单站成功替代该矩阵，也不为通过实测而绕过网站访问限制。

## 11. 风险、处理策略与最终完成定义

### 11.1 已识别风险

| 风险                                     | 处理策略                                          | 不接受的处理                        |
| ---------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| 原 Source 已丢失字段边界或 Examples 层级 | 在 Adapter 的忠实表达中补齐，新增 Source 期望夹具 | 保留 structure 或猜测原结构         |
| Markdown 扩展重解析丢尺寸/跨度/换行      | 先通过 codec Gate，再接入生产；复用精确受控语法   | Serializer/Renderer 从旧 AST 补字段 |
| 章节别名同名、多语言和未知标题           | 基于祖先、范围、OJ 配置保守识别；歧义内容保留     | 标题正则全局替换、默认中文化        |
| 规则配置变成过度设计                     | 使用固定数据与少量必要特例；不做 UI/脚本引擎      | 为未来用户设置构建庞大抽象          |
| 旧报告误导后续继续开发                   | 需求快照、优先级、阶段记录与新报告分开            | 复制历史“已完成”替代本次证据        |
| 原始工作区改动复杂                       | 逐文件检查原 diff，只处理相关问题                 | reset/clean/覆盖用户改动            |
| 样式变化掩盖内容错误或相反               | 内容与布局分层比较；固定最终文本做视觉回归        | 为过测试修改字体/字号/页边距        |
| 原生浏览器/线上页面条件不足              | 离线固定夹具加可用宿主验证，明确剩余原生项        | 声称全站浏览器验收完成              |

### 11.2 需求对照清单

只有下列项目具备代码和证据后，才能宣布本次重构完成；原生环境不可用的剩余验证须单独声明，不能勾成通过。

- [x] 五个 Adapter 仅输出 Source Markdown、Metadata、Assets、诊断，Source 中无并行语义内容。
- [x] Source 保留原语言、标题层级、章节关系、样例、图表、公式、代码；必要扩展公开、可解析、无隐藏 AST。
- [x] Source Markdown 实际被 Parser 解析；固定文本独立决定转换结果。
- [x] Parser 仅处理语法；Transformer 集中负责章节、包装、样例、层级与必要同语言标题调整。
- [x] 通用规则和五个 OJ 独立配置均存在，能用固定 `.md` 单测，无网页依赖。
- [x] 顶层格式 Input/Output 与 Examples 内样例 Input/Output 正确区分；非连续编号及无号样例不重编号。
- [x] Serializer 只编码，所有支持内容往返保真、输出稳定。
- [x] 三种文本状态互不回写；编辑后不再次 CNOI 转换，预览/PDF 以用户当前内容为准。
- [x] 直接导出与编辑未改导出共用相同最终解析/Typst 链路，内容、资源和排版一致。
- [x] Renderer 无章节识别、翻译、重编号、重排；字体和现有视觉参数保留。
- [x] 旧结构、重复转换入口、错误断言、兼容壳及已失去用途的辅助函数已清理。
- [x] 原网页提取、图片资源、Typst/WASM、Worker/offscreen、下载/取消设施未无意义重写或退化。
- [x] 相关单元、集成、UI、真实编译、完整回归、静态检查与构建结果已记录。
- [x] 可执行浏览器项目已验证；未验证项和实际限制清楚列出。
- [x] 维护文档反映真实调用关系，旧文档有明确历史/取代标记。

### 11.3 最终交付报告必须回答的问题

1. 给出代码实际执行的 Source → Parser → AST Transformer → Serializer → CNOI → 最终 Parser → PDF 路径，而非只展示设计图。
2. 列出主要新增、修改和删除模块，以及旧 structure/sampleRole/重复入口的清理结论。
3. 逐站说明 Source 提取来源、语言选择、独立规则、覆盖夹具和已知边界。
4. 报告实际测试与构建结果、真实 Typst/PDF 和浏览器证据；单列跳过和未执行项。
5. 如实列出未解决问题或限制，区分实现缺口、网站差异和环境无法验证。

## 12. 执行记录与需求变更记录

### 12.1 当前状态

| 项目                           | 状态   | 证据/说明                                                             |
| ------------------------------ | ------ | --------------------------------------------------------------------- |
| 需求原文保存                   | 已完成 | 原标记区域 SHA-256 未变，验收记录载明校验值                           |
| 当前架构与调用关系检查         | 已完成 | 第 1 节保留实施前基线，维护文档反映最终代码                           |
| 本次详细执行计划               | 已完成 | 本文件，用户授权后逐项实施                                            |
| P0 运行基线                    | 已完成 | baseline-status、字体/模板/视觉参数、测试和真实渲染证据               |
| P1 通用语法与保真              | 已完成 | markdown 独立模块、codec/source-syntax 回归、真实 Typst 往返          |
| P2 独立 Transformer 与五站规则 | 已完成 | cnoi/transform、六个规则文件、五站独立 Source/expected Markdown       |
| P3 五站与生产链路切换          | 已完成 | Adapter 无 structure；service/消息/UI/Worker 使用新合同               |
| P4 编辑/导出与视觉一致性       | 已完成 | 两页 PDF 像素一致；编号 42 与新增正文的预览/下载 PDF                  |
| P5 清理及最终验收              | 已完成 | 927 通过/1 跳过，276 契约通过，静态检查/构建/审计通过，新 QA/维护文档 |
| Chrome/Edge 原生扩展矩阵       | 未验证 | 没有可用原生连接和已加载扩展；不能以本地端口宿主替代                  |

### 12.2 实际阶段记录

全部阶段于 2026-10-16 在原工作区实施。详细命令、数量、五站状态和本地证据索引见[验收报告](../qa/source-markdown-cnoi-refactor.md)；下列记录说明各阶段的真实结果，不以历史报告作为本次结果。

**P0 / A01–A16、T01–T27 基准。** 检查实际脏工作区及已有调用，保存 baseline-status、style-tokens、template、字体清单、typecheck/build 和测试 JSON。基线 891 通过/1 跳过，早期进程异常另行定位处理，没有回滚已有变更。固定富内容文档用原有真实 Typst 设施生成 PDF/SVG 参考。后续阶段以 Source 和原文需求为准，不保留 structure 作为迁移后合同。

**P1 / A04、A09、A13、T14–T18、T24。** 建立通用 markdown/ast、parse、serialize、HTML codec；直接 lexer → AST；去掉样例专用节点及网页 UI 清理；精确代码、合并表格、尺寸、题注、公式、容器、列表及内联边界有独立回归。最终渲染模型实际采用 extends ProblemMetadata 的扁平元信息 + 唯一 ast，属于第 3 节示意类型的实现收敛，没有增添第二正文。最终全套回归及 pipeline-compile 真编译验证该阶段。

**P2 / A03、A05–A09、T04–T13。** cnoi/convert 成为唯一全流程用例，transform 只接受通用 AST 和 metadata；临时标题树仅用于分析。common 与五站规则独立；固定 Markdown fixture 可完全绕过 Adapter 测试。CF 上下文、zh/en/ja、未知章节、无号/2/7/字母/罗马/冲突编号、包装说明和深冻结均通过。最终 `pnpm test` 覆盖独立规则/配置及纯 Serializer 不重复变换。

**P3 / A01–A03、A13–A15、T01–T03、T19。** 五站及 common 仅输出 sourceMarkdown/metadata/assets/warnings；保留 native 字段和 DOM 原层次，精简网页控件清理。删除 recognizeSamples、SourceBlock/SourceSectionRole/structure 以及重复 DOM 图片扫描。service 真正 parse Source 再转换；复制原字符串。Parser 不再经整页 HTML 提取器；消息、守卫、UI、Worker/offscreen 切为 RenderDocument。资源收敛后的题面与 service 专项回归 247 用例通过；最终全套 927 用例再验证。

**P4 / A10–A14、T20–T23、T25–T27。** 编辑器只初始化副本，后续直接 parse 当前全文；Renderer 按通用节点顺序排版。保留 IME、队列、防抖、资源约束及生命周期测试。最终生产浏览器宿主实际 Worker 预览/下载两份 PDF；直接参考与未改编辑版两页 90 dpi 像素差均为空；修改为编号 42 并追加中文后，预览及真实 PDF 完整反映。固定 SVG 与实施前 SHA-256 相同；字体与 style-tokens 未改。原生 activeTab/offscreen/Downloads 矩阵没有环境，仍单列未验证。

**P5 / A15–A16 及全部回归。** 删除旧文件和失效入口、旧语义测试，收紧 architecture audit；重写维护文档、标记历史计划/QA、更新本计划与浏览器矩阵。最终 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm audit:architecture`、`pnpm test`（927 通过/1 可选 live 跳过）、`pnpm test:contract`（276 通过）、`pnpm build`、`pnpm audit:manifest` 均退出 0。CodeMirror 的 jsdom Range 几何缺失通过测试环境 API 补齐解决，没有屏蔽异常。文档单独检查格式、链接和原文校验。

待环境补充的验证不视为通过：

- [ ] 在加载最终扩展的 Chrome/Edge 中执行第 10.2 节五站线上、权限、关闭 popup、原生下载/取消/超时矩阵。

没有新增未解决的已知实现缺陷。支持边界包括有限受控 HTML、保守章节识别和沿用的图片尺寸策略，详见验收报告；不以支持任意网页 HTML/CSS 或自动翻译/编号作为本次能力。

### 12.3 需求变更记录

2026-10-16 用户追加：“按照计划执行直到完成，不要怕删没用的代码，旧的不去新的不来”。据此开始实施 P0–P5；不再受前一阶段仅编写计划的范围限制，六部分架构要求不变。

后续仅将用户明确提出的变化追加到此处，记录原指令、修改点及受影响验收项；实现困难、旧测试预期或历史文档不能自行构成需求变更。

2026-10-18 后续修正：用户指出复制 Source 含大量内部 HTML。按原要求的可读 Markdown 优先原则，已删除字段容器及其 Transformer 展开规则，原生 Source 不再重写；并修复此前报告未覆盖的完整复制合同。此处是实现纠偏，不修改原始需求快照，见[验收记录](../qa/readable-source-markdown-fix.md)。

2026-10-18 同日追加：用户提供 P5665 的期望与实际全文，指出实际 Source 漏主标题、合并样例组并额外加粗。以用户提供的期望保存完整固定夹具，原生 Source 保留原站导出的标题、每组编号及子标题，不采用网页 UI 的公共容器/粗体；已有非连续编号保留。Adapter 和采集到复制服务逐字对照完整原文，Transformer 独立读取同一 Markdown。旧“只保留一个无号样例组”的断言已移除。本次全套 967 通过、1 个可选线上用例跳过，静态门禁、构建通过。原始架构和需求快照不变。

2026-10-18 AtCoder 纠偏：用户指出 ABC391 G 的 Copy 控件进入 Source，公式格式展开为冗长 HTML，并要求核对其他保真问题。按官方页面及脚本补齐完整双语 HTML/英文 Markdown 夹具，在 Adapter 清理已确认的两处 Copy 控件和剪贴板镜像；通用 Parser/Serializer 增加显式 `text+math` 围栏，保留预格式行与 LaTeX。真实编译同时修复单行公式数组实参错误，保留原视觉参数。完整正文/编号/评分/约束/分隔线/解释核对、实际采集到复制服务、官方 KaTeX 和英文/日文真实 PDF 验证完成；全套 982 通过、1 个可选线上用例跳过，详见 [AtCoder 修复记录](../qa/atcoder-source-markdown-fix.md)。不修改原始需求快照，不增加另一份正文或第二个语义转换入口。

2026-10-18 Hydro 纠偏：用户提供“生成树很爽（tree）”的完整复制文本及截图，要求排查大块列表/表格私有 HTML 和 Copy 混入。已修复通用列表序列化、KaTeX 原子边界、HTML 合并表格逻辑网格和 Hydro 生成工具栏清理，删除列表中猜测合并 p/div 的旧分支。完整 Source、实际采集到复制/直接导出/编辑交付、真实 PDF 与两页检查通过；全套 997 通过、1 个可选线上用例跳过。固定夹具明确为依据用户文本重建，站点匿名访问需登录且未连接原生浏览器，未声称登录态线上点击通过。见 [Hydro 验收记录](../qa/hydroj-source-markdown-fix.md)。原始需求快照和唯一 Source 数据流不变。

2026-10-18 QOJ 边界审计：用户以 1907「博弈」质疑 Source 标题降级，要求检查越权并修复源提取。公开页面内容及维护者指南支持原页 H3/H4；未发现 h2 被采集器降到 h3 的证据，保留原级别并增加 H1–H6 回归，不按误判全站提升标题。实际修复 QOJ 顶层 TeX 脚本被重复清理、Transformer 漏配「样例数据」、Renderer 将 H4–H6 压为 H3 及合并列表段落的问题，删除冗余清理和列表拼接入口；UI 依赖门禁禁止运行时导入 CNOI。完整固定 Source/CNOI、服务、真实两页 PDF 与编辑层级/段落验证完成，全套 1012 通过、1 个可选线上用例跳过，详见 [QOJ 验收记录](../qa/qoj-source-markdown-boundaries.md)。未获得登录态原生浏览器或作者原始 Markdown，不把重建夹具冒充线上采集。原始需求快照不变。
