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
</p>

> 跨 OJ 聚合提交轨迹，让赛后复盘更简单。

OJTrace 是一个 Chrome / Edge 扩展，将多个在线评测系统（OJ）的提交记录汇总为时间线，方便做题回顾和训练复盘。

## 为什么做 OJTrace

做题记录分散在多个 OJ。复盘时需要分别打开各站的 Submission History，再对照题目和提交时间，很难快速还原一段时间内做过哪些题、经历了怎样的提交过程。

OJTrace 将这些记录按时间统一整理，方便每日回顾、比赛或训练后的复盘，也便于将题目和提交链接整理到学习笔记。

## 核心功能

- 跨 OJ 统一时间线，按提交时间回顾做题过程。
- 按 OJ、日期时间和结果（Accepted / Unaccepted）筛选。
- 在“全部提交”和“每题最后一次”之间切换。
- 管理多个账号，自定义同步账号和采集范围（最近 35 天内）。
- 跳转到原题或提交记录，复制单条记录的复盘 Markdown。

## 支持的 OJ

| OJ         | 状态      | 添加账号方式                                      | 备注                                    |
| ---------- | --------- | ------------------------------------------------- | --------------------------------------- |
| Codeforces | ✅ 可用   | 输入用户名、使用浏览器登录态或手动配置 Cookie     | 输入用户名时无需登录                    |
| 洛谷       | ✅ 可用   | 使用浏览器登录态或手动配置 Cookie                 | 需要登录                                |
| AtCoder    | ✅ 可用   | 使用浏览器登录态或手动配置 Cookie                 | 需要登录；提交列表依赖 AtCoder Problems |
| HydroOJ    | ✅ 可用   | 填写实例地址，使用浏览器登录态、Cookie 或账号密码 | 支持自部署实例及普通、比赛、作业提交    |
| QOJ        | 🧪 实验性 | 使用浏览器登录态或手动配置 Cookie                 | 需要登录，可能受站点访问限制影响        |

数据来源和站点适配细节见 [docs/research/](./docs/research/)。

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
2. 选择 OJ 和添加方式，按提示登录或填写凭证，并授予站点访问权限；HydroOJ 需填写实例地址。
3. 回到 Timeline，选择同步账号和采集范围，点击“同步”。
4. 筛选并浏览记录，点击原题或提交链接，或复制复盘 Markdown。

## 隐私与权限

OJTrace 采用本地优先（local-first）存储：账号配置、提交记录和手动填写的凭证保存在当前浏览器，可在设置中清除。项目没有后端账号系统。

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

[MIT](./LICENSE)
