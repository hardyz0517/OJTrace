# 原生 Markdown 表格被展开为 HTML 的修复

日期：2026-10-18（Asia/Shanghai）。用户指出 P5665 数据范围表在编辑器中变成大量 table/span HTML，要求保留可读 Markdown。

后续：[Source 复制修复](./readable-source-markdown-fix.md)进一步移除了整份 Source 的内部字段包装。P5665 夹具已补全三组样例和完整正文；本文件的数量、两页 PDF 和 `.tmp/table-markdown-fix/` 证据保留为当时阶段记录。

## 原因

原生来源本来是 `::cute-table[]{tuack}` 加普通管道表格，使用 `^` 表示向上合并。旧流程在 Adapter 方言解码时把标记转换为 AST spans/style；Serializer 一看到 spans 或 style，就整表输出受控 HTML。保住了 PDF 的合并单元格，却不必要地破坏了 Markdown 的可读性，也导致 Source 被重写。

## 实际修改

- 新增通用语法模块 `src/problem/markdown/table.ts`，供 Parser 和 Serializer 共用。裸单元格 `^` 向上合并，`<` 向左合并；矩形组合支持同时跨行和跨列。
- Parser 直接读取这些表格语法及紧邻表格的 `::cute-table{tuack}` / `::cute-table[]{tuack}`。它只生成语法 AST，没有识别题面章节、样例或执行 CNOI 规则。
- Serializer 优先输出管道表格、原始 LaTeX 和合并标记；tuack 样式只需短指令，不再强制生成整表 HTML。
- 移除 `luogu-dialect.ts` 中旧的表格合并和待处理表格样式逻辑；保留仍有用途的来源布局/提示容器处理。没有保留第二套表格解析实现。
- 原生 Source 的表格现在原样保留；CNOI 序列化只规范空白和分隔行。编辑后的文本仍只经过通用 Parser 和原有 Renderer，不需要再跑 Luogu Adapter 或 Transformer。
- 字面量合并符可用 `\^`、`\<` 或行内代码表示。转义内容、HTML 字面量和未使用的样式指令不会被误当成语法。非矩形标记组保留文字，不覆盖真实单元格；沿用单元格及跨度预算。

例如当前可编辑输出是：

```markdown
::cute-table{tuack}

|  测试点编号  |    $n \leq$     | $a_i \leq$ | $type =$ |
| :----------: | :-------------: | :--------: | :------: |
|  $1 \sim 3$  |      $10$       |    $10$    |   $0$    |
|  $4 \sim 6$  |      $50$       |   $10^3$   |    ^     |
|  $7 \sim 9$  |      $400$      |   $10^4$   |    ^     |
| $10 \sim 16$ |     $5000$      |   $10^5$   |    ^     |
| $17 \sim 22$ | $5 \times 10^5$ |   $10^6$   |    ^     |
| $23 \sim 25$ | $4 \times 10^7$ |   $10^9$   |   $1$    |
```

这是支持合并格的 Markdown 扩展；标准 GFM 本身没有 rowspan/colspan。无表头、不等长等无法在现有管道语法中无损往返的网格仍保留 HTML，不通过补造表头或丢失单元格来消除标签。

## 验证

新增 `tests/problem/markdown/table.test.ts` 的 13 个用例，覆盖普通/带公式/对齐表格、P5665 五行合并、行列组合合并、转义符、非法形状、样式指令、预算，以及固定 Source → CNOI → 当前编辑全文解析。Source 与 CNOI 互不回写，修改 `$10^3$` 后新值进入 AST，合并格保持。

独立文本为 `tests/problem/fixtures/source-markdown/luogu/p5665-table.{source,expected}.md`。现有 P5665 原生 JSON 夹具扩充数据范围表，用于实际采集函数、Adapter、最终 Parser、真实 Typst/WASM 的全链路验证。

| 检查                                                 | 结果                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 相关专项回归                                         | 8 文件、123 用例通过                                                               |
| 全套回归                                             | 88 文件通过、1 文件跳过；952 用例通过、1 可选 Hydro live 同步用例跳过              |
| typecheck / lint / format:check / architecture audit | 通过                                                                               |
| 生产构建 / manifest audit                            | 通过，`.output/chrome-mv3`                                                         |
| 原 HTML 表达与新 Markdown 表达                       | 解析结果和 Typst 内容一致                                                          |
| 实际 PDF                                             | 两页 A4、99,969 字节；逐页检查两条求和公式、表内公式、五行合并、对齐与表格边框正常 |

证据在本地忽略目录 `.tmp/table-markdown-fix/`：各检查日志、`tests.json`、`render/luogu-p5665-cnoi.json`、`render/luogu-p5665.{pdf,svg}`、`render/luogu-p5665-{1,2}.png`。未改 PDF Renderer 的视觉参数，没有把本轮固定来源/真实编译验证写成 Chrome/Edge 原生在线扩展验收。

需要重新加载扩展并重新提取题面。旧编辑页中的 HTML 不会因为构建更新而被擅自改写。
