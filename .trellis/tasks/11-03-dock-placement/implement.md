# Dock Placement · 执行计划

> 前置：prd.md 的 **D1–D5** 拍板 + design.md 复审通过 → 才能 `task.py start`。
> 本计划按 P0→P3 分四段，每段可独立发布、独立回滚。**每段内部先红后绿（TDD）。**

## 阶段总览

| 期 | 目标 | 触碰目录 | 风险 | 可独立发布 |
| --- | --- | --- | --- | --- |
| P0 | 图标落位可编辑 + 持久化 | `shared/dock`、`shared/store/dockStore`、`layout/dock-layout`、`app/dock`、`app/components` | 低（不碰 tab） | ✅ |
| P1 | 槽位 tab 宿主 + tab 停靠（菜单入口） | `shared/types/editorGroup`、`shared/store/editorStore+selectors`、`features/editor`、`features/dock-tabs`、`app/utils` | 中（编辑布局不变量） | ✅ |
| P2 | 种类级入口 + 快速打开 | `shared/dock/panelMeta`、`app/dock/registry`、`app/hooks`、`features/live-sessions`（只读复用） | 低（装配） | ✅ |
| P3 | 拖拽贯通 + a11y 收尾 | `features/editor`（DndContext 上提）、`layout` | 高（DndContext 提升） | ✅ |

---

## P0 · 布局可编辑（需求 A 全闭环）

### P0-1 纯数据与纯函数（无 UI 依赖，先写完再动 store）

- [ ] `src/shared/dock/types.ts`：`DockSlot`/`DOCK_SLOTS`/`isDockSlot`/`ViewKey`/`DockViewHost`/`DockViewActivation`/`DockViewMeta`/`DockPlacement`/`DockZoneRuntime`/`DockLayoutState`。保留 `MIN_ZONE_SIZE_PERCENT` 的原导出位置（`panelMeta.ts`）。
- [ ] `src/shared/dock/viewKey.ts`：四个 mint + `isViewKey`。**不加** `parseViewKey`（查表裁定）。
- [ ] `src/shared/dock/placement.ts`：`slotPlacements`/`slotViews`/`applyMove`/`applyActivate`/`applyToggle`/`applyOnBar`/`hasSlotViews`。
- [ ] **先写** `src/shared/dock/__tests__/placement.test.ts` 覆盖 design.md §6 的七条行为规格 + 幂等 + 原引用返回。
  - 红：`pnpm vitest run src/shared/dock/__tests__/placement.test.ts`
- [ ] 实现到绿；`placement.ts` 行覆盖 100%。

**校验**：`pnpm vitest run src/shared/dock/__tests__/placement.test.ts`

### P0-2 声明表迁移

- [ ] `panelMeta.ts`：`DOCK_PANEL_META` → `DOCK_VIEW_META`（8 个 panel + `appView:library`；**P0 阶段先不加** tabHost/entry 行，见 design §13.2）。
- [ ] `shared/dock/index.ts`：更新 re-export（同时导出 `types` 与 `viewKey` 的公开面）。
- [ ] `app/dock/registry.ts`：`UI_BINDINGS` 的 key 换成 `panelView(...)`；`buildDockPanelRegistry()` 增加 `host !== 'none' → component 必填` 校验。
- [ ] `app/panels/__tests__/registry.test.ts` 增补：每个 meta 视图都有绑定；缺绑定 throw（负例）。

**校验**：`pnpm vitest run src/app/dock src/app/panels`

### P0-3 dockStore v6

- [ ] `createDefaultDockState()`（meta → placements + zones，按 `defaultOrder` 排序后归一化 `order`）。
- [ ] mutators：`moveView`（meta 能力校验 + `applyMove`）、`activateView`、`toggleView`、`setViewOnBar`、`setViewSize`、`setSlotExpanded`、`setLeftSlotSize`、`enterCenterView`/`exitCenterView`（Library 互斥语义改为经 `setSlotExpanded` 表达）。
- [ ] selectors：`selectSlotPlacements` / `selectBarPlacements` / `selectSlotActiveView`。
- [ ] `migrateFromV5` + `sanitize`（纯函数，独立导出以便直测）。
- [ ] persist：`version: 6` + `migrate` + `merge(sanitize)`。
- [ ] **重写** `src/shared/store/__tests__/dockStore.test.ts`：既有 231 行用例按新字段语义等价改写（tab 视图切 appView、zone 展开、Library 互斥）+ 新增 G5/G6。
  - 注意：`vi.mock('../../dock/panelMeta')` 的 `mysteryTab` 负例（`openAs:'tab'` 但非合法 AppView）在新模型下对应「`activation.kind === 'appView'` 且 view 非法」——用同样思路构造负例，不要删掉这条防护。

**校验**：`pnpm vitest run src/shared/store/__tests__/dockStore.test.ts`

### P0-4 layout 消费（骨架仍零 registry 感知）

- [ ] `DockZone.tsx`：由 `s.zones[zoneId].activeView` + registry 取组件；空态文案保留。
- [ ] `DockLayout.tsx`：`rightVisible = hasSlotViews(state,'right') && expanded`；`activeView` 尺寸走 `viewSizes[view] ?? meta.defaultSlotSize ?? 18`（clamp `MIN_ZONE_SIZE_PERCENT`）+ `useZoneExpandCollapse` 不变；`handleLayoutChanged` 用 `setViewSize(activeView, …)`。
- [ ] `DockBar.tsx`：加 droppable 容器（含空栏落点）+ 可排序列；保持 `role="toolbar"`。
- [ ] `DockBarDnd.tsx`：两栏共用 `DndContext`；`onDragEnd` 只提取 `active.id` / `over.id` → `onMoveView(view, slot, index)`（spec §8）。
- [ ] `DockLayout` 接受并透传 `onMoveView`（app 注入），**不 import** registry / store 之外的域。

**校验**：`pnpm vitest run src/layout`

### P0-5 app 装配与 a11y

- [ ] `app/hooks/useDockBarButtons.tsx`：按 `selectBarPlacements(side)` 派生；`DockBarButton` 传 `activation`。
- [ ] `app/components/DockBarButton.tsx`：`activation.kind` 分发（`toggleZone` / `appView`；`openTab` 在 P2 生效）；`Alt+←/→` 移到另一侧（调用同一个 `moveView`）；`aria-label` 带类型与「可拖动」提示。
- [ ] `app/hooks/useDockBarMove.ts`（新增或并入 useDockBarButtons）：`onMoveView` 实现 + `meta.movable` 校验提示（`showToast` 说明不可移动）。
- [ ] 单测：`UseDockBarButtons.test.tsx` 改写为按 placements 断言；`DockBarButton.test.tsx` 增补 activation 分发与 Alt+方向键。
- [ ] `app/utils/__tests__/dockBarMove.test.ts`：跨栏 + 栏内重排 + 不可移动视图被拒。

**校验**：`pnpm vitest run src/app/components/__tests__/DockBarButton.test.tsx src/app/hooks`

### P0-6 回归与收尾

- [ ] `pnpm check:quick`（**只在收尾跑一次**）。
- [ ] 手工冒烟：双向换边 / 栏内排序 / 刷新保持 / 手改 localStorage 不炸 / 键盘等价。
- [ ] `docs/layout-architecture.html`：③ 三层体系、④ 状态源、⑥ 扩展指南三节同步（`zones[].panels` 与 `barItems` 不再存在）。
- [ ] spec 增补：`interaction-patterns.md` 加「跨两栏移动共用单一 DndContext」的偏差与理由（design §11）。

**回滚点 R-P0**：`dockStore` 版本号回 5 + revert 提交。P0 不触碰 tab，回滚无数据损失（v6 快照会被 v5 `merge` 忽略 → 用户需重设一次图标布局，可接受）。

---

## P1 · 槽位 tab 宿主 + 停靠（菜单入口）

### P1-1 布局不变量扩展（先红）

- [ ] `shared/types/editorGroup.ts`：`EditorSplitLayout.docked: Record<DockSlot, EditorGroupState>`；`createDefaultEditorLayout()` 补默认值。
- [ ] `editorTabSelectors.selectOrderedTabIds`：追加 `docked.left.tabIds` + `docked.right.tabIds`（design C5 扩展）。
- [ ] **先写** `editorTabSelectors.test.ts` 新断言（G2：覆盖全量、无重复）+ `tabSurface.test.ts`（G1：center ∩ docked = ∅）。

**校验**：`pnpm vitest run src/shared/store/__tests__/editorTabSelectors.test.ts`（此时应红）

### P1-2 editorStore 原子移动

- [ ] `editorStore.dockTab(tabKey, tabId, target: DockSlot | 'center')`：单次 `set` 内「从 groups.left/right/pinned/docked.* 全部移除 → 插入目标组」，并修复各组 `activeTabId`（design §7.2）。
- [ ] `useEditorGroupLayout`：暴露 `moveToDock(slot)` / `moveToCenter()`（内部只调 `dockTab`）。
- [ ] `editorStore.test.ts` 增补：从中心 → dock、dock → 中心、dock → 另一 dock、pinned tab 被拒（R9 决策）。

**校验**：`pnpm vitest run src/shared/store/__tests__/editorStore.test.ts src/app/utils/__tests__/tabSurface.test.ts`（转绿）

### P1-3 宿主渲染（最大化复用）

- [ ] `EditorGroupPane.tsx`：`groupId: EditorGroupId | 'pinned'` → `paneId: EditorGroupId | 'pinned' | 'dockLeft' | 'dockRight'`；新增 `chrome?: 'full' | 'dock'`（dock 下隐藏 ActionMenu / 分屏控件）。**全部调用点同一 diff 内改完**（中心 3 处 + 新宿主）。
- [ ] `features/dock-tabs/hooks/useDockedPane.ts`：读 `editorLayout[tabKey].docked[slot]`，只返回 `{ tabs, activeTabId, activate }`（薄，不复制中心大对象）。
- [ ] `features/dock-tabs/components/DockTabHost.tsx`：`slot` → `paneId`；无 `tabKey` → 空态；`chrome="dock"`。
- [ ] `app/dock/wrappers/DockTabHostWrapper.tsx`：解析当前激活 workspace 的 `tabKey`（`useActiveWorkspaceKey` + `tabSpaceKeyOf`），无项目 → 空态。
- [ ] `app/dock/registry.ts` + `panelMeta.ts`：补 `tabHost:left` / `tabHost:right`（`host:'tabHost'`、`movable:false`、`defaultOnBar` 按 D1）。
- [ ] `dockStore` `defaultSlotSize` 与 `viewSizes` 支持 tabHost。
- [ ] 单测：`DockTabHost.test.tsx`（有 docked tab → 渲染；清空 → 空态；无 tabKey → 空态；`chrome:'dock'` 不渲染分屏控件）。

**校验**：`pnpm vitest run src/features/dock-tabs src/features/editor`

### P1-4 入口（菜单/命令）

- [ ] tab 右键菜单加「Move to Right Dock / Move to Left Dock / Move to Center」（`usePaneContextMenu`）。
- [ ] 命令面板项（可选）：`View: Move Tab to Right Dock`。
- [ ] `app/utils/tabSurface.ts`：`moveTabToSlot(tabKey, tabId, slot)` 三步编排（design §7.2），**顺序不可换**。
- [ ] 单测：三步调用顺序 + 无 tabKey / 无目标宿主 → 返回 false 且不改状态。

**校验**：`pnpm vitest run src/app/utils src/features/editor`

### P1-5 回归与收尾

- [ ] `pnpm check:quick`。
- [ ] 冒烟：dock → 关 tab（dirty 确认）→ 切项目空态 → dock 回中心。
- [ ] 回归既有 pin-then-open 路径（history: pin tab → 开侧面板 → handle 失效）。**这是 C2 的直接防线，必须手测。**
- [ ] `docs/layout-architecture.html` ④ 增 `docked` 组说明。

**回滚点 R-P1**：`docked` 组默认空 → 宿主渲染空态；单独 revert P1 提交不影响 P0（P2 未上线时无入口指向它）。

---

## P2 · 种类级入口 + 快速打开（需求 C）

- [ ] `panelMeta.ts`：`tabKind:agent-chat` / `tabKind:terminal`（`host:'none'`、`activation:{kind:'openTab'}`、`defaultSlot:'right'`、`defaultOnBar` 按 D1）。
- [ ] `app/dock/registry.ts`：两个 entry 的 title/icon（无 component，走 `host:'none'` 免校验）。
- [ ] `DockBarButton`：`activation.kind === 'openTab'` →
  - 已有该 kind 且属于当前 tabKey 的 tab → `activateTab`（若在 docked 组，同时 `activateView(host)`）；
  - 否则新建：agent-chat 走 `openAgentChatTab(workspace)`、terminal 走 `handleAgentClick` / `handleAddTerminalTab`；
  - 新 tab 落 `DOCK_VIEW_META[tabKindView(kind)].defaultSlot` 宿主（D3）。
- [ ] 会话接回：点击入口时若 live-sessions 有对应会话，复用 `planSessionActivation`（**不新写状态机**）。
- [ ] 单测：`DockBarButton` 的 `openTab` 分发三分支（已有/新建/无项目）；`tabKind` → 默认 slot 派生。

**校验**：`pnpm vitest run src/app/components/__tests__/DockBarButton.test.tsx src/features/live-sessions`

**回滚点 R-P2**：把两条 `tabKind` meta 行的 `defaultOnBar` 置 false（图标消失）或删除 meta 行（入口消失），不影响 P1 已停靠的 tab。

---

## P3 · 拖拽贯通 + a11y 收尾

> 高风险段：`DndContext` 提升会触及现有 tab 拖拽（含 pin）。必须先补回归测试再动。

- [ ] **先补** 回归测试：`TabItem.test.tsx` / `EditorDndShell` 相关（拖拽到另一组、拖到 pin zone、拖拽后 handle 可用）。
- [ ] 把 `EditorDndShell` 的 `DndContext` 上提到工作区层（包住 `DockLayout` + center），`DockBarDnd` 从独立 context 改为消费者。
- [ ] tab → 工具栏：`over` 命中 `bar:<slot>` → `moveTabToSlot(tabKey, tabId, slot)`。
- [ ] 工具栏 → tab 区：图标拖到 center/doc host → `moveView` 回退（仅 `singleton` 有意义，`none` 族拒绝）。
- [ ] a11y：拖拽的全键盘替代（`Alt+←/→` 移图标、`Alt+Shift+←/→` 移 tab）；`aria-describedby` 说明快捷键；焦点环不丢。
- [ ] 手测 pin-then-open 全链路（C2 第二次防线）。

**回滚点 R-P3**：DndContext 提升单独一个提交，revert 即回到 P2 行为（菜单入口仍在）。

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
5. `dock-dnd-unify`（P3）

顺序即依赖顺序；2 可与 1 并行到"接口冻结"（`applyMove` 签名 + `onMoveView` 契约）。
