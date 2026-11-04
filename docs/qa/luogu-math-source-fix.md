# 洛谷公式源码丢失修复

日期：2026-10-18（Asia/Shanghai）。用户报告 P5665《划分》的求和公式在提取后变成拼接符号，行内 `a_i` / `k_0` 等上下标也丢失。

同日后续：[Markdown 表格修复](./markdown-table-fix.md)补充了数据范围表的原生语法及回归。该阶段扩充了 P5665 夹具；本文数字和 `.tmp/math-source-fix/` 证据保留为公式修复阶段记录。

## 原因和复现边界

`markdown/html.ts` 的 `mathValue` 原先找不到 TeX 属性、script 或 annotation 时直接使用 `trimmedText(node)`。KaTeX 的可见字形 DOM 不是 LaTeX：读取它只能得到上下标/求和符号的排列文本，原命令与结构已丢失。

洛谷当前 [Markdown 渲染模块](https://fecdn.luogu.com.cn/columba/mkdn~623605ba5c21bb4d.js)使用 KaTeX `output: "html"`，不自带 MathML/TeX annotation；[页面客户端模块](https://fecdn.luogu.com.cn/columba/vendor.20261012-2301.js)初始化时读取 `#lentille-context`，站内导航则使用同 URL、`x-lentille-request: content-only` 的原生 JSON。初始 script 在 SPA 切换后不能作为当前题目的可靠来源。此前即使 Adapter 会拒绝另一题 pid，采集阶段也没有补取当前原生源码，最终退化到错误的字形文本兜底。

本次直接请求 [P5665](https://www.luogu.com.cn/problem/P5665) 的原页面及 content-only 响应，确认原始 JSON 保留两条完整求和表达式。测试固定了“缺少初始 JSON”和“初始 JSON 仍是 P1001、当前 URL 为 P5665”两种情形。未取得用户浏览器当时的 snapshot，因此没有声称已复现用户那一次导航的具体步骤。

## 修改

- Adapter 的 `captureHints(url)` 给出当前题号身份校验和允许的来源字段；题库路径中大小写差异不导致误判。
- 页面采集优先读取匹配当前题号的 JSON script。缺失、损坏或仍指向上一题时，按 Adapter 声明读取当前 URL 的原生 JSON，只保留字段白名单。
- 请求限定同源、携带同源会话、拒绝重定向，5 秒内中断；流式读取使用既有 3 MB 快照预算，超限立即取消。没有添加新权限，没有读取 Vue 私有状态，也没有拦截页面请求。
- HTML codec 保留 data-math、alttext、TeX script 和 TeX annotation 的支持；不再把 KaTeX、MathJax 或 MathML 的字形拼接冒充源码。确实无法取得 TeX 时返回明确错误，提示刷新重新提取。
- Source → Parser → AST Transformer → Serializer → CNOI → 最终 Parser → Renderer 的架构不变。当前 JSON 只为 Adapter 提供原文，未向 Transformer 增加内容旁路。Renderer、PDF 字体和样式没有修改。

## 回归与验收

固定来源为 `tests/problem/fixtures/luogu-p5665-math.json`，只保留公开的题号/题名、截图中完整描述、输入首段、输出、限制和首个样例；不是完整 P5665 题面归档，不含用户会话数据。

`tests/application/problem-export-service.test.ts` 覆盖实际采集函数序列化边界：首次加载不请求、缺失/过期 script 补取源码、返回其他题目/登录 HTML/403 时拒绝乱码、流式超限取消、请求超时中断。该文件默认禁止意外真实网络请求；所有来源差异使用固定响应。

`tests/problem/markdown/source-syntax.test.ts` 覆盖仅剩字形的 KaTeX、MathJax、没有可读文字的 SVG 公式和非 TeX annotation；`render/pipeline-compile.test.ts` 验证上述真实 Source 经过 Transformer、最终解析及实际打包字体/WASM 后，两条公式仍完整存在并可生成 SVG/PDF。

全套回归曾指出旧 `pipeline-fidelity` 的一个问题：它把完整 HTML fixture 直接交给 Adapter，却没有像真实采集那样传递 script 中的 sourceData，过去因此可能对已丢失的字形文本继续做“保真”比较。本次补齐了真实输入条件，并保留无源码必须失败的独立反例，没有恢复乱码兜底。

最终结果：

| 检查                                                 | 结果                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| 五站来源、采集服务及公式语法专项                     | 124 用例通过                                                     |
| 全套测试                                             | 939 通过、1 个可选 Hydro live 同步用例跳过，无失败               |
| typecheck / lint / format:check / architecture audit | 通过                                                             |
| 生产构建 / manifest audit                            | 通过，产物 `.output/chrome-mv3`                                  |
| P5665 实际 Typst/SVG/PDF                             | 通过；两页 A4，82,939 字节；两条求和公式及行内上下标逐页查看正常 |

日志与 QA 证据位于本地忽略目录 `.tmp/math-source-fix/`：`tests.json`、`tests.log`、各静态检查及构建日志，以及 `render/luogu-p5665.{pdf,svg}`、`render/luogu-p5665-cnoi.json`、`render/luogu-p5665-{1,2}.png`。

浏览器连接只提供内置浏览器，当前读取该线上页面连续超时；本轮未完成原生扩展在线点击验收。以上结果来自当前公开原生响应、真实页面采集函数的序列化测试和真实 PDF 编译/逐页检查，没有把它们写成在线扩展实测通过。

重新加载扩展后，需要关闭旧编辑页并重新提取题面；已生成的乱码文本无法凭更新自动恢复丢失的 TeX。
