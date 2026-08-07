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
- [x] `pnpm test:run`、`pnpm type-check`、`pnpm lint`、`pnpm lint:fe` 全部通过。

## Out of Scope

- 反向拖拽 unpin（从 pinned 面板拖回取消 pin）。
- 改变 pinned 面板的视觉布局 / 展示方式。
- pinned 面板内部 tab 的拖拽排序（pinned tabs 按 pin 顺序展示）。

## Open Questions

- 无（产品决策已确认）。