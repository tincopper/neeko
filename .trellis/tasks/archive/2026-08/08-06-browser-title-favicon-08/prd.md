# 页面标题/favicon 同步(P3)

## Goal

地址栏与面板当前仅显示 URL,补充页面标题与 favicon 展示,提升可读性。

## Requirements

* 后端 `on_page_load` Finished 后,通过 `webview.eval` 提取 `document.title` 与 favicon URL(或利用页面加载完成时机)
* 事件 payload 扩展或新增事件,携带 `{ label, url, title, favicon }`
* 前端 BrowserToolbar 地址栏/面板显示标题(URL 过长时可省略),favicon 渲染
* 无 title/favicon 的页面优雅降级为 URL

## Acceptance Criteria

* [ ] 加载页面后地址栏区域显示标题 + favicon(如有)
* [ ] 无 title 页面(如 file:// 预览)降级显示 URL
* [ ] `pnpm type-check` + `pnpm test:run` 通过

## Out of Scope

* 标签页模型(多 tab)
* 站点图标缓存策略
