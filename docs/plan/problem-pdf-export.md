# 题目页一键导出 NOI 风格 PDF 实现计划

> 状态：功能实现和自动化验证已完成；Chrome/Edge 真实页面矩阵待验收。
>
> 本文既保留原始架构方案，也记录当前实现、验证结果和已知限制。后续可靠性与复用升级见 [题面 PDF 可靠性与复用升级计划](problem-pdf-reliability-upgrade.md)。

## 0. 当前实现状态

已完成：

- popup 已成为 extension action 的默认入口；时间线和设置改为 popup 底部次级入口；
- 五个独立 Problem Adapter：Luogu、Codeforces、AtCoder、QOJ、HydroOJ；
- Luogu 适配器兼容当前 `.l-card.problem` 布局，并优先从 `#lentille-context` 中读取结构化题面、样例和限制，以保留 DOM 数学排版丢失的 TeX 源码；
- 统一 `ProblemDocument` 和 `StatementBlock` AST，同时生成 Markdown；
- 页面探针和完整快照分离，background 负责 `activeTab`/`scripting` 采集；
- 独立 `problem-export.html` 导出页和 runtime port 交付链路；任务 token 在文档成功交付后才删除，端口中断可在短 TTL 内重试；
- 导出页握手同时携带后台刚创建的短期 job 元数据；存储短暂不可见时可恢复任务，仍由后台校验标签页和原页面 URL；
- 浏览器端 Typst WASM Renderer，A4 模板、CJK/数学/等宽字体和 HTML 打印兜底；
- 图片采集、大小上限、VFS 注入和无法嵌入时的原图链接兜底；
- Manifest/架构审计及适配器、提取器、Renderer 单元测试。
- Typst WASM 真实编译 smoke test：本地字体、中文、数学、长代码和新版页码模板可输出 PDF；临时验证文件已清理。

自动化验证结果（2026-10-12）：

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:contract`、`pnpm format:check`、`pnpm build`、`pnpm audit:manifest`、`pnpm audit:architecture` 均通过；最新完整测试为 659 passed、1 skipped，契约测试为 276 passed；
- 生产构建总计约 43.83 MB，Typst WASM chunk 约 39.20 MB；popup 保持独立小 chunk，WASM 只由题面导出页加载；
- 构建有现存依赖的 `use client` 指令提示及大 chunk 提示，不影响构建成功；
- 待完成 Chrome/Edge 实际安装扩展后的 CSP、下载、五个 OJ 页面和自部署 Hydro 页面验收。当前运行环境没有可用的加载 OJTrace 扩展的 Chrome/Edge；QOJ 在线页面请求曾返回 403，因此 QOJ 适配目前以 UOJ/QOJ 风格夹具和自动化测试验证。

## 1. 目标与范围

OJTrace 新增独立的“题目页工具”：当用户打开支持的 OJ 题目页时，通过扩展 popup 识别当前页面并导出适合 A4 打印的单题题面 PDF。

首批支持：

- Luogu
- Codeforces
- AtCoder
- QOJ
- HydroOJ

功能与时间线解耦。题面 Adapter 只负责页面识别和题面提取，PDF Renderer 统一负责排版，方便以后继续增加 OJ。

不包含：

- 整套比赛封面和注意事项；
- 多题合并；
- 题解和提交代码；
- 服务器端渲染；
- 时间线中的题面导航页面。

## 2. 当前项目现状

项目是 WXT + TypeScript + React 的 Manifest V3 扩展，主要结构如下：

- `src/domain`：账号、提交记录、来源类型等纯领域模型；
- `src/adapters/{luogu,codeforces,atcoder,qoj,hydroj}`：账号授权和提交同步 Adapter；
- `src/application`：同步、账号、存储、消息处理；
- `src/platform`：HTTP、限流、权限等基础设施；
- `entrypoints/timeline`：完整时间线页面；
- `entrypoints/settings`：设置页面；
- `entrypoints/background.ts`：后台消息和扩展 action 处理；
- `tests/adapters`、`docs/fixtures`：现有同步解析测试和脱敏夹具。

项目的原始 action 行为是：

```text
点击扩展图标
  -> background.ts 的 browser.action.onClicked
  -> 打开或聚焦 timeline.html
```

本次实现已补齐：

- 以 popup 为默认入口的 action 配置；
- 当前活动标签页的题目页识别和临时 DOM 采集；
- `ProblemDocument`、`StatementBlock` AST 和 Markdown 序列化；
- 独立 PDF Renderer、导出页和 runtime port 生命周期；
- `activeTab` 和 `scripting` 权限；
- 五个 OJ Adapter、脱敏/结构化夹具和 Renderer 测试。

现有 `OJAdapter` 仍只服务账号授权和提交同步。本功能位于独立的 `src/problem` 模块，题面 Adapter 不复用同步 Adapter 的职责。

## 2.1 工程化评审结论

当前方向整体符合常见的浏览器扩展工程做法：popup 负责入口，background 负责浏览器权限和页面采集，Adapter 负责 OJ 差异，统一中间结构负责解耦，Renderer 负责 PDF。这条链路具备较好的可维护性和可扩展性。

初版方案有三个需要修正的风险：

1. **不能把完整 HTML、Markdown 和图片 data URL 作为一个大对象长期放进存储。** MV3 storage 有容量和序列化限制，题面和图片也可能导致导出失败。改为由导出页先建立 `runtime.Port`，background 在端口生命周期内完成采集和提取，再把结果交给导出页；`storage.session` 只保存很小的 job 元数据，并以同样的短 TTL 写入 `storage.local` 作为开发版扩展重载时的兼容副本。
2. **不能把 Markdown 作为唯一的内部语义结构。** HTML 转 Markdown 再由 Renderer 重新解析，会让公式、样例组、表格和图片语义发生二次损失。增加稳定的题面块 AST；Markdown 仍然是要求保留的可调试、可复制中间结果，Renderer 直接消费 AST。
3. **预览检查和正式导出不能各自维护一套选择器。** 两个阶段允许使用不同大小的页面快照，但 OJ Adapter 的识别、题面根节点和元数据选择器必须由同一组纯函数共享，避免 popup 显示的题目和最终导出的题目不一致。

实施后，职责和生命周期保持清晰：popup 不解析题面，background 不排版，Adapter 不处理浏览器 UI，Renderer 不识别 OJ。Typst WASM、字体打包、图片 VFS、导出任务和 WASM 编译已通过自动化/本地 smoke 验证；MV3 CSP、实际下载行为和不同浏览器上的启动性能仍由真实浏览器验收确认。

## 3. 更新后的用户入口

新的用户流程：

```text
点击扩展图标
  -> 打开轻量 popup
  -> 读取当前活动标签页
  -> 判断是否为支持的题目页

支持：显示 OJ、题号、题目名称和“导出题面 PDF”主按钮
不支持：显示“当前页面暂不支持题面导出”

popup 底部：打开时间线、设置
```

popup 是 OJTrace 的统一入口，但不做成小型 Dashboard。它不显示同步状态、筛选器、账号管理或复杂诊断。

建议尺寸：宽度约 `340px`，允许范围 `320px`～`360px`。

视觉优先级：

1. 当前题目识别结果；
2. `导出题面 PDF`；
3. `打开时间线` 和 `设置`。

## 4. Extension action 调整

### Manifest

将 action 从点击事件改成默认 popup：

```json
{
  "action": {
    "default_title": "打开 OJTrace",
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/ojtrace-16.png",
      "32": "icons/ojtrace-32.png",
      "48": "icons/ojtrace-48.png"
    }
  }
}
```

后台不再使用 `browser.action.onClicked` 作为打开时间线的入口。

新增权限：

- `activeTab`：用户点击 action 后临时访问当前页面；
- `scripting`：动态执行一次性页面采集函数。

第一版不新增 `contextMenus`。右键菜单 `OJTrace -> 导出题面 PDF` 作为后续预留能力。

`activeTab` 适合这个场景：只有用户显式点击扩展后，扩展才临时获得当前标签页的访问能力，不需要给所有网站增加持久读取权限。

参考：[Chrome activeTab 文档](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。

不新增：

- `<all_urls>`；
- `webRequest`；
- 持久化的泛站点 content script；
- 服务器端代理。

现有 OJ 同步使用的 host permissions 保持不变。题目页采集优先依赖 `activeTab`，以覆盖 Hydro 自部署实例。

### Manifest 审计

现有 `tools/audit-manifest.mjs` 需要调整为：

- 允许 `activeTab` 和 `scripting`；
- 继续禁止 `<all_urls>` 和 `webRequest`；
- 检查存在 `action.default_popup`；
- 检查没有新增持久化泛站点 content script；
- 检查没有新增无关 host permission。

## 5. Popup 设计

### 文件

```text
entrypoints/popup/
  index.html
  main.tsx
  style.css
```

### 组件结构

```text
Popup
├─ PopupHeader
├─ ActivePageStatus
│  ├─ LoadingState
│  ├─ SupportedProblemCard
│  ├─ UnsupportedPageState
│  └─ InspectionErrorState
├─ ExportProblemButton
└─ PopupFooterActions
   ├─ OpenTimelineButton
   └─ OpenSettingsButton
```

支持页面示意：

```text
OJTrace

Codeforces
1A · Theatre Square

[       导出题面 PDF       ]

             打开时间线   设置
```

不支持页面只显示：

```text
当前页面暂不支持题面导出
```

popup 启动流程：

1. 通过 `browser.tabs.query({ active: true, currentWindow: true })` 读取活动标签页；
2. 取得 `tab.id`、`tab.url`、`tab.title`；
3. 向 background 发送题目页检查请求；
4. background 使用 `ProblemAdapterRegistry` 识别页面；
5. 返回支持状态和轻量题目预览；
6. popup 显示题目信息或不支持提示。

popup 不应拿到完整 Markdown，也不应负责 PDF 编译。

## 6. Popup 与题面导出流程

建议消息类型：

```ts
type ProblemExportMessage =
  | {
      type: "INSPECT_ACTIVE_PROBLEM_PAGE";
      requestId: string;
      tabId: number;
      url?: string;
    }
  | {
      type: "START_PROBLEM_EXPORT";
      requestId: string;
      tabId: number;
      url?: string;
    }
  | { type: "OPEN_TIMELINE"; requestId: string }
  | { type: "OPEN_SETTINGS"; requestId: string };
```

建议使用独立的题面导出消息 schema，避免修改现有时间线消息协议。

### 轻量检查

popup 启动时只获取：

- URL；
- 页面标题；
- 题号候选；
- 标题候选；
- 题面存在性标志；
- 少量限制信息。

### 正式导出

用户点击主按钮后才获取：

- 完整题面 HTML；
- 公式节点；
- 样例；
- 图片；
- 表格；
- 完整元数据。

流程：

```text
popup 启动
  -> INSPECT_ACTIVE_PROBLEM_PAGE
  -> background 查询活动标签页
  -> 动态注入 captureProblemPreview()
  -> ProblemAdapterRegistry.inspect()
  -> 返回 ProblemPreview

点击“导出题面 PDF”
  -> START_PROBLEM_EXPORT
  -> background 创建短时 export job
  -> 打开 problem-export.html
  -> 导出页建立 runtime.Port
  -> background 校验 tabId 和 URL 未变化
  -> 动态注入 captureProblemSnapshot()
  -> ProblemAdapter.extract()
  -> 生成 ProblemDocument（AST + Markdown）
  -> 通过 port 交给导出页
  -> Typst Renderer 编译 PDF
  -> Blob 下载
```

导出页是独立的题面导出处理页面，不是时间线导航页面。当前 OJ 页面保持不变。

### Job 生命周期

导出 job 只保存以下小型元数据：

```ts
interface ProblemExportJob {
  token: string;
  tabId: number;
  expectedUrl: string;
  createdAt: number;
  expiresAt: number;
}
```

`storage.session` 保存上述 token、标签页和过期时间；`storage.local` 只保留同一份短 TTL 元数据作为 session 被开发版扩展重载清空时的兼容副本。两者都不保存完整 HTML、Markdown、图片 data URL 或 PDF bytes。

导出页打开后立即执行：

```text
connect("problem-export")
  -> 发送 token 和短期 job 元数据
  -> background 优先读取 storage，必要时用握手元数据恢复 job
  -> background 验证标签页和原页面 URL
  -> background 采集、解析并发送文档
```

使用 `runtime.Port` 的原因是让 background 在页面采集和交付期间有明确的生命周期边界。导出页关闭或 port 断开时，background 取消当前采集，但保留短 TTL job，允许导出页重新连接；只有完整文档成功发送后才清理 job。文档和资源传输需要设置大小上限；超过上限时应返回明确错误，而不是静默截断。

如果导出页在 background 休眠前尚未建立连接，导出页可以用 token 和同一份短期元数据重试；后台仍以过期时间、token、标签页和原页面 URL 做校验。过期或元数据缺失时才提示重新从 popup 发起导出。

完整快照不通过 URL 参数传递。导出页 URL 只包含不可推导的短 token 和恢复任务所需的 tabId、原页面 URL、创建时间、过期时间，不包含 HTML、Markdown、图片或 PDF；元数据过期后不可复用。

## 7. ProblemAdapter 和中间结构

建议新增：

```text
src/problem/
  domain.ts
  adapter.ts
  registry.ts
  snapshot.ts
  statement.ts

src/problem/adapters/
  luogu.ts
  codeforces.ts
  atcoder.ts
  qoj.ts
  hydroj.ts
```

### 页面探针和完整快照

```ts
interface ProblemPageProbe {
  url: string;
  title: string;
  htmlFragment: string;
  baseUrl: string;
}

interface ProblemPageSnapshot {
  url: string;
  title: string;
  html: string;
  baseUrl: string;
  language?: "zh" | "en" | "ja" | "other";
  capturedAt: number;
}
```

页面采集函数只读取 DOM，不负责 OJ 解析。

### Adapter

```ts
interface ProblemAdapter {
  readonly oj: SourceId;

  inspect(
    probe: ProblemPageProbe,
  ): Promise<ProblemPreview | undefined>;

  extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult>;
}
```

Adapter 只负责：

- URL 识别；
- 题面根节点识别；
- 题号、标题、限制提取；
- 语言和站点特殊字段处理；
- 返回统一题面片段。

Adapter 不负责 PDF 排版、下载、popup 或账号同步。

### ProblemDocument

```ts
interface ProblemDocument {
  oj: SourceId;
  problemId: string;
  title: string;
  originalUrl: string;

  timeLimit?: ProblemLimit;
  memoryLimit?: ProblemLimit;

  /** Stable canonical representation consumed by the Renderer. */
  blocks: readonly StatementBlock[];
  /** Normalized Markdown for debugging, copying and future exporters. */
  markdown: string;
  language?: "zh" | "en" | "ja" | "other";
  assets: ProblemAsset[];
  warnings: ProblemWarning[];
}

interface ProblemLimit {
  display: string;
  milliseconds?: number;
  bytes?: number;
}
```

建议的 `StatementBlock` 至少包括：

```ts
type StatementBlock =
  | HeadingBlock
  | ParagraphBlock
  | MathBlock
  | CodeBlock
  | SampleBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | QuoteBlock
  | ThematicBreakBlock;
```

`SampleBlock` 应能表达一个样例组中的输入、输出和说明，不能只依赖普通代码块的相邻顺序推断。

限制同时保留原始显示文本和可选规范化数值，Renderer 不需要知道 OJ 单位差异。`blocks` 是排版的主输入，`markdown` 是稳定的交换、调试和复制格式；Renderer 不应再把 Markdown 重新解析成第二套语义树。

## 8. 五个 OJ 的识别和提取策略

### Luogu

识别：

- `/problem/{pid}`；
- `/problem/show?pid={pid}`；
- URL 中的 `P/B/U/T` 等题号形式。

提取优先级：

1. `#lentille-context` 内与当前 URL 题号匹配的结构化题目数据（`content` / `contenu`、`samples`、`limits`）；
2. 当前已渲染题面 DOM，包括当前 `.l-card.problem` 容器；
3. 其他 hydration 数据；
4. 结构确认后的 `main/article` 回退。

结构化题面 Markdown 先由 MIT 许可的 `marked` 转为中间 HTML，再进入共享的惰性 HTML AST 提取器。当前线上 `#lentille-context` 同时存在 `content` 和 `contenu` 字段；适配器兼容两种字段并将完整许可证随扩展打包。这样可以保留页面 DOM 中只剩 KaTeX 视觉节点时已经不可逆丢失的公式源码。JSON 题目 ID 必须与 URL 中的题号一致；数据字段缺失或不匹配时回退到 DOM，不根据页面标题猜测题目。

处理：

- 中文标题和题号分离；
- 题目背景、题目描述、输入格式、输出格式、说明/提示、数据范围；
- 移除广告、讨论入口、提交按钮；
- 处理 KaTeX/MathJax 重复节点；
- 登录页和加载失败页不能当作题面。

### Codeforces

识别：

- `/problemset/problem/{contestId}/{index}`；
- `/contest/{contestId}/problem/{index}`；
- `/gym/{contestId}/problem/{index}`。

优先节点：

```text
.problem-statement
```

字段：

- `.header`：题号和标题；
- `.time-limit`：时间限制；
- `.memory-limit`：内存限制；
- 输入、输出、样例区块；
- 其他题面分节。

普通 Contest 和 Gym 的 URL 必须区分。Codeforces 页面可能受到 Cloudflare 影响，导出只处理用户当前页面快照，不重新抓取页面。

参考：[Codeforces 1A 题面](https://codeforces.com/problemset/problem/1/A)。

### AtCoder

识别：

- `/contests/{contestId}/tasks/{taskId}`；
- 兼容旧题面路径；
- 保留当前 `lang=en`、`lang=ja` 等语言选择。

优先节点：

```text
#task-statement
```

处理：

- `Time Limit`、`Memory Limit`；
- 日文/英文标题；
- `<var>` 数学表达式；
- 样例、列表、代码和图片；
- `img.atcoder.jp` 图片转绝对地址。

参考：[AtCoder 题面](https://atcoder.jp/contests/abc001/tasks/abc001_1)。

### QOJ

识别：

- `/problem/{id}`；
- `/contest/{contestId}/problem/{id}`；
- 结合题面容器、标题、登录标记和 challenge 特征。

处理：

- UOJ 风格题面容器；
- 顶部时间、内存、总分；
- `h2/h3`、列表、表格和代码块；
- 登录页、维护页、Cloudflare challenge 与普通页面脚本的区分。

参考：[QOJ 题面](https://qoj.ac/problem/1)。

### HydroOJ

识别：

- `/p/{problemId}`；
- `/d/{domainId}/p/{problemId}`；
- 比赛和作业下的题目路由；
- Hydro 页面特征和当前 origin。

Hydro 实例差异最大，必须进行实例能力探测：

```text
URL 匹配成功
  -> 页面特征探测
  -> 找到题面容器和标题才允许导出
  -> 否则返回“当前实例暂不支持”
```

不得把一个 Hydro 版本的选择器假设为所有实例通用。需要支持 HTTP/HTTPS、domain 路径、不同主题和 WAF/challenge 页面。

## 9. HTML/DOM 提取器与 Markdown 序列化

Adapter 只返回题面片段：

```ts
interface StatementFragment {
  rootHtml: string;
  title?: string;
  metadataNodes?: string[];
  language?: string;
}
```

统一提取器负责：

- 删除 `script`、`style`、`noscript`、导航、广告、提交按钮和隐藏节点；
- 保留标题、段落、列表、表格、图片、链接、代码、公式；
- 规范化题面标题层级；
- 转换 GFM 表格；
- 保留 fenced code block；
- 将相对图片地址转换为绝对地址；
- 禁止危险 URL 协议；
- 处理 HTML entity。

处理顺序应是：

```text
HTML/DOM
  -> 清理后的内部节点
  -> StatementBlock AST
  -> Markdown 序列化
```

不要采用“先生成 Markdown，再由 Renderer 重新解析 Markdown”的主路径。这样可以避免公式、样例组、表格和图片在两次转换之间丢失语义。

公式统一保留为：

- `$...$`；
- `$$...$$`；
- `\\(...\\)`；
- `\\[...\\]`。

需要识别 MathJax annotation、KaTeX MathML、`alttext` 和 AtCoder `<var>`，避免公式源码和视觉节点重复出现。

可以使用 `parse5` 或等价 HTML AST 解析器，再使用受控的内部 StatementBlock AST。Markdown 序列化可以使用 `mdast`/`remark`、GFM 和数学扩展，但它只是输出格式，不是 Renderer 的唯一输入。正式引入前需要完成包体积、浏览器兼容性和许可证审计。

### 图片资源策略

图片资源不应让 Typst Renderer 在编译期间任意访问网络。页面采集阶段按以下顺序处理：

1. 将相对地址解析成绝对地址；
2. 对当前页面同源图片尝试获取并转换为受大小限制的 data URL；
3. 对跨源或防盗链图片保留绝对地址和替代文本；
4. 无法嵌入时在 `warnings` 中记录，并在 PDF 中显示可读的图片替代信息或原链接；
5. 限制单图和总资源大小，不允许静默截断。

页面上下文中的 `fetch` 也可能受 CORS 影响，因此图片完整嵌入必须有失败路径，不能作为整份题面导出的硬依赖。

## 10. PDF 生成路线

推荐使用浏览器端 Typst WASM：

```text
ProblemDocument.blocks
  -> 自有 StatementBlock-to-Typst 转换器
  -> 自有 A4 Typst 模板
  -> typst.ts WASM
  -> PDF bytes
  -> Blob + <a download>
```

建议 Renderer 对外只有一个稳定接口：

```ts
interface ProblemRenderer {
  render(
    document: ProblemDocument,
    options?: RenderOptions,
  ): Promise<Uint8Array>;
}
```

Renderer 只接收通用 `ProblemDocument`，不能接收 `SourceId` 后再分支处理 OJ。`markdown` 仍用于复制、调试和未来其他导出格式；正式排版使用 `blocks`。

参考项目公开说明其流程是 Markdown 转 Typst，并在浏览器端生成题面；`typst.ts` 也提供浏览器端编译能力。

参考：

- [CNOI Statement Generator README](https://github.com/Mr-Python-in-China/cnoi-statement-generator#readme)
- [typst.ts 文档](https://myriad-dreamin.github.io/typst.ts/cookery/guide/all-in-one.html)

必须先验证：

- MV3 CSP 和 WASM 加载；
- CJK 字体；
- 数学公式；
- 长样例和多页分页；
- 图片嵌入；
- 包体积和初始化速度。

Chrome 扩展页面对 WebAssembly 有 CSP 要求，需要配置允许的 `wasm-unsafe-eval`。[Chrome 扩展 CSP 文档](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

当前实现采用 `@myriaddreamin/typst-all-in-one.ts` 0.7.0 和 `tex2typst` 0.6.2。Typst 懒加载到独立导出页，字体本地打包。HTML 打印预览已经移除；编译失败只在导出页显示诊断，不下载文件。真实 Typst WASM 编译 smoke test 已通过，但 Chrome/Edge 扩展 CSP 和实际下载尚未在真实安装环境验收。当前 43.78 MB 的解压构建中，Typst chunk 约 39.20 MB，这是发布评估中需要明确接受的体积和首次导出加载成本。

## 11. NOI 风格和许可证边界

参考项目使用 AGPL-3.0，不能直接复制其源码、模板、CSS、资源或字体。只能参考最终视觉效果，独立实现 OJTrace 自己的模板。

参考项目公开更新记录提到：

- 代码字体使用 Fira Mono；
- 数学字体使用 New Computer Modern Math；
- 通过 Typst 生成题面。

参考：[CNOI 项目更新记录](https://cnoi.mrpython.top/)。

建议新增：

```text
src/problem/render/style-tokens.ts
src/problem/render/template.ts
THIRD_PARTY_NOTICES.md
```

初始版式 token：

- 页面：A4；
- 左右边距：约 20mm；
- 上下边距：约 18mm～22mm；
- 标题：约 17pt；
- 正文：约 10.5pt～11pt；
- 行距：约 1.45～1.6；
- 代码：Fira Mono，约 8.5pt～9pt；
- 数学：New Computer Modern Math；
- 页脚：页码和必要的原题链接信息。

这些是独立实现的初始排版参数，后续通过视觉验收调整，不复制参考项目内部模板。

PDF 只包含单题题面、标题、限制、正文、样例、图片、公式和页码，不加入整套比赛材料。

## 12. 失败兜底和边界情况

页面识别失败类型：

- `unsupported-url`；
- `statement-not-found`；
- `login-required`；
- `challenge-page`；
- `page-not-ready`；
- `ambiguous-problem`；
- `renderer-unavailable`。

规则：

- 标题和正文缺失时失败；
- 时间或内存缺失时省略对应字段并显示 warning；
- 题号无法确认时优先从 URL 提取；
- 公式转换失败时保留原公式文本；
- 图片失败时保留替代文本和原链接；
- 题面过大时明确提示，不静默截断；
- 导出前校验 tabId 和 URL 没有变化；
- 不执行题面中的脚本；
- 不读取 Cookie 或向服务器上传题面。

分页规则：

- 标题不单独落在页底；
- 样例标题尽量和样例内容保持在一起；
- 表头跨页重复；
- 长代码允许换行或缩小字号；
- 图片不超过正文宽度；
- 每页带页码。

## 13. 测试方案

### Popup

实现于：

```text
tests/ui/popup.test.tsx
```

覆盖：

- 加载状态；
- 支持页面；
- 不支持页面；
- OJ、题号、标题显示；
- 主按钮视觉优先级；
- 时间线和设置次级入口；
- 识别失败；
- tab URL 变化；
- popup 不显示复杂同步内容。

### 消息、导出和导航

实现于：

```text
tests/application/problem-export-service.test.ts
tests/ui/problem-export.test.tsx
```

覆盖：

- 预览请求；
- 正式导出请求；
- tab 校验；
- export job 创建、过期和清理；
- runtime.Port 建立、交付和断开；
- service worker 休眠前后的重试；
- 打开或聚焦时间线；
- 打开或聚焦设置。

### 题面 Adapter 和提取器

实现于：

```text
docs/fixtures/problem/atcoder-multilang.html
docs/fixtures/problem/qoj-uoj.html
tests/problem/adapters.test.ts
tests/problem/extract/roundtrip.test.ts
tests/problem/extract/samples.test.ts
tests/problem/render/renderer.test.ts
```

覆盖：

- 中英文/日文；
- canonical StatementBlock AST 和 Markdown 序列化一致；
- 数学公式；
- 多个样例；
- 表格、列表和图片；
- 长代码；
- 登录页和 challenge；
- 相对图片地址；
- 缺失字段和轻微 DOM 变化；
- 危险链接和隐藏节点。

### Renderer

验证：

- PDF 能生成；
- Renderer 只依赖通用 ProblemDocument，不按 OJ 分支；
- 页数正确；
- 页面尺寸为 A4；
- 文本可抽取；
- 中文、公式和代码可见；
- 长题面分页正常；
- 图片、表格和页码无裁切。

已完成 Renderer 单元测试及使用真实 Typst WASM 的本地 smoke 编译。自动化验证不包含真实 Chrome/Edge 的扩展安装、页面打印预览视觉检查或下载 UI。

默认 CI 不依赖实时 OJ，真实页面只进入 Chrome/Edge 浏览器验收矩阵。

## 14. 文件变更清单

### 新增

```text
entrypoints/popup/index.html
entrypoints/popup/main.tsx
entrypoints/popup/style.css

entrypoints/problem-export/index.html
entrypoints/problem-export/main.tsx
entrypoints/problem-export/ProblemExport.tsx
entrypoints/problem-export/ProblemExport.css

src/problem/domain.ts
src/problem/adapter.ts
src/problem/registry.ts
src/problem/snapshot.ts
src/problem/statement.ts
src/problem/index.ts

src/problem/adapters/common.ts
src/problem/adapters/luogu.ts
src/problem/adapters/codeforces.ts
src/problem/adapters/atcoder.ts
src/problem/adapters/qoj.ts
src/problem/adapters/hydroj.ts

src/problem/extract/html-document.ts
src/problem/extract/html-to-statement.ts
src/problem/extract/markdown-serializer.ts
src/problem/extract/metadata.ts
src/problem/extract/image-assets.ts
src/problem/extract/index.ts

src/problem/render/browser-typst-compiler.ts
src/problem/render/statement-to-typst.ts
src/problem/render/typst-renderer.ts
src/problem/render/style-tokens.ts
src/problem/render/template.ts
src/problem/render/typst-escape.ts
src/problem/render/index.ts

src/application/problem-export/service.ts
src/application/problem-export/client.ts
src/application/problem-export/messages.ts
src/application/problem-export/export-state.ts
src/application/problem-export/transport.ts

src/application/navigation/extension-pages.ts

tests/application/problem-export-service.test.ts
tests/application/problem-export-transport.test.ts
tests/ui/popup.test.tsx
tests/ui/problem-export.test.tsx
tests/problem/adapters.test.ts
tests/problem/extract/roundtrip.test.ts
tests/problem/extract/samples.test.ts
tests/problem/render/renderer.test.ts
docs/fixtures/problem/atcoder-multilang.html
docs/fixtures/problem/qoj-uoj.html
docs/qa/problem-pdf-browser-matrix.md

THIRD_PARTY_NOTICES.md
public/licenses/tex2typst-0.6.2-LICENSE.txt
public/licenses/typst-all-in-one-0.7.0-LICENSE.txt
public/licenses/marked-18.1.0-LICENSE.txt
public/problem-fonts/FiraMono-Regular.ttf
public/problem-fonts/LibertinusSerif-Regular.otf
public/problem-fonts/NewCM10-Regular.otf
public/problem-fonts/NewCMMath-Regular.otf
public/problem-fonts/NotoSerifCJKsc-Regular.otf
public/problem-fonts/README.md
public/problem-fonts/NOTICE-typst-assets.txt
public/problem-fonts/NOTICE-typst-dev-assets.txt
```

### 修改

```text
package.json
pnpm-lock.yaml
wxt.config.ts
entrypoints/background.ts
tools/audit-manifest.mjs
tools/audit-architecture.mjs
```

第一版不新增 `contextMenus`，但导出服务接口应允许未来复用到右键菜单。

## 15. 分阶段实现顺序

### 阶段 0：技术可行性验证（本地验证完成，浏览器验收待完成）

- 验证 Typst WASM 在 MV3 中运行；
- 编译带中文、公式、代码、图片和多页内容的 A4 PDF；
- 验证字体和依赖许可证；
- 测量包体积、初始化速度和内存；
- 验证 Blob 下载。

已验证真实 Typst WASM 能加载随扩展打包的字体并编译中文、数学、代码和分页文档；依赖许可证、题面和图片体积边界已纳入实现。Chrome/Edge 的扩展 CSP、实际下载行为和首次初始化性能仍要在阶段 6 中验收。

### 阶段 1：领域合同和提取器（已完成）

- 定义 `ProblemDocument`；
- 定义 `StatementBlock` canonical AST；
- 定义 `ProblemAdapter`；
- 定义轻量 `ProblemPageProbe` 和完整 `ProblemPageSnapshot`；
- 实现 HTML 清理、AST 提取和 Markdown 序列化；
- 验证 Luogu `.l-card.problem` 实际布局及 `#lentille-context` 结构化题面、样例和限制提取；
- 使用静态 fixture 测试。

### 阶段 2：popup 和 action 入口（已完成）

- 新增 popup entrypoint；
- 修改 `wxt.config.ts`；
- 增加 `activeTab`、`scripting`；
- 实现当前活动标签页读取；
- 实现 popup 预览状态；
- 将时间线、设置改为 popup 次级入口；
- 更新 Manifest 和架构审计。

### 阶段 3：页面采集和导出状态（已完成）

- 实现轻量预览采集；
- 实现完整题面采集；
- 校验 tabId/URL；
- 使用 `storage.session` 保存小型 export job 元数据，并以短 TTL 的 `storage.local` 副本覆盖开发版扩展重载；
- 在导出页握手中携带同一份短期元数据，覆盖 storage 在扩展重载或 service worker 唤醒窗口中的短暂不可见；
- 使用 `runtime.Port` 交付 ProblemDocument 和导出进度；
- 覆盖 port 断开、job 过期和 service worker 休眠重试；
- 打开独立的 `problem-export.html`。

### 阶段 4：Adapter（已完成）

五个 Adapter 已分别实现并由静态页面夹具和结构化 DOM 测试覆盖。HydroOJ 对页面特征进行严格验证，避免把任意 `/p/...` 页面误认为 Hydro 题目。

### 阶段 5：NOI Renderer（已完成）

- A4 页面；
- 标题和限制；
- 正文；
- 公式；
- 代码和样例；
- 表格、列表和图片；
- 分页和页码。

Renderer 直接消费 `StatementBlock` AST。Markdown 只作为复制、调试和未来其他格式的输入，不在 Renderer 内重新解析。

### 阶段 6：浏览器验收（待执行）

按 [`docs/qa/problem-pdf-browser-matrix.md`](../qa/problem-pdf-browser-matrix.md) 在 Chrome 和 Edge 分别验证五个 OJ、日文/英文页面、长题面、图片、公式、Hydro 自部署实例和 popup 的三个入口。

## 16. 兼容性影响

明确的行为变化只有一项：

```text
旧行为：点击扩展图标 -> 直接打开时间线
新行为：点击扩展图标 -> 打开 popup
```

原本通过扩展图标进入时间线的用户，需要在 popup 中再点击一次“打开时间线”。

除此之外：

- 时间线完整功能不变；
- 设置完整功能不变；
- 账号和提交数据不变；
- 同步逻辑不变；
- 时间线 URL 不变；
- 现有书签和直接打开方式不变；
- 不需要迁移本地数据。

为了降低影响，`打开时间线` 应保持稳定、容易发现的底部入口，并在版本说明中明确入口变化。后续可增加右键菜单或快捷键，但不应扩大第一版 popup 的职责。

## 17. 发布前门禁

实现和自动化门禁已完成，记录的最终门禁为：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm format:check
pnpm build
pnpm audit:manifest
pnpm audit:architecture
```

Chrome/Edge 的真实页面导出验收仍是发布前的唯一未完成项；不需要再确认计划即可继续开发或安排验收。
