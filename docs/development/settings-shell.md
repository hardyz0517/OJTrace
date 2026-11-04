# Settings Shell 审计与重构

日期：2026-10-19。

## 改造前的实际结构

- `entrypoints/settings/main.tsx` 同时负责 GET_STATE、storage 监听、账号列表与删除、数据清理与确认弹窗，并纵向嵌入 AccountForm、PaginationSettings、CNOI 跳转卡片。
- AccountForm / useAccountAuthorization 已独立承载五站账号认证、权限请求、浏览器会话检测、Hydro 实例与域、手动凭据及授权成功后的保存，不需要业务重写。
- PaginationSettings 已按 OJ 分行管理草稿、输入校验、提交与恢复默认；保存通过 UPDATE_PAGINATION_POLICY，在后台事务中仅更新对应 OJ。
- CNOI 原为独立 WXT HTML 入口。CnoiRulesPage 重复渲染 AppHeader、外框与返回链接；useRulesWorkspace、RuleConfigurationPanel、ConversionPreviewPanel 已具备可直接复用的完整业务状态和规则编辑能力。
- 两页通过后台消息及 `ojtrace:data` 的 storage 事件同步，不直接通信。项目没有 React Router；顶层导航在独立扩展 HTML 页面之间切换。
- 账号、提交、同步状态、偏好数据共用后台 storage 单写入口；GET_STATE 返回去除凭据的 PublicStoredData。账号授权立即保存；采集按行显式保存，恢复默认立即保存；CNOI 恢复默认只修改草稿，显式保存才生效，保留版本与并发基线检查。
- CNOI 原有 beforeunload 草稿保护；账号与采集表单没有统一离页保护。原页面卸载即丢失未保存的表单状态。
- syncAccountIds 与 syncRange 是时间线的操作状态，仍留在时间线；retentionPerAccount 与 freshnessCooldownMs 目前没有设置控件，本次不添加新功能或占位项。

## 现在的页面组织

唯一设置入口为 `settings.html`，继续复用 AppHeader 的时间线 / 设置 / GitHub 主导航：

| 组 | 独立模块 | 稳定地址 |
| --- | --- | --- |
| 账号与同步 | AccountsSettings，复用原 AccountForm | `settings.html#accounts` |
| 账号与同步 | PaginationSettings | `settings.html#collection` |
| 题面工具 | CnoiRulesSettings | `settings.html#cnoi` |
| 数据与隐私 | LocalDataSettings | `settings.html#data` |

- SettingsShell 只负责布局、侧栏、页面标题、未保存标记及离页保护，不直接访问业务存储。
- settings-navigation 使用原生 hashchange 与历史记录，切换独立内容模块；不通过锚点滚动模拟分区。无效分区规范化为 accounts，规范化使用 replaceState，不增加无意义历史记录。
- SettingsApp 按需挂载已访问模块，随后通过 hidden 切换可见性；不卸载已访问表单、各 OJ 草稿或 CodeMirror 文档。账号凭据和自定义测试 Source 仅留在当前标签页内存，不另行持久化草稿。
- useSettingsData 保留 GET_STATE 的异步序号保护和 storage 监听，提供共享只读快照。各模块继续调用原后台命令；没有新增存储格式、并行存储入口或转换逻辑。
- 账号与采集模块向 Shell 报告草稿及保存中状态；CNOI 报告所有 OJ 的草稿及保存中状态。切换分区不弹确认且保留草稿；关闭、刷新、跳到其他文档时使用 beforeunload 保护。用户确认离开后，未保存草稿不会跨刷新保留。
- CNOI 工作台迁至 `entrypoints/settings/cnoi/`；删除旧 HTML、启动代码、独立容器、返回链接及跳转卡片，仅维护一套规则 UI。旧 `cnoi-rules.html` 地址不再构建。
- 顶部点击当前设置页保留分区；从 popup / background 打开设置时，忽略已有设置标签页的 hash 进行匹配，只聚焦，不覆盖其导航状态与草稿。
- 常规模块最大宽度 1000px（含内边距），侧栏 220px，可收起至 62px；CNOI 占满右侧剩余宽度。工作区使用容器查询，避免窗口宽度足够但扣除侧栏后内容仍拥挤。窄窗口导航移至上方，可收起；最窄窗口 Source/CNOI 改为单列。

## 验证

- 新增 settings-shell UI 测试：独立模块、深链接、未知地址、前进后退、刷新、账号与采集草稿跨区保留、账号授权/删除、采集保存、CNOI OJ 与 Source 状态保留、真实转换预览、规则保存/恢复默认、离页保护、三类清理确认、保留偏好边界、侧栏收起。
- 新增扩展页面导航测试：聚焦含 hash 的已有设置页、不错误匹配同名前缀页、无匹配时创建唯一设置入口。
- 原账号授权、采集 UI / 集成、CNOI UI / 应用层 / 五站 fixture / 并发测试保留并通过。
- 完整测试：1054 通过，1 跳过；typecheck、lint、format:check、audit:architecture、build、audit:manifest 全部通过。
- 浏览器通过本地隔离测试页加载实际 React 设置页面，CNOI 使用实际后台规则服务与 Transformer，采集保存使用实际事务更新函数。验证 1440×1000、720×1000、390×844，分区/后退/刷新、草稿、采集与规则保存、恢复默认、自定义 Source 转换、OJ 下拉、侧栏收起及宽度。1440px 下侧栏实测 220px，CNOI 模块使用右侧全部 1163px。
- 浏览器验收未操作真实扩展的账号凭据或用户数据；真实站点登录及权限弹窗未重新操作。构建保留第三方模块的 use client 及大 chunk 提示，无新增依赖。
