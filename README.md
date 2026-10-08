<h1 align="center">OJTrace · 题迹</h1>

<p align="center">
  <img src="./public/icons/ojtrace-128.png" alt="OJTrace Logo" width="128" height="128" />
</p>

<p align="center">
  <a href="https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3">
    <img src="https://img.shields.io/badge/Manifest-V3-2f6feb" alt="Manifest V3" />
  </a>
  <a href="https://developer.chrome.com/docs/extensions/">
    <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-supported-5b8def" alt="Chrome / Edge" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" />
  </a>
</p>

> 跨 OJ 聚合提交轨迹，让赛后复盘更简单。

OJTrace 是一个 Chrome / Edge 扩展，将多个在线评测系统（OJ）的提交记录汇总为时间线，方便做题回顾和训练复盘。

## 为什么做 OJTrace

做题记录分散在多个 OJ。复盘时需要分别打开各站的提交历史，再对照题目和提交时间，很难快速还原一段时间内做过哪些题、经历了怎样的提交过程。

OJTrace 将这些记录按时间统一整理，方便每日回顾、比赛或训练后的复盘，也便于将题目和提交链接整理到学习笔记。

## 核心功能

- 跨 OJ 统一时间线，按提交时间回顾做题过程。
- 按 OJ、日期时间和结果（Accepted / Unaccepted）筛选。
- 在“全部提交”和“每题最后一次”之间切换。
- 管理多个账号，自定义同步账号和采集范围（最近 35 天内）。
- 跳转到原题或提交记录，复制单条记录的复盘 Markdown。

## 支持的 OJ

| OJ         | 添加账号方式                                          | 备注                                         |
| ---------- | ----------------------------------------------------- | -------------------------------------------- |
| Codeforces | 输入用户名、使用浏览器登录态或手动配置 Cookie         | 输入用户名时无需登录                         |
| 洛谷       | 使用浏览器登录态或手动配置 Cookie                     | 需要登录                                     |
| AtCoder    | 使用浏览器登录态或手动配置 Cookie                     | 需要登录；提交列表依赖 AtCoder Problems      |
| HydroOJ    | 填写实例或域地址，使用浏览器登录态、Cookie 或账号密码 | 支持自部署实例及所选域的普通、比赛、作业提交 |
| QOJ        | 使用浏览器登录态或手动配置 Cookie                     | 需要登录，可能受站点访问限制影响             |

数据来源和站点适配细节见 [docs/research/](./docs/research/)。

### 同步范围与请求节奏

采集默认最近 7 天，允许选择最近 35 天内的闭区间 `[开始时间, 结束时间]`。后台冻结两端，范围外记录不进入本轮结果、不占记录额度、不请求单条详情；已缓存的范围外记录由独立的保留策略管理。

倒序列表会经过晚于结束时间的定位页，跨过可靠的开始时间边界后停止；无法证明页序时使用尾页或预算结束。每个 origin 的第一张列表页立即入队，后续列表页（包括其他账号、活动的第一页）按同源串行请求，并按该 OJ 的配置额外等待，默认 1500ms ± 500ms。设置页可调整基础间隔（1.5–600 秒）和随机浮动（上限与基础间隔上限共用 600 秒，0 表示关闭），均以 0.1 秒递增，基础间隔减去浮动不得小于 1 秒。本轮同步冻结配置，保存或恢复默认从下一轮同步生效。Hydro 所有实例使用同一组设置，同站不同账号和域仍共享 origin 队列。单账号任务时限为 15 分钟（900 秒，包含等待），间隔较大时可能返回部分完成。

HTTP 429 立即建立该 origin 的冷却，支持 Retry-After；手动同步不能绕过节奏和冷却。非敏感冷却状态保存在 `storage.session`，用于 service worker 重启恢复；浏览器会话结束后不保证保留。间隔设置保存在 `storage.local`，浏览器重启后继续有效；旧数据和损坏的可选配置逐来源回退默认，不影响已有账号和记录。

| 来源       | 当前采集限制                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codeforces | 单次最近最多 1000 条；未到达目标窗口或被额度截断时报告部分完成                                                                                        |
| 洛谷       | 最多 100 页；使用 count/perPage、已验证倒序边界或尾部停止，缺少可靠分页证据时报告部分完成                                                             |
| QOJ        | 最多 100 页；使用 HTML 下一页和已验证倒序边界停止，重复页及时停止                                                                                     |
| HydroOJ    | 普通记录与用户参加活动共用最多 100 张逻辑列表页、1000 条唯一记录；最多 50 个活动，每活动最多 5 页，未访问活动计入覆盖缺口                             |
| AtCoder    | AtCoder Problems 每批最多 500 条，按时间游标读取所选范围；空批/短批或越过结束时间即完成，同秒游标停滞/额度/限流时报告部分结果；仅对入选唯一记录补详情 |

添加账号只验证身份并保存配置，不自动采集记录；需要在时间线点击“同步”开始采集。重新授权保留原来的启用选择和已有记录。页面区分完整、部分、覆盖未知和错误，只有完整采集更新最近成功时间。详情或品牌补全失败独立提示。本轮自动检查与真实浏览器验收状态见 [浏览器矩阵](./docs/qa/browser-matrix.md)，Chrome/Edge 新同步行为仍待人工验证。

## 安装

当前采用源码构建、加载已解压扩展的方式安装。构建需要 Node.js 24 或更高版本，以及 pnpm 11.x。

```bash
git clone https://github.com/hardyz0517/OJTrace.git
cd OJTrace
pnpm install --frozen-lockfile
pnpm build
```

1. 构建完成后，打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择仓库下的 `.output/chrome-mv3` 目录。

## 快速使用

1. 点击扩展图标打开 Timeline，进入设置页添加账号。
2. 选择 OJ 和添加方式，按提示登录或填写凭证，并授予站点访问权限；HydroOJ 可填写根地址或 `http://106.55.100.251/d/student/` 这样的域地址。
3. 回到 Timeline，选择同步账号和采集范围，点击“同步”。
4. 筛选并浏览记录，点击原题或提交链接，或复制复盘 Markdown。

每个 Hydro 绑定只采集所填地址对应的域，不自动枚举其他域。需要多个域时分别添加，账号、记录和图标缓存独立；同网站仍共用登录会话与限流。实例名字可手动填写，图标从所选域首页读取。

## 隐私与权限

OJTrace 采用本地优先存储：账号配置、提交记录和手动填写的凭证保存在当前浏览器，可在设置中清除。项目没有后端账号系统。

扩展不会向开发者服务器上传 Cookie、密码、提交记录或代码。数据请求只发往已连接的 OJ 或 AtCoder Problems（`kenkoooo.com`）公开数据服务；登录凭证仅用于对应 OJ 的认证。

| 权限             | 用途                                |
| ---------------- | ----------------------------------- |
| `storage`        | 保存本地数据                        |
| `tabs`           | 打开或聚焦 OJTrace 页面             |
| `cookies`        | 在需要登录态的 OJ 上处理对应 Cookie |
| host permissions | 访问对应 OJ 和所需的公开数据服务    |

站点授权范围和 Cookie 处理细节见 [隐私说明](./docs/privacy.md)。

## 开发

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

### 检查与构建

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm format:check
pnpm build
pnpm audit:manifest
```

生产构建产物位于 `.output/chrome-mv3`。发布前的自动门禁和 Chrome / Edge 手测要求见 [release checklist](./docs/qa/release-checklist.md)。

## License

This project is licensed under the [MIT License](./LICENSE).
