# Dock Placement · 执行计划

> 前置：prd.md 的 **D1–D5** 拍板 + design.md 复审通过 → 才能 `task.py start`。
> 本计划按 P0→P3 分四段，每段可独立发布、独立回滚。**每段内部先红后绿（TDD）。**

## 阶段总览

| 期 | 目标 | 触碰目录 | 风险 | 可独立发布 |
| --- | --- | --- | --- | --- |
| P0 | 图标落位可编辑 + 持久化 | `shared/dock`、`shared/store/dockStore`、`layout/dock-layout`、`app/dock`、`app/components` | 低（不碰 tab） | ✅ |
| P1 | 槽位 tab 宿主 + tab 停靠（菜单入口） | `shared/types/editorGroup`、`shared/store/editorStore+selectors`、`features/editor`、`features/dock-tabs`、`app/utils` | 中（编辑布局不变量） | ✅ |
| P2 | 种类级入口 + 快速打开 | `shared/dock/panelMeta`、`app/dock/registry`、`app/hooks`、`features/live-sessions`（只读复用） | 低（装配） | ✅ |
| P3a | 拖拽浮层 + 键盘焦点保持 + a11y 护栏 | `layout/dock-layout`、`app/components`、`app/hooks` | 低 | ✅ |
| ~~P3b~~ | ~~把 tab 拖到工具栏（需上提 `DndContext`）~~ | — | — | **取消**（收益<风险，理由见 P3 段） |

---

## P0 · 布局可编辑（需求 A 全闭环）

### P0-1 纯数据与纯函数（无 UI 依赖，先写完再动 store）

- [x] `src/shared/dock/types.ts`：`DockSlot`/`DOCK_SLOTS`/`isDockSlot`/`ViewKey`/`DockViewHost`/`DockViewActivation`/`DockViewMeta`/`DockPlacement`/`DockZoneRuntime`/`DockLayoutState`。保留 `MIN_ZONE_SIZE_PERCENT` 的原导出位置（`panelMeta.ts`）。
- [x] `src/shared/dock/viewKey.ts`：四个 mint + `isViewKey`。**不加** `parseViewKey`（查表裁定）。
- [x] `src/shared/dock/placement.ts`：`slotPlacements`/`slotViews`/`applyMove`/`applyActivate`/`applyToggle`/`applyOnBar`/`hasSlotViews`。
- [x] **先写** `src/shared/dock/__tests__/placement.test.ts` 覆盖 design.md §6 的七条行为规格 + 幂等 + 原引用返回。
  - 红：`pnpm vitest run src/shared/dock/__tests__/placement.test.ts`
- [x] 实现到绿；`placement.ts` 行覆盖 100%。

**校验**：`pnpm vitest run src/shared/dock/__tests__/placement.test.ts`

### P0-2 声明表迁移

- [x] `panelMeta.ts`：`DOCK_PANEL_META` → `DOCK_VIEW_META`（8 个 panel + `appView:library`；**P0 阶段先不加** tabHost/entry 行，见 design §13.2）。
- [x] `shared/dock/index.ts`：更新 re-export（同时导出 `types` 与 `viewKey` 的公开面）。
- [x] `app/dock/registry.ts`：`UI_BINDINGS` 的 key 换成 `panelView(...)`；`buildDockPanelRegistry()` 增加 `host !== 'none' → component 必填` 校验。
- [x] `app/dock/__tests__/registry.test.ts` 增补：每个 meta 视图都有绑定；缺绑定 throw（负例）。（放 dock 目录：`app/panels/` 是底部固定面板，无关）

**校验**：`pnpm vitest run src/app/dock src/app/panels`

### P0-3 dockStore v6

- [x] `createDefaultDockState()`（meta → placements + zones，按 `defaultOrder` 排序后归一化 `order`）。
- [x] mutators：`moveView`（meta 能力校验 + `applyMove`）、`activateView`、`toggleView`、`setViewOnBar`、`setViewSize`、`setSlotExpanded`、`setLeftSlotSize`、`enterCenterView`/`exitCenterView`（Library 互斥语义改为经 `setSlotExpanded` 表达）。
- [x] selectors：实际落 `placement.ts` 的 `slotPlacements` / `placementsInSlot` / `isViewVisible`（**不另起 store 选择器名**：同一事实起第二个名字正是本任务要消灭的形态）。
- [x] `migrateFromV5` + `sanitize`（纯函数，独立导出以便直测）。
- [x] persist：`version: 6` + `migrate` + `merge(sanitize)`。
- [x] **重写** `src/shared/store/__tests__/dockStore.test.ts`：既有 231 行用例按新字段语义等价改写（tab 视图切 appView、zone 展开、Library 互斥）+ 新增 G5/G6。
  - 注意：`vi.mock('../../dock/panelMeta')` 的 `mysteryTab` 负例（`openAs:'tab'` 但非合法 AppView）在新模型下对应「`activation.kind === 'appView'` 且 view 非法」——用同样思路构造负例，不要删掉这条防护。

**校验**：`pnpm vitest run src/shared/store/__tests__/dockStore.test.ts`

### P0-4 layout 消费（骨架仍零 registry 感知）

- [x] `DockZone.tsx`：由 `s.zones[zoneId].activeView` + registry 取组件；空态文案保留。
- [x] `DockLayout.tsx`：`rightVisible = hasSlotViews(state,'right') && expanded`；`activeView` 尺寸走 `viewSizes[view] ?? meta.defaultSlotSize ?? 18`（clamp `MIN_ZONE_SIZE_PERCENT`）+ `useZoneExpandCollapse` 不变；`handleLayoutChanged` 用 `setViewSize(activeView, …)`。
- [x] `DockBar.tsx`：加 droppable 容器（含空栏落点）+ 可排序列；保持 `role="toolbar"`。
- [x] `DockBarDnd.tsx`：两栏共用 `DndContext`；`onDragEnd` 只提取 `active.id` / `over.id` → `onMoveView(view, slot, index)`（spec §8）。
- [x] `DockLayout` 接受并透传 `onMoveView`（app 注入），**不 import** registry / store 之外的域。

**校验**：`pnpm vitest run src/layout`

### P0-5 app 装配与 a11y

- [x] `app/hooks/UseDockBarButtons.tsx`：按 placements 派生；`DockBarButton` 传 `activation`。
- [x] `app/components/DockBarButton.tsx`：`activation.kind` 分发（`toggleZone` / `appView`；`openTab` 在 P2 生效）；`Alt+←/→` 移到另一侧（调用同一个 `moveView`）；`aria-label` 带类型与「可拖动」提示。
- [x] `app/hooks/useDockBarMove.ts`（新增或并入 useDockBarButtons）：`onMoveView` 实现 + `meta.movable` 校验提示（`showToast` 说明不可移动）。
- [x] 单测：`UseDockBarButtons.test.tsx` 改写为按 placements 断言；`DockBarButton.test.tsx` 增补 activation 分发与 Alt+方向键。
- [x] `app/hooks/__tests__/useDockBarMove.test.ts`：跨栏 + 栏内重排 + 不可移动视图被拒。

**校验**：`pnpm vitest run src/app/components/__tests__/DockBarButton.test.tsx src/app/hooks`

### P0-6 回归与收尾

- [x] `pnpm check:quick`（**只在收尾跑一次**）。
- [x] 手工冒烟：双向换边 + 点图标开面板已真机通过；刷新/重启保持与坏 localStorage 由单测覆盖（`sanitize` / persist 水合），真机未逐项走。
- [x] `docs/layout-architecture.html`：③ 三层体系、④ 状态源、⑥ 扩展指南三节同步（`zones[].panels` 与 `barItems` 不再存在）。
      （④ 的 editorStore 行补 zone 级判据 / 左右 zone 卡片改「空宿主不占位」，⑤ 的注入规则补 `tabHostHasTabs`。）
- [x] spec 增补：`interaction-patterns.md` 加「跨两栏移动共用单一 DndContext」的偏差与理由（design §11）。

**回滚点 R-P0**：`dockStore` 版本号回 5 + revert 提交。P0 不触碰 tab，回滚无数据损失（v6 快照会被 v5 `merge` 忽略 → 用户需重设一次图标布局，可接受）。

---

## P1 · 槽位 tab 宿主 + 停靠（菜单入口）

### P1-1 布局不变量扩展（先红）

- [x] `shared/types/editorGroup.ts`：`EditorSplitLayout.docked: Record<DockSlot, EditorGroupState>`；`createDefaultEditorLayout()` 补默认值。
- [x] `editorTabSelectors.selectOrderedTabIds`：追加 `docked.left.tabIds` + `docked.right.tabIds`（design C5 扩展）。
- [x] **先写** `editorTabSelectors.test.ts` 新断言（G2：覆盖全量、无重复）+ `tabSurface.test.ts`（G1：center ∩ docked = ∅）。

**校验**：`pnpm vitest run src/shared/store/__tests__/editorTabSelectors.test.ts`（此时应红）

### P1-2 editorStore 原子移动

- [x] `editorStore.dockTab(tabKey, tabId, target: DockSlot | 'center')`：单次 `set` 内「从 groups.left/right/pinned/docked.* 全部移除 → 插入目标组」，并修复各组 `activeTabId`（design §7.2）。
- [x] 不做额外 hook 端口：菜单消费 app 注入的 `onMoveTabToSlot`（否则就是绕过 `tabSurface` 三步编排的第二个入口，评审门 G-b）。
- [x] `editorStore.test.ts` 增补：从中心 → dock、dock → 中心、dock → 另一 dock、pinned tab 被拒（R9 决策）。

**校验**：`pnpm vitest run src/shared/store/__tests__/editorStore.test.ts src/app/utils/__tests__/tabSurface.test.ts`（转绿）

### P1-3 宿主渲染（最大化复用）

- [x] `EditorGroupPane.tsx`：`groupId: EditorGroupId | 'pinned'` → `paneId: EditorGroupId | 'pinned' | 'dockLeft' | 'dockRight'`；新增 `chrome?: 'full' | 'dock'`（dock 下隐藏 ActionMenu / 分屏控件）。**全部调用点同一 diff 内改完**（中心 3 处 + 新宿主）。
- [x] `features/dock-tabs/hooks/useDockedPane.ts`：读 `editorLayout[tabKey].docked[slot]`，只返回 `{ tabs, activeTabId, activate }`（薄，不复制中心大对象）。
- [x] `features/dock-tabs/components/DockTabHost.tsx`：`slot` → `paneId`；无 `tabKey` → 空态；`chrome="dock"`。
- [x] `app/dock/wrappers/DockTabHostWrapper.tsx`：解析当前激活 workspace 的 `tabKey`（`useActiveWorkspaceKey` + `tabSpaceKeyOf`），无项目 → 空态。
- [x] `app/dock/registry.ts` + `panelMeta.ts`：补 `tabHost:left` / `tabHost:right`（`host:'tabHost'`、`movable:false`、`defaultOnBar` 按 D1）。
- [x] `dockStore` `defaultSlotSize` 与 `viewSizes` 支持 tabHost。
- [x] 单测：`DockTabHost.test.tsx`（有 docked tab → 渲染；清空 → 空态；无 tabKey → 空态；`chrome:'dock'` 不渲染分屏控件）。

**校验**：`pnpm vitest run src/features/dock-tabs src/features/editor`

### P1-4 入口（菜单/命令）

- [x] tab 右键菜单加「Move to Right Dock / Move to Left Dock / Move to Center」（`usePaneContextMenu`）。
- [x] 命令面板项（可选）：`View: Move Tab to Right Dock`。
- [x] `app/utils/tabSurface.ts`：`moveTabToSlot(tabKey, tabId, slot)` 三步编排（design §7.2），**顺序不可换**。
- [x] 单测：三步调用顺序 + 无 tabKey / 无目标宿主 → 返回 false 且不改状态。

**校验**：`pnpm vitest run src/app/utils src/features/editor`

### P1-5 回归与收尾

- [x] `pnpm check:quick`。
- [x] 冒烟：dock → 关 tab（dirty 确认）→ 切项目空态 → dock 回中心。
- [x] 回归既有 pin-then-open 路径（history: pin tab → 开侧面板 → handle 失效）。**这是 C2 的直接防线，必须手测。**
- [x] `docs/layout-architecture.html` ④ 增 `docked` 组说明。
      （④ 的 editorStore 行补 zone 级判据 / 左右 zone 卡片改「空宿主不占位」，⑤ 的注入规则补 `tabHostHasTabs`。）

**回滚点 R-P1**：`docked` 组默认空 → 宿主渲染空态；单独 revert P1 提交不影响 P0（P2 未上线时无入口指向它）。

---

## P2 · 种类级入口 + 快速打开（需求 C）

- [x] `panelMeta.ts`：`tabKind:agent-chat` / `tabKind:terminal`（`host:'none'`、`activation:{kind:'openTab'}`、`defaultSlot:'right'`、`defaultOnBar` 按 D1）。
- [x] `app/dock/registry.ts`：两个 entry 的 title/icon（无 component，走 `host:'none'` 免校验）。
- [x] `DockBarButton`：`activation.kind === 'openTab'` →
  - 已有该 kind 且属于当前 tabKey 的 tab → `activateTab`（若在 docked 组，同时 `activateView(host)`）；
  - 否则新建：agent-chat 走 `openAgentChatTab(workspace)`、terminal 走 `handleAgentClick` / `handleAddTerminalTab`；
  - 新 tab 落 `DOCK_VIEW_META[tabKindView(kind)].defaultSlot` 宿主（D3）。
- [x] 会话接回：点击入口时若 live-sessions 有对应会话，复用 `planSessionActivation`（**不新写状态机**）。
- [x] 单测：`DockBarButton` 的 `openTab` 分发三分支（已有/新建/无项目）；`tabKind` → 默认 slot 派生。

**校验**：`pnpm vitest run src/app/components/__tests__/DockBarButton.test.tsx src/features/live-sessions`

**回滚点 R-P2**：把两条 `tabKind` meta 行的 `defaultOnBar` 置 false（图标消失）或删除 meta 行（入口消失），不影响 P1 已停靠的 tab。

---

## P3 · 反馈与键盘可访问性（P3b 已取消）

> **P3b（把 tab 拖到工具栏）不做**，判断依据见下方「取消理由」。本节只交付 P3a。

### P3a（本次交付）

- [x] 工具栏图标拖拽的跟手预览：`useDockBarDnd`（可单测的 hook，与 `useEditorDnd` 同构）+ `DragOverlay`；
      浮层内容由 app 注入（`DockBarEntry.preview`），`layout/` 仍不 import `app/dock/registry`。
- [x] 键盘换边的焦点保持：`Alt+←/→` 后图标在另一条栏重新挂载，原 DOM 连同焦点被卸载 —— 用模块级
      单次交接（`dockBarFocusHandoff`，与 `useFileDrop` 的 `pendingDrag` 同构）把焦点交给新按钮；
      **只有键盘路径登记**（拖拽不抢焦点）。
- [x] 回归护栏：tab 右键菜单的键盘到达（`role="tab"` / 焦点态 `tabIndex` / `contextmenu` 接线）、
      `aria-keyshortcuts` 与 keydown 判据同源于 `DOCK_BAR_MOVE_BINDINGS`。

### P3c · PRD C 组缺口补齐（2026-11-03 追加）

三条是 PRD 里**功能未实现**、不是没验的项，交付如下：

- [x] **C4 新 tab 默认进 dock**：`DockViewMeta.docksNewTabs`（能力位，仅 `agent-chat` 为 true）+
      `shared/store/tabSurfacePolicy`（**单槽**注册表，仿 `registerTabCleanup`）+
      `app/dock/registerNewTabDockPolicy`（由 `bootstrap()` 注册，槽位读 `placements` 里图标当前所在槽）+
      `editorStore.addTab` 在**无显式 targetGroup** 时问一次策略。于是 4 个入口（图标 / 侧栏会话行 /
      Action Menu / 项目引导页）共用同一落点，不需要各改一遍。
- [x] **C2/C3 图标接回会话**：`selectLatestSessionForUnit`（纯选择器：unit + kind + `isListedSession`，
      取 `startedAt` 最大，**不依赖数组顺序**）+ `SESSION_KIND_OF_TAB_KIND`（唯一映射）→
      `useDockBarOpenTab` 在新建**之前**委派 `useActivateSession`（与侧栏点会话行同一条链，含
      attach / resume）。无命中才新建。
- [x] **DockTabHost 空 → 非空揭示**：与已实现的「非空 → 空则收起」对称，同一 `prevCountRef` 跃迁判断
      （每次渲染都跑会把用户手动收起的宿主立刻重新展开）。

红证据（三处同时禁用后）：8 条用例失败，恢复后全绿。

### P3b 取消理由（不再作为待办）

计划的收益是「把 tab 拖到工具栏图标上」，代价是把 `EditorDndShell` 的 `DndContext` 上提到
`DockLayout` 之上：

1. **一个 context 会同时承载两个 id 空间**（`ViewKey` 与 `tabId`），`onDragEnd` 必须先判断
   「这是图标还是 tab」—— 正是本任务用三轮消除掉的「一份状态两种命名」。
2. **tab 列表要在编辑器之上二次派生**（`useEditorDnd` 需要 `leftTabs/rightTabs/pinnedTabs`），
   与「单一派生点」直接冲突。
3. **收益已被替代品覆盖**：右键菜单已有 Move to Left/Right Dock / Move to Center，且
   `TabItem` 可键盘到达（`role="tab"` + Enter/Space + `contextmenu`）。
4. 该拖拽系统已有三次事故记录（pin→handle 失效、关闭按钮 pointer 泄漏、动态 `PinDropZone` 的
   `MeasuringStrategy.Always`），为一个重复手势承担回归风险不划算。

重新开启的判据（届时再评估，而不是「计划里写了就做」）：有用户实际反馈「在拖 tab 找落点」，
或侧栏会话行需要拖到 zone。

**回滚点 R-P3a**：浮层与焦点交接都是纯增量（新增文件 + 两个端口），revert 即回到纯指针拖拽 + 焦点丢失的旧行为。

---

## P4 · 回归修复：中心区形态被右侧停靠影响（用户实测，2026-11）

**现象**：选中项目后中心区显示引导页 → 点右栏 Terminal 图标（或引导页上的「打开终端」）→
中心区变空白，引导页被卸载。用户预期：点右栏图标只影响右侧宿主，中心区维持原状。

**根因**：`ProjectView` 用「tab 空间的 tab 总数」判定中心区渲染谁（`tabs.length > 0 ?
<EditorGroupLayout/> : <ProjectGuidePage/>`）。P1/P2 让 tab 可以住在 dock 槽里，但仍登记在同一个
`tabs[tabKey]` 注册表；`terminal` 的 `docksNewTabs: true` 使新 tab 直接落 `layout.docked.right`，
中区组一个 tab 都没有 ⇒ 走 `EditorGroupLayout` 渲染空 pane（视觉空白），引导页被条件分支挤掉。
**判据错误**是「注册表里有 tab」冒充「中心画面有东西可渲染」——归属只由 `editorLayout` 的组表达。

### P4-1 中心区判据（TDD）

- [x] **先写** `src/shared/store/__tests__/editorTabSelectors.test.ts` 新用例：`hasCenterTabs` ——
      只有 `docked.*` → `false`；`groups.left`/`groups.right`/`pinnedTabIds` 任一非空 → `true`；缺 layout → `false`。
  - 红：`pnpm vitest run src/shared/store/__tests__/editorTabSelectors.test.ts`
- [x] `src/shared/store/editorTabSelectors.ts`：新增 `hasCenterTabs(state, tabKey): boolean`
      （中心画面 = left ∪ right ∪ pinned；dock 宿主的 tab 由宿主渲染，不参与）。
- [x] `src/app/components/ProjectView.tsx`：`tabs.length > 0` → `hasCenterTabs(...)`，删掉只为计数
      存在的 `useShallow` 全量 tabs 订阅。
- [x] 组件级回归用例（`src/app/components/__tests__/ProjectView.center.test.tsx`）：tab 全部停靠在
      right 槽时仍渲染引导页（`ProjectGuidePage`），不渲染 `EditorGroupLayout`。
- [x] 复核补强（变异确认）：判据还要求 id 仍在注册表里 —— 布局残留已关闭 tab 的 id 时，只数
      `tabIds.length` 会把「渲染不出任何 tab」判成可渲染，症状与本次缺陷相同（空岛顶掉引导页）。

**校验**：`pnpm vitest run src/shared/store/__tests__/editorTabSelectors.test.ts src/app/components/__tests__/ProjectView.center.test.tsx`

**回滚点 R-P4**：单点判据替换 + 一个选择器，revert 即回到「停靠即清空中心」的旧行为。

---

## P5 · 第一性原理重构：可见性从内容派生（空宿主不占位）

**用户实测**：右侧默认显示 `No docked tabs — right-click a tab and choose "Move to Left/Right Dock"`。

**三条判据（可判定，不是口号）**

- **P1 内容先于容器**：容器可见性是内容的函数，容器不能比内容活得久。
- **P2 路径无关**：同一事实（宿主持有 0 条 tab）必须得到同一布局结果，与「怎么变空的」无关。
- **P3 可表示状态必有用户意图**：无意图的状态应不可表示，而不是配文案解释。

> 项目自己的原则（spec「错误不可表示才是根治」）在这里原本是反着做的：把不该存在的状态做成
> 可表示，再补一句解释。

**根因**：宿主被当成「用户可开合的面板」管可见性，而它其实是**内容的投影**。dock 里另外 6 个
视图是无状态视图（内容随时可重建 ⇒ 持久化 intent 合法），只有 tabHost 的内容按 workspace 投影且
不持久化 —— 这个差异从未被表达，于是它继承了同一条可见性规则。两处补丁都在遮这个错位：

| 破的判据 | 现状 | 证据 |
| --- | --- | --- |
| P1 | 破 —— `partialize` 落盘 `zones`（含宿主 `expanded`/`activeView`），停靠 tab 不落盘 | `dockStore.ts` persist 段 |
| P2 | 破 —— 关光 tab → 收起（D7）；重启/切项目 → 展开并显示文案 | `DockTabHost` 的 N→0 分支 + I4 |
| P3 | 破 —— D10 删掉宿主图标后，「点图标展开空宿主」已不可达，D7 的例外理由已死 | `panelMeta.ts`（host 无 `defaultOnBar`） |

**重构**：`zone 渲染 = 展开 ∧ 前台视图有内容可渲染`；无状态视图「有内容」恒真 ⇒ 既有行为不变；
宿主 = 该 workspace 在这槽内有存活 docked tab。**删三样，不增一样**：

- D7 的 N→0 收起 effect 整条退役（不再写 intent）
- 两句空态文案 + `DockTabEmptyState`
- `partialize` 里不需要任何宿主特例（持久化残留自动不占位）

### P5-1 判据与纯函数（TDD）

- [x] **先写** `src/shared/dock/__tests__/zone.test.ts`：`zoneFrontView` / `isZoneRenderable` ——
      前台是宿主且 `hostHasTabs=false` → false；`hostHasTabs=true` → true；前台是无状态面板 → true
      （宿主有无 tab 无关）；未展开 → false；前台是 `host:'none'`（library 落位在同槽）→ 回落到
      槽内首个宿主视图；槽内无可渲染视图 → null / false。
- [x] 新增 `src/shared/dock/zone.ts`：`zoneFrontView(state, slot)` + `isZoneRenderable(state, slot, hostHasTabs)`。
      `zoneFrontView` 是「前台是谁」的**单一派生点**（`DockZone` 现在的 `views.includes(activeView) ? … : views[0]`
      兜底并入这里，禁止第三份拷贝）。放新文件而不是 `placement.ts`：后者刻意不依赖声明表。
- [x] `src/shared/dock/index.ts` 导出这两个函数。
      （另导出 `zoneHostedViews`：`DockZone` 的渲染列表与前台派生必须共用同一个「有 zone 内容」过滤器，
      否则「registry 里有没有 component」会漏掉 Library —— 它有组件，只是渲染在中心区。）

### P5-2 选择器 + app 注入端口

- [x] **先写** `editorTabSelectors.test.ts` 新用例：`hasDockedTabs(state, tabKey, slot)` —— 只认该槽的组、
      id 必须存活、`tabKey` 为 null → false（与 `hasCenterTabs` 共用「存活 id」判定，不复制判据）。
- [x] `src/app/hooks/useDockTabHostContent.ts`（新）：`Record<DockSlot, boolean>`，key = `useActiveWorkspaceKey`
      （**不要**抄 ProjectView 的 `tabSpaceKeyOf({kind:'app'})` 兜底：app 空间没有可停靠 tab，抄了就是第三份公式）。
      对象用 `useMemo` 稳定（避免击穿下游 memo）。
- [x] `src/app/shell/AppShell.tsx`：调该 hook，作为 `tabHostHasTabs` 注入 `<DockLayout/>`（组合根注入，
      layout 层不 import tab 域 —— 与 `onMoveView` 同一条规矩）。

### P5-3 消费侧

- [x] `src/layout/dock-layout/DockLayout.tsx`：`leftVisible` / `rightVisible` 改用 `isZoneRenderable`
      （左/右同一规则，不特判）；`useZoneExpandCollapse` 与新 prop 接线；`handleLayoutChanged` 的右区宽度
      持久化沿用 `rightVisible`。
      **左区的 `defaultSize` / handle `disabled` / 宽度持久化也必须跟随 `leftVisible`** —— 只改
      `useZoneExpandCollapse` 的话，左槽空宿主首帧仍按 `leftSlotSize` 占位（该 effect 首渲染早退）。
      右区尺寸与 `resize` 效果的前台改取 `zoneFrontView`（`activeView` 指向 host:none 时宽度记忆不该记在它名下）。
- [x] `src/layout/dock-layout/DockZone.tsx`：前台视图改从 `zoneFrontView` 取（删掉本地 fallback）。
      渲染列表改 `zoneHostedViews`（声明表口径）；新增 `DockZone.test.tsx` 钉住这两条（Library 不进 zone / 前台回落）。
- [x] `src/features/dock-tabs/components/DockTabHost.tsx`：删两句文案 + `DockTabEmptyState` + N→0 收起分支；
      空态与 `tabKey === null` 一律 `return null`；保留 0→N 的「内容到达即前置」揭示。注释改成「宿主是内容的
      投影，空即不占位；不在这里解释为什么是空的」。
- [x] `DockTabHost.test.tsx`：4 条空态文案断言 → 改为断言渲染为空；删「本来就空不收起」（行为已由派生可见性
      取代）；补一条「关光后不写 intent」（`zones.right.expanded` 保持原值，与 P5 的「不再写 intent」对齐）。

**校验**：`pnpm vitest run src/shared/dock src/shared/store/__tests__/editorTabSelectors.test.ts src/features/dock-tabs src/layout`

### P5-4 文档同步（同一 diff）

- [x] `prd.md`：验收项「切到另一个项目 → 显示空态，不是空白死区」改为「→ 该槽不占位（不留空岛）」；
      D5/D7 两行同步（D7 退役，理由改为「派生可见性已覆盖，不需要写 intent」）。
- [x] `design.md`：I4 与 §7.4 的「宿主渲染空态」改述为「空宿主不占位」；补一条可见性派生规则。
- [x] `.trellis/spec/frontend/state-management.md` Contract 8：形态判据扩到 zone 级（`isZoneRenderable` +
      `hasCenterTabs` 同一口径）。
- [x] `docs/layout-architecture.html` ④/⑤：若有「空态」表述同步。
      （④ 的 editorStore 行补 zone 级判据 / 左右 zone 卡片改「空宿主不占位」，⑤ 的注入规则补 `tabHostHasTabs`。）

**回滚点 R-P5**：`isZoneRenderable` 一个判据 + 注入端口 + 删掉的文案/分支；revert 即回到
「空宿主占位 + 文案解释」的旧行为。

---

## P6 · 内容到达即前置（上提到 app 层）+ 审计问题清理

### P6-1 揭示不再属于宿主组件（修既有缺陷）

**缺陷**：`docksNewTabs` 自动停靠的非图标路径（Action Menu / 侧栏点会话 / history 恢复）在**槽已收起**时不展开宿主
（`DockZone` 在 `!zone.expanded` 时返回 null ⇒ 宿主未挂载 ⇒ 它自己的 0→N 揭示失效）→ tab 建好但看不见。

**为什么不在 `registerNewTabDockPolicy` 里补 `activateView`**（审计前的「一行修法」）：那个策略回调是在
`editorStore.addTab` 的 `set((state) => …)` **updater 内部**被调用的（`const surface = targetGroup ? null : resolveTabSurface(tab)`）。
在 updater 里写另一个 store = 纯推导里夹副作用（重跑 / 工具链会重复触发，也是跨域耦合）。

**修法（第一性原理）**：揭示的判据已经是 P5 算好的**同一个事实**（该槽宿主有无可渲染 tab）。所以：

- [x] 新增 `src/app/hooks/useDockTabHostReveal.ts`：吃 `useDockTabHostContent()` 的返回值，在**假 → 真**
  跃迁上调 `activateView(tabHostView(slot))`（初值取当前值，不在挂载时触发）；
- [x] `AppShell` 装配：`const facts = useDockTabHostContent(); useDockTabHostReveal(facts);`；
- [x] **删除 `DockTabHost` 的 0→N effect**：宿主从此**零布局写入**（读布局、渲染内容），揭示与可见性全部由
  app 层 + 派生判据承担 —— 不再依赖宿主是否挂载，四条入口（图标 / 菜单 / 自动停靠 / 切单元）行为一致。
- [x] 移植 `DockTabHost.test.tsx` 的「空 → 非空揭示」用例到新 hook 的测试；补一条「槽已收起时自动停靠仍揭示」
  （直接调 `editorStore.addTab`，不走 `moveTabToSlot`，即真实缺陷路径）+ 一条「挂载时不重复揭示」。
- [x] 注释里记录残差：**已折叠且已非空**时再自动停靠不会揭示（跃迁语义），需要时把它改成计数比较。

### P6-2 审计问题清理

- [x] **[Warning] `src/shared/dock/zone.ts`**：`host === 'tabHost' ? hostHasTabs : true` → 穷尽 `switch`
      （`'tabHost'` / `'singleton'` / `'none'`，无 default）。新 host variant 必须编译报错，不得静默落 `true`。
      用例：把 `'singleton'` 改成 `false` 时 zone.test 必红（变异验证）。
- [x] **[Block，非本任务但同工作树] `src-tauri/src/common/db/migrations.rs`**：`LATEST_VERSION` 18 → 13
      （`migrate_step` 只到 12，现状态下任何库都在第 14 步 `bail!`，`cargo test` 必红）。
- [x] **[Nit] 测试用工厂**：`useDockTabHostContent.test.ts` / `AppShell.test.tsx` 的 `{ id: 'p1' } as unknown as Project` →
      `createProject({ id: 'p1' })`（`@/testing/factories`，同批 `ProjectView.center.test.tsx` 已是这么写的）。
- [x] **[Nit] `DockLayout.test.tsx`**：`'28%'` 改从 `DOCK_VIEW_META[tabHostView('right')].defaultSlotSize` 派生。
- **[Nit] 不改，仅记录**：`ProjectView.tsx` 295/300 行（未越线，拆它属另一次有回归风险的改动）；
  `docs/layout-architecture.html` 不在 fmt 覆盖范围（HEAD 起即如此）。
- **[决策仍待定]** 左槽前台是空宿主 ⇒ 整条左栏 0 宽（与旧 D7 的 in-session 行为一致）。要「左栏永不消失」
  需引入槽级兜底前台声明，属产品决策。

### P6-3 文档同步

- [x] `design.md` I5：补「揭示由 app 层统一承担（宿主零布局写入）」；
- [x] `.trellis/spec/frontend/state-management.md` Contract 9：补「到达即前置」一条（唯一实现 `useDockTabHostReveal`，
      禁止在 `registerTabSurfacePolicy` 的 updater 内写 dockStore）。

**校验**：`pnpm vitest run src/app/hooks/__tests__ src/app/shell src/features/dock-tabs src/shared/dock src/layout`

**回滚点 R-P6**：一个 app 层 hook + 穷尽 switch + 常量回退；revert 即回到「揭示依赖宿主挂载 / host 判据双分支」。

---

## 验证命令

```bash
# 单文件红绿反馈（观察用，不是门禁）
pnpm vitest run src/shared/dock/__tests__/placement.test.ts
pnpm vitest run src/shared/store/__tests__/dockStore.test.ts
pnpm vitest run src/app/utils/__tests__/tabSurface.test.ts

# 收尾唯一门禁（每期结束时跑一次）
pnpm check:quick
```

> 按根 `AGENTS.md`：不要在开发中反复跑 `pnpm lint` / `pnpm test`；不要主动跑 `pnpm check`（pre-push / CI 兜底）。

## 评审门（每期 PR 必过）

| # | 检查项 | 判据 |
| --- | --- | --- |
| G-a | 布局事实单一来源 | 变更后全仓不存在 `zones[].panels` / `barItems` 的任何读写 |
| G-b | 无 tab 双挂载路径 | `dockTab` 是唯一移动入口；UI 不得直接改 `groups` 来"实现"停靠 |
| G-c | 无动态 ViewKey 入库 | 持久化里出现的 ViewKey 必须能在 `DOCK_VIEW_META` 查到 |
| G-d | 纯函数覆盖率 | `placement.ts`、`migrateFromV5`、`sanitize` 100% |
| G-e | 不变量测试能红 | 临时改坏实现（漏移除源组 / 不修 activeView）时对应测试必须失败 |
| G-f | 文档同步 | `docs/layout-architecture.html` ③④⑥ 与实现一致 |
| G-g | 红线无新增违背 | 尤其：红线 3（无阻塞 I/O 新增）、红线 12（若涉及路径，不得自造归一）、前端导入防火墙 |

## 子任务拆分建议（若单 PR 过大）

按 `task.py create --parent` 拆：

1. `dock-placement-core`（P0-1 ~ P0-3）
2. `dock-bar-dnd`（P0-4 ~ P0-6）
3. `dock-tab-host`（P1-1 ~ P1-3）
4. `dock-tab-entry`（P1-4 + P2）
5. ~~`dock-dnd-unify`~~（P3b 已取消）

顺序即依赖顺序；2 可与 1 并行到"接口冻结"（`applyMove` 签名 + `onMoveView` 契约）。
