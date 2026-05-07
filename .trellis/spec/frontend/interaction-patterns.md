# 交互模式指南

> 本项目中复杂交互（拖拽、手势等）的实现模式。

---

## 概述

本项目使用 **Pointer Events** 替代 HTML5 Drag API 实现拖拽排序，解决 Windows/Tauri 环境下 `data-tauri-drag-region` 与 `draggable` 属性冲突的问题。

---

## 场景：Pointer Events 拖拽排序模式（2026-05-07）

### 1. Scope / Trigger

- Trigger：HTML5 `draggable` + `onDragStart/onDragOver/onDrop` 在 Windows 上与 Tauri 窗口拖拽（`-webkit-app-region: drag`）冲突，导致拖拽项目时窗口跟着移动。
- Scope：项目列表拖拽排序（本地、WSL、SSH 远程）。

### 2. 设计决策：Pointer Events 替代 HTML5 Drag API

**选项**：
1. HTML5 Drag API（`draggable` + `onDrag*`）—— 浏览器原生，但 Windows/Tauri 冲突
2. Pointer Events（`onPointerDown/Move/Up`）—— 跨平台统一，无窗口拖拽冲突
3. Mouse Events（`onMouseDown/Move/Up`）—— 不支持触摸，无 pointer capture

**决策**：选择 Pointer Events，因为：
- 跨平台兼容（鼠标 + 触摸板 + 触摸屏）
- `setPointerCapture` 保证指针离开元素后仍能跟踪移动
- 不触发 Tauri 窗口拖拽
- 阈值检测（5px）防止误触发

### 3. 核心架构：三层分离

```
┌─────────────────────────────────────────────────┐
│  Domain Hooks (useLocalProjects, useWslProjects) │  ← 业务逻辑：排序算法 + 持久化
│  handleDragEnd(draggedId, targetId)              │
└─────────────────────┬───────────────────────────┘
                      │ onDragEnd callback (via Props/Context)
┌─────────────────────▼───────────────────────────┐
│  useProjectItemDrag (纯逻辑 hook)                │  ← 交互逻辑：pointer 事件 + 阈值 + 目标查找
│  { isDragging, dragOffset, dropIndicator, ... }  │
└─────────────────────┬───────────────────────────┘
                      │ state + handlers
┌─────────────────────▼───────────────────────────┐
│  DraggableProjectItem (纯表现组件)               │  ← 视觉层：transform + CSS 类 + 放置指示器
│  <div onPointerDown={...} style={translate(...)}/>
└─────────────────────────────────────────────────┘
```

### 4. useProjectItemDrag 契约

```ts
// src/components/project/useProjectItemDrag.ts
export interface UseProjectItemDragOptions {
  projectId: string;
  onDragEnd?: (draggedId: string, targetId: string) => void;
}

export interface DragOffset { x: number; y: number; }
export interface DropIndicator { targetId: string; position: "before" | "after"; }

export function useProjectItemDrag(options: UseProjectItemDragOptions): {
  isDragging: boolean;
  dragOffset: DragOffset;
  dropIndicator: DropIndicator | null;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handlePointerCancel: () => void;
}
```

**关键行为**：
- 仅响应主按钮（`e.button === 0`）
- 5px 移动阈值后才激活拖拽（`DRAG_THRESHOLD = 5`）
- 通过 `setPointerCapture` 跟踪指针离开元素后的移动
- 通过 `document.elementsFromPoint` 查找放置目标（临时隐藏拖拽元素以穿透检测）
- `[data-no-drag]` 属性排除交互元素（按钮、链接、输入框）
- `[data-drag-id]` 属性标识可拖拽项目

### 5. DraggableProjectItem 契约

```tsx
// src/components/project/DraggableProjectItem.tsx
interface DraggableProjectItemProps {
  dragId: string;
  isDragging: boolean;
  dragOffset: DragOffset;
  dropIndicator: DropIndicator | null;
  isActive?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  children: React.ReactNode;
  className?: string;
}
```

**视觉行为**：
- 拖拽中：`opacity-50 scale-[1.02] rotate-[0.5deg] shadow-lg z-50`
- 光标跟随：`transform: translate(${dragOffset.x}px, ${dragOffset.y}px)`
- 放置指示器：蓝色顶部/底部边框 + 发光效果（`bg-accent-blue` + `boxShadow`）
- 非拖拽时：`cursor-grab`

### 6. 跨层数据流

```
Domain Hook                     useAppContainer              Component
─────────────                   ───────────────              ─────────
useLocalProjects                projects, handleDragEnd      ProjectItem
  handleDragEnd ──────────►     onDragEnd: handleDragEnd ──► useProjectItemDrag({ onDragEnd })

useWslProjects                  wslEntries, handleWslDragEnd  ConnectionProjectCard
  handleWslDragEnd ────────►    onWslDragEnd: ... ─────────► useProjectItemDrag({ onDragEnd })

useRemoteProjects               remoteEntries, handleRemoteDragEnd  ConnectionProjectCard
  handleRemoteDragEnd ──────►   onRemoteDragEnd: ... ───────► useProjectItemDrag({ onDragEnd })
```

### 7. Stale Closure 修复模式

**问题**：`handlePointerUp` 通过 `useCallback` 创建，闭包捕获了创建时的 `dropIndicator` 值。如果在 `pointerDown` → `pointerUp` 期间 `dropIndicator` 状态更新但 `handlePointerUp` 的回调引用未变，读到的是过期值。

**方案**：使用 `useRef` 镜像状态，在 `handlePointerMove` 中同步更新 ref，在 `handlePointerUp` 中从 ref 读取最新值。

```tsx
// ✅ 正确：ref 镜像 + useCallback 读 ref
const dropIndicatorRef = useRef<DropIndicator | null>(null);

const handlePointerMove = useCallback((e: React.PointerEvent) => {
  // ...
  const target = findDropTarget(e.clientX, e.clientY);
  dropIndicatorRef.current = target;  // 同步更新 ref
  setDropIndicator(target);           // 触发重渲染
}, [projectId, findDropTarget]);

const handlePointerUp = useCallback((e: React.PointerEvent) => {
  if (activeRef.current) {
    const currentDrop = dropIndicatorRef.current;  // 从 ref 读最新值
    if (currentDrop && onDragEnd) {
      onDragEnd(projectId, currentDrop.targetId);
    }
    // ...
  }
}, [projectId, onDragEnd]);

// ❌ 错误：直接读状态变量（闭包捕获过期值）
const handlePointerUp = useCallback((e: React.PointerEvent) => {
  if (dropIndicator && onDragEnd) {  // dropIndicator 可能是旧值！
    onDragEnd(projectId, dropIndicator.targetId);
  }
}, [projectId, onDragEnd, dropIndicator]);  // 依赖数组膨胀，引用不稳定
```

**何时使用此模式**：
- `useCallback` 内需要读取频繁变化的状态
- 依赖数组膨胀会导致引用不稳定（影响下游 `React.memo`）
- 状态变化不需要在回调内触发重渲染（只读取最新值）

### 8. 域 Hook 排序算法契约

本地、WSL、SSH 远程的排序逻辑结构一致：

```ts
const handleDragEnd = useCallback((draggedId: string, targetId: string) => {
  if (draggedId === targetId) return;  // 同位置不操作
  setItems((prev) => {
    const newItems = [...prev];
    const [dragged] = newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, dragged);
    // 持久化（本地用 invoke，WSL/SSH 用 saveSession）
    persist(newItems);
    return newItems;
  });
}, [deps]);
```

**WSL/SSH 特殊行为**：
- 拖拽范围限定在同一 entryId 内（跨 distro/host 忽略）
- `handleWslDragEnd(entryId, draggedId, targetId)` —— 先按 entryId 过滤
- `handleRemoteDragEnd(entryId, draggedId, targetId)` —— 同上

### 9. Tests Required

| 测试目标 | 断言点 |
|---------|--------|
| `useProjectItemDrag` | 5px 阈值前不激活；阈值后 `isDragging=true`；`onDragEnd` 被调用；无目标时不调用 |
| `handleDragEnd`（本地） | 正常排序；同位置不操作；持久化 `reorder_projects` 被调用 |
| `handleWslDragEnd` | 同 entryId 内排序；跨 entryId 忽略；`saveSession` 被调用 |
| `handleRemoteDragEnd` | 同 entryId 内排序；跨 entryId 忽略；`saveSession` 被调用 |

### 10. Anti-patterns

#### ❌ 使用 HTML5 Drag API（Windows/Tauri 冲突）

```tsx
// 不要这样做
<div draggable onDragStart={...} onDragOver={...} onDrop={...}>
```

#### ❌ 在 useCallback 中直接读取频繁变化的状态

```tsx
// 不要这样做：依赖数组膨胀，引用不稳定
const handlePointerUp = useCallback(() => {
  if (dropIndicator) { ... }
}, [dropIndicator, otherDeps]);
```

#### ✅ 使用 Pointer Events + ref 镜像

```tsx
// 正确做法
const dropIndicatorRef = useRef<DropIndicator | null>(null);
const handlePointerMove = useCallback(() => {
  dropIndicatorRef.current = target;
  setDropIndicator(target);
}, []);
const handlePointerUp = useCallback(() => {
  const current = dropIndicatorRef.current;
  if (current) { ... }
}, [onDragEnd]);
```
