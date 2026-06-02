# Replace Custom Drag with @dnd-kit

## 背景

当前 ProjectsPanel 中项目卡片的拖拽排序使用自实现的 Pointer Events 方案（`useProjectItemDrag` + `DraggableProjectItem`）。存在两个根因 bug：

1. **抖动** — CSS `transition-[transform]` 与每帧 `setDragOffset` 冲突，导致元素永远追不上指针
2. **无法变更顺序** — `document.elementsFromPoint` + `closest("[data-drag-id]")` 在列表边缘（空白区域）返回 null，拖拽静默失败

## 目标

用 `@dnd-kit/core` + `@dnd-kit/sortable` 替换自实现拖拽，修复上述两个 bug。

## 范围

### 需要修改的文件

| 文件 | 操作 |
|---|---|
| `package.json` | 添加 `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers`, `@dnd-kit/utilities` |
| `src/features/project/components/useProjectItemDrag.ts` | **删除** |
| `src/features/project/components/DraggableProjectItem.tsx` | **删除** |
| `src/features/project/components/ProjectItem.tsx` | 改用 `useSortable` hook |
| `src/features/project/components/ProjectsPanel.tsx` | 外层包 `DndContext` + `SortableContext`（local 区域） |
| `src/features/connection/components/ConnectionProjectCard.tsx` | 改用 `useSortable` hook |
| `src/features/connection/components/RemoteItems.tsx` | 每个 entry 内包 `DndContext` + `SortableContext` |
| `src/features/project/components/index.ts` | 移除 `DraggableProjectItem`、`useProjectItemDrag`、相关 type 导出 |
| `src/features/project/index.ts` | 移除 `DraggableProjectItem`、`useProjectItemDrag`、相关 type 导出 |
| `src/features/project/components/projectItemTypes.ts` | `onDragEnd` 签名不变 |
| `src/features/project/hooks/__tests__/useLocalProjects.test.ts` | 无需修改（handleDragEnd 逻辑不变） |

### 不需要修改

- `useLocalProjects.handleDragEnd` — 业务逻辑保持不变
- `useWslProjects.handleWslDragEnd` — 业务逻辑保持不变
- `useRemoteProjects.handleRemoteDragEnd` — 业务逻辑保持不变
- `projectApi.reorderProjects` — API 层不变
- 后端 Rust 代码 — 完全不涉及

## 技术方案

### 依赖

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers @dnd-kit/utilities
```

### Local 项目区域

`ProjectsPanel.tsx` 中 local 项目列表包裹：

```tsx
<DndContext
  collisionDetection={closestCenter}
  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
  onDragEnd={({ active, over }) => {
    if (over && active.id !== over.id) {
      onDragEnd(String(active.id), String(over.id));
    }
  }}
>
  <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
    {projects.map(p => <ProjectItem ... />)}
  </SortableContext>
</DndContext>
```

### WSL / Remote 区域

每个 entry 内部独立包裹 `DndContext` + `SortableContext`（不支持跨 entry 拖拽，保持现有行为）。

### ProjectItem / ConnectionProjectCard

替换为 `useSortable` hook：

```tsx
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
const style = {
  transform: CSS.Transform.toString(transform),
  transition,
};
```

- `listeners` 绑定到整个卡片（排除 `data-no-drag` 子元素的事件过滤保留）
- `isDragging` 用于视觉反馈（opacity、shadow）
- 保留 `cursor-grab` / `cursor-grabbing` 样式

### Drop 指示器

使用 dnd-kit 内置的 sortable 动画（其他元素自动让位），不再需要手动渲染蓝色指示条。如需保留蓝色 indicator 视觉，可用 `DragOverlay` + CSS。

## 验收标准

1. Local 项目可拖拽排序，松手后顺序持久化到后端
2. WSL entry 内项目可拖拽排序，松手后持久化
3. Remote entry 内项目可拖拽排序，松手后持久化
4. 拖拽无抖动，元素跟随指针流畅
5. 拖拽到列表首尾均可正确放置
6. `data-no-drag` 区域（如 worktree 删除按钮）点击不触发拖拽
7. `pnpm type-check` 通过
8. `pnpm lint` 通过
9. 现有 `useLocalProjects.test.ts` 中 `handleDragEnd` 测试通过
