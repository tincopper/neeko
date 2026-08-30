# 支持拖拽未 pin 的 tab 到 pinned 面板触发 pin（多 pinned tabs）

## Goal

让用户可以用鼠标把 left/right 面板中未 pin 的 tab，通过拖拽放到 pinned 面板区域，从而触发 pin（**新增**一个 pinned tab，而非替换现有 pinned tab）。pinned 面板支持多个 pinned tabs。视觉上保留现有的独立 pinned 面板，不改变 pin 的展示与 unpin 方式。

## Background / 已确认事实

- store 已有 `pinTab(tabKey, tabId)`（`src/shared/store/editorStore.ts`）：把 tab 从 left/right 组移除并加入 `pinnedTabIds`（原单 `pinnedTabId` 已改为多 tab 列表）。
- pinned tab 渲染在独立面板，由 `EditorGroupLayout` 中 `groupId="pinned"` 的 `EditorGroupPane` 承载（`EditorGroupLayout.tsx`）。
- 每个 TabBar 内部自建 `DndContext`（`TabBar.tsx`），left/right/pinned 三个面板各自独立，dnd-kit over 检测仅在同一个 DndContext 内生效。
- pinned 面板 TabBar 目前 `reorderable={false}`，pinned tab 既不可被拖出，也不是 drop target。
- 反向 unpin 已通过右键菜单实现（"Unpin Tab"），支持按 tab 维度 unpin。
- TabBar 仅被 `EditorGroupPane` 复用（搜索确认无其他调用方）。

## Requirements

1. 从 left / right 面板拖拽一个未 pin 的 tab，拖到 **pinned 面板区域**（包含 pinned tabs 的整块面板）即触发 `pinTab(tabKey, draggedTabId)`。
2. 命中判定范围为 pinned 面板区域，而非仅 pinned tab 本身。
3. 拖拽过程中保留现有排序交互（left 组、right 组内部仍可 reorder）。
4. 采用单一共享 `DndContext` + 多个 `SortableContext`（multi-container 模式），视觉上各面板仍独立显示。
5. pin 成功后表现：tab 从原组移除、**新增**到 pinned 面板（多个 pinned tabs 共存，不替换），并带 Pin 图标。
6. 不实现反向拖拽 unpin（保持右键菜单方式，右键按 tab 逐条 unpin）。

## Acceptance Criteria

- [x] 从 left 面板拖 tab 到 pinned 面板区域，该 tab 被 pin（`pinnedTabIds` 新增该 id，tab 从 left.tabIds 移除）。
- [x] 从 right 面板拖 tab 到 pinned 面板区域，该 tab 被 pin。
- [x] 已存在 pinned tab 时再拖拽 pin 新 tab：**新增**而非替换（`pinnedTabIds` 追加，原 pinned tab 保留）。
- [x] left 组内部、right 组内部的拖拽排序仍正常工作（不回归）。
- [x] 拖拽到 pinned 面板区域内任意位置（非刚好 pinned tab 上）也触发 pin。
- [x] 已 pin 的 tab 仍不可被拖出（保持现状）。
  - ↑ 2026-08-29 起由需求扩展解禁：pinned tab 可拖到 left/right 组的 tab 上触发 unpin 移动（见「Scope 扩展」）。
- [x] `pnpm test:run`、`pnpm type-check`、`pnpm lint`、`pnpm lint:fe` 全部通过。

## Scope 扩展（2026-08-29）

### 扩展 1：拖拽动效（DragOverlay + drop 高亮）

真实环境反馈「拖拽没有动效」：无 Overlay 模式下被拖原始 tab 元素受 TabBar `overflow-x-auto` 裁剪，跨面板拖拽中离开源 tab 栏即不可见；pinned 区域也无 drop 目标提示。修复：

- `EditorGroupLayout` 渲染 `<DragOverlay>`，`useEditorDnd` 维护 `dragActiveTab`（dragEnd/cancel 无条件清空，含 over 为 null 的提前 return 路径）；新组件 `TabDragPreview` 作跟手副本（纯展示，无交互语义）。
- `EditorGroupPane` 的 `useDroppable` 取 `isOver`，拖入 pinned 区域显示 `ring-2 ring-accent/70` 高亮（样式计算提取为 `editorPaneRegionClass` 纯函数，drop 高亮替换默认 focus ring）。

### 扩展 4：pane 内 + / ActionMenu 新建 tab 跟随发起面板落组（2026-08-29）

需求：pinned 面板内「+」新建的 tab 落 pinned 组；left/right 面板内新建落对应组（此前
所有新建统一落布局激活组 `activeGroupId`，pinned 面板内新建会落到 left/right）。

- store：`addTab` 增加可选第三参 `targetGroup?: EditorGroupId | 'pinned'`——'pinned'
  落 pinnedTabIds 并激活（防御 ensureLayout 将新 tab 塞进 left 的边界）；left/right
  落对应组并组内激活；缺省完全保持既有逻辑（20+ 打开文件/diff 类调用方零破坏）。
- 链路：`usePaneActions`（new-agent-chat / new-browser / new-file / agent terminal）
  与 `useTerminalTabs`（new-terminal / agent terminal）全部带发起 pane 的 groupId；
  `createUntitledFileTab` 增加 targetGroup 参数；pinned pane 此前
  `onAddTerminalTab={undefined}`（菜单 New Terminal 无效），现已接通。
- `EditorContext.onAddTab` 类型放宽为可选 targetGroup（全局工具栏/快捷键路径签名
  兼容不受影响）；全局 AgentBar 链路（无 pane 上下文）保持现状，记为已知限制。

### 扩展 3：无 pinned 面板时拖拽动态创建 pin 目标（2026-08-29）

需求：pinned 面板不存在时，拖动非 pinned tab 也能创建 pinned 面板，不必先右键 Pin。

- 判定：`shouldShowPinDropZone` 纯函数（`!hasPinned && 拖拽中 && 被拖非 pinned`）。
- 渲染：新组件 `PinDropZone` 在工作区最左侧显示虚线窄条，**复用 pinned 面板同款
  droppable id**，drop 判定零改动走既有 `resolveDropAction` pin 分支；`isOver` 时
  accent 高亮提示「松手即 pin」。
- 关键机制：zone 在拖拽中途挂载，DndContext 必须配
  `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}`
  （默认 WhileDragging 仅在 dragStart 测量一次，中途注册的 droppable rect 为 null
  会让 pointerWithin 永远不命中）。
- 右键 Pin 菜单保持不变，两条路径并存。

### 扩展 2：pinned tab 拖出触发 unpin 移动（原 Out of Scope 解禁）

- 判定：`resolveDropAction` 增加 `pinnedIds`；active 为 pinned tab 时，over 落在 left/right 组 tab 上 → `unpin`（带 overId 与目标组）；拖回 pinned 区域 / 落到 pinned tab 上 → none（pinned 内部排序仍不支持）。
- store：新增 `unpinTabTo(tabKey, tabId, groupId, overId)`——从 pinned 移除、插到 over 之前（null 追加尾部）、目标组激活被拖 tab、pinnedActiveTabId 交接。右键菜单 `unpinTab`（放回 left 头部）语义不变。
- 发起端：`PaneTabBar` 的 pinned 分支改为 `reorderable` + `externalDnd`（可拖出发起，pinned 内部排序由判定层拒绝，视觉弹回）；`TabBar` sortable 分支去掉 `tabs.length > 1` 下限——单 tab 面板（含最后一个 pinned tab）也要可发起跨面板拖拽。
- DragOverlay 内容源 `resolveDragTab` 扩展 pinned 组。

## Out of Scope

- 改变 pinned 面板的视觉布局 / 展示方式。
- pinned 面板内部 tab 的拖拽排序（pinned tabs 按 pin 顺序展示）——拖入 pinned 区域 / pinned 间拖拽判定为 none，视觉弹回原位。

## Open Questions

- 无（产品决策已确认）。