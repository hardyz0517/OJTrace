# OJTrace Source Markdown → CNOI 重构：用户需求原文快照

- 保存日期：2026-10-16（Asia/Shanghai）。
- 用途：保存本轮用户原始要求，供执行计划、实现与验收逐项对照。
- 保存时授权范围：先检查代码并编写计划。后续用户已于 2026-10-16 授权“按照计划执行直到完成，不要怕删没用的代码，旧的不去新的不来”；该后续指令仅改变开始实施的范围，不修改下方原始架构要求。
- 对应执行计划：[source-markdown-cnoi-refactor-plan.md](./source-markdown-cnoi-refactor-plan.md)。
- 下方原文区域不作设计改写。以后需求有变，另记用户明确提出的变更及影响，不覆盖这份原始快照。

<!-- USER_REQUIREMENTS_BEGIN -->
请按照我们最终确定的架构，直接重构 OJTrace 的题面提取与 CNOI 转换系统。这次以职责清晰、长期可维护为目标，不要为了兼容旧设计而保留不合理的数据流、重复实现或无用抽象。

## 一、目标架构
```objectivec
OJ 网页 DOM / JSON
        ↓
OJ Adapter
        ↓
Source Markdown + Metadata + Assets
        ├── 复制原始 Markdown
        ↓
Markdown Parser
        ↓
Markdown AST
        ↓
CNOI Transformer
（通用规则 + 对应 OJ 专属规则）
        ↓
Markdown Serializer
        ↓
CNOI Markdown
        ├── 直接导出 PDF
        └── 编辑器初始化 → Edited Markdown
                    ↓
            Markdown Parser
                    ↓
               PDF Renderer
                    ↓
               预览 / PDF
```

## 二、严格明确模块职责

**1. OJ Adapter：只负责源题面提取**

分别适配 Luogu、Codeforces、AtCoder、QOJ、HydroOJ。

- 从网页 DOM / 原生 JSON 提取题面，生成尽可能忠实、完整的 Source Markdown。
- 保留原始语言、标题层级、章节关系、样例、公式、图片、表格、代码块等信息。
- 提供 Metadata（OJ、题号、题名、时限、内存、URL 等）和 Assets。
- 必要时允许使用 Markdown 扩展或受控 HTML 保存无法由标准 Markdown 完整表达的内容。
- 允许 Adapter 内部临时使用 DOM / AST 完成 HTML → Markdown 提取。
- 不负责 CNOI 章节规范化、样例重排、标题升降级等操作。

**Source Markdown 是唯一正式的题面内容来源。不要再让 Adapter 输出另一套并行的语义 `structure` 供 Transformer 直接使用。**

**2. Markdown Parser：只负责语法解析**

- 将 Source Markdown 解析为通用 Markdown AST。
- 正确处理标题、段落、代码块、数学公式、表格、图片等。
- 不负责判断章节属于题目描述、输入格式还是样例。

**3. CNOI Transformer：负责全部题面语义识别和结构转换**

- 基于 Source Markdown 解析得到的 AST，结合 OJ 类型、上下文和转换规则识别章节语义。
- 负责章节重排、标题层级调整、包装章节移除、样例整理、必要的章节重命名等。
- 提供通用规则与五个 OJ 各自独立的规则模块。
- 转换规则尽量数据驱动，预留未来允许用户编辑规则配置的能力，不必现在实现设置 UI。
- 不擅自翻译原题，不随意删除内容，不破坏已有样例编号。

例如 Codeforces：
```shell
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

Transformer 应根据标题层级与父章节上下文，识别顶层 Input / Output 为输入输出格式，Examples 下的 Input / Output 为样例输入输出，再按照 CNOI 规则取消 Examples 包装章节、提升样例标题层级。

不要因为少数存在歧义的 Markdown 示例，就永久依赖 Adapter 提供的平行 AST。首先应确保 Source Markdown 忠实保留原始结构；对确实无法从 Markdown 表达的源信息，完善其表达方式。

**4. Markdown Serializer**

- 将 Transformer 调整后的 AST 序列化为 CNOI Markdown。
- 仅负责序列化，不重复做语义调整。
- 保证内容保真和稳定性。

**5. PDF Renderer**

- 负责解析最终 Markdown、Typst 转换及 NOI 风格视觉排版。
- 不再擅自修改章节语义、翻译标题、重新编号样例或重排内容。
- 保留当前已调好的字体、字号、行距、页边距、分页等 PDF 样式。

## 三、统一三个 Markdown 状态

- `sourceMarkdown`：Adapter 的源输出，复制功能使用，后续不得修改。
- `cnoiMarkdown`：Transformer 的转换结果，供直接导出与编辑器初始化。
- `editedMarkdown`：用户修改后的副本，直接解析并渲染，不再执行 CNOI 转换。

直接导出与编辑器无修改导出必须得到一致的题面内容和 PDF 排版。

## 四、彻底清理旧实现

请先检查当前 `ProblemDocument`、`structure`、`blocks`、`extractDocument`、`htmlToStatement`、`normalizeStructure`、`transformToCnoi`、Markdown 编解码及 PDF Renderer 相关代码。

- 逐步移除 Transformer 对 Adapter 生成的并行 `structure` 的依赖。
- 将当前散落在 Adapter、通用提取器、编辑序列化和 Renderer 中的 CNOI 规范化逻辑迁移到 Transformer。
- 删除被新架构取代的旧函数、冗余结构、无用兼容层和重复转换入口。
- 不保留两套长期并行的题面转换流程。
- 不做表面上的模块拆分，实际数据流必须真正以 Source Markdown 为基础。
- 必要时重构相关类型与接口，不必为了最小 diff 牺牲架构质量。
- 保留必要的图片资源处理、网页提取逻辑及现有 Typst/PDF 编译设施，不做无意义重写。

## 五、测试与验收

重点测试：

1. 五个 OJ 的 Source Markdown 提取正确性。
2. 中文、英文、日文题面的章节识别。
3. 输入格式与样例输入的上下文区分。
4. 多组样例、包装章节、非连续编号、特殊章节。
5. 图片尺寸、表格合并、公式、代码块等内容保真。
6. Source Markdown 不受 Transformer 或编辑器修改影响。
7. 直接导出与编辑器未修改导出一致。
8. 编辑后预览和 PDF 完整反映用户修改。
9. 转换规则能够单独使用固定 Source Markdown Fixture 测试，无需重新访问 OJ 网页。

重构时同步更新测试，移除将错误中文标题、样例重编号等旧行为视为正确结果的断言。测试不能仅以通过旧测试为目标。

## 六、执行要求

请先检查现有代码和调用关系，然后按合理依赖顺序逐步实施本次重构，**不必再停留在只输出计划的阶段**。

以最终架构为准，允许彻底修改旧模块，删除不合理实现，不要为了兼容错误的设计而制造更多抽象。

完成后运行相关单元测试、集成测试及构建；能进行浏览器实测的部分也应验证。

最后说明：

- 新架构的实际数据流；
- 主要修改、删除和新增的模块；
- 五个 OJ 的适配及 Transformer 规则现状；
- 测试结果；
- 尚未解决的问题或限制。

目标是得到真正独立、可测试、可扩展的 `Source Markdown → CNOI Transformer → CNOI Markdown → PDF Renderer` 架构，而不只是给现有代码换一层包装。





先别开工，先根据上面的需求写一个详细的执行计划plan写成md文件，具体规划一下如何执行上面的要求，然后注意保存上面的要求不要做到后面信息失真又乱来
<!-- USER_REQUIREMENTS_END -->
