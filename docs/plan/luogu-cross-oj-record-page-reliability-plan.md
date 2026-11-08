# 洛谷跨 OJ 记录页可靠性重构计划

> 状态：核心实现完成，已补充跨 world 单实例接管与并发详情渲染保护，待登录态浏览器验收
>
> 本文只规划洛谷跨 OJ 记录列表与记录详情页的可靠性重构，不改变跨 OJ 提交协议、OJ 适配器、凭证边界或提交结果关联合同。实现前必须先完成本计划的浏览器复现和基线记录。

> 实施记录：已完成 hash 记录路由、列表幂等渲染、详情主体直接挂载、主题继承、头像样式、Tab 面板、breadcrumb 幂等更新、MutationObserver 自变更过滤、跨 world 控制器接管、详情节点对数校验、异步提交前清理，以及 scoped CSS 缺失时的两栏布局兜底；受影响的 5 个测试文件共 37 个用例、`typecheck`、`lint`、架构审计、构建和 manifest 审计通过。全套 `pnpm test` 在串行文件模式下 1278 个用例通过、1 个可选 live 用例跳过；并行模式偶发分页集成超时。`format:check` 仍有其他未修改文件的格式问题；真实登录态 Chrome/Edge 刷新、后退、自定义主题验收仍需在可识别的浏览器页面中完成。

## 1. 审计结论

当前问题由四个生命周期设计叠加造成：

1. 记录详情使用洛谷不存在的 `/record/cf/...`、`/record/at/...` 伪路由。点击时由 MAIN world 脚本接管，刷新时浏览器直接请求洛谷服务器，产生 `No route found`。
2. 记录列表同时依赖洛谷 Vue 原生 DOM 和扩展异步注入 DOM。原生列表尚未准备好时，扩展可能创建第二个列表；后续 Vue 重绘或并发 `render()` 又可能重复插入记录。
3. 详情页克隆并隐藏 `.theme-page`，只复制有限主题变量。刷新 404 页面或主题变量尚未稳定时，扩展会从错误壳或默认壳取样，返回列表后也可能恢复错误的主题状态。
4. 详情页的头像、隐藏面板和标签状态依赖洛谷内部的 Vue scoped CSS 与 `[hidden]` 默认行为，当前实现对这些内部细节的依赖过强。

本次重构的主原则是：**使用洛谷真实存在的页面壳和浏览器原生历史机制，把扩展内容作为一个可撤销、可幂等、可取消的局部增强挂载进去。**

## 2. 现状证据与影响范围

| 现象                     | 现状证据                                                                                                                                                                                                                                                      | 影响                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 刷新后出现洛谷错误页     | [`record-details.ts`](../../src/oj-enhancer/features/cross-oj-submit/record-details.ts) 生成 `/record/cf/...`、`/record/at/...`；[`luogu-record-route-main.ts`](../../src/oj-enhancer/features/cross-oj-submit/luogu-record-route-main.ts) 只在页面内接管导航 | P0：详情页刷新不可用，原生错误壳和扩展详情可能同时显示    |
| 返回列表重复             | [`record-list.ts`](../../src/oj-enhancer/features/cross-oj-submit/record-list.ts) 在原生列表不存在时生成独立列表，在原生列表存在时直接 `prepend`；`render()` 没有串行锁                                                                                       | P0：记录数量、列表 DOM 和用户认知不一致                   |
| 主题丢失                 | [`luogu-record-page.ts`](../../src/oj-enhancer/features/cross-oj-submit/luogu-record-page.ts) 复制第一个 `.theme-page` 的有限 CSS 变量并隐藏其他主题页                                                                                                        | P1：自定义背景、卡片透明度、模糊和遮罩在刷新/返回后不稳定 |
| 头像变形                 | [`luogu-native-identity.ts`](../../src/oj-enhancer/features/cross-oj-submit/luogu-native-identity.ts) 给新头像使用通用 `avatar` class，但没有完整复制用户名组件的 scoped 属性                                                                                 | P1：头像尺寸、圆角或布局受全局 CSS 影响                   |
| 源代码和评测面板同时出现 | 当前实现使用 `hidden` 控制卡片，标签为 `span`；无法保证 `[hidden]` 没有被站点 CSS 覆盖，也无法保证重复渲染后状态仍一致                                                                                                                                        | P1：详情页信息层级错误，标签与内容不同步                  |
| 源码与产物可能不一致     | 当前 `.output/chrome-mv3` 产物时间早于工作区部分源码修改                                                                                                                                                                                                      | P1：浏览器反馈可能来自旧构建，导致错误判断修复效果        |

现有相关单元测试和 `typecheck` 能证明纯函数、DOM 夹具和消息合同的一部分正确，但没有覆盖真实浏览器的硬刷新、`history.back()`、Vue 异步重绘、跨 world 注入时序和实际 CSS 计算结果。

## 3. 目标与非目标

### 3.1 目标

- 记录详情可以在洛谷真实存在的页面壳中打开、刷新、后退和前进。
- 同一个 `oj + contestId + submissionId` 在同一列表中最多显示一次。
- 列表和详情的异步请求、定时器、观察器在离开路由后全部失效。
- 详情页继承当前洛谷主题，不复制或持久化用户主题设置。
- 头像、认证标识、状态标签和源代码面板在 Chrome/Edge 中具有稳定布局。
- 使用原生洛谷页面的导航、主题、卡片、链接和用户卡片语义；扩展只增加必要内容。
- 保持现有本地优先、无服务端、源代码只存 `storage.session` 的隐私边界。
- 为后续 Codeforces、AtCoder 以及可能的其他来源保留清晰的记录模型和路由扩展点。

### 3.2 非目标

- 不重写跨 OJ 提交流程、编辑器读取、Cloudflare/Turnstile 等目标站逻辑。
- 不把详情页改成独立扩展页面。
- 不下载或替换整份洛谷 HTML，不重新执行站点脚本。
- 不使用用户脚本的 `GM_*` 存储、任意跨域请求、手工提交 token 或固定语言 ID。
- 不将洛谷原生记录、OJTrace 外部记录和历史数据混成没有来源标识的单一对象。
- 不为了“看起来像原生”复制不稳定的 Vue `data-v-*` 属性作为长期合同。

## 4. 目标信息模型与身份键

### 4.1 记录身份

扩展记录的唯一键固定为：

```text
recordKey = `${oj}:${contestId}:${submissionId}`
```

详情路由、列表 DOM、缓存快照、异步请求和诊断日志都使用这个键。题号、题名、用户名、时间和 verdict 不能作为唯一键。

### 4.2 路由状态

详情使用洛谷真实存在的列表页面作为壳，建议形式如下：

```text
/record/list?pid=CF1A#ojtrace-record=cf/397475296
/record/list?pid=AT_abc482_a#ojtrace-record=at/123456
```

约束：

- hash 内只放经过严格校验的 OJ 标识和提交 ID；比赛 ID 从列表页的 `pid` 解析，不放代码、Cookie、token 或详情原文。
- 记录列表原有 query 参数必须保留；扩展不得覆盖用户筛选条件。
- 详情链接、浏览器后退和刷新都必须回到真实的 `/record/list` 路由。
- 直接打开不带 `ojtrace-record` 的列表 URL 时，只显示原生列表和可用的外部记录增强。
- 不再把 `/record/cf/...` 或 `/record/at/...` 作为任何新链接的 canonical URL。

### 4.3 来源区分

列表 DOM 必须区分：

- 洛谷原生记录：由洛谷 Vue 渲染，扩展不拥有其生命周期。
- OJTrace 外部记录：由扩展渲染，使用 `data-ojtrace-record-key` 标识。

如果外部记录能够由站点响应明确映射到某条洛谷原生记录，才允许合并；只有题号、时间或题名相同不能作为合并依据。

## 5. 目标生命周期设计

### 5.1 单一控制器

新增一个轻量的页面控制器，职责只有四项：

1. 读取当前列表/详情路由。
2. 在路由变化时取消旧作用域并创建新作用域。
3. 调度列表或详情的挂载。
4. 清理扩展拥有的节点、监听器、请求和定时器。

控制器不负责解析 OJ 响应，不负责读取凭证，不负责保存记录。现有 `record-list.ts`、`luogu-record-page.ts` 和后台消息服务继续保持职责分离。

每次进入路由生成递增的 `generation` 和 `routeKey`。所有异步 continuation 在写 DOM 前检查：

```text
active === true
generation === currentGeneration
currentDocumentUrl === expectedDocumentUrl
routeKey === currentRouteKey
```

### 5.2 挂载节点

外部列表拥有一个扩展根节点；详情页使用两个直接挂载到洛谷主题壳的受控节点：

```text
data-ojtrace-luogu-record-list
data-ojtrace-luogu-record-page + data-ojtrace-luogu-record-node="header"
data-ojtrace-luogu-record-node="main"
```

详情的 `header` 和 `main` 直接位于 `.theme-page` 内，footer 保持洛谷原生节点。进入详情时保存并隐藏原生列表的 header/main，离开时精确恢复。重新渲染只更新这两个受控节点，不重新创建页面主题壳。

### 5.3 请求取消与清理

- 每个路由作用域持有 `AbortController` 或等价的逻辑取消标记。
- 详情请求、列表刷新、历史扫描和样式发现都绑定到作用域。
- `MutationObserver`、`popstate`、`hashchange`、`pagehide` 和定时器集中注册、集中销毁。
- 离开详情时恢复标题和扩展修改的滚动状态。
- 旧请求完成后只能丢弃结果，不能弹出错误卡片，也不能重新创建详情根节点。

### 5.4 跨 world 单实例接管

洛谷脚本同时存在于 manifest 静态 content script、权限启用后的延迟 `executeScript` 和 MAIN world 路由脚本。JavaScript 模块级变量不能作为这些注入路径之间的唯一锁，因此控制器还必须在共享 DOM 上登记 owner token：

- 新控制器先写入 DOM owner token，再向旧 token 发送接管事件；旧控制器立即停止 observer、路由监听、定时器和后续 reconcile。
- 旧控制器的详情请求即使晚到，也要在写 DOM 前重新验证 owner token、当前 URL 和活动状态。
- 详情最终提交前再次删除所有现有 OJTrace header/main 节点，再提交唯一一对节点。
- 安装判定要求恰好一个 header 和一个 main，且二者同属当前主题壳；出现四个节点时必须判定为未安装并触发修复。
- 释放 owner token 时只允许 owner 自己清理，不能误删接管后的新控制器节点。

## 6. 路由重构方案

### 阶段 R1：保留列表壳，移除伪详情路径

修改范围：

- `src/oj-enhancer/features/cross-oj-submit/record-details.ts`
- `src/oj-enhancer/features/cross-oj-submit/luogu-record-route.ts`
- `src/oj-enhancer/features/cross-oj-submit/luogu-record-route-main.ts`
- `entrypoints/luogu-cross-oj.content.ts`
- 对应路由测试

工作项：

- 将记录链接改为当前列表 URL 加 hash。
- 保留原生 query，使用 `URL` 和 `URLSearchParams` 构造地址。
- 对 hash 做严格解析和长度限制。
- 将 MAIN world 代码从“拦截不存在的 pathname”改为“只通知 hash/历史变化”，减少对洛谷 router 的干预。
- 保留普通洛谷链接的原生行为。
- 处理浏览器后退、前进、hash 清除和用户手动修改 URL。

退出条件：

- 详情首次打开、刷新、后退、前进均不产生 `No route found`。
- 直接加载详情 hash 时只出现一个扩展详情根节点。
- 删除或禁用扩展脚本后，`/record/list` 仍是正常洛谷页面。

## 7. 列表渲染重构方案

### 阶段 L1：稳定挂载点

- 等待洛谷原生 `.main-container .main-content` 和结果卡片出现。
- 等待窗口必须有上限；超时只显示状态提示，不创建第二个伪列表。
- 原生列表为空时，可以在原生结果卡片中创建一个明确标记的外部记录容器；不能创建另一个完整的原生 `.list` 并与原生列表竞争。
- 每次 Vue 重绘后，通过根节点标记重新找到挂载点。

### 阶段 L2：幂等 reconcile

每次渲染都按 `recordKey` 建立 DOM 映射：

```text
desiredKeys = response.records.map(recordKey)
existingKeys = root.querySelectorAll('[data-ojtrace-record-key]')
```

执行顺序：

1. 删除不再存在的扩展记录行。
2. 更新仍存在但状态、时间、语言或资源发生变化的行。
3. 创建缺失记录行。
4. 按服务端排序重新排列扩展行。
5. 只更新扩展自己维护的计数和状态提示。

禁止无条件 `prepend`。原生记录数量和外部记录数量必须分别可解释；如果产品最终需要合并显示，合并必须建立在明确的来源键上。

### 阶段 L3：并发渲染保护

- `render()` 进入时记录当前 generation。
- 同一作用域最多一个 DOM reconcile；后续触发只设置 `pendingRender = true`。
- 当前 reconcile 完成后，如果仍有 pending，再使用最新响应执行一次。
- 缓存响应和刷新响应按照版本号或 `observedAt` 选择，不允许旧响应覆盖新状态。

### 阶段 L4：列表退出清理

退出列表时只删除：

- 外部记录根节点；
- 扩展状态消息；
- 扩展新增的计数标记。

不得删除原生 `.row`、搜索控件、分页控件或洛谷原生空状态。

## 8. 详情页 UI 重构方案

### 8.1 原生壳策略

详情的 header/main 直接挂在当前 `.theme-page` 内部，位于原生 header/main 之前；原生 footer 保持在主题壳中。扩展不再创建第二个 `.theme-page`，不再隐藏整个原生主题页，也不再以“先渲染 404 再覆盖”的方式工作。

如果主题壳尚未准备好：

- 等待有限时间；
- 显示扩展自己的小型加载状态；
- 超时显示可恢复错误，不隐藏原生页面。

两栏结构的 `display: flex`、方向、比例和窄屏折叠由扩展自己的 fallback class 保底；洛谷 `data-v-*` 属性只用于复用主题视觉。这样详情 CSS 在刷新期间尚未可读时，测试点和用户信息仍保持原生页面的左右层级。额外样式发现失败时不永久缓存空结果，后续重绘可以再次尝试。

### 8.2 头像与认证标识

头像使用扩展独立 class，并明确声明尺寸、圆角、裁切和 flex 行为。认证标识作为单独的链接或 badge 节点生成，保留当前登录用户链接和可访问名称。

不依赖洛谷内部的 `data-v-*` 属性控制头像尺寸。可以读取原生用户名和头像来源，但不把整个原生用户名 DOM 当作布局模板。

### 8.3 标签与内容面板

使用两个真正的 tab button：

```text
role="tab"
aria-selected="true|false"
aria-controls="..."
```

内容面板使用：

```text
role="tabpanel"
data-ojtrace-panel="evaluation|source"
```

切换必须同时更新：

- `aria-selected`；
- `tabIndex`；
- `data-active`；
- `hidden`；
- 明确的 `display` 状态。

评测信息是默认面板。源代码只有用户点击“源代码”后显示，两个面板不能同时占据布局空间。

### 8.4 源代码安全与布局

- 源代码继续用 `textContent` 写入 `<pre>`，不能使用 `innerHTML`。
- 长代码使用滚动容器，不撑破卡片宽度。
- 测试点详情无数据时显示明确的“原站未提供”状态。
- 详情页窄窗口时改为单列，头像、用户信息和统计字段不发生挤压。

## 9. 主题策略

主题只从当前洛谷页面继承，不进入长期存储。

进入详情时只记录必要的页面状态：

- 当前真实文档 URL；
- 当前页面标题；
- 当前滚动位置；
- 详情根节点所在的稳定宿主。

不复制主题变量作为主要机制。若某个洛谷组件确实需要 CSS 变量，读取当前计算值并写入扩展根节点的局部变量，但必须有明确的变量 allowlist和降级值。

主题验收必须包含：

- 默认主题；
- 自定义背景图；
- 卡片透明度和模糊；
- 深色或高对比主题；
- 刷新详情；
- 后退到列表；
- 前进回详情。

## 10. 参考插件的取舍

### 10.1 GenGen-RMJ：采用的经验

- 使用路由 key 和 generation 防止旧异步流程污染新页面。
- 集中管理 timer 和销毁逻辑。
- 记录合并使用 Submission ID，而不是依赖数组位置。
- 页面加载阶段提供明确的 loading 状态。
- 主题读取允许等待和重试。

GenGen-RMJ 的公开说明确认了本地页面自动填充、等待验证和记录轮询的产品路径：[ScriptCat 页面](https://scriptcat.org/en/script-show-page/5099)。

### 10.2 GenGen-RMJ：明确不采用的实现

- 整个 `document.documentElement` 替换。
- 远程模板下载后重新执行脚本。
- 广泛的 `GM_xmlhttpRequest` 和任意连接权限。
- 手工读取、拼接或提交 Cloudflare/CSRF token。
- 将源码、主题和账号状态长期写入用户脚本存储。
- 固定目标 OJ 语言 ID。
- 依赖高频轮询维持页面一致性。

GenGen 自己的说明也指出本地高权限方案带来更高风险和更低稳定性；这部分应作为边界提醒，而不是作为 OJTrace 的实现目标。[洛谷专栏说明](https://www.luogu.com/article/1pli1kc2)

### 10.3 Luogu-Better：采用的工程经验

- 将 SPA 观察、等待工具、存储配置和功能模块分开。
- 通过统一的生命周期入口管理模块启停。
- 让功能开关和样式作用域集中处理。

Luogu-Better 的源码目录把 `spa`、`storage`、`config`、`ui` 和功能模块分开，适合借鉴其组织方式，但不复制其与 OJTrace 无关的功能。[源码结构](https://github.com/Luogu-Plugins/Luogu-Better)

## 11. 测试计划

### 11.1 纯模块测试

- hash 路由解析、构造、长度限制和非法字符拒绝；
- `recordKey` 生成、排序和去重；
- generation 变化后旧异步结果被丢弃；
- 列表 reconcile 的新增、更新、删除和排序；
- 详情标签状态机；
- 主题变量 allowlist 和降级值；
- 用户名、头像、认证标识缺失时的可用降级。

### 11.2 DOM 测试

新增以下场景：

1. 原生列表延迟出现，扩展最终只保留一个外部容器。
2. 同一响应触发两次 render，DOM 只出现一行。
3. 缓存响应晚于刷新响应到达，旧状态不能覆盖新状态。
4. Vue 删除扩展根节点后，扩展可以重新挂载且不产生第二份。
5. 详情刷新后只存在一个详情根节点。
6. 后退时详情根节点、标题和主题修改全部清理。
7. 评测信息默认可见，源代码默认不可见；点击和键盘操作均只显示一个面板。
8. 头像在无 scoped CSS、存在全局 `.avatar` CSS 和窄窗口下都保持尺寸。
9. 源代码中的 HTML、脚本和 CSS 文本只作为文本显示。

### 11.3 浏览器验收矩阵

| 浏览器 | 主题   | 流程                             | 必须通过                           |
| ------ | ------ | -------------------------------- | ---------------------------------- |
| Chrome | 默认   | 列表→详情→刷新→后退→前进         | 无 404、无重复、只有一个详情根节点 |
| Chrome | 自定义 | 列表→详情→切换源代码→刷新        | 主题、标签和面板状态正确           |
| Edge   | 默认   | 列表→详情→后退→再次进入          | 旧请求不回写、记录不重复           |
| Edge   | 自定义 | 列表异步加载、Vue 重绘、窗口缩放 | 主题和布局保持                     |

验收时打开 DevTools 记录：

```js
location.href;
document.querySelectorAll("[data-ojtrace-luogu-record-page]").length;
document.querySelectorAll("[data-ojtrace-record-key]").length;
document.querySelectorAll(".row").length;
document.querySelector('[data-ojtrace-panel="source"]')?.hidden;
getComputedStyle(document.querySelector('[data-ojtrace-panel="source"]'))
  .display;
```

## 12. 实施顺序与发布门禁

实施顺序固定为：

1. 记录当前工作区和构建产物基线，不先修 CSS。
2. 完成 hash 路由和硬刷新测试。
3. 完成列表单一容器与幂等 reconcile。
4. 完成详情单根节点和取消/清理机制。
5. 完成主题、头像和 tab UI。
6. 补齐单测、DOM 测试和浏览器矩阵。
7. 重新构建并运行全部门禁。

交付前必须运行：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm audit:architecture
pnpm audit:manifest
```

浏览器只加载全新生成的 `.output/chrome-mv3`。扩展重新加载后，必须手动刷新洛谷标签页再验证。

## 13. 可靠性、可维护性、可拓展性和原生性自审查

### 13.1 可靠性

- **通过**：真实列表壳、hash 路由、单根节点、generation、取消和幂等 reconcile 能覆盖刷新、后退、前进、Vue 重绘和异步竞态。
- **剩余风险**：洛谷可能改变列表宿主或主题 DOM。计划要求使用稳定结构、有限等待、诊断属性和浏览器矩阵，不把一次成功选择器当作永久合同。
- **禁止回退**：不能因为某次选择器失效就重新启用伪 `/record/cf` 路由、整页替换或无界轮询。

### 13.2 可维护性

- **通过**：路由、生命周期、列表 reconcile、详情呈现和身份显示分开；每个模块只有一个方向的依赖。
- **剩余风险**：洛谷 scoped CSS 的可复用程度有限。计划把尺寸和交互样式收回扩展自己的命名空间，减少对 `data-v-*` 的依赖。
- **维护要求**：每次洛谷页面结构变化必须同步更新研究记录、DOM fixture、浏览器矩阵和失败降级说明。

### 13.3 可拓展性

- **通过**：`recordKey`、路由解析和详情模型已经包含 `oj`；Codeforces 与 AtCoder 共享渲染壳，站点差异留在后台数据解析。
- **边界**：不能提前抽象成通用 OJ 页面注册系统。只有第二个真实页面布局出现重复合同后，才提取共享接口。
- **扩展方式**：新增 OJ 只需提供严格校验后的详情模型、原始详情链接、问题标识和测试点数据，不应新增一套页面接管机制。

### 13.4 原生一致性

- **通过**：使用洛谷真实 `/record/list` 壳、原生导航区域、原生主题继承、原生链接行为和原生用户上下文。
- **限制**：外部记录不是洛谷服务器记录，必须在 DOM 和文案中保持可识别的 OJTrace 来源，不能伪装成洛谷已认证的原生记录。
- **视觉策略**：复用洛谷卡片、颜色变量和排版语义；头像、tab、间距和响应式布局使用扩展自己的稳定 CSS，避免复制内部 Vue 组件实现。

### 13.5 最终审计结论

该计划在不引入后端、不扩大数据边界、不依赖整页替换的前提下，能够解决截图中的四类问题，并为后续 OJ 记录详情扩展保留边界。实现前必须先完成真实浏览器复现；没有通过“刷新、后退、Vue 重绘、主题切换、单面板显示”五项验证，不得宣称记录页重构完成。
