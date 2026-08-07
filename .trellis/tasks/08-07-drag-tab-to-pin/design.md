# Design — 拖拽未 pin tab 到 pinned tab 触发 pin

## 问题与目标

left/right 面板的未 pin tab 目前只能通过右键 "Pin Tab" 菜单触发 pin。本设计让用户通过拖拽交互，把未 pin tab 拖进 pinned 面板区域即触发 `pinTab`。视觉上保留独立 pinned 面板。

## 核心约束（dnd-kit 特性）

dnd-kit 中，`over` 检测只在**同一个 `DndContext`** 内生效。当前每个 TabBar 自建 `DndContext`（`TabBar.tsx:165`），因此 left/right/pinned 三个面板彼此隔离，无法跨面板判断"拖到了 pinned 区域"。

关键结论：**必须把 DndContext 提升到共享层（multi-container 模式）**，让三个面板的 tab 共享同一个 context，才能让 from 侧（left/right）与 to 侧（pinned）在同一个碰撞检测体系内。

## 架构与边界

### 共享 DndContext 提升位置

`EditorGroupLayout` 是 left/right/pinned 三个 `EditorGroupPane` 的共同父组件（`EditorGroupLayout.tsx`）。在它这里创建**一个** `DndContext`，包裹三个 `EditorGroupPane`。

改动：
- `EditorGroupLayout.tsx`：新增共享 `DndContext`；原有 `ResizablePanelGroup` 分支改由它包裹；新增 `handleDragEnd` 统一分发。
- `TabBar.tsx`：移除组件内自建 `DndContext`（`TabBar.tsx:165-186`），改为只使用 `SortableContext`，并接收来自父级的 `onDropOnPinned` 回调。
- `EditorGroupPane.tsx`：把拖拽结束事件（`onDragEnd`）与容器判定所需信息上抛给 `EditorGroupLayout`。

### 容器标识

用 tab id + 容器前缀区分 drop target 归属，判定 over 落在哪个容器：

- left 容器：`left:{tabId}`（或复用现有 reorder 语义）
- right 容器：`right:{tabId}`
- pinned 容器：`pinned:{tabId}`

`handleDragEnd` 逻辑：
1. 若 over 属于 left/right 且与 active 同容器 → 原有 `reorderTab`。
2. 若 over 属于 pinned 容器 → `pinTab(tabKey, activeId)`。
3. 若 active 本身是 pinned（不可拖，保持现状）→ 忽略。

### SortableContext 兼容

`SortableContext`（`horizontalListSortingStrategy`）仍按各面板独立传入各自的 items。dnd-kit 允许一个 `DndContext` 下挂多个 `SortableContext`，这是官方 multi-container 模式。

### pinned 面板作为 drop target

pinned 面板即使只有一个 pinned tab，也要作为可命中的 drop target。方案：给 pinned 面板的 TabBar 区域包一个 `useDroppable`（id 为 pinned 容器），或复用 pinned tab 的 sortable id 作为容器命中点。为满足"拖到面板区域任意位置即 pin"，更稳妥是给 pinned 面板整体一个独立的 droppable 容器（`pinned-panel:{tabKey}`），命中即 pin。

## 数据流

```
用户拖 left tab → 共享 DndContext 捕获 drag
  → over 命中 pinned-panel droppable
    → handleDragEnd: pinTab(tabKey, activeId)   // store 更新
      → pinnedTabId 更新、left.tabIds 移除
      → EditorGroupLayout 重渲染，pinned 面板显示新 pin 的 tab
```

## 兼容性与迁移

- 现有 left/right 组内 reorder 行为不变（同一 DndContext 内，同级 over 走 reorderTab）。
- pinned 面板默认 `reorderable={false}` 保持：pinned tab 不可被拖出。
- 不改变 store 的 `pinTab` / `unpinTab` 接口。
- 无后端 / 持久化影响。

## 风险与权衡

- **R1（主要风险）**：DndContext 提升会影响三个面板的拖拽，需确认 left/right 组内排序不回归。缓解：保留原 reorderTab 分支，并用现有 TabBar 测试回归。
- **R2**：dnd-kit 多 SortableContext + 混合 droppable 的命中判定可能误判。缓解：用容器前缀区分，over 判定先按前缀分类。
- **R3**：pinned 面板 droppable 与 pinned tab 自身 sortable 的 over 冲突。缓解：明确优先级——pinned 面板容器 prefer 命中，pinned tab 本身不参与 sortable。

## 回滚

删除 `EditorGroupLayout` 中的共享 DndContext 及 `onDropOnPinned` 传递，恢复各 TabBar 自建 DndContext 即可回滚到原行为。