# Hydro Source Markdown：嵌套列表、合并表格与工具栏修复

日期：2026-10-18（Asia/Shanghai）。用户提供“生成树很爽（tree）”完整复制文本及截图，报告嵌套列表和表格变成大量私有 HTML，且样例混入 Copy。

## 根因与改动

1. `markdown/serialize.ts` 只允许单段落列表输出 Markdown，任何嵌套列表、多段落或代码都会使整个列表退回 ul/li/p/span HTML。现改为 CommonMark 列表缩进，缩进宽度按真实编号标记计算，支持多位有序编号、复选框、段落、代码、引用和标题。独立相邻列表用不显示的分隔注释保持独立，避免重新解析时被合并。
2. `markdown/html.ts` 将 KaTeX 的内部 MathML 当作外层正文边界。列表项同时含公式与子列表时，一句话会被拆成多个段落。公式现在作为原子行内/行间语法节点处理，不递归用其内部视觉树判断正文边界。标准 HTML 块边界的折叠空白被规范到浏览器的文本语义；显式 `data-ojtrace-text` 字面量仍保留原始边缘空白。
3. 删除列表提取器中“没有结构子块就把全部 p/div 猜成一句话”的旧分支。所有列表项统一经通用块提取器，作者明确的多段落仍是多段落。旧测试把三个实际 p 合并为一句话的断言已更正。
4. 原生 HTML 的 rowspan/colspan 会省略被覆盖位置，旧提取器直接保存物理单元格数组，造成不等长行，已有 Markdown 合并表格序列化因此拒绝转换。现在先展开为统一逻辑网格，覆盖位置为 null；Source 输出普通管道表格和既有 `^` / `<` 合并语法。复杂表头的 colspan 同样展开，已有显式覆盖位置可往返。重叠等异常网格保留全部原单元格，不猜测或丢内容；展开后的格数也受预算约束。
5. [Hydro 官方高亮组件](https://github.com/hydro-dev/Hydro/blob/master/packages/ui-default/components/highlighter/highlighter.page.ts) 使用 Prism 工具栏，[Prism 集成](https://github.com/hydro-dev/Hydro/blob/master/packages/ui-default/components/highlighter/prismjs.js) 注册 Copy，并可增加 Fill to Pretest。Hydro Adapter 仅删除 `code-toolbar` 生成容器中、与 pre 相邻的 `toolbar`，不按 Copy 文字删除正文，也不删除作者在其他位置的 toolbar/按钮。

没有修改章节语义识别、样例编号、字体/边距/分页或渲染模板；未增加 Adapter structure、另一份复制正文或复制前清洗入口。正式流程仍是 DOM → Adapter Source → Parser → Transformer → Serializer → CNOI；复制直接返回 Source，编辑副本直接解析渲染。

## 完整复现与保真

`docs/fixtures/problem/hydroj-tree.html` 根据用户的完整题面、截图及官方组件重建，明确标注为复现夹具，不是登录态页面抓取。期望 `tests/problem/fixtures/hydroj-tree.source.md` 人工按题面保存，没有用当前 Adapter 自动生成期望。

全文复制结果逐字匹配该期望：

- 原 h3 题名及章节不升降级、不翻译；公式保留 LaTeX。
- 三个外层列表项及第二项的子列表保留，一句话不被 MathML 拆散；不再包含 ul/li/p/span 包装。
- 六行数据范围保留，两处分值的两行合并由 `^` 表达；不再包含 table/span 包装。
- 两组输入/输出代码、plain 语言和每行数字不变；Copy/预测试按钮不进入 Source。
- 附件文字及实际 href 保留，正常表达为 `[附加文件](http://47.113.203.55/p/100/file/tree.zip?type=additional_file)`，不下载或重写附件。

边界回归还验证作者 Copy 文本/按钮、字面美元样例、嵌套多段落、复选框、多位编号、独立相邻列表及引用中的列表。表格回归覆盖非首列同时合并行列、占位顺序、与 Markdown 重解析一致及展开预算。既有 Luogu/AtCoder 的完整 Source 对照继续通过。

服务测试运行实际序列化采集函数，完整 Source 逐字对照期望；复制不调用 Transformer，直接导出和编辑交付得到同一解析内容。转换后 Source 不变，编辑表格内容不回写 Source。

真实 Typst 编译及两页 Poppler 检查核对嵌套列表、数学、输入输出数据、两处合并及附件，未丢失内容。直接/未修改编辑副本的 Typst 与 SVG 相同，修改性质文本后实际预览变化。原有跨页代码样式保持不变。

## 验证结果与限制

| 检查                                                 | 结果                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| 完整单元/集成测试                                    | 93 文件通过，997 用例通过；1 个可选 Hydro live 用例跳过 |
| typecheck / lint / format:check / architecture audit | 通过                                                    |
| 生产构建 / manifest audit                            | 通过，`.output/chrome-mv3`                              |
| 完整 Source / 服务 / 真实编译 / 视觉检查             | 上述固定题面通过                                        |
| 原始需求快照                                         | 标记区域 SHA-256 不变                                   |

匿名访问 `http://47.113.203.55/p/100` 返回登录页，没有读取登录账号或绕过权限；当前浏览器工具也没有连接到原生 Chrome/Edge。因此尚未完成该站登录态页面上的插件按钮验收，不将重建夹具或实际采集函数测试冒充线上点击通过。Source 是 DOM 的可读表示，不声称恢复作者上传原文件的原始字节；无表头/异常网格等无法无损表达的内容仍允许必要的受控 HTML。

忽略目录 `.tmp/hydro-source-fix/` 保存本次实际回归提取的 `hydroj-tree.source.md`、CNOI、PDF/SVG、两页 PNG、测试 JSON/日志和构建日志。长期回归仅依赖仓库内固定夹具，不访问线上题目。
