# Source Markdown → CNOI → PDF 重构验收

日期：2026-10-16（Asia/Shanghai）。依据[需求原文](../plan/source-markdown-cnoi-requirements.md)及[执行计划](../plan/source-markdown-cnoi-refactor-plan.md)。实现与可执行验收已完成；Chrome/Edge 原生扩展矩阵仍未验证，见本文限制。

后续修复：2026-10-18 用户报告洛谷公式退化为字形文本，已修复过期/缺失 native JSON 的补取及错误字形兜底，新增复杂公式回归。具体结果见[公式源码修复](./luogu-math-source-fix.md)；下文保留 10 月 16 日的验收范围及数量，不覆盖成后续结果。

同日继续修复了[原生 Markdown 表格被展开为 HTML](./markdown-table-fix.md)的问题，将合并表格语法统一到通用 Parser/Serializer，Source 与 CNOI 均保留可读表格。

随后用户报告 Source 复制仍泄漏内部字段 HTML，已删除该包装模型及相关展开逻辑，详见[可读 Source 修复](./readable-source-markdown-fix.md)。下文 source-field/source-item 的描述属于 10 月 16 日实现，已不适用当前代码；维护文档已更新。

## 实际数据流与职责

```text
网页 DOM / allowlist JSON
  → Adapter.extractSource
  → SourceProblem { sourceMarkdown, metadata, assets, warnings }
      ├─ extractMarkdown：原样复制 sourceMarkdown
      └─ convertSourceToCnoi
          → parseMarkdown(sourceMarkdown)
          → transformToCnoi(ast, metadata)
          → serializeMarkdown(ast.children)
          → serializeProblemMarkdown(metadata, body)
          → CnoiProblem { cnoiMarkdown, assets, warnings }
              ├─ 直接导出
              └─ 编辑器初始化 editedMarkdown → 用户编辑
                       ↓
          parseProblemMarkdown(当前 Markdown, assets/warnings)
          → RenderDocument { 扁平 metadata, ast, assets, warnings, displayLabels }
          → 原有 Typst / Worker / WASM → SVG 预览 / PDF
```

Source 没有 structure、语义 role 或备用 AST。Adapter 内部 DOM/AST 只用于忠实提取；Transformer 必须重新解析 Source 字符串。最终 RenderDocument 也只有一份 AST，不同时保留 Markdown/blocks 兜底。编辑后的解析入口不导入 Transformer；删除或修改标题、编号、正文及 front matter 后，不补回旧内容。

Parser 基于已有 marked lexer，直接构建通用 AST。受控 HTML 仅用于标准 Markdown 不足以表达的精确代码、合并表格、图像尺寸、对齐、题注、来源字段容器等语法。Parser 不接受 OJ 参数、不识别样例。Serializer 只编码；样例在 AST 中是普通标题与代码，没有专用 SampleBlock。

具体维护方式、语法和模块边界见[维护文档](../development/problem-markdown-pipeline.md)。

## 主要增改删

| 范围                                              | 实际结果                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/problem/domain.ts`                           | 独立 readonly ProblemMetadata；SourceProblem/CnoiProblem/RenderDocument 内容合同清晰；移除 ProblemDocument、SourceBlock、SourceSectionRole、structure |
| `src/problem/markdown/`                           | 单一 ast、parse、serialize、html、html-encode、text；编辑与提取共享语法编解码，网页清理不进入 Parser                                                  |
| `src/problem/cnoi/`                               | 唯一 convert 用例、纯 AST transform、common 及五个 OJ 独立规则模块；规则可序列化并可单测覆盖配置                                                      |
| `adapters/common.ts` 与五站                       | 只生成 Source；来源可视层次和原生字段边界保存在正文中；移除预先样例语义识别                                                                           |
| `extract/figure-layout.ts`                        | 将源网页的图注布局推断留在提取边界，不对用户编辑执行推断                                                                                              |
| `extract/resource-url.ts`                         | 保留来源 URL 解析；删除重复 DOM 图片扫描，统一从当前语法树发现资源                                                                                    |
| `problem-markdown.ts` 与 service/studio           | front matter 语法和最终解析统一；三种文本不回写，直接与编辑导出共用渲染链路                                                                           |
| `render/markdown-to-typst.ts`、template、消息接口 | 渲染通用 AST；移除样例专用分支；保留字体、视觉参数、WASM、Worker/offscreen 和取消/下载设施                                                            |
| architecture audit                                | 约束新 Markdown 目录及反向依赖，禁止 Adapter/codec 向 Transformer 泄漏职责、Transformer 依赖 Adapter/Renderer/浏览器                                  |

已删除或被迁移替代：旧 `statement.ts`、`statement-text.ts`、`extract/html-to-statement.ts`、`extract/markdown-serializer.ts`、`extract/markdown-to-html.ts`、`extract/statement-html.ts`、`extract/image-assets.ts`、`adapters/recognize-samples.ts`、`render/statement-to-typst.ts`，以及 normalizeStructure、sampleRole 和并行结构转换入口。没有保留旧数据模型兼容壳。

旧 `tests/problem/cnoi.test.ts` 和样例提取语义测试已迁移/替换；保留有价值的提取、资源、编译及生命周期断言，删除自动中文化、自动连续编号和隐式结构兜底的错误期望。测试辅助器只能从一份 Source 文本重新解析，不能向生产补充结构。

## 五站状态

| OJ         | Source 提取与内容保护                                                                                                                                     | Transformer 独立规则及覆盖                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Luogu      | native JSON 优先，DOM 回退；完整选择一个语言版本，空字段不借另一语言补齐；原始字段以 source-field/source-item 语法保留；精确样例、原标签、CRLF 与代码保护 | 原生字段解释、包装与局部来源重复处理；同数据的不同编号保留；样例 2/7 不重编号；独立 fields fixture                     |
| Codeforces | 原 section-title 和 Examples/子 Input 层次忠实映射；已有 heading 不升级；保留 TeX、字体和预格式行                                                         | 祖先上下文区分格式与样例；包装展开、层级调整、等宽引号来源特例；独立 fixture 使用用户给出的 Input/Output/Examples 结构 |
| AtCoder    | 选择实际 en/ja 分支；保留评分、分隔线、制約及原语言                                                                                                       | en/ja 别名、样例层次；不删除评分或翻译标题；独立日文 fixture 与格式化编号测试                                          |
| QOJ        | article/比赛路由；保留作者编号标题、alert、下载链接；只清理可证实的页面控件                                                                               | 独立 UOJ/QOJ 别名、Samples/Examples/Sample Cases 上下文；独立包装 fixture                                              |
| HydroOJ    | 官方/自部署/domain 路由；支持空值 boolean marker；仅删除正文前缀中已确认的系统通知，保留作者 note/warn、未知通知和正文后的相似文字                        | 独立输入/输出说明、测试样例、提示别名；独立中文 fixture 和来源边界测试                                                 |

通用规则保留未知章节、说明范围、编号冲突、缺失一侧样例、无号样例、字母/罗马编号及有内容的包装。只对明确识别且可安全移动的范围排序。配置包含 aliases、order、sectionLevel、unwrapSamples；没有添加设置 UI 或动态脚本引擎。

以上是固定网页/JSON 快照和 Markdown fixture 的实现验收，不等同于本轮完成五站在线原生扩展矩阵。

## 测试与工程门禁

最终生产修改完成后运行，以下命令均退出 0：

| 命令                      | 结果                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `pnpm typecheck`          | 通过                                                          |
| `pnpm lint`               | 通过，无警告                                                  |
| `pnpm format:check`       | 通过                                                          |
| `pnpm audit:architecture` | 通过，包含反向依赖反例测试                                    |
| `pnpm test`               | 87 个文件通过、1 个文件跳过；927 个用例通过、1 个跳过，无失败 |
| `pnpm test:contract`      | 23 个文件、276 个用例通过                                     |
| `pnpm build`              | 通过，生成 `.output/chrome-mv3`，约 76.70 MB                  |
| `pnpm audit:manifest`     | 通过                                                          |

跳过的是未配置 `OJTRACE_HYDRO_*` 的可选 Hydro live 同步测试，不是题面转换测试。实施基线记录了 891 通过、1 跳过；早期进程退出异常在完整回归中定位为 jsdom 缺少 CodeMirror 所需的 Range 几何 API，已在测试环境补齐，不修改生产编辑器、不屏蔽异常。最终全套测试进程退出 0。

| 计划测试范围                                    | 主要证据                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| T01–T03，五站来源及语言/层次                    | `adapters.test.ts`、`adapters-boundaries.test.ts`、`luogu-banks.test.ts`、五站 service fixture                                       |
| T04–T13，语义、上下文、编号、不变性、规则独立性 | `cnoi/transform.test.ts` + `fixtures/source-markdown/<oj>/*.source.md` / `*.expected.md`                                             |
| T14–T18，通用语法与富内容保真                   | `markdown/{codec,source-syntax}.test.ts`、`extract/{roundtrip,pipeline-fidelity}.test.ts`、`render/pipeline-compile.test.ts`         |
| T19–T23，复制/编辑/两路一致性/元信息            | `problem-markdown.test.ts`、`problem-export-service.test.ts`、`problem-studio.test.tsx`、`markdown-editor.test.tsx` 及真实浏览器/PDF |
| 诊断、资源、取消/超时、Worker/offscreen         | 原有 service/transport/direct-download/renderer/Worker/UI 集成回归及 architecture audit                                              |

精确代码首尾换行、围栏、HTML 内联 code 空格、美元数学边界、独立 inline-image 段落、容器嵌套/结束标签、表格跨度、列表起点/复选状态均有专项回归。Source 与输入 AST 深冻结测试以及只改 Source 字符串的测试已通过。

最终日志、JSON 测试报告和生成证据保存在仓库本地忽略目录 `.tmp/source-markdown-cnoi/`；文档单独执行 Prettier 检查及本地链接校验。需求快照标记区域的 SHA-256 仍为 `26fcfdf0c2b7c2c480e8b2204fa83f0c57775bac8a6f6957a7d7d026a3b6e1d1`，没有改写原文。

## 真实 Typst / PDF / 浏览器证据

固定富内容文档经实际打包字体、mitex、Typst WASM 编译，包含图片和行内小图、显式尺寸/比例、图注、合并格、精确多行代码、数学代码行、公式、多段说明、样例编号 7 和跨页内容。

- 固定最终文档的重构前后 SVG 完全相同，SHA-256 为 `CB1A68BC70F42C4343C155E6AF3F70298820984C5EDC479205BE25E0DCC46ABA`。
- `style-tokens.ts` 与实施前副本完全相同，SHA-256 为 `E92C1EB9AE6CC88A9D80813A428ECF7499DA57D603F860EA2466F4BCCCF2744A`；保留字体和既有排版参数。
- 最终构建在内置浏览器、本地宿主和 `self` / `wasm-unsafe-eval` CSP 下运行实际生产编辑页、Worker、WASM、字体及 SVG/PDF。仅扩展端口/getURL 是宿主替身。
- 初始预览为两页，实际点击导出得到 44,555 字节 PDF。与直接渲染参考 PDF 以 Poppler 90 dpi 渲染后，两页像素差均为空；不是仅比较 Markdown 或 PDF 文件头。
- 通过实际编辑器将 Sample Input/Output 7 改为 42，并追加 `## 编辑验证` 和 `用户添加的内容。`。预览立即反映；再次下载得到 46,563 字节、两页 A4 PDF（595.28 × 841.89 pt），文本提取确认新内容存在、旧编号不再存在。
- 逐页查看 PDF 栅格结果，图片/合并格/代码框/公式/样例/新增正文和页码正确；第二页留白与既有分页基准一致。最终浏览器错误日志为空。

本地证据：

- `render/pipeline-fidelity.{pdf,svg}`、`baseline-render/pipeline-fidelity.{pdf,svg}`
- `browser-unedited.pdf`、`browser-edited.pdf` 及对应提取文本
- `render/browser-{unedited,edited}-page-{1,2}.png`
- `browser-pdf-verification.json`、`browser-edited.jpg`

这些文件位于上述忽略目录，不是需要随扩展发布的运行时资源。

## 尚未验证及支持边界

1. 当前连接的浏览器仅为内置浏览器，没有可用的已加载扩展的 Chrome/Edge。五站线上 activeTab、原生 offscreen、Downloads API、登录/WAF、关闭 popup 后继续导出及权限交互未实测；[原生矩阵](./problem-pdf-browser-matrix.md)仍待执行。自动化生命周期测试和模拟端口不替代这些项目。
2. Markdown/受控 HTML 是有意明确的语法合同，不支持任意网页 HTML/CSS。Source 可复制不意味着任意未知扩展都能无损 PDF 排版；不支持或超限时给诊断，不启用旧结构回退。
3. 图片 width/height/widthRatio 按既有策略参与 PDF 布局；zoom/max 信息保真存储，但本轮不改变原有渲染尺寸策略。缺失或不可取得的图片保留原有警告和降级行为。
4. 未知或歧义章节保守保留；没有实现翻译、自动补编号、任意题面推断或用户规则设置 UI。站点模板变化需新增脱敏来源夹具和对应独立规则测试。

现有未提交工作区已保留；本次没有执行 reset/clean、提交、推送或发布。
