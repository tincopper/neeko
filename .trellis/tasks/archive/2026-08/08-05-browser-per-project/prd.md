# 浏览器跟随项目隔离

## Goal

当前所有打开的项目共用一个浏览器页面，需要实现浏览器按项目隔离，切换项目时自动展示该项目对应的浏览器页面。

## What I already know

* 用户反馈：当前打开项目都是共用一个浏览器页面
* 期望：浏览器跟随项目，每个项目有独立的浏览器上下文

## Open Questions (resolved)

* ~~当前浏览器页面的生命周期管理方式？~~ → 单 webview + 全局 store，硬编码 label
* ~~隔离粒度~~ → 完整页面状态，每个项目独立 webview（show/hide 切换）
* ~~URL 持久化~~ → 仅当前会话，内存中，不持久化到磁盘
* ~~初始 URL~~ → 无默认行为，只有用户主动操作时才导航
* ~~Label 格式~~ → `neeko-browser-{projectId}`

## Requirements

* [x] 每个项目拥有独立的浏览器 webview（完整页面状态保留）
* [x] 切换项目时隐藏旧 webview、显示新 webview
* [ ] 应用重启后恢复浏览器 URL（明确不做）

## Acceptance Criteria

* [x] 打开项目 A 访问 URL_X，切换到项目 B（新 URL_Y），再切回项目 A 时展示 URL_X **且保持滚动位置+表单状态**
* [x] 多个项目之间浏览器 webview 物理隔离，互不可见
* [x] 浏览器 UI 与当前项目指示器一致
* [x] 内存占用可控：活跃项目的 webview 持有渲染资源，非活跃项目仅隐藏

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / type-check / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Decision (ADR-lite)

**Context**: 浏览器当前所有项目共用一个 webview，用户需要浏览器跟随项目隔离
**Decision**:
- 隔离级别：每个项目独立 webview（完整页面状态保留）
- 生命周期：show/hide 切换，不销毁重建
- 初始 URL：无默认行为
- Label 格式：`neeko-browser-{projectId}`
- URL 持久化：仅当前会话（内存中）
**Consequences**:
- 优点：切换回项目后保留滚动位置、表单输入、JS 状态
- 缺点：内存占用随打开项目数线性增长
- 与全局单 store 架构冲突，需引入项目级状态

## Out of Scope (explicit)

* 应用重启后恢复浏览器 URL
* 浏览器 cookie/storage 持久化（跨会话）
* 浏览器内容搜索
* 多 tab 浏览器

## Technical Notes

* 后端 Rust 已按 `label` 参数化：`create_browser_webview`、`browser_navigate`、`browser_set_bounds`、`browser_close`、`browser_set_visible` 等都接受 `label` 参数
* 前端当前硬编码 `BROWSER_WEBVIEW_LABEL = 'neeko-browser-panel'` 单实例 + 全局 `useBrowserStore`
* 项目切换通过 `useProjectStore.getState().activeProjectId` 获取
* 需要在项目切换时：隐藏旧项目 webview → 创建/显示新项目 webview
