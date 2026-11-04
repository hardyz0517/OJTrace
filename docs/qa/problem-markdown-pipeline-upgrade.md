# Markdown 数据流升级验收记录

> 历史文档：本文件描述允许并行 `structure` 的上一轮实现，已被 [Source Markdown 重构计划](../plan/source-markdown-cnoi-refactor-plan.md)及[本轮验收记录](../qa/source-markdown-cnoi-refactor.md)取代。旧完成状态和测试数量不代表本轮架构；历史正文保留。

日期：2026-10-16。升级代码、清理和自动门禁已完成；Chrome/Edge 原生扩展矩阵未执行，因此不是发布批准。未提交、未发布；在工作区已有改动上渐进实施，未重置原有工作。

## 五阶段结果

| 阶段         | 实际改动与证据                                                                                                                                                                                                                                 | 状态                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1：基线      | 实施前 typecheck 通过；85 个测试文件通过、1 个可选文件跳过，851 个用例通过、1 个跳过；保留 Luogu 整份选版本与现有 PDF/Worker 生命周期                                                                                                          | 完成                         |
| 2：Gate F    | statement.ts 扩展多块说明；statement-html/markdown-serializer/html-to-statement 保留尺寸、合并格、原标签、数学代码和首尾换行。fidelity-fixture、pipeline-fidelity、pipeline-compile 验证语义 AST、Typst 及真实 SVG 一致                        | 通过                         |
| 3：Gate T    | domain/adapter/registry 交付独立 Source；原生字段与同版本结构绑定。recognize-samples、Luogu 方言、CF markup 均在 Adapter；cnoi 目录集中通用/站点调整。cnoi、Luogu banks、Adapters 夹具验证不可变性、语言、去重和反例                           | 通过                         |
| 4：Gate U    | service.prepareCnoiProblem 的类型化消费替代假 port；协议 2 交付 CnoiProblem；两条导出共用 Parser；Studio 不重置编辑副本，缓存绑定文本与资源。五站服务集成证明复制零转换、每导出任务一次转换、两路径 AST/Typst/资源一致；UI 与取消/超时回归通过 | 通过                         |
| 5：清理/验收 | 删除 format-problem-markdown 与旧单行 explanation；Renderer 不再生成标签、编号或中文内容。runtime 依赖门禁增加 problem 核心及正反例；维护文档已更新。生产浏览器 Worker 预览、编辑和下载通过                                                    | 自动部分完成；原生矩阵待实机 |

职责、扩展点和受控语法见[维护文档](../development/problem-markdown-pipeline.md)。原计划的重构前模块清单作为历史基线保留，不能当作当前调用关系。

## 最终工程门禁

| 命令                            | 结果                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| pnpm typecheck                  | 通过                                                                                                              |
| pnpm lint                       | 通过，无 lint 警告                                                                                                |
| pnpm test / default+json 双报告 | 891 个用例通过，1 个可选 live 用例跳过，0 个失败；两种运行进程均退出 0。JSON 为 tests-sample-hierarchy-final.json |
| pnpm test:contract              | 23 个文件、276 个用例通过                                                                                         |
| pnpm format:check               | 通过                                                                                                              |
| pnpm audit:architecture         | 通过；包含 problem 核心反向依赖与浏览器 API 的正反例                                                              |
| pnpm build                      | chrome-mv3 生产构建成功；依赖 Radix 的 use client 模块指令有打包提示，不影响生成产物                              |
| pnpm audit:manifest             | 通过；未增加权限                                                                                                  |

构建目录：`.output/chrome-mv3`。本记录与维护文档另经 Prettier Markdown 检查及本地链接检查。

## 内容与行为回归

- Source 与 CNOI：Luogu 选定 native Markdown 及 DOM 回退；四份远程题库材料；CF、AtCoder en/ja、QOJ、Hydro 代表夹具。原始文字、版本、图片链接及样例数据独立保留，复制不再添加来源/限制外包装。
- 结构：普通 Input + pre 不作为样例；Adapter 明确声明的 CF/QOJ 结构与明确的 Sample/样例/入力例可以识别；不同编号不配对；已有章节不重复添加；题名只在初次转换去重，编辑后 H1 保留。
- 语言：英文/日文样例文字保留；Luogu 英文、日文及未知语言不默认生成中文章节；空译文字段不借用原文。限制与页码标签由 Parser 提供，Renderer 直接展示。
- 保真：图片宽高、比例、zoom、最大尺寸；行内图片；合并格、无表头表格、对齐、文字/代码/公式中的竖线；首尾空行、反引号、题注和数学代码行；多段样例说明、嵌套列表、对齐与 figure；字面量美元/TeX 文本不重新扫描。未知 Luogu 指令保留，嵌套围栏不截断。
- 失败路径：有界 HTML/节点/深度/表格解析；不完整原生结构仍可复制且阻止导出；缺图提示与原图链接；非法/旧版本交付明确提示；元信息无效不下载缓存；取消、超时、迟到结果、并发 token、交付失败重试和资源释放。

## 实际 PDF 与浏览器验证

pipeline-compile.test.ts 使用实际 Typst WASM、随包字体和 mitex。原丰富 AST、codec 往返及 Source → Transformer → Parser 的 Typst source 与 SVG 完全相同，生成 2 页 A4 PDF。Poppler 逐页渲染检查过图片尺寸、合并表格、数学行、样例框、说明及页码。

最终生产构建通过本地 HTTP 测试宿主在 Codex 内置浏览器加载；CSP 只允许 self 与 wasm-unsafe-eval，使用实际 `problem-render.worker`、字体、WASM、编辑器与 SVG/PDF 编译。只有扩展 runtime/port/getURL 由本地宿主模拟；没有把该验证当作真实 Chrome/Edge 扩展安装验收。

实际操作：初始化 CNOI → 预览成功 → 将 Sample Input/Output 7 改为 42 → 追加“编辑验证 / 用户添加的内容。” → 新预览显示修改且无诊断 → 点击导出并取得真实 PDF。最终构建重新加载后复核同样操作；pypdf 确认 2 页、有两处编号 42 与新增正文、没有旧 Sample Input 7。已逐页查看 Poppler 图片，图片、合并表格与原布局正常。

本地 QA 证据目录：`E:/UserData/Codex/visualizations/2026/10/15/01a14033-ea8e-7a61-8c1c-b2be06f00d7c/ojtrace-qa`，含 tests-final.json、tests-legacy-cleanup-final.json、tests-test-cleanup-final.json、pipeline-fidelity.pdf/svg、pipeline-cnoi.json、browser-edited.pdf 与逐页 PNG；这些是测试产物，不进入业务存储或 Git。

## 尚未执行与保留限制

当前只发现内置浏览器/MCP Apps，没有已连接且加载 OJTrace 的 Chrome/Edge；原生安装、activeTab 授权、真实 offscreen/Downloads API、关闭 popup 后继续下载及各线上 OJ 当前页面矩阵仍按[浏览器清单](./problem-pdf-browser-matrix.md)待实机执行。本次没有以模拟端口的集成测试替代这些项目。

有限受控语法不代表支持任意 HTML/CSS；未知/混合语言保持保守，不能可靠识别的原生复杂结构明确阻止导出。对新页面差异应先补来源夹具，再在对应 Adapter 或站点规则调整。完整的字体/模板/编译设施保留，未做额外样式重调。

## 旧链路补查与清理（2026-10-16）

上一轮清理覆盖了主要旧流程；本次继续检查生产可达性、导出/类型引用、端口发送方、测试隔离和构建产物，确认还有以下残留并清除。

| 项目                                                 | 引用证据与处理                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain.StatementFragment                             | 全项目只有定义，没有调用/类型引用；删除旧片段模型                                                                                                  |
| export-state.consumeProblemExportJob / claimedTokens | 仅旧单元测试调用，生产已使用 prepareCnoiProblem 的 activeExports 与交付后删除；移除旧的提前消费 API 和第二套占用集合                               |
| PROBLEM_EXPORT_START / PROBLEM_EXPORT_CANCEL         | 生产没有发送方；删除协议类型、接收守卫和后台分支。连接只接受 CONNECT，取消仍由端口断开和直接导出的 AbortSignal/内部 cancel 执行                    |
| registry.inspectProblemPage / extractProblemPage     | 只给测试转发到同一个 registry，旧名称掩盖实际 Source 契约；删除包装，测试改为实际的 registry.inspect / extractSource；测试视图不再借用旧函数别名   |
| src/problem/snapshot.ts                              | 从六个 WXT 入口、模块依赖与 Worker new URL 引用追踪，唯一未被生产使用的题面模块；移动构造夹具到 tests/problem/snapshot-fixtures.ts，移除旧生产文件 |
| 无使用的契约/API 残留                                | 删除旧请求 probe 字段、未产生的 statement_not_found/job_expired 错误码及 service 的 budget 重导出；内部 helper 不再多余导出                        |
| UI/测试包装                                          | Studio 直接从 pdf-file 引用文件校验/命名，download-pdf 只负责下载；删除未使用的 renderHtml/旧 Renderer mock 和过时阶段注释                         |

本次保留了仍有真实调用的 render-problem-pdf → TypstProblemRenderer、Worker、图片资源、Luogu 方言解码、任务恢复的 session/local/fallback 路径，以及仅用于明确报错的版本不匹配处理。它们属于当前统一链路或已验证的恢复语义，不能按“名字像旧代码”删除。AST 类型在同模块内构成联合类型，属于有效声明，也没有批量删除。

复核结论：题面生产模块未发现孤立文件；生产源码和构建 JS 未发现已退休的端口命令及旧转换入口。测试专用快照工具与 Source 检查视图仅留在 tests；架构审计新增禁止生产模块运行时依赖 tests 的反例。旧端口命令有拒绝测试；任务测试改为当前实际使用的“可重读重试 → 显式删除/过期清理”语义，保留服务层的并发/取消测试。

清理后重新执行：typecheck、lint、format:check、audit:architecture、完整测试（891 通过、1 个可选 live 跳过、0 失败）、contract（276 通过）、生产 build 和 audit:manifest，均通过。完整结果为 tests-legacy-cleanup-final.json；本地 .tmp 下的依赖/导出诊断脚本和构建日志只是本轮检查产物，不增加生产依赖或新的构建体系。

未提交、未发布。Chrome/Edge 原生矩阵仍为上述待执行状态；本轮清理没有将它改记为完成。

## 测试冗余补查与清理（2026-10-16）

继续检查了本次题面升级涉及的 Adapter、Transformer、codec、Renderer、服务、传输、直接下载和编辑器测试，并检查整个 tests 目录的辅助模块引用。按实际覆盖删除重复用例，没有按文件年龄删除回归测试。

| 清理项目                                                | 保留的验证与归属                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 删除 tests/problem/render/statement-coverage.test.ts    | 原测试的大型节点清单只断言输出非空、固定数组非空，无法验证每种节点的渲染正确性；其中有效的“字面量 $n$ 不重新识别成公式、显式数学节点仍渲染”断言归并至 renderer.test.ts 的文本转义测试。图片、表格、列表、对齐、题注、Luogu 指令和真实编译回归仍保留 |
| 删除 tests/problem/extract/editor-roundtrip.test.ts     | 三组 Luogu/AtCoder/QOJ 真实夹具的正文与元信息往返验证移至 pipeline-fidelity.test.ts；删除简单图片/公式用例，其行为已有丰富 AST 保真和通用 Parser 不推断样例的明确断言覆盖。旧标题“保留样例”与实际断言不生成 sample 的矛盾一并移除                   |
| 移除 renderer.test.ts 中重复的 compiler injectable 用例 | PDF 字节返回值、SVG 返回值、题名传入编译器和 PDF/预览 Typst source 相同统一在同一用例验证；图片字节映射等独立验证仍保留                                                                                                                             |
| 简化 extractRenderedDocument 测试辅助函数               | 去掉永远 ok:true 的结果外壳，直接返回经实际 Source → Transformer → Parser 得到的文档；失败仍抛错，不再留下无意义的成功分支                                                                                                                          |
| 删除两份 FONT_FILES 手写清单                            | typst-compile.test.ts 与 sample-line-pitch.test.ts 读取生产 bundledFontPaths；保留字体嵌入检查、数学字体选择检查和真实 SVG 行距测量。修正旧“自动编号样例”用例标题，与 Renderer 当前职责一致                                                         |

本轮净减少 3 个重复用例，891 → 888 个通过；三组真实来源回归只是归并位置，未删除。此前移除的 format-problem-markdown.test.ts 和旧任务提前消费测试仍不再依赖退役 API；对旧协议的拒绝测试属于当前输入校验回归，保留。同步、存储兼容和可选 Hydro 实机测试仍有实际职责，未随题面链路清理删除。

以当前 86 个 .test.ts/.test.tsx 文件为根追踪 TypeScript import/export 依赖，tests 内未发现无引用的辅助模块；noUnusedLocals/noUnusedParameters 检查通过。生产源码无本轮变更，没有修改现有字体、PDF 模板或编译基础设施。

清理后再次通过 typecheck、lint、format:check、audit:architecture、完整测试（888 通过 / 1 可选 live 跳过 / 0 失败）、contract（276 通过）、生产构建和 manifest 审计。未提交、未发布；原生浏览器矩阵状态不变。

## Luogu 样例层级修复（2026-10-16）

用户报告 CF1209F 的网页只有一个“输入输出样例”总标题，而复制文本出现每组一个带编号的二级标题。核查发现需要区分两份证据：

- 洛谷当前页面实际加载的 [ProblemContentBlock 脚本](https://fecdn.luogu.com.cn/columba/columba~f10fa4122524ce4b.js) 中，自带复制模板对 problem.samples 每项生成“二级样例标题 + 编号”，再写三级输入、输出标题。它与网页单一 h2、io-sample/io-sample-block 的结构不同，确实能生成截图格式。
- 本次工作区与重建产物的插件复制入口直接返回 Source，没有上述带编号父标题的生成逻辑，无法仅凭截图确认当次复制入口/已加载版本。但代码仍有实际缺陷：原生字段提取没有带上 DOM 中的样例总标题与标签；通用 CNOI 规则又把已有样例标题强制设为二级。上次仅验证“复制等于 Source”和正文/样例数据保真，漏掉了具体标题层级，不能据此声称复制结构已经完全忠实。

修复由对应职责的模块承担，未改 Renderer、字体或 PDF 编译设施：

1. adapters/luogu.ts：读取 DOM 中已有的“输入输出样例”标题和样例 UI 子标题，识别为父标题的下一级；原生三组样例按一整个 samples 来源块提取。只有编号和输入/输出数据均匹配时才关联 DOM 标签，代码字节继续使用选定版本的原生字段；无法匹配时不借用其他样例文字。DOM 回退也识别 io-sample-block 中的标题层级。
2. cnoi/rules/common.ts：保留已有 HeadingBlock 的级别；需补充的样例标签使用当前样例章节的下一级。不会把三级标题全部提升为二级。
3. cnoi/rules/luogu.ts：适配整组样例块，在同编号、同数据条件下逐个去重；仍保留原生换行，全部去重后不留下空样例总标题。

CF1209F 回归固定为一个二级“输入输出样例”标题，下面六个三级输入/输出标签和三组原始数据。新夹具 luogu-cf1209f-samples.html 使用实际公开 native 字段和样例数据，DOM 是按报告与已核实的官网组件结构缩减重建，未宣称为完整原样页面快照。回归覆盖 native 提取、DOM 回退、Transformer 后的标题级别/数据、Source 不变性，以及经过序列化采集脚本的后台复制与编辑交付；实际 CSP/WASM PDF 编译增加该题。另强化四站现有 CNOI 回归，检查原三级样例标签不被升级。

新增 3 个用例，完整测试 891 通过、1 个可选 live 跳过，默认报告进程退出 0；default+json 双报告再次退出 0，结果保存为本地 QA 目录 tests-sample-hierarchy-final.json。单独 JSON reporter 曾两次返回 1，但其 JSON 均记录 success:true/零失败，未得到对应失败用例；保留 .tmp/sample-hierarchy-json-run.log 与双报告日志，未隐藏异常或修改测试 runner。双报告中的 CodeMirror/jsdom getClientRects 日志是现有模拟环境限制，不是本次题面编译失败。

typecheck、lint、format:check、audit:architecture、contract（276 通过）、生产 build、audit:manifest 均通过；构建日志 .tmp/sample-hierarchy-build.log。最新产物仍在 .output/chrome-mv3，需重新加载扩展并重新发起复制/编辑任务；已打开编辑页的用户副本不会自动覆盖。未提交、未发布，真实 Chrome/Edge 扩展矩阵仍待实机执行。
