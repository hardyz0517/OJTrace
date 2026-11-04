# CNOI 转换规则管理

实现日期：2026-10-19。

设置页侧栏的「题面工具 → CNOI 转换规则」切换至 `settings.html#cnoi` 工作区。左侧编辑规则，右侧通过真实后台转换用例比较 Source 与 CNOI Markdown，不启动 PDF 编译器。

## 规则与边界

- `src/domain/cnoi-rules.ts`：可序列化合同、运行时校验、最小覆盖和规范比较。用户匹配只接受完整标题和单个 `{number}` 编号占位符，没有用户正则、JS、DOM 选择器或脚本模板。
- `src/problem/cnoi/rules/config.ts`：五站独立默认配置、稳定规则 ID、解析与校验。默认对象深度冻结；公共匹配和本站匹配形成本站默认目录。
- `src/problem/cnoi/transform.ts`：建立临时标题树，以父角色和祖先角色识别章节，再改变 AST。未知标题和说明是祖先遍历边界。引用、代码和其他正文容器不作为主章节重新分类。
- `src/problem/cnoi/convert.ts`：唯一完整 Source → AST → CNOI Markdown 用例。
- `src/application/cnoi-rules/`：读取、事务保存、草稿预览和消息合同。
- `entrypoints/settings/cnoi/`：页面、OJ 草稿、内置案例、差异及诊断。

优先级为：自定义匹配 100；用户显式修改内置角色或上下文 80；内置带样例前缀 50、样例包装 40、父样例内裸 Input/Output 30、解释 20、普通格式 10、编号组 5。同一优先级命中不同角色时保留该子树并给出冲突提示。禁用规则直接退出匹配；不同规则的重叠匹配仍是独立规则。

排序只支持背景、描述、输入、输出、样例、提示六类主章节，在安全连续区间内稳定排序，不跨未知标题或重复格式标题，不独立排序输入输出样例。样例包装删除只移除已确认的结构标题，正文块原样保留；含链接、公式等内容的标题不删除。层级无法保留嵌套关系时返回原结构及诊断。

编号仅支持保留、继承明确父组编号。继承要求父组有编号且直接子章节中恰有一个输入和一个输出。已有不连续、字母、罗马编号不被覆盖；冲突和多组结构不猜测配对。模板支持 `{number}`、`{numberSuffix}`。标题文案分别按 zh/en/ja 生效，other 保留原文。

## 状态与存储

`ojtrace:data.preferences.cnoiRules = { formatVersion: 1, bySource: { [oj]: { defaultsVersion: 1, overrides } } }`。

缺少属性继承默认，显式 `false` 禁用。保存会删除与默认相同的字段和空覆盖，恢复默认删除本站条目。只由后台 `StoragePort.transact` 写入，不覆盖其他设置。提交时在事务内比较本站原覆盖，其他 OJ 和无关设置的并发变化不造成冲突。同站冲突保留草稿，用户可读取最新基线后重新应用。损坏或不支持版本的配置按站隔离并展示提示，不清空整库。

规则草稿与测试题面是页面内状态，切换 OJ 保留各自草稿，未保存时阻止无提示离开。恢复默认先改草稿，保存后影响新任务。预览防抖 250ms，输入法组合期间暂停；过期响应不覆盖当前结果。

后台消息为 `GET_CNOI_RULES`、`UPDATE_CNOI_RULES`、`PREVIEW_CNOI_CONVERSION`。UI 只导入配置合同和消息客户端，架构审计继续禁止 UI 运行时导入 Transformer、Adapter 或 Registry。

## 正式转换任务

`ProblemExportService.start` 在任务开始时读取并复制规则快照，快照随短期导出任务存储。直接导出和编辑初始化都由 `prepareCnoiProblem` 使用此快照调用唯一转换用例。任务快照丢失会提示重新发起，不能悄悄使用新配置。后台重启后的任务使用已持久化的快照。

Source 复制不读取配置。编辑器接收初始 CNOI 后继续只解析当前用户 Markdown，不监听规则配置重新转换。结构提示不会阻止正常导出；直接下载成功时如有提示，popup 保留诊断及已有编辑入口。

## 内置案例来源

内置案例同时包含聚焦结构边界的回归案例与 P5665、ABC391 G、QOJ 1907、Hydro tree 完整 Source 存档。完整存档与 `tests/problem/fixtures/` 中对应来源逐字校验。Codeforces 1A 的英文正文取自已有 `docs/fixtures/problem/luogu-bank-codeforces.html` 中保存的英文原文，按 Codeforces Input/Output/Examples 标题上下文组成固定测试输入；它不是本轮重新抓取的 Codeforces 页面。生产代码不导入测试目录。

## 首版不支持

任意正则或 JS、任意 AST 查询与变换、按代码块位置猜测样例配对、自动连续重编号、改写正文中的样例引用、跨 OJ 共享配置、配置文件导入导出、PDF 视觉样式设置。大型输入的差异计算有上限，超过上限降级为前后公共区间比较，全文仍完整显示和转换。
