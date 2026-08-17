# Design — Browser 作为编辑器 Tab

## 问题与目标

现有 Browser 是右侧 Dock panel（每项目一个 webview，`neeko-browser-{projectId}`）。目标：`+` 菜单新增 New Browser，在编辑器 TabBar 新建 `kind:'browser'` 的 Tab，多 tab 独立、与旧 panel 并存。

## 第一性原理与核心约束

1. **渲染面约束**：Tauri 2 child webview 是 OS 级窗口表面，恒在主 React webview 之上，不能嵌入 DOM。→ Browser tab 内容 = 「DOM 占位容器 + 按容器 rect 定位的悬浮 webview」。现有 panel 已攻克 bounds 全链路同步，本设计同构复用。
2. **可见性约束**：同一区域同时只有一个可见悬浮 webview 有意义。→ 核心原语是可见性开关：同一时刻只 show「当前激活且当前项目」的 Browser webview，其余 hide。
3. **状态归属约束**：tab 语义 = 独立状态单元。→ 每个 Browser tab 独立 webview + 独立 state（已确认路线 A），拒绝"共享 webview + 切换时重新导航"（会闪白、丢页面状态、无法隔离历史栈）。

## 架构与边界

### 数据模型

```ts
// shared/types/tab.ts
type TabKind = ... | 'browser';
interface BrowserTabData { kind: 'browser'; url: string; }   // title 放 Tab.title
// TabData union += BrowserTabData
```

```ts
// 新增 shared/store/browserTabsStore.ts（独立文件，遵循 store 目录直导）
interface BrowserTabState {
  label: string;            // neeko-browser-tab-{tabId}
  url: string;
  isCreated: boolean;
  isLoading: boolean;
  history: HistoryStack;
  title: string;
  favicon: string;
  lastActiveAt: number;
}
useBrowserTabsStore: {
  states: Record<tabId, BrowserTabState>;
  getTabState / setTabState / removeTabState;
}
```

label 派生：`getBrowserTabLabel(tabId) = 'neeko-browser-tab-' + tabId`（放 `features/browser/hooks/useBrowserConstants.ts`，与 `getProjectBrowserLabel` 并存）。

### Hook 分层（复用最大化）

1. **核心 hook** `useBrowserWebview(opts)`（新增，无 UI 绑定）：
   `{ label, getState, setState, removeState, visible, containerRef }` → 封装 create/navigate/back/forward/refresh/openDevTools/openExternal/bounds 同步/事件订阅（按 label 过滤）/自动刷新（git/file-changed）/懒创建/reclaim 上报。
   来源：从现有 `useBrowserPanel.ts` 抽离业务逻辑（其 696 行中大部分与项目耦合的是：projectId→label、states[projectId]、dock 可见性）。
2. **`useBrowserPanel`（现有）**：改为薄适配层 —— projectId→label、dock 可见性（`zones.right`）→ `useBrowserWebview`。行为不回归。
3. **`useBrowserTab`（新增）**：`{ tabKey, tabId, projectId }` → tabId→label、per-tab state、可见性 = 「该 tab 是当前 pane 激活 tab && 项目激活」→ `useBrowserWebview`。

### 组件层

- `PaneContent` 增加 `case 'browser'` → `<BrowserTabView tabKey tabId projectId showToast />`。
- `BrowserTabView`（新增，≈ BrowserPanel）：Toolbar（复用现有 `BrowserToolbar`）+ 容器 div（`flex-1`，即 containerRef）+ bounds 同步。容器 rect 由 `getBoundingClientRect()` 给出，分栏/pinned 天然跟随（复用现有 ResizeObserver/rAF 逻辑）。
- 旧 `BrowserPanel` 保持不动（dock 挂载）。

### 菜单层（+ → New Browser）

- `actionRegistry.ts`：新增 `{ id:'new-browser', group:'browser', label:'New Browser', icon: Globe, keywords:['browser','web','internet'] }`。
- `actionMenu.ts`：`ActionId += 'new-browser'`；`ActionGroup += 'browser'`。
- `usePaneActions.handleActionMenuExecute`：`case 'new-browser'` → `addTab(tabKey, { id:'tab_'+uuid, projectId, title:'Browser', order: tabs.length, data:{ kind:'browser', url:'' } })` + `activateTab`。
- `TabBar.tsx`：`+` 按钮显示条件由 `terminalTabCount < 10 && (onAddTerminalTab || onActionMenuOpen)` 改为 `onActionMenuOpen || onAddTerminalTab`（始终显示）。

### 可见性协调（最关键）

新增 **`BrowserVisibilityManager`**（store action 或 hook，单一真源）：
- 输入：所有 browser webview（panel + tabs）的「应可见」集合。
- 计算：激活的 Browser tab → visible；其余 Browser tab → hidden；非 Browser tab 激活 → 该项目全部 Browser tab hidden；项目切换 → 旧项目全部 hidden；旧 panel 保持 dock 语义（`expanded && activePanelId==='browser'`）。
- 输出：与当前真实可见性 diff 后，逐个 `browserSetVisible(label, v)`。
- 订阅源：`useEditorStore`（activeTabId / tabs）+ `useProjectStore`（activeProjectId）+ `useDockStore`（zones.right）。收敛现状 `useBrowserPanel` 内零散的 `setVisible` 调用。

**z-order 专项（排期重点）**：Browser tab 激活时 OS webview 覆盖整个内容区，会盖住内容区内的 DOM 浮层（`+` 下拉、tab context menu、quick-open、toast、确认对话框、补全弹层）。机制：全局「浮层打开状态」集合 → 任一浮层打开 → VisibilityManager 对当前可见的 Browser webview 执行 `hide`；浮层全关 → 恢复。需枚举现有关浮层入口（ActionMenuDropdown、ContextMenu、QuickOpen palette、CloseConfirm/BulkCloseConfirm、toast）并在其 open 状态上挂接。

### 事件与自动刷新

- 事件已按 label 过滤，per-tab label 直接复用；`useBrowserWebview` 内事件订阅参数化 label。
- `BROWSER_PROMPT_SUBMITTED_EVENT`（picker→agent CLI）：picker 注入时需带上 Browser tab 标识 → 小改 Rust `picker_script.js`（payload 增加 tabId/选择器上下文）+ `scripts.rs` 脚本构造；前端按 tabId 路由到对应 tab 的 URL 与当前激活的 agent CLI tab。
- git/file-changed 自动刷新：从「按 projectId 单 URL」改为「遍历该项目所有 Browser tab 的 URL 匹配」。

### 关闭清理

- `terminalTabCleanup.ts` 的 `closeEditorTab` 目前是 terminal 专用。扩展为按 `tab.data.kind` 分发：browser → `browserClose(getBrowserTabLabel(tabId))` + `useBrowserTabsStore.removeTabState(tabId)` + `closeTab`。
- `closeAllEditorTabs` / `beforeunload` / 切项目：遍历该项目所有 Browser tab 执行 `browserClose`。

### 回收策略

- `reclaimPolicy.ts`：`WebviewUsage` 键从 projectId 泛化为通用 key（projectId | tabId 均可），决策逻辑不变（已有测试可复用扩展）。
- Browser tab 上限（如 8~12）在创建侧（`new-browser` handler / store addTab）门控；懒创建 + 闲置回收控峰值。激活 Browser tab 时若有 URL 但 `isCreated=false` → 重建 webview 并导航（复用现有"有 URL 未创建 → navigate 时创建"逻辑）。

## 数据流

```
用户点「+」→ ActionMenuDropdown 点 New Browser
  → usePaneActions 'new-browser': addTab(tabKey, browser tab) + activateTab
    → editorStore 更新 → PaneContent case 'browser' → BrowserTabView mount
      → useBrowserTab 读取 per-tab store；VisibilityManager 判定应可见
        → BrowserTabView 容器 rect → useBrowserWebview.createWebview（懒创建）
          → Rust create_browser_webview(label=tab, ...) → OS webview 悬浮于内容区
切 tab / 切项目 → VisibilityManager diff → browserSetVisible(label, v)
关闭 tab → closeEditorTab 分发 → browserClose(label) + removeTabState + closeTab
```

## 兼容性与迁移

- 旧 panel：`useProjectBrowserStore`、`useBrowserPanel`、dock `browser` 面板、`openHtmlInBrowserPanel`、AgentSelector 'browser' 模式、`terminalLinks`/`consoleLinks`/`lspHover` 的 `navigateTo` 全部**不改**（零回归）。
- Rust 端：仅 `picker_script.js`/`scripts.rs` 的 prompt-submitted payload 扩展（向后兼容：无 tabId 字段时回退为"当前激活 Browser tab"）。
- 无持久化/迁移：tabs 本就是运行时状态。

## 风险与权衡

- **R1（z-order 悬浮覆盖，最高）**：Browser tab 激活时盖住内容区内 DOM 浮层。缓解：全局浮层状态 → 浮层开则 hide webview；作为独立里程碑验证（见 implement）。
- **R2（多 webview 资源）**：每 tab 一个 webview + panel webview，OS 表面数量增多，需实测 macOS/Linux 多 child webview 稳定性/聚焦。缓解：懒创建 + 数量上限 + 闲置回收。
- **R3（picker 多 tab）**：picker 注入按 webview 生效，切 tab 需 stop 前一个 picker。缓解：picker 状态按 label 维护，`useBrowserWebview` 内按激活切换。
- **R4（bounds 覆盖内容区之外的控件）**：webview 必须严格 = 内容区 rect；TabBar/Toolbar 在内容区上方不重叠，依赖现有 bounds 全链路（ResizeObserver/rAF/focus）不回归。
- **R5（回收/关闭竞态）**：关闭与回收、切项目并发调 `browserClose`/`removeTabState` 需幂等（Rust 端 `browser_close` 已幂等，前端 remove 需容错不存在）。

## 回滚

- 各文件均可独立还原到 git HEAD；无 schema/迁移。
- 高优先级回滚点：`TabBar.tsx`（+ 按钮条件）、`actionRegistry.ts`/`usePaneActions.ts`（菜单）、`PaneContent.tsx`（渲染路由）、`terminalTabCleanup.ts`（关闭分发）、`useBrowserPanel.ts`（重构后行为回归，若抽 hook 造成回归需整体还原该文件）。
