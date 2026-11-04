# 复制 Source Markdown 泄漏内部 HTML 包装的修复

日期：2026-10-18（Asia/Shanghai）。用户报告“复制源 Markdown”得到 source-field/source-item、section/p/span 等大量内部标签。上一阶段只修复了表格，未清理这套 Source 字段包装；本记录替代旧维护文档中允许这些字段容器的约定，原始用户需求不变。

同日追加纠偏：用户提供 P5665 的原站完整复制文本，指出工具仍漏掉主标题、合并三个样例章节并给子标题添加粗体。上一阶段的“可读”验证不足以证明忠实来源。当前以该原文为固定完整夹具，原生路径必须逐字匹配，不再把网页 UI 的公共样例容器和粗体当成原生 Markdown。

## 根因

Luogu Adapter 用私有 HTML 容器表示 JSON 字段和样例数组，普通正文也因此带着内部字段标签。通用提取工具还会先解析这些内容，再用 Adapter 方言解码；一旦某处语法变化，就重新序列化整份 Source。容器的编码递归调用 blockHtml，导致原本正常的 Markdown 全部展开为 HTML。复制功能原样返回 Source，因而直接暴露这些标签。

## 最终实现

- Luogu 用普通 Markdown 标题表达原生字段的来源章节，用原始正文表达字段内容；顺序跟随来源页面的描述、格式、样例、提示。标题来自来源字段的显示标签，已有同级同名标题不重复添加，正文自己的标题不被升降级。
- Luogu 原生路径保留 `# 题号 题名`、每组独立的 `## 输入输出样例 #n` 和 `### 输入/输出 #n`，不合并成公共样例章节、不附加粗体。原生数组的编号按原站导出所用的一基序号表达；与选定语言和数据匹配的 DOM 已有编号优先保留，包括非连续的 2/7 和重复数据。DOM 的样式节点只用于读取编号，不移植到原生 Source。
- 样例数据用 Markdown 围栏原样保存。普通代码的首尾空行、缩进、text 语言及包含反引号的内容可用围栏保真往返，不再仅因此改用 pre HTML。
- 移除 Source 字段容器、通用 ContainerBlock、相关 Parser/HTML 编码/Renderer 分支及 Luogu 字段展开/隐藏标识去重规则，没有兼容分支或复制前正则剥标签。
- 来源布局语法从 Adapter 的 luogu-dialect 移到通用 `markdown/directives.ts`：align、figure、提示/引用容器是 Markdown 语法，由 Parser 处理，不判断章节角色。只识别实际 Markdown 指令，转义文本、HTML 字面量、代码里的相同文字不被执行；嵌套有深度预算。
- common 提取工具收到原生 Source 后不再解码/重写原文，解析仅用于资源发现和诊断。DOM 来源仍可临时使用 AST 做 HTML → Markdown。
- Transformer 只根据 Source 的正常标题及上下文转换。Luogu 保留独立别名配置，删掉依赖私有字段容器的大段预处理。没有通过平行 AST、metadata 旁表或另一份“复制版正文”弥补。
- Luogu Transformer 识别带编号的原生样例组，移除组包装并提升子标题；Source 本身不受影响。其他 OJ 的 `Example VII` 等已有编号组策略不变。DOM 回退忠实提取实际 DOM 层次，不声称在缺少原生数据时能逐字重建原站导出。

当前真实链路：

```text
native JSON / DOM → Adapter → 可读 Source Markdown
                         ├─ 原样复制
                         └─ 通用 Parser（含来源语法扩展）
                            → AST Transformer → Serializer → CNOI
                            → 直接导出 / 编辑副本 → Parser → 原有 Renderer
```

作者原文中确有必要的 HTML（如带显式尺寸的图片）仍原样保留。本次消除的是工具自行注入的字段包装和整段 HTML 展开，没有将合法作者内容一刀切删除。

## 验证

新增 `tests/problem/readable-source.test.ts` 的 13 个用例，验证完整复制文本、含原生布局指令的正文、原始标题、必要图片 HTML、英文/日文、首尾空行代码、转义/HTML/代码中的指令字面量及嵌套预算。转换后 Source 不变，样例数据不丢失。

服务测试执行实际采集函数的序列化版本后调用 `extractMarkdown`，明确断言正常章节和公式存在，且 P1001 的复制内容没有 section/span/pre/data-ojtrace。P5665 的完整复制回归同时放入页面原生 JSON 和公共样例容器/粗体 DOM，输出仍逐字等于用户给的 `tests/problem/fixtures/luogu-p5665.source.md`。Adapter 的 JSON 独立测试也对照同一完整原文；独立 Transformer 测试直接读取该 Markdown，不运行 Adapter。保留原有非连续样例编号、翻译隔离、源码丢失诊断、资源及生命周期回归。

P5665 JSON 夹具升级为完整公开来源的选定语言正文、限制和三组样例，不含用户会话字段。Source 逐字包含原生描述和表格，六段样例数据与原生数组一致；整份复制结果不含生成的 section/span/pre/table/data-ojtrace。实际 Parser/Transformer/Typst 编译覆盖三条独立公式、全部输入说明、三组样例、解释和数据范围表。

| 检查                                                 | 结果                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 本次题面及服务专项                                   | 161 用例通过，含完整原文、实际序列化采集/复制、独立转换及非连续编号                       |
| 最终全套                                             | 89 文件通过、1 跳过；967 用例通过、1 个可选 Hydro live 同步用例跳过                       |
| typecheck / lint / format:check / architecture audit | 通过                                                                                      |
| 生产构建 / manifest audit                            | 通过，`.output/chrome-mv3`                                                                |
| 完整 P5665 实际 PDF 编译                             | 全套中的真实 Typst 编译通过，覆盖公式、样例及合并表格；本次没有改 Renderer 和字体视觉参数 |

本次本地证据位于忽略目录 `.tmp/source-fidelity-fix/`：`tests.json`、实际 Adapter 输出 `luogu-p5665.source.md`、真实编译的 PDF/SVG 及 CNOI。上一阶段的 `.tmp/readable-source-fix/` 留作历史证据；其旧 Source 的样例结构不能用作当前正确结果。原生 Chrome/Edge 在线扩展验收仍没有环境；上述复制测试和真实编译没有冒充原生 UI 点击通过。

重新加载扩展后再次点击“复制源 Markdown”使用新实现。旧编辑页和已复制的旧文本不会被更新程序擅自改写。
