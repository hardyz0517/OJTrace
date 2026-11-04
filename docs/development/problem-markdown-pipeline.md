# 题面 Source Markdown、CNOI 转换与 PDF 数据流

实现日期：2026-10-16。设计基准为[用户需求原文](../plan/source-markdown-cnoi-requirements.md)及[本轮执行计划](../plan/source-markdown-cnoi-refactor-plan.md)，验证结果见[本轮验收记录](../qa/source-markdown-cnoi-refactor.md)。旧计划及旧验收只用于历史追溯。

## 唯一正式数据流

```text
网页 DOM / allowlist JSON
  → 五站 Adapter.extractSource
  → SourceProblem { sourceMarkdown, metadata, assets, warnings }
      ├─ 复制：原样返回 sourceMarkdown
      └─ convertSourceToCnoi
          → parseMarkdown(sourceMarkdown)
          → transformToCnoi(MarkdownRoot, metadata, rules)
          → serializeMarkdown(转换后的 AST 节点)
          → serializeProblemMarkdown(metadata, body)
          → CnoiProblem { cnoiMarkdown, assets, warnings }
              ├─ 直接导出
              └─ ProblemStudio 初始化 editedMarkdown → 用户编辑
                       ↓ 两条导出共用
          parseProblemMarkdown(当前完整 Markdown, resources)
          → RenderDocument { Metadata 字段, ast, assets, warnings, displayLabels }
          → Worker → 同一 Typst 节点转换/模板/资源准备
          → SVG 预览 / PDF 下载
```

Source 不包含 structure、另一套内容 blocks、章节 role、样例语义或识别旁表。RenderDocument 通过 `extends ProblemMetadata` 保留扁平元信息，只含一个通用 AST，不再同时保存 Markdown 正文。Source 的临时提取树在 Adapter 内结束；正式转换始终重新解析实际 Source 文本。Source 不包含私有字段容器；原生 Markdown 进入 common 后不再被重写。复制不执行标签剥离，也没有另一份“复制专用正文”。

## 状态和任务边界

| 状态               | 所有者                   | 规则                                                       |
| ------------------ | ------------------------ | ---------------------------------------------------------- |
| sourceMarkdown     | Adapter，任务内保存      | 忠实来源；复制直接返回；转换、资源补齐、编辑均不回写       |
| cnoiMarkdown       | 唯一转换用例             | YAML front matter + CNOI 正文；用于直接导出及编辑初始化    |
| editedMarkdown     | ProblemStudio 的任务副本 | 新 token 初始化；用户修改后只解析/渲染，不再进行 CNOI 转换 |
| RenderDocument.ast | 最终文档解析入口         | 由当前正文生成；不按原始 AST、节点下标或旧语义补内容       |

`service.extractMarkdown` 不转换、不编译、不为复制采集图片字节。`prepareCnoiProblem` 保留原来的捕获、图片补齐、取消、超时和交付机制，只调用一次 `convertSourceToCnoi`。直接下载与编辑页最终都调用 `parseProblemMarkdown`；重编译和预览不调用初次转换。

Adapter 的 `captureHints(url)` 声明字段白名单及当前题号身份。洛谷初始 JSON 缺失或属于上一条 SPA 路由时，采集函数可读取同 URL 的原生 content-only JSON；同源、拒绝重定向、5 秒中断并沿用快照字节预算。该来源仍由 Adapter 转为 Source，不绕过 Markdown。KaTeX 视觉 HTML 没有 TeX 时不能拼接字形冒充公式；明确报错并提示重新提取。详见[公式修复验收](../qa/luogu-math-source-fix.md)。

编辑后的 title、URL、限制、语言取自当前 front matter。清空或删除限制会清空对应值；不从旧任务数据恢复。相对图片按当前 URL 解析，资源按完整 URL 关联；删除图片会删除其渲染引用。缓存同时绑定当前完整文本和资源上下文，无效正文/元信息不能触发旧 PDF 下载。

## 模块职责

| 模块                                                              | 职责和禁止事项                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `adapters/{luogu,codeforces,atcoder,qoj,hydroj}.ts`               | 原站路由、所选语言版本、题面根、metadata、Source 内容；只清理有证据的网页控件               |
| `adapters/common.ts`                                              | 组合正式 Source；DOM 来源可临时解析为通用 AST，再用共用 Serializer 输出；不识别样例         |
| `markdown/directives.ts`                                          | 通用布局/提示/引用指令的语法解析；转义、HTML 字面量与代码不识别为指令，不接受 OJ 或章节语义 |
| `adapters/codeforces-markup.ts`                                   | 映射源页面已有视觉层级、字体和预格式化行；保留 Examples/子 Input 的层次，不输出样例角色     |
| `extract/figure-layout.ts`                                        | 仅提取源页面的既有图/题注布局证据；通用 Markdown Parser 不运行该启发式                      |
| `extract/resource-url.ts`                                         | 解析来源资源 URL；资源发现统一使用当前 AST，避免重复扫描 DOM 或带回已删除图片               |
| `markdown/ast.ts`                                                 | 标题、段落、代码、数学、图像、表格、列表、引用、布局等通用语法；没有 SampleBlock/sampleRole |
| `markdown/parse.ts`                                               | 使用现有 marked lexer 直接构建 AST；数学、表格和布局扩展按显式语法解析，不接受 OJ 参数      |
| `markdown/html.ts` / `html-encode.ts`                             | 惰性 HTML 语法解码/编码，不执行脚本或按网页 UI class 删除编辑正文                           |
| `markdown/serialize.ts`                                           | 稳定编码 AST；不生成章节、整理样例、翻译或排序                                              |
| `markdown/table.ts`                                               | 通用管道表格、合并标记及短样式指令的语法编解码；不识别 OJ 或题面章节                        |
| `cnoi/convert.ts`                                                 | 唯一完整 Source → 解析 → 转换 → 序列化用例；无网络、React、Chrome API、编译依赖             |
| `cnoi/transform.ts`                                               | 从解析树建立临时标题上下文，识别语义并变换 AST；临时分析不进入 Source 合同                  |
| `cnoi/rules/common.ts` + 五站配置                                 | 标题别名、上下文规则、顺序、层级和包装策略；必要来源特例保持局部、可单测                    |
| `problem-markdown.ts`                                             | 文档元信息信封及统一最终渲染准备；不是第二个语义 Transformer                                |
| `render/markdown-to-typst.ts`、`template.ts`、`typst-renderer.ts` | 顺序排版当前 AST、虚拟图片资源、Typst source；不识别章节或重编号                            |

`localization.ts` 只保留限制/页码等显示文案；章节和样例标题文案只在规则数据中。Worker、offscreen、字体包、WASM/CSP 和下载生命周期继续复用原设施。

## 规则如何工作

AtCoder 的来源清理仅针对原站脚本加入的 `btn-copy`、`div-btn-copy` 和 `source-code-for-copy`。不能把全局删除 Copy 文字、移除任意作者按钮或在 Markdown Parser/Renderer 中清理网页控件当作修复方式。

Transformer 先建立标题树，再根据所选 OJ 配置及父章节识别含义。Examples/Samples 下的裸 Input/Output 属于样例；顶层 Input/Output 属于格式。说明中的子标题、引用、未知特殊章节不能被一次全局正则重写。

常见章节在安全的连续区间内稳定重排，未知章节和重复格式章节作为锚点。修改主章节层级时同步调整未知同级/下级标题，避免把原本的同级章节误变成子章节。无号 Examples 包装可展开，但其引言、图片、表格和说明保留；带编号的 Example VII 等组标题保留原标识和子标题关系。

样例最终由普通标题、代码和段落组成。不存在另一套 sample 语义块，因此不同编号的输入/输出不会被合并或按位置重新编号。原编号、字母、罗马数字保留；无号样例不自动补号。取消包装确需补全语境时只按原文语言补全标题，例如 Input → Sample Input、入力 #7 → 入力例 #7。编辑阶段不会再次做这些调整。

规则由不可变的内置匹配目录和按 OJ 保存的用户覆盖组成，支持稳定规则 ID、上下文、顺序、层级、包装、标题及安全编号策略。规则管理页通过后台调用同一转换入口，任务开始时固定规则快照。详见 [CNOI 转换规则管理](cnoi-rule-management.md)；不运行用户正则、动态脚本或插件注册系统。

| OJ         | Adapter 的来源职责                                                                                                   | 独立转换规则                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Luogu      | 同版本 native JSON 优先、DOM 回退、整份语言版本选择；原生导出的题名、每组样例章节和精确代码；匹配的 DOM 仅补已有编号 | 按普通标题及上下文识别带编号的原生样例组并展开；保留编号与内容；没有私有字段展开或隐藏标识去重 |
| Codeforces | 页头/复制控件排除、Examples 与子标题关系、TeX 字体和代码行提取；不注入 sample-role                                   | 按祖先区分格式与样例，展开包装、调整层级；局部处理来源等宽引号特例                             |
| AtCoder    | 实际显示 en/ja 分支、标题和限制；评分和分隔线进入 Source                                                             | en/ja 别名和样例标题；主章节层级；保留实质评分、约束和分隔内容                                 |
| QOJ        | statement article 优先，普通/比赛路由；保留正文编号标题、作者 alert 和下载链接                                       | 独立 UOJ/QOJ 别名、Samples/Examples/Sample Cases 上下文和说明                                  |
| HydroOJ    | 明确题面 marker、官方/自部署/domain 路由；仅移除位于正文前缀的已确认系统通知                                         | 独立输入/输出说明、测试样例和提示别名；未知内容保留                                            |

Hydro 前缀通知的定位依据为[上游题面模板](https://github.com/hydro-dev/Hydro/blob/master/packages/ui-default/templates/partials/problem_description.html)，文案参考[上游语言数据](https://github.com/hydro-dev/Hydro/blob/master/packages/hydrooj/locales/zh.yaml)。作者 note/warn、未知通知和正文开始后的相似文字保留，不仅凭样式名删除。

## Source 中的受控语法

带行内 LaTeX 的预格式文本优先用 `text+math` 代码围栏，保留逐行空格、换行和公式源码；由通用 `markdown/math-code.ts` 编解码，不识别输入/输出或样例角色。其他 Markdown 符号在该围栏中是字面量，字面美元和反斜线可用 `\$` / `\\` 表达。普通代码围栏保持纯文本语义；带题注/额外语言/复杂行内内容的代码仍可使用必要的受控 HTML。外部 CommonMark 阅读器将扩展显示为代码，不能假定它们支持公式渲染。原站 `<var>`、实际 KaTeX、Copy 控件及完整双语题面验证见 [AtCoder 修复记录](../qa/atcoder-source-markdown-fix.md)。

普通 Markdown 优先；标准语法不足时使用有限的显式 HTML。这些属性属于正文可复制、可编辑的表达，不是隐藏 AST/JSON。

| 表达                                                                           | 用途                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `img` 的 width/height/title 和受支持 style                                     | 图片的显式尺寸、比例、zoom、max 尺寸、原说明及行内位置                                   |
| 管道表格、单元格 `^` / `<`、`::cute-table{tuack}`                              | 普通表格、向上/向左合并、公式与列对齐；可编辑 Markdown 优先，标准 GFM 外使用明确合并语法 |
| `table[data-ojtrace-table]`                                                    | 无表头、不等长等现有管道语法不能无损往返的网格，不再仅因合并或样式而输出 HTML            |
| `text+math` 代码围栏                                                           | 预格式文本内的行内 LaTeX；保留空格、换行，普通代码围栏仍为字面量                         |
| `pre[data-ojtrace-code="exact"]`                                               | 含题注或无法用显式公式围栏完整表达的代码；普通代码优先使用 Markdown 围栏                 |
| `div[data-ojtrace-align]` / `div[data-ojtrace-figure]`、原生 figure/figcaption | 对齐、图及显式题注                                                                       |
| `p[data-ojtrace-caption]` / `ol,ul[data-ojtrace-list]`                         | 图注及无法用普通缩进无损表达的特殊列表；普通嵌套、多段落列表不因此退回 HTML              |
| `span[data-ojtrace-text]`                                                      | 防止字面量美元/反斜线再次被当成数学语法                                                  |

禁止在 Source 填入私有字段/样例数组容器、`role=input`、识别旁表、完整备用 AST 或恢复旧 sample 容器。已有 h1–h6 原级别保留；非 heading 的视觉标签可以忠实映射为 Source 原有章节关系，CNOI 的统一层级仅由 Transformer 决定。

QOJ 1907 等原页正文使用 h3/h4，因此 Source 保留三级/四级、CNOI 转为二级是正常的阶段差异，不能在 Adapter 给全站标题统一提升。QOJ 的「样例数据」包装只由本站 Transformer 规则识别。公式 script 与可执行 script 的区别统一由通用 HTML 解析器处理，Adapter/common 不再提前删除可能含 TeX 的 script。最终 Renderer 也保留全部六级标题和列表中的真实段落，不再压平层级或合并段落；UI 运行时不得导入 Transformer。完整审计与证据边界见 [QOJ 验收记录](../qa/qoj-source-markdown-boundaries.md)。

表格优先使用 Markdown；`^` 和 `<` 只有作为未转义的完整单元格时才表示合并，字面量可转义或写成行内代码。只有不能无损表达的网格才退回受控 HTML。P5665 的五行合并、公式、编辑及排版验证见[表格修复记录](../qa/markdown-table-fix.md)。

## 验证与后续扩展

普通嵌套列表和多段落列表用 CommonMark 缩进表达，不能仅因列表项含多个子块就整体退回 HTML。HTML 列表项统一提取正文块，不根据公式或 p/div 包装猜测合并段落；KaTeX 是原子数学节点，其内部 MathML 不构成外层段落边界。原生 HTML 表格先按 rowspan/colspan 展开逻辑网格，再使用既有 Markdown 合并标记；异常网格保守保留内容。Hydro 的工具栏只由 Adapter 根据生成容器清理。完整复现与限制见 [Hydro 修复记录](../qa/hydroj-source-markdown-fix.md)。

固定输入/期望位于 `tests/problem/fixtures/source-markdown/<oj>/`。规则测试只读 `.source.md`、最小 metadata 和 `.expected.md`，不抓网页、不运行 Adapter。新增页面差异先补网页来源夹具及 Source 断言；新增语义变换先补 Markdown 正反例，再修改本站或通用规则。

```powershell
pnpm exec vitest run tests/problem
pnpm exec vitest run tests/application/problem-export-service.test.ts tests/ui/problem-studio.test.tsx
pnpm audit:architecture
```

完整门禁及真实 PDF/浏览器证据见本轮验收记录。架构审计覆盖 markdown 新目录及禁止反向依赖；不能用测试辅助器把另一份正文重新带进生产。

支持范围是已声明的 Markdown/受控 HTML，不等于完整浏览器 HTML/CSS。图像保留现有 PDF 尺寸策略：显式 width/height/widthRatio 参与排版，zoom/max 字段保真存储，沿用既有视觉行为；不在本轮顺带调整全局样式。超限或无法完整解析时给出诊断，native Source 仍可复制；不能回退到被删除的来源结构。

原生字段边界使用来源章节标题，样例使用正常子标题和围栏。Luogu 原生导出保留 `# 题号 题名` 和每组 `## 输入输出样例 #n`，不合并章节或把页面控件的粗体样式移植进来；原生数组索引按原站编号表达，匹配的既有编号优先。没有原生数据的 DOM 回退按实际页面层次提取，不伪称与原生导出逐字相同。来源正文和语法扩展直接保留，不通过 AST 重写整份 Source；完整复制合同及 P5665 证据见[Source 复制修复](../qa/readable-source-markdown-fix.md)。
