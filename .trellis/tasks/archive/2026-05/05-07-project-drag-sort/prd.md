# 任务：修复项目列表拖拽排序功能

## 概述

修复当前项目列表拖拽排序功能失效的问题，并扩展支持 WSL 和 SSH 远程项目列表的拖拽排序能力。

## 问题描述

### 当前状态
1. **本地项目列表拖拽排序功能失效** - HTML5 Drag API 与 Tauri 窗口拖拽在 Windows 上冲突（`data-tauri-drag-region` 导致窗口移动而非项目排序）。
2. **WSL/SSH 项目列表没有拖拽排序支持** - 只有本地项目支持排序。

### 根因
- HTML5 `draggable` 属性和 `onDragStart`/`onDragOver`/`onDrop` 事件在 Windows 上会触发 Tauri 窗口拖拽，因为标题栏元素有 `-webkit-app-region: drag`。
- 拖拽视觉反馈 CSS（`.dragging`、`.drag-over`）在 Tailwind 迁移时被移除。

## 需求

### 1. 修复本地项目列表拖拽排序
- 使用 **Pointer Events** 方案替代 HTML5 Drag API，避免 Windows 上与 Tauri 窗口拖拽冲突。
- 恢复拖拽期间的视觉反馈：
  - 被拖拽项目：透明度降低、缩放、微旋转、悬浮阴影
  - 放置目标：蓝色顶部边框指示器带发光效果
  - 被拖拽项目跟随鼠标移动：通过 `transform: translate(offsetX, offsetY)` 实时跟踪光标位置，让用户直观地看到项目正在被拖动
- 基于阈值的激活（5px 移动）防止误触发。

### 2. 支持 WSL 项目列表拖拽排序
- 支持在同一 WSL distro 条目内的拖拽排序。
- 跨不同 WSL distro 条目拖拽：视觉上允许但逻辑上忽略（与本地项目行为一致）。
- 通过 `saveSession()` 持久化新顺序。

### 3. 支持 SSH 远程项目列表拖拽排序
- 支持在同一 SSH 远程条目内的拖拽排序。
- 跨不同 SSH 远程条目拖拽：视觉上允许但逻辑上忽略。
- 通过 `saveSession()` 持久化新顺序。

### 4. 组件架构（低耦合、高内聚）
- `useProjectItemDrag` hook：纯逻辑层 - pointer 事件、阈值检测、目标查找、`dragOffset` 实时偏移量计算。无样式知识。
- `DraggableProjectItem` 组件：纯表现层 - 通过 `cn()` 组合 Tailwind 类、`transform: translate()` 实现拖拽跟随、放置指示器。无业务逻辑。
- 各项目组件（`ProjectItem`、`ConnectionProjectCard`）使用 `DraggableProjectItem` 包装。

## 设计约束

### 样式指南（shadcn/ui 原则）
- 使用 `cn()` 工具函数处理条件类名。
- 使用 `gap-*` 而非 `space-y-*`。
- 使用语义化颜色（`bg-accent-blue`、`text-text-muted`）。
- 组件样式应使用 Tailwind 工具类，而非自定义 CSS 类。

### 交互设计
- 交互元素（按钮、链接、输入框）不能触发拖拽 - 使用 `[data-no-drag]` 属性过滤。
- 拖拽激活需要最小 5px 指针移动以防止误触发。
- 拖拽期间禁用正文文本选择（`user-select: none`）。
- 活动拖拽时光标变为 `grabbing`。

## 技术说明

### 前端架构
```
src/components/project/
├── useProjectItemDrag.ts      # 纯逻辑 hook
├── DraggableProjectItem.tsx   # 纯表现包装器

src/components/connections/
├── ConnectionProjectCard.tsx   # 使用 DraggableProjectItem
├── RemoteItems.tsx            # 传递 onDragEnd 回调
```

### 后端变更
- 本地项目排序：现有的 `invoke("reorder_projects", { orderedIds })` 命令已足够。
- WSL/SSH 项目排序：前端通过 `saveSession()` 处理，无需新的后端命令。

### 测试要求
- `useLocalProjects` 中 `handleDragEnd` 的单元测试。
- `useWslProjects` 中 `handleWslDragEnd` 的单元测试。
- `useRemoteProjects` 中 `handleRemoteDragEnd` 的单元测试。
- 测试场景：
  - 列表内正常排序。
  - 拖拽到相同位置（无操作）。
  - 跨条目拖拽被忽略（仅 WSL/SSH）。
  - 排序后调用持久化。

## 验收标准

- [ ] 本地项目拖拽排序在 Windows 上正常工作，不会触发窗口移动。
- [ ] 被拖拽项目有清晰的视觉反馈（透明度、缩放、阴影）。
- [ ] 被拖拽项目跟随鼠标移动（`transform: translate`），用户可直观感知拖拽动作。
- [ ] 放置目标有清晰的视觉指示（蓝色边框带发光）。
- [ ] WSL 项目列表支持在同一 distro 内的拖拽排序。
- [ ] SSH 远程项目列表支持在同一 host 内的拖拽排序。
- [ ] 拖拽后新顺序被持久化（通过 `saveSession` 或 `reorder_projects`）。
- [ ] 所有新/修改的代码通过 `pnpm type-check`。
- [ ] 所有新测试通过（`pnpm test:run`）。
- [ ] 没有引入新的 lint 警告。

## 范围外
- 跨 WSL distro 或跨 SSH host 的拖拽排序（此应用不支持此 UX）。
- 除了 pointer events 外的触摸手势支持（未来增强）。
- 自定义拖拽预览/幽灵元素（仅视觉，无功能）。
- 拖拽动画的缓动曲线优化（后续增强）。