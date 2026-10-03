# OJTrace · 题迹

![OJTrace Logo](./public/icons/ojtrace-128.png)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2f6feb)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Chrome / Edge](https://img.shields.io/badge/Chrome%20%2F%20Edge-supported-5b8def)](https://developer.chrome.com/docs/extensions/)

> 跨 OJ 聚合提交轨迹，让赛后复盘更简单。

OJTrace 是一个面向 Chrome 和 Edge 的 Chromium Manifest V3 扩展。它把多个在线评测系统（OJ）的提交记录整理到一条本地时间线上，帮助你快速回顾做题记录，提高复盘效率。

## 为什么做 OJTrace

竞赛选手往往会同时使用 Codeforces、洛谷、AtCoder、HydroOJ、QOJ 等平台。单独查看一个 OJ 的提交历史并不困难，真正耗时的是查看分散在不同网站的记录。如果要整理复盘则需要打开很多页面比较混乱繁琐。

OJTrace 把这些提交记录重新放回同一条时间线。你可以按日期、OJ 和结果筛选，直接打开原题或提交记录继续复盘，亦可以直接复制 Markdown 的题目链接和提交记录。

### 适用场景

#### 做题复盘

一段时间在多个 OJ 上做题后，按真实提交时间回顾解题过程。

#### 整理学习笔记

对单条记录复制复盘 Markdown。可用链接会被保留为类似下面的格式：

```md
[题号 题名](problemUrl) [(code)](submissionUrl)
```

## 核心功能

- 聚合 Codeforces、洛谷、AtCoder、HydroOJ 和 QOJ 的提交记录；
- 按 OJ、日期时间范围、Accepted / Unaccepted 筛选；
- 在全部提交和“每题最后一次”之间切换；
- 管理多个 OJ 账号，并选择本次要同步的账号；
- 手动选择采集时间范围（当前最多回看 35 天）；
- 点击记录跳转到原题、提交详情或 HydroOJ 活动页面；
- 复制单条记录的复盘 Markdown；
- 本地优先存储；某个来源暂时失败时保留已有缓存并展示诊断信息；
- 支持 Chrome 和 Edge 的 Chromium Manifest V3 扩展。

## 支持


| OJ         | 状态      | 数据来源 / 认证方式                                                              | 备注                                       |
| ---------- | --------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Codeforces | ✅ 可用   | 官方 `user.status` API；公开用户名、浏览器会话或手动 `JSESSIONID`                | 公开用户名模式不要求登录                   |
| 洛谷       | ✅ 可用   | `record/list`；浏览器会话或手动配置 `__client_id` 与 `_uid`                      | 需要洛谷登录态                             |
| AtCoder    | ✅ 可用   | AtCoder 账号身份页 + AtCoder Problems 公共提交 API；浏览器会话或 `REVEL_SESSION` | 提交列表依赖 `kenkoooo.com`                |
| HydroOJ    | ✅ 可用   | 用户输入并校验后的精确实例 origin；浏览器会话、`sid` / `sid.sig` 或账号密码      | 支持普通提交、比赛和作业活动               |
| QOJ        | 🧪 实验性 | `qoj.ac` 的 UOJ 风格 HTML 提交列表；浏览器会话或手动 Cookie                      | 需要登录；可能受 Cloudflare 和页面变更影响 |

## 安装

当前仓库还没有商店版或可引用的 Release 下载包，推荐从源码构建安装。

### 从源码构建

环境要求：

- Node.js 24 或更高版本；
- pnpm 11.x。

```bash
git clone https://github.com/hardyz0517/OJTrace.git
cd OJTrace
pnpm install --frozen-lockfile
pnpm build
```

构建完成后：

1. 打开 `chrome://extensions`，或在 Edge 中打开 `edge://extensions`；
2. 开启“开发者模式”；
3. 选择“加载已解压的扩展程序”；
4. 选择构建产物目录 `.output/chrome-mv3`。

开发时可以使用 `pnpm dev`，WXT 会生成开发构建。

## 快速使用

1. 点击扩展图标打开 Timeline；首次使用时进入设置页添加账号。
2. 选择 OJ 和认证方式。浏览器会话模式需要先在对应 OJ 登录；HydroOJ 还需要填写实例地址。
3. 按提示授予对应站点的 host permission。
4. 选择要同步的账号和采集时间范围，点击“同步”。
5. 在 Timeline 中按 OJ、时间和结果筛选；点击记录打开原站，或复制复盘 Markdown。

每个 OJ 的数据来源和登录态差异见 [隐私说明](./docs/privacy.md) 及 `docs/research/` 中的站点记录。

## 隐私与权限

OJTrace 是 local-first 扩展：没有 OJTrace 后端账号系统，账号配置、提交记录、同步状态、站点品牌、筛选偏好和用户主动填写的凭证都保存在当前浏览器的 `chrome.storage.local` 中。扩展不会把完整 Cookie、密码、提交记录或代码上传到开发者服务器；请求仍会直接发送到对应 OJ，或 AtCoder 的公开提交数据服务。

认证相关行为如下：

- 浏览器会话模式使用浏览器已有的 OJ 登录态；
- 手动 Cookie 和 HydroOJ 密码只在用户主动填写后保存为本地凭证；
- 需要 Cookie fallback 时，扩展只读取来源限定的 Cookie，并在请求期间临时注入，完成后恢复或删除；
- AtCoder 的 `REVEL_SESSION` 不会发送到 `kenkoooo.com`；
- QOJ 可能临时复用同域的登录或 Cloudflare 通行 Cookie，但不会保存或上传这些值；
- 设置页可以分别清除账号、提交记录或全部本地数据。

扩展声明的权限及用途：

- `storage`：保存本地状态和凭证；
- `tabs`：打开或聚焦 Timeline；
- `cookies`：读取来源限定的认证 Cookie，或临时注入用户主动提供的 Cookie；
- host permissions：访问已连接的 OJ。QOJ 使用固定的 `https://qoj.ac/*`；Codeforces、洛谷、AtCoder 和 AtCoder Problems 通过可选权限按需申请；HydroOJ 按用户输入并通过校验的精确实例 origin 申请。

HydroOJ 的 Chrome 兼容方案需要在 manifest 中声明 HTTP/HTTPS 通配 host pattern，才能申请运行时权限；实际请求仍经过精确 origin 校验，不会请求 `<all_urls>`，也不使用 `webRequest`。更详细的边界和数据处理见 [docs/privacy.md](./docs/privacy.md) 与 [权限研究记录](./docs/research/permission-matrix.md)。

## 开发

### 环境要求

- Node.js 24 或更高版本；
- pnpm 11.x。

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

### 检查与构建

以下命令直接对应仓库当前的 package scripts：

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

`package.json` 当前声明许可证为 MIT；仓库根目录尚未提交独立的 `LICENSE` 文件。
