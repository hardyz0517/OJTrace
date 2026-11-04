# AtCoder Source Markdown 控件与公式格式修复

日期：2026-10-18（Asia/Shanghai）。用户报告 ABC391 G 的源复制包含 `Sample Input 1Copy`、独立 `Copy` 段落，以及冗长的公式 pre/span HTML，并要求检查其他来源保真问题。

## 来源与根因

- 对照 [ABC391 G - Many LCS](https://atcoder.jp/contests/abc391/tasks/abc391_g?lang=en) 的公开双语 HTML。完整来源夹具 `docs/fixtures/problem/atcoder-abc391-g.html` 仅保留题名、公开限制和双语题面，没有登录状态、CSRF 或账户字段。
- [原站 contest.js](https://img.atcoder.jp/public/779f2fa/js/contest.js) 对 `h3+pre` 添加标题内的 `span.btn-copy` 及代码块前的 `div.div-btn-copy`；另外对 prettyprint 代码生成 `pre.source-code-for-copy`。旧 Adapter 未删除这些控件和剪贴板镜像，因此通用 HTML 提取器把它们当作正文。
- 数学预格式文本已有完整 TeX 和行结构，但 Serializer 一律将 `CodeBlock.lines` 编码为 pre/code/span 的私有 HTML，导致 Source 难以阅读。普通 Markdown 围栏不能同时表达字面代码与其中可渲染的数学，需要显式语法扩展。
- 真实编译还发现旧 Renderer 的单行数学格式实参缺少 Typst 单元素数组所需的逗号，造成 `element sequence has no method len`。这是此前未覆盖的编译错误，不是来源内容错误。

## 修复与边界

AtCoder Adapter 在选定语言分支后，仅删除上述三个明确的原站 UI class。没有按文字全局删除 `Copy`，也没有把控件清理放进 Parser 或编辑后的渲染链。作者正文、普通按钮及样例代码中的 `Copy` 均保留。

新增通用 `markdown/math-code.ts`，为带行内公式的预格式文本定义 `text+math` 围栏：

````markdown
```text+math
$N$ $M$
$S$
```
````

- `$…$` 表示行内 LaTeX，原始公式命令、下标、空格及行关系保留；其他 Markdown 符号按字面内容处理。
- 字面美元和反斜线分别使用 `\$` 和 `\\`。普通无语言/普通语言围栏保持纯代码语义，里面的 `$N$` 不自动渲染成公式。
- Parser 只解析显式围栏语法，不接受 OJ 或章节语义。Serializer 只从通用 CodeBlock 编码，没有从 Input/Sample 标题推断公式。
- 原生 HTML `<var>` 与 KaTeX 的 TeX annotation 继续由已有提取器处理。原有纯文本 fallback 计算集中到此模块，没有两份独立实现；正式 Source 中保留的是 LaTeX，不用 fallback 符号代替它。
- 带题注/额外语言/复杂行内节点、跨行或包含美元的特殊公式仍使用必要的受控 HTML。手写未闭合公式按字面量保留；行数与节点沿用预算。
- `text+math` 是 OJTrace 的显式 Markdown 扩展，外部纯 CommonMark 阅读器会把它显示为代码；不宣称普通围栏支持数学渲染。

Renderer 仅修复单元素数组实参生成，字体、字号、行距、边距、代码框和分页规则均未改。Transformer 不需要新语义分支，依然只解析同一 Source 的章节结构；复制直接返回 Adapter 的 Source。

## 保真与验证

完整英文期望固定为 `tests/problem/fixtures/atcoder-abc391-g.en.source.md`，人工按原题正文和本次语法表达保存，不从 Adapter 自动生成期望。原始 `<var>` 和带 KaTeX annotation/双重视觉节点的页面，即使注入两处 Copy 控件，复制结果也逐字等于该夹具。

已核对评分、约束、原始 h3 标题、列表、四处分隔线、三组样例、所有答案和解释，语言不串入、编号不变化、公式不降级为符号。日文使用同一来源的实际分支，保留日文标题与内容。作者的 Copy 文本/按钮、普通代码美元字面量与 h4 子标题有独立反例。

服务回归运行实际采集函数的序列化版本再调用 `extractMarkdown`，覆盖英文/日文、Copy 控件和隐藏语言分支。独立语法回归覆盖空白、字面美元/反斜线/HTML/反引号、普通代码、未闭合公式、受控 HTML 回退和预算。Source 在转换后不变。

真实 Typst 编译覆盖上述整题的英文和日文，均为两页 A4；90 dpi Poppler 逐页检查输入两行、输出下标及省略号、三组样例、解释和页码，没有剪裁或标签泄漏。直接输出与未改编辑副本的 Typst/SVG 相同；修改公式及追加说明改变实际预览。

另外使用原站实际 KaTeX 0.12.0 对完整原生夹具生成真实数学 DOM，再运行当前 Adapter，英文仍逐字匹配完整期望，日文也通过。此离线复核与合成的单元回归分别保留证据，不将它们冒充原生浏览器验收。此次在应用内浏览器访问原题导航超时，Chrome/Edge 已加载扩展的点击验收仍未验证。

| 检查                                                 | 结果                                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| 全套单元/集成测试                                    | 91 文件通过，982 用例通过；1 个可选 Hydro live 用例跳过  |
| typecheck / lint / format:check / architecture audit | 全部通过                                                 |
| 生产构建 / manifest audit                            | 通过，`.output/chrome-mv3`                               |
| 完整 Source                                          | 原始 HTML、合成 KaTeX、官方 KaTeX 三种路径的英文全文一致 |
| 真实编译与逐页检查                                   | 英文/日文均通过，视觉样式沿用原模板                      |

本地忽略目录 `.tmp/atcoder-source-fix/` 保存实际 Source、原站公开脚本、官方 KaTeX 复核脚本、最终测试 JSON/日志、CNOI、两份 PDF/SVG 和四页 PNG。源复制的实现及长期回归位于上述生产模块和 tests，不依赖此临时目录。
