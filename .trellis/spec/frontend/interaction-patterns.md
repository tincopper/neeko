# 交互模式指南

> 本项目中复杂交互（拖拽、手势等）的实现模式。

---

## 概述

本项目使用 **@dnd-kit** 库实现拖拽排序。之前的自研 Pointer Events 方案因存在抖动和列表边缘无法落点的 bug，在 2026-06-02 被替换。

---

## 场景：项目列表拖拽排序（@dnd-kit，2026-06-02）

### 1. 背景

- HTML5 `draggable` + `onDragStart/onDragOver/onDrop` 在 Windows/Tauri 环境下与 `data-tauri-drag-region` 冲突。
- 自研 Pointer Events 方案存在：CSS transition 与 pointermove 冲突导致抖动；`document.elementsFromPoint` 在列表边缘返回 null 导致无法排序。
- 最终选择 `@dnd-kit`：hook-based API、内置 collision detection、无 DOM 查询、支持键盘/触摸。

### 2. 依赖

```
@dnd-kit/core       — DndContext, closestCenter, DragEndEvent
@dnd-kit/sortable   — SortableContext, useSortable, verticalListSortingStrategy
@dnd-kit/modifiers  — restrictToVerticalAxis, restrictToParentElement
@dnd-kit/utilities  — CSS.Transform.toString
```

### 3. 核心架构

```
┌───────────────────────────────────────────────────┐
│  DndContext (每个独立列表一个)                      │  ← 拖拽事件总线 + collision detection
│  modifiers: restrictToVerticalAxis,               │
│             restrictToParentElement               │
│  onDragEnd: (event) => handler(active.id, over.id)│
├───────────────────────────────────────────────────┤
│  SortableContext                                  │  ← 排序容器，声明 items 列表
│  items: projects.map(p => p.id)                   │
│  strategy: verticalListSortingStrategy            │
├───────────────────────────────────────────────────┤
│  useSortable({ id })                              │  ← 每个可排序项目卡片
│  返回: attributes, listeners, setNodeRef,         │
│        transform, transition, isDragging          │
└───────────────────────────────────────────────────┘
```

### 4. 每个独立排序区域有自己的 DndContext

| 区域 | DndContext 位置 | onDragEnd 处理器 |
|------|----------------|-----------------|
| Local 项目 | `ProjectsPanel.tsx` | `useLocalProjects.handleDragEnd(draggedId, targetId)` |
| WSL entry 内 | `RemoteItems.tsx > WSLItem` | `useWslProjects.handleWslDragEnd(entryId, draggedId, targetId)` |
| Remote entry 内 | `RemoteItems.tsx > RemoteItem` | `useRemoteProjects.handleRemoteDragEnd(entryId, draggedId, targetId)` |

跨 entry 拖拽不支持（每个 entry 独立的 DndContext 天然隔离）。

### 5. 可排序卡片组件契约

```tsx
// ProjectItem.tsx / ConnectionProjectCard.tsx
const {
  attributes,  // aria 属性
  listeners,   // pointer/keyboard event handlers
  setNodeRef,  // DOM ref 绑定
  transform,   // 当前拖拽 transform
  transition,  // CSS transition string
  isDragging,  // 是否正在被拖拽
} = useSortable({ id: project.id });

const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition ?? undefined,
};

return (
  <div
    ref={setNodeRef}
    style={style}
    className={cn(
      "relative mb-0.5 rounded-md overflow-visible",
      isDragging && "opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50",
      !isDragging && "cursor-grab",
    )}
    {...attributes}
    {...listeners}
  >
    {/* 卡片内容 */}
  </div>
);
```

### 6. 域 Hook 排序算法

本地、WSL、SSH 远程的排序逻辑结构一致：

```ts
function handleDragEnd(draggedId: string, targetId: string) {
  if (draggedId === targetId) return;
  const draggedIndex = items.findIndex(i => i.id === draggedId);
  const targetIndex = items.findIndex(i => i.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) return;

  const newItems = [...items];
  const [dragged] = newItems.splice(draggedIndex, 1);
  newItems.splice(targetIndex, 0, dragged);
  // persist...
}
```

**WSL/SSH 特殊行为**：
- 拖拽范围限定在同一 entryId 内（独立 DndContext 保证）
- 持久化通过 `saveSession` 而非 `reorderProjects` API

### 7. Tests Required

| 测试目标 | 断言点 |
|---------|--------|
| `handleDragEnd`（本地） | 正常排序；同位置不操作；持久化 `reorder_projects` 被调用 |
| `handleWslDragEnd` | 同 entryId 内排序；`saveSession` 被调用 |
| `handleRemoteDragEnd` | 同 entryId 内排序；`saveSession` 被调用 |

### 8. Anti-patterns

#### ❌ 使用 HTML5 Drag API（Windows/Tauri 冲突）

```tsx
// 不要这样做
<div draggable onDragStart={...} onDragOver={...} onDrop={...} />
```

#### ❌ 自实现 Pointer Events 拖拽

```tsx
// 不要这样做 — 已被替换
// document.elementsFromPoint + setPointerCapture + manual transform
```

#### ❌ 在 DndContext.onDragEnd 中做复杂逻辑

```tsx
// 不要这样做
onDragEnd={(event) => {
  // 复杂的 splice + API call + state update
}}
```

应将排序逻辑封装在域 hook 中，DndContext 只负责提取 `active.id` / `over.id` 并调用 handler。

## 网络操作超时模式

所有 git 网络操作（push/pull/fetch）必须使用 `withTimeout` 包装，防止后端阻塞时 UI 永久挂死：

```typescript
import { withTimeout } from '@/shared/utils/withTimeout';

// 网络操作：60 秒超时
await withTimeout(commands.push(false), 60_000, 'push');
await withTimeout(commands.pull(), 60_000, 'pull');

// 本地操作：30 秒超时
await withTimeout(commands.commitFiles(files, message), 30_000, 'commit');
```

当前已覆盖的网络操作路径（需保持同步）：

| 触发路径 | 文件 | push | pull | fetch |
|---------|------|------|------|-------|
| Git Control → Changes | `GitCommitPanel.tsx`（由 `GitControlPanel` 挂载） | ✅ | ✅ | ✅ |
| CommitDialog | `CommitDialog.tsx` | ✅ | ✅ | - |
| ProjectsPanel 右键 | `ProjectsPanel.tsx` | ✅ | ✅ | - |

---

## 键盘快捷键按 Tab 域限定

### 背景

合并后 Dock 面板（如 GitControlPanel）包含多个 Tab，各 Tab 有各自的键盘快捷键。需要在全局 `keydown` 监听中根据当前激活 Tab 做域限定，防止快捷键跨 Tab 误触。

### 模式

```tsx
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  // 1. 让出非当前 Tab
  if (tab !== 'history') return;

  // 2. contentEditable / input guard
  const target = e.target as HTMLElement;
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // 3. 快捷键处理
  switch (e.key) {
    case 'c': handleCopyDiff(...); break;
    case 'k': handleMoveUp(); break;
    case 'j': handleMoveDown(); break;
  }
}, [tab, ...]);
```

### 规则

1. **第一道关卡**：`tab !== 'xxx'` return，非当前 Tab 直接放行
2. **第二道关卡**：`contentEditable / INPUT / TEXTAREA` 守卫，防止编辑器内触发热键
3. **依赖数组包含 `tab`**：确保 `keydown` 回调能感知 Tab 切换
4. **顶层解绑**：Wrapper 的 `useEffect` 返回 `removeEventListener` 清理

### 反模式

❌ 非当前 Tab 的子组件依然绑定全局 `keydown` 监听：

```tsx
// Changes tab 下 GitLogPanel 依然监听 J/K → 按键被误吞
```

❌ 缺少 contentEditable 守卫：

```tsx
// 用户在 commit message 输入框按 'j' → 触发了 GitLog 光标移动
```

---

## 终端 IME 输入：精确抑制 compositionend 后的 onData

### 背景

xterm.js 的 `onData` 与浏览器 `compositionend` 存在时序问题。如果 `compositionend` 后**无条件抑制下一个 `onData`**，按空格确认 IME 候选时，紧随其后的空格 `onData(' ')` 会被吞掉，表现为终端里空格键失效。

### 正确做法

记录 `compositionPendingText`，仅抑制内容与 pending text 完全相同的 `onData`。

```ts
let compositionPendingText: string | null = null;

compositionStartHandler = () => {
  composing = true;
  compositionPendingText = null;
};

compositionEndHandler = (e: CompositionEvent) => {
  composing = false;
  const text = e.data;
  if (text) {
    compositionPendingText = text;
    sendInput(text);
  }
};

term.onData((data) => {
  if (composing) return;

  if (compositionPendingText !== null) {
    if (data === compositionPendingText) {
      compositionPendingText = null;
      return;
    }
    compositionPendingText = null;
  }

  sendInput(data);
});
```

### 错误做法

```ts
// 不要这样做 —— 会吞掉 IME 确认后紧随的空格
suppressNextOnData = true;
setTimeout(() => {
  suppressNextOnData = false;
}, 0);
```

### 测试断言

| 场景 | 期望行为 |
|------|---------|
| 普通空格 `onData(' ')` | 正常转发到 PTY |
| `compositionend('中')` 后 `onData(' ')` | 空格正常转发，不被抑制 |
| `compositionend('中')` 后 `onData('中')` | 被抑制，避免重复发送 |

---

### 9. Modifiers 说明

- `restrictToVerticalAxis`：锁定垂直轴，防止水平漂移
- `restrictToParentElement`：限制拖拽范围在父容器内，防止拖出可见区域
