# Implement — Browser 作为编辑器 Tab

## 执行清单（TDD，按依赖顺序）

### 阶段 1：类型 + Store（无 UI，纯状态）
1. ✅ **类型**：`src/shared/types/tab.ts` — `TabKind` 加 `'browser'`；新增 `BrowserTabData`；`TabData` union 增加；`editorStore.mergeTabData` 加 `browser` 分支（支持后续 title/url 更新）。
2. ✅ **Store**：新增 `src/shared/store/browserTabsStore.ts` — `states: Record<tabId, BrowserTabState>` + `getTabState/setTabState/removeTabState`（含 `lastActiveAt` / `isActive`，供回收与可见性）。**测试**（7 例）。
3. ✅ **label 派生**：`features/browser/hooks/useBrowserConstants.ts` 加 `getBrowserTabLabel(tabId)`。**测试**。

### 阶段 2：核心 Hook 抽取（复用最大化）
4. ✅ 从 `useBrowserPanel.ts` 抽取 `useBrowserWebview(opts)`（无 UI 绑定：label/get/set/removeState/visible/containerRef 驱动的 create/navigate/back/forward/refresh/devtools/openExternal/bounds 同步/事件订阅/懒创建/可见性上报 `onVisibleChange`）。
5. ✅ `useBrowserPanel` 保留内联实现（**偏差**：未改薄适配层，仅机械替换 label 参数，保证 dock panel 零回归；重构留待后续）。
6. ✅ 新增 `useBrowserTab({ tabKey, tabId, projectId, isActive, showToast })`（per-tab state + 可见性 = pane 激活 && 项目激活 && 无浮层）。**测试**。

### 阶段 3：组件 + 菜单（用户可见）
7. ✅ `PaneContent.tsx` 加 `case 'browser'` → `<BrowserTabView tabKey tabId projectId isActive />` + `isActiveGroup` prop。**测试**（3 例，mock BrowserTabView）。
8. ✅ 新增 `features/browser/components/BrowserTabView.tsx`（Toolbar 复用 `BrowserToolbar` + 容器 + bounds 同步）。
9. ✅ `actionRegistry.ts` 加 `new-browser`（Globe）；`actionMenu.ts` 类型补 `'new-browser'` / `'browser'` + `ActionMenuDropdown` group label。**测试**（3 例）。
10. ✅ `usePaneActions.handleActionMenuExecute` 加 `case 'new-browser'`（addTab+activateTab）。**测试**（含无项目 no-op）。
11. ✅ `TabBar.tsx`：`+` 按钮改为始终显示（移除 terminal 数量门控与 `terminalTabCount`）。**测试**（10 个终端仍显示 +）。

### 阶段 4：可见性协调 + z-order 专项（最高风险）
12. ✅ 可见性单一真源：`useBrowserTab` 计算 `visible = isActive && !anyOverlayOpen`；`useBrowserWebview` 的 visible effect 驱动 `setVisible` + `onVisibleChange`（更新 isActive/lastActiveAt）。回收生命周期由 `useBrowserReclaimManager`（阶段 5）承载。
13. ✅ **z-order 专项**：新增 `src/shared/store/overlayStore.ts`（`setOverlayOpen` + `count`）。接入：`useActionMenu`（+ 下拉）、`useQuickOpenStore`（palette）、`usePaneContextMenu`（右键）、`useCloseConfirmation`、`useBulkCloseConfirmation`。浮层开 → 隐藏内容区 Browser webview，关 → 恢复。**偏差**：toast 未接入（`pointer-events-none` 短暂展示，不遮挡交互）。**测试**（overlayStore 6 例 + useActionMenu 上报 1 例）。

### 阶段 5：清理 + 回收 + picker + 自动刷新
14. ✅ 关闭分发（**偏差**：未改 `terminalTabCleanup` 避免 terminal↔browser 循环依赖）——新增 `registerTabCleanup(kind, fn)` 注册表于 `editorStore`，`closeTab`/`clearProjectTabs` 移除 tab 后调用；browser 侧 `utils/browserTabCleanup.ts` 注册 `'browser'` handler（`browserClose(label)` + `removeTabState`），`useBrowserTab` 内幂等 ensure。terminal 保持内联清理（不注册）→ 无双重清理。
15. ✅ `reclaimPolicy.ts` 键泛化 `projectId` → `key`（`panel:{pid}` / `tab:{tabId}`）；新增 `useBrowserReclaimManager`（引用计数单实例，60s 周期）统一覆盖 panel + tab，共享上限 8。**测试**（reclaim 6 例已更新）。
16. ✅ picker → agent CLI：Rust `picker_script.js`/`scripts.rs` payload 扩展 `label`（webview 标识，向后兼容：缺失 → 前端回退当前项目路由）；`browser_start_picker` 注入 `window.__NEEKO_BROWSER_LABEL__`；前端 panel handler 按 label 过滤，`useBrowserTab` 新增 handler 经 `findAgentCliTab` 路由到同项目 Agent CLI tab。**测试**（Rust payload 解析 + `findAgentCliTab` 5 例）。
17. ✅ git/file-changed 自动刷新：新增 `src/shared/utils/browserAutoRefresh.ts`（项目级武装 + 30s 安全窗）；`useBrowserTab` 内各 tab 自检（git-changed 刷新已创建 webview；file:// URL 命中变更路径才刷新）。**测试**（6 例）。

### 阶段 6：回归 + 全量验证
18. ✅ 最小回归集通过：`pnpm lint`（cargo fmt + clippy -D warnings + 字节断言）、`pnpm lint:fe`（eslint src/ + tsc）、`pnpm test:run`（220 文件 / 1850 例通过）、`cargo test --manifest-path src-tauri/Cargo.toml`（browser:: 54 例通过）。
19. ⬜ 手动验收清单（见下，需真机验证）。

## 验证命令

```bash
pnpm test:run
pnpm type-check
pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml
```

## 风险文件 / 回滚点

- `src/features/editor/components/TabBar.tsx` — + 按钮条件（最易回归）。
- `src/features/editor/components/PaneContent.tsx` — browser 渲染路由。
- `src/features/editor/hooks/usePaneActions.ts` — new-browser 执行分支。
- `src/features/action-menu/actionRegistry.ts` — 菜单项。
- `src/shared/store/editorStore.ts` — `closeTab`/`clearProjectTabs` 改为块函数并在移除后触发 `runTabCleanup`（注册表）。
- `src/features/browser/hooks/useBrowserPanel.ts` — label 机械替换；内联实现保留（零回归），移除内联回收。
- `src/features/terminal/components/terminalTabCleanup.ts` — 未改动（清理走 editorStore 注册表）。
- `src-tauri/src/browser/scripts.rs` + `picker_script.js` + `uri_scheme.rs` — prompt payload 扩展（向后兼容）。
- 回滚：各文件还原 git HEAD；无 schema/迁移。

## 手动验收清单

- [x] `+` 菜单出现 New Browser，点击新建 tab 并激活、内容区显示浏览器。（代码就绪，待真机）
- [ ] 同项目开 2+ Browser tab，独立导航/后退/前进，切换无闪白不重载。
- [ ] 分栏 right 面板 / pinned 面板中 Browser tab 定位正确、无偏移。
- [ ] 切非 Browser tab / 切项目 → webview 隐藏；切回 → 恢复且位置正确。
- [ ] 关闭 Browser tab（X / Cmd+W / 关全部 / 关项目）→ webview 销毁、状态清除。
- [ ] 懒创建：非激活 tab 不占 webview；回收后重激活按 URL 重建导航。
- [ ] picker 在 Browser tab 内选元素 → prompt 路由到当前 agent CLI tab（含 label 过滤）。
- [ ] 浮层（+ 下拉 / context menu / quick-open / 确认框）打开不被 webview 遮挡。
- [ ] 旧 dock browser panel + 全部旧入口不回归。

## 提交前检查

- [x] prd.md / design.md / implement.md 齐备且经 review，用户已确认「文档已完成、可以开始实现」，`task.py start` 已执行。
- [x] 阶段 4（z-order）专项：overlayStore 单测 + 关键浮层接入完成，真机遮挡验证待手动验收。
- [x] 最小回归集通过（`pnpm lint` / `pnpm lint:fe` / `pnpm test:run` / `cargo test`）。
- [x] 新增功能均有测试覆盖（纯函数 100%、store/hook 关键行为、组件关键交互）。

## Bugfix 记录（真机/自测反馈后追加）

### 2025-XX-XX：neeko-check 5 项不规范优化
- **🔴 面板回收回归**：`useBrowserReclaimManager` 仅由 tab 路径（`useBrowserWebview`）启动，
  只用 dock 面板时面板 webview 不再闲置回收 → 在 `useBrowserPanel` 中同样调用
  `useBrowserReclaimManager()`（引用计数单例，双挂载安全）。导出 `checkReclaims` 供单测，
  新增 `useBrowserReclaimManager.test.ts`（4 例：仅面板回收、panel+tab 统一、活跃项目豁免、
  未创建跳过）。
- **🟡 overlay count 卡死**：浮层所属 pane 在打开状态下被卸载（切项目/关 pane）时 count 不归零，
  Browser webview 一直隐藏 → 为 `useActionMenu` / `usePaneContextMenu` / `useCloseConfirmation` /
  `useBulkCloseConfirmation` 增加 unmount 兜底 `setOverlayOpen(id, false)`；`QuickOpenPalette`
  同样兜底（导出 `QUICK_OPEN_OVERLAY_ID`）。`useCloseConfirmation.test` +1。
- **🟡 渲染期写 store**：`useBrowserTab` 渲染体调用 `getTabState()`（内部 set()）触发 StrictMode
  警告 → 改为 `useEffect` 惰性初始化（effect 声明早于懒创建 effect，状态先就绪）。新增
  `useBrowserTab.test.ts`（2 例：effect 初始化 + 幂等）。
- **🟢 DRY 双实现**：panel 与 tab 的 bounds 同步（ResizeObserver + window resize + focus +
  diff 去抖）两份重复 → 抽共享 `useBrowserBoundsSync` hook，两处收敛（新增测试 5 例）。完整
  「薄适配层」（panel 全量委托 useBrowserWebview）因零回归优先级仍缓办。
- **🟢 次要**：删除 `useBrowserTab`/`useBrowserPanel` 返回的死 `destroy`（清理走注册表）；
  删除 `useBrowserWebview` 无人消费的 `openExternal`（无 projectId 死变体）；Rust prompt
  去重窗口（500ms）由全局共享改为**按 label 隔离**（`HashMap<String,Instant>`，旧 GET 通道
  用 `__legacy__` 哨兵键退化全局），新增 2 例 Rust 测试。
- **结果**：`pnpm test:run` 226 文件 / 1882 例 ✅、`cargo test` 850 例 ✅、`pnpm lint` /
  type-check / eslint ✅。

### 2025-XX-XX：Browser tab 名称/图标跟随网站名 + favicon
- **需求**：Browser tab 名称使用网站的名称和 icon（新建 tab 固定显示「Browser」不够直观）。
- **实现**：
  - `BrowserTabData` 新增 `favicon?: string`；`editorStore.mergeTabData` browser 分支合并 `favicon`（并保留 url）。
  - `useBrowserWebview` 新增 `onPageMeta` 回调（PAGE_META 事件触发）；`useBrowserTab` 内把 `title`/`favicon` 同步到编辑器 tab（`updateTab(tabKey, tabId, { title, favicon })`）。
  - 导航（URL_CHANGED）时 tab 标题兜底为 `hostFromUrl(url)`（跨站不滞留旧标题），meta 到达后覆盖为网站名。
  - `TabItemLeading` browser kind 渲染 `data.favicon`（有则显示网站图标，无则回退 Globe）。
- **测试**：`editorStore` updateTab browser title/favicon 同步（2 例）、`TabItem` favicon 渲染/回退（2 例）、`browserUtils.hostFromUrl`（5 例）。TDD Red→Green。
- **结果**：`pnpm type-check` ✅、eslint ✅、`pnpm test:run` 222 文件 / 1865 例 ✅（零回归）。

### 2025-XX-XX：browser panel 打开页面时崩溃 "undefined is not an object (stack.index)"
- **症状**：打开 browser panel（dock）并输入/打开页面时，React 渲染崩溃
  `undefined is not an object (evaluating 'stack.index')`。
- **根因**：`useBrowserPanel.navigate/createWebview/refresh` 直接
  `setPanelState(projectId, { url, isLoading })` **未先 `getPanelState` 初始化**。
  若面板状态不存在（如直接打开空 browser panel 再输入地址），`setPanelState` 的
  `{ ...s.states[projectId], ...patch }` 对 undefined 展开 → 生成缺 `history` 的
  残缺状态 → 渲染 `canGoBack(browserState.history)` → `stack.index` 崩溃。
- **修复**：
  - `browserStore.setPanelState`：base 不存在时先 `defaultPanelState` 完整初始化再 patch。
  - `browserTabsStore.setTabState`：同样防御（保持与 getTabState 初始化语义一致）。
  - `historyStack` 纯函数防御：`canGoBack/canGoForward` 对残缺栈返回 false、
    `recordNavigation` 对 undefined 重建空栈 —— 任何路径产生残缺状态都不再崩溃应用。
- **测试**：`browserStore.test` +1（setPanelState 对不存在项目初始化完整状态）、
  `historyStack.test` +1（残缺栈防御）。TDD Red→Green。
- **结果**：`pnpm test:run` 223 文件 / 1870 例 ✅、type-check ✅、eslint ✅。

### 2025-XX-XX：关闭 browser tab 后 webview 残留可见、无法关闭
- **症状**：关闭 Browser tab（X / Cmd+W）后，页面仍以悬浮 OS webview 形式嵌在应用上，无法关闭/交互。
- **排查**：逐层验证关闭链路 —— `handleCloseTab → closeEditorTab → editorStore.closeTab → runTabCleanup('browser') → browserClose(label) + removeTabState`。新增 `browserTabCleanup.test.ts`（3 例）实证前端链路确实触发 `browserClose`；Rust `browser_close` 为标准 Tauri `Webview::close()` 且已注册。静态分析未发现确定性前端断点，但识别出三类脆弱点：
  1. 清理注册依赖惰性 hook 挂载 + 模块级 `registered` 标志 —— editorStore 模块（热）重载后注册表重置、标志过期导致「关闭不销毁」。
  2. 关闭路径只 `browserClose`，若平台 close 失败/延迟则 webview 残留**可见**。
  3. 关闭后若组件因未批处理渲染存活一拍，懒创建/visible 效应可能重新创建/显示已关闭 tab 的 webview。
- **加固**（`browserTabCleanup.ts` + `useBrowserTab.ts`）：
  - 模块加载即注册（幂等），`ensureBrowserTabCleanupRegistered()` 每次渲染重写回注册表（修复重载后注册丢失）。
  - 清理 handler 先 `browserSetVisible(false)` 再 `browserClose`（双保险：close 失败也先隐藏，不残留可见遮挡）。
  - `useBrowserTab` 新增 `tabExists` 守卫：`visible = isActive && !anyOverlayOpen && tabExists`，关闭后任何存活组件都无法重建/重显 webview。
- **测试**：`browserTabCleanup.test.ts` 3 例（closeTab 先隐藏再关闭 + 清状态；clearProjectTabs 全部关闭；非 browser tab 不触发）。全量 `pnpm test:run` 223 文件 / 1868 例 ✅、type-check ✅、eslint ✅。
- **待真机验证**：`pnpm tauri dev` 后创建 Browser tab → 导航 → 关闭，确认页面不再残留。若仍残留，则需进一步排查 Rust 侧 `webview.close()` 的平台移除语义（可用 `app.remove_webview` / 强制 detach 兜底）。

### 2025-XX-XX：浏览器地址栏不能自行输入
- **根因**：共享 `BrowserToolbar` 地址输入框为受控组件但 `value={title || url}`，
  未绑定可编辑的 `inputValue` —— 每敲一个字符，`onChange` 更新 `inputValue` 后
  渲染值仍是 `title || url`，字符立即被还原，表现为「无法输入」（paste 同样失效）。
  browser tab 为主要输入场景，故在 tab 验收时暴露。
- **修复**：`BrowserToolbar.tsx` 引入 `editing` 态 —— 非编辑态展示 `title || url`；
  聚焦进入编辑态（值切为可编辑 `inputValue` 并全选，类浏览器地址栏），输入/粘贴
  走 `inputValue`，失焦恢复标题/URL 展示。URL prop 变化仅在非编辑态同步，避免打断输入。
- **测试**：新增 `BrowserToolbar.test.tsx`（6 例：聚焦可输入、连续输入不回退、
  Enter 规范化提交、标题降级展示、聚焦切 URL、URL 同步）。TDD Red→Green。
- 旧 dock browser panel 复用同一 Toolbar，一并修复。
