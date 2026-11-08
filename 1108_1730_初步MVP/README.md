# Electron Custom Shell

轻量 Electron 基础浏览器 MVP。使用预编译 Electron 运行时，不需要本机编译 Chromium；应用仍包含 Electron 自带的 Chromium。

## 开发环境

- Node.js 24
- npm

## 开发

```sh
npm install
npm run check
npm test
npm start
```

应用界面从 `src/index.html` 加载，网页标签由主进程管理的 `WebContentsView` 承载。主进程逻辑位于 `src/main.js`，受限的桌面接口位于 `src/preload.js`。

## MVP 功能

- 标签创建、切换、关闭；网页弹窗在新标签中打开。
- 地址栏支持网址和 DuckDuckGo 搜索；提供前进、后退和刷新。
- 书签、最近 1,000 条历史记录及当前运行期间的下载列表。
- macOS 常用快捷键。
- 浏览器数据保存在 Electron 用户数据目录的 `browser-data.json` 中。

网页不启用 Node.js 集成，使用上下文隔离和沙箱；仅允许 HTTP(S) 页面导航，并默认拒绝网页权限请求。

## 当前边界

MVP 首轮在 macOS Intel 开发机验证。扩展、同步、无痕模式、跨平台发行包、签名和自动更新尚未包含。
