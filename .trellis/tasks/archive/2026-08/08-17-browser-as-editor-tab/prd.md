# PRD — Browser 作为编辑器 Tab（+ 号新增 Browser 选项，新建 Browser tab 而非 dock panel）

## Goal

在编辑器 TabBar 右上角的「+」动作菜单中新增 **New Browser** 选项。点击后**在编辑器 TabBar 中新建一个 Browser tab 卡**（复用现有悬浮 webview 渲染机制），而不是打开右侧 Dock 的 browser panel。支持同一项目内多个独立的 Browser tab（每个 tab 独立导航/历史/页面状态）。

## Background / 背景

- 现状 Browser 是右侧 Dock panel（`dock/registry.ts` 的 `browser` 面板），每项目一个 webview（label=`neeko-browser-{projectId}`），状态在 `useProjectBrowserStore.states[projectId]`。
- 用户希望浏览器作为「编辑器 tab」使用：`+` → New Browser → 在内容区打开一个浏览器标签页，可与终端/文件 tab 并列、可拖拽/分栏/pin。

## Requirements

- R1 **+ 号入口**：编辑器 TabBar 右上角「+」打开的动作菜单新增 **New Browser** 项（带 Globe 图标），点击后在当前 tabKey 新建一个 `kind:'browser'` 的 Tab 并激活。
- R2 **独立多 tab**：同一项目可开多个 Browser tab，每个 tab 拥有独立的 webview、URL、历史栈（canGoBack/Forward）、title/favicon、加载状态；切换 tab 不触发重新导航（无闪白、页面状态不丢）。
- R3 **渲染位置**：Browser tab 内容渲染在编辑器内容区（`PaneContent`），支持 left/right 分栏与 pinned 面板（容器 rect 自动跟随）。
- R4 **可见性协调**：同一时刻只显示「当前激活且当前项目」的 Browser tab webview；切到非 Browser tab / 切项目时隐藏相关 webview；激活时恢复并同步 bounds。
- R5 **完整浏览器能力**：地址栏导航、刷新、后退/前进、打开 DevTools、外部浏览器打开、元素选择器（picker→agent CLI）、页面 title/favicon 展示，与现有 panel 能力对齐。
- R6 **关闭清理**：关闭 Browser tab（X / Cmd+W / 关全部）时销毁对应 webview 并清理 per-tab 状态。
- R7 **资源控制**：非激活 Browser tab 采用懒创建（只存 URL，激活时才建 webview）；纳入闲置回收策略；webview 数量设上限。
- R8 **面板并存**：右侧 Dock 的 browser panel 保留并可继续使用（panel 与 tab 长期并存）；`openHtmlInBrowserPanel`、AgentSelector 'browser' 模式等旧入口行为不变。
- R9 **+ 按钮始终显示**：TabBar「+」按钮不再以 `terminalTabCount < 10` 为显示条件，改为始终显示（New Terminal / New Browser 等随时可达）。

## Constraints / 约束

- Tauri 2 child webview 是 OS 级表面，永远悬浮在主 React webview 之上，**不能嵌入 DOM**——Browser tab 内容区是「DOM 占位容器 + 按容器 rect 定位的悬浮 webview」。
- Browser tab 状态**不持久化**（与现有 tabs 一致）：重启后不恢复。
- 事件（URL-changed / page-loaded / page-meta / open-url / prompt-submitted / git-changed / file-changed）按 webview label 过滤——多 tab 必须用 per-tab label。
- 遵循 TDD（Red-Green-Refactor）与 AGENTS.md 的导入防火墙、OCP、单一职责原则。

## Acceptance Criteria

- [ ] `+` 菜单出现 **New Browser**；点击后在当前编辑器 TabBar 新建 Browser tab 并激活，内容区显示浏览器（地址栏 + 页面）。
- [ ] 同一项目可开 ≥2 个 Browser tab，各自独立导航；tab 间来回切换不重新加载页面、URL/后退/前进各自正确。
- [ ] Browser tab 激活时 webview 定位/尺寸与内容区一致（含分栏 right 面板、pinned 面板），无偏移、无遮挡内容区之外的 TabBar/Toolbar。
- [ ] 切到非 Browser tab → 该 Browser webview 隐藏；切回 → 恢复显示且位置正确；切项目 → 上一项目所有 Browser webview 隐藏。
- [ ] 关闭 Browser tab → webview 销毁、per-tab 状态清除、不残留；Cmd+W / 关全部 / 关项目 tabs 同效。
- [ ] 非激活 Browser tab 不常驻 webview（懒创建）；闲置回收后重新激活能按存储 URL 重建并导航。
- [ ] 元素选择器：在 Browser tab 内 picker 选中元素提交 prompt → 正确路由到当前 agent CLI tab（按 Browser tab 定位）。
- [ ] 浮层（`+` 下拉、tab context menu、toast、确认对话框等）打开时不被 Browser webview 遮挡（z-order 专项生效）。
- [ ] 旧 dock browser panel 及其入口（AgentSelector 'browser'、openHtmlInBrowserPanel、terminalLinks/consoleLinks/lspHover 的 navigateTo）行为不回归。
- [ ] `pnpm test:run`、`pnpm type-check`、`pnpm lint`、`cargo test` 全部通过；新增功能均有测试覆盖。

## Notes / 已确认决策

- **路线 A（已确认）**：每 tab 独立 webview（label=`neeko-browser-tab-{tabId}`）+ 独立 per-tab store；拒绝"共享一个 webview 切换时重新导航"。
- **旧 panel（已确认）**：panel 与 tab 长期并存，`useProjectBrowserStore` 保留，新增 `useBrowserTabsStore`。
- **+ 按钮（已确认）**：始终显示，不再受 terminal 数量门控。
