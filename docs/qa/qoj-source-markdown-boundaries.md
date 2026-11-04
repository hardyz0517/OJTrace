# QOJ Source 标题保真与转换边界审计

日期：2026-10-18（Asia/Shanghai）。用户以 QOJ 1907「博弈」报告 Source 中三级、四级标题与编辑器二级标题不同，要求核对越权修改并修复提取问题。

## 标题核对结论

[该题公开页面](https://qoj.ac/problem/1907)的页面内容抽取展示为 `### 输入格式`、`### 样例数据`、`#### 样例 1 输入`；与用户复制出来的标题一致。[QOJ 维护者的出题指南](https://training.qoj.ac/blog/qingyu/blog/1423?lang=en)也建议正文最高使用三级标题。没有发现 Adapter 将 h2 改为 h3 的代码或重现证据，不能仅按视觉字号认定 HTML 层级，更不能据此给全部 QOJ 标题提升一级。

当前采集链路是 h1–h6 → 通用 AST 的相同 level → 相同数量的 Markdown `#`。新增 H1–H6 全级别回归，分别证明 h2 保持 `##`、h3 保持 `###`，其他级别同理。这里不声称恢复作者上传 Markdown 文件的原始字节；仅有 DOM 时，Source 是该题面结构的忠实 Markdown 表达。

编辑器的二级标题来自 Transformer 对 Source 的 CNOI 转换，这一差异符合架构。复制不调用 Transformer，编辑器不回写 Source，编辑后不再做章节识别。

## 实际发现及修复

1. **QOJ 包装规则遗漏。** `cnoi/rules/qoj.ts` 未识别「样例数据」，现在在本站独立数据配置中补充别名。包装标题只在 Transformer 中移除，样例输入/输出提升到 CNOI 二级；保留原文字和编号。仅含「见下发文件。」的「样例 2」章节保留，子任务及正文不丢失、不翻译。
2. **Source 中 TeX 被提前删除。** `adapters/qoj.ts` 删除直属 script，导致顶层 MathJax TeX 源丢失；`adapters/common.ts` 又重复删除 script，且白名单漏掉通用提取器已支持的 application/x-tex。删除这两处重复清理，统一由 `markdown/html.ts` 识别公式源、忽略视觉副本及可执行脚本/样式。未放宽脚本执行能力：HTML 转换始终是惰性语法处理。
3. **Renderer 越权压平标题。** `render/markdown-to-typst.ts` 将四至六级标题限制到三级。现保持 Markdown 的 1–6 级；不根据 OJ、章节名称或上下文重新解释最终标题。
4. **Renderer 越权合并列表段落。** 删除 `listItemBody` 中把多个 paragraph 拼成一句话的实现，统一递归渲染通用子块。更正旧测试中将合并段落视为正确的断言。真实 PDF 检查进一步发现第二段首行未对齐正文起点，模板的列表/编号标记改为置于正文左侧，所有段落共用同一正文起点；字体、字号、行距、页边距、页眉页脚、代码框及分页参数均未修改。
5. **依赖门禁。** 架构审计禁止编辑器/UI 运行时导入 CNOI 模块，包括间接依赖；补充对应反例，测试项目同时包含 tsx，避免漏检实际编辑器扩展名。现有 Adapter、Parser/Serializer、Renderer 反向依赖限制继续有效。

没有增加 Adapter structure、另一份复制正文、复制前清洗、QOJ 全局标题升降级或第二个转换入口。五个 Adapter、共享编解码、转换入口、复制服务、编辑器及 Renderer 均已核对；未发现其他运行中的 CNOI 章节转换入口。

## 固定输入与数据流验证

- `docs/fixtures/problem/qoj-1907.html` 根据用户全文、截图和公开页面结构重建，明确标注不是浏览器捕获。
- `tests/problem/fixtures/qoj-1907.source.md` 保存人工确定的完整 Source，包含原 H3/H4、公式、样例数据、样例 2 提示及六条子任务。Adapter 输出逐字对照全文。
- `tests/problem/fixtures/qoj-1907.cnoi-body.md` 是独立完整 CNOI 期望。Transformer 测试仅输入固定 Source + metadata，不访问页面，不运行 Adapter；冻结输入 AST 后转换，原 AST 和 Source 均不变。
- 真实序列化采集函数到服务的回归验证：复制调用 Transformer 零次；直接导出与编辑器初始化各一次；三次采集得到相同 Source。直接/未修改编辑副本解析内容及 Typst 相同。
- 使用实际 bundled Typst WASM 编译这道题，直接/未修改编辑副本的 SVG 相同。将输入标题改到四级、样例标题改成五级 `Input #7`、新增六级标题和列表中的第二段后，只解析编辑稿，预览及 PDF 完整保留修改，Source 不变。
- 两版 PDF 均为两页，已用 Poppler 渲染并逐页检查。段一/段二正文起点经 pdfplumber 测得均为 x=107.01pt。原有样例代码跨页策略保持不变。

正式链路继续为：DOM / JSON → Adapter Source → Markdown Parser → CNOI Transformer → Markdown Serializer → CNOI。复制直接返回 Source；直接导出解析 CNOI，编辑器解析当前 editedMarkdown；两者共用同一 Renderer。

## 检查结果与限制

| 检查                                                     | 结果                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| 全量单元/集成测试                                        | 94 文件通过、1012 用例通过；1 个可选 Hydro 线上测试跳过 |
| typecheck / lint / format / architecture audit           | 通过                                                    |
| 生产构建 / manifest audit                                | 通过，`.output/chrome-mv3`                              |
| QOJ 完整 Source、固定 Source 转换、复制/双导出、真实 PDF | 通过上述离线回归和视觉核对                              |
| 原始用户需求                                             | 标记区域 SHA-256 不变                                   |

当前原生 Chrome/Edge 未连接；IAB 打开 QOJ 超时，直接 HTTP 获取遇到 Cloudflare 验证。本轮没有在用户登录浏览器中点击插件按钮，也没有获取作者原始 Markdown；不把公开页面内容抽取或重建夹具当成登录态线上实测。忽略目录 `.tmp/qoj-source-fix/` 保存实际提取的 Source、CNOI/编辑稿、PDF/SVG/PNG、测试及构建日志。
